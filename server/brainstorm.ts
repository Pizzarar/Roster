import type { RpcInput } from "@getpaseo/plugin";
import { execCommand, type PluginServerContext } from "@getpaseo/plugin/server";
import type { createBrainstormRpc, renameBrainstormRpc } from "../shared/brainstorm";

type PaseoApi = Parameters<Parameters<PluginServerContext["handle"]>[1]>[1]["paseo"];

function paseoCandidates(): string[] {
  const candidates: string[] = [];
  if (process.env.PASEO_CLI) {
    candidates.push(process.env.PASEO_CLI);
  }
  candidates.push("paseo");
  if (process.env.APPDATA) {
    candidates.push(`${process.env.APPDATA}\\npm\\paseo.cmd`);
  }
  if (process.env.LOCALAPPDATA) {
    candidates.push(`${process.env.LOCALAPPDATA}\\Programs\\Paseo\\resources\\bin\\paseo.cmd`);
  }
  return candidates;
}

function messageOf(error: unknown): string {
  const stderr = (error as { stderr?: unknown }).stderr;
  if (typeof stderr === "string" && stderr.trim()) return stderr.trim();
  return error instanceof Error ? error.message : String(error);
}

export async function renameBrainstorm({ agentId, title, leadKey }: RpcInput<typeof renameBrainstormRpc>) {
  let lastError = "paseo CLI not found";
  const args = [
    "agent",
    "update",
    agentId,
    "--name",
    title,
    "--label",
    "role=brainstorm",
    ...(leadKey ? ["--label", `lead=${leadKey}`] : []),
  ];

  for (const command of paseoCandidates()) {
    try {
      await execCommand(command, args, { timeout: 30_000 });
      return { ok: true, message: `Renamed to ${title}` };
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      lastError = messageOf(error);
      if (code !== "ENOENT") break;
    }
  }

  return { ok: false, message: lastError };
}

export async function createBrainstorm(
  { leadId, leadTitle, area, cwd }: RpcInput<typeof createBrainstormRpc>,
  paseo: PaseoApi,
) {
  const title = `BRAINSTORM · ${area}`;
  const slug = area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
  const handle = await paseo.agents.create({
    cwd,
    title,
    labels: { role: "brainstorm", lead: slug },
    config: { provider: "claude/claude-opus-5-5", thinkingOptionId: "medium" },
    prompt: `You are the Brainstorm chat for ${area} (${cwd}). Current active lead: "${leadTitle}" (${leadId}). Riff with Aub here and dispatch or message the lead when approved.`,
  });
  return { ok: true, message: `Created ${title}`, agentId: handle.id };
}
