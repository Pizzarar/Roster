import type { RpcInput } from "@getpaseo/plugin";
import { execCommand, type PluginServerContext } from "@getpaseo/plugin/server";
import { resolveProviderAutoMode, type createBrainstormRpc, type renameBrainstormRpc } from "../shared/brainstorm";
import type { BoardConfig } from "../shared/config";

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
  { leadId, leadTitle, area, cwd, profile, modeId: modeInput }: RpcInput<typeof createBrainstormRpc>,
  paseo: PaseoApi,
  cfg: BoardConfig,
) {
  const title = `BRAINSTORM · ${area}`;
  const slug = area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";

  const configRes = await paseo.config.get().catch(() => null);
  const daemonConfig = configRes?.config as
    | (NonNullable<typeof configRes>["config"] & { daemon?: { agentProfiles?: NonNullable<typeof configRes>["config"]["agentProfiles"] } })
    | undefined;
  const profiles = daemonConfig?.agentProfiles ?? daemonConfig?.daemon?.agentProfiles ?? [];
  const wantedProfile = profile?.trim() || cfg.brainstormProfile;
  const matched =
    (wantedProfile ? profiles.find((p) => p.id === wantedProfile || p.name === wantedProfile) : undefined) ??
    profiles.find((p) => /brainstorm/i.test(p.name));

  const providerId = matched ? matched.provider : "claude";
  const providerSpec = matched
    ? matched.model
      ? `${matched.provider}/${matched.model}`
      : matched.provider
    : "claude/claude-opus-5-5";

  const modes = await paseo.providers.listModes(providerId as never, { cwd }).catch(() => []);
  const availableModeIds = (modes as readonly { id: string }[]).map((mode) => mode.id);
  const requestedMode = modeInput?.trim() || cfg.brainstormModeId || "auto";
  let modeId: string;
  if (requestedMode === "auto") modeId = resolveProviderAutoMode(providerId, availableModeIds);
  else if (requestedMode === "profile") modeId = matched?.modeId || resolveProviderAutoMode(providerId, availableModeIds);
  else if (availableModeIds.length === 0 || availableModeIds.includes(requestedMode)) modeId = requestedMode;
  else modeId = resolveProviderAutoMode(providerId, availableModeIds);

  const handle = await paseo.agents.create({
    cwd,
    title,
    labels: { role: "brainstorm", lead: slug },
    config: {
      provider: providerSpec,
      modeId,
      thinkingOptionId: matched?.thinkingOptionId ?? "medium",
      ...(matched?.featureValues ? { featureValues: matched.featureValues } : {}),
    },
    prompt: `You are the Brainstorm chat for ${area} (${cwd}). Current active lead: "${leadTitle}" (${leadId}). Riff with Aub here and dispatch or message the lead when approved.`,
  });
  return { ok: true, message: `Created ${title} (${matched?.name ?? providerSpec}, ${modeId})`, agentId: handle.id };
}
