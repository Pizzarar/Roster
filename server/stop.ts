import type { RpcInput } from "@getpaseo/plugin";
import { execCommand } from "@getpaseo/plugin/server";
import type { stopAgentRpc } from "../shared/stop";


/** The daemon's PATH may not include the npm global bin, so try it explicitly too. */
function paseoCandidates(): string[] {
  const candidates = ["paseo"];
  if (process.platform === "win32" && process.env.APPDATA) {
    candidates.push(`${process.env.APPDATA}\\npm\\paseo.cmd`);
  }
  return candidates;
}

function messageOf(error: unknown): string {
  const stderr = (error as { stderr?: unknown }).stderr;
  if (typeof stderr === "string" && stderr.trim()) return stderr.trim();
  return error instanceof Error ? error.message : String(error);
}

export async function stopAgent({ agentId }: RpcInput<typeof stopAgentRpc>) {
  let lastError = "paseo CLI not found";
  for (const command of paseoCandidates()) {
    try {
      const { stdout } = await execCommand(command, ["stop", agentId, "--json"], { timeout: 30_000 });
      console.log(`stop ${agentId}: ${stdout.trim()}`);
      return { ok: true, message: "Stop sent" };
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      lastError = messageOf(error);
      if (code !== "ENOENT") break;
    }
  }
  console.error(`stop ${agentId} failed: ${lastError}`);
  return { ok: false, message: lastError };
}