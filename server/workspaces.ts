import type { RpcInput } from "@getpaseo/plugin";
import { execCommand } from "@getpaseo/plugin/server";
import type { checkWorkspaceMergesRpc, WorkspaceMergeInfo } from "../shared/workspaces";

const TTL_MS = 300_000;
const CONCURRENCY = 4;
const cache = new Map<string, { at: number; info: WorkspaceMergeInfo }>();

type Target = RpcInput<typeof checkWorkspaceMergesRpc>["workspaces"][number];

async function run(command: string, args: string[], options: { cwd?: string; timeout: number }): Promise<string | null> {
  try {
    const result = await execCommand(command, args, options);
    return typeof result === "string" ? result : String((result as { stdout?: unknown }).stdout ?? "");
  } catch {
    return null;
  }
}

async function inspect({ directory, branch: knownBranch }: Target): Promise<WorkspaceMergeInfo> {
  let branch = knownBranch;
  let upstreamGone = false;
  let dirty: boolean | null = null;

  const status = await run("git", ["-C", directory, "status", "--porcelain", "--branch"], { timeout: 6_000 });
  if (status !== null) {
    const lines = status.split(/\r?\n/).filter(Boolean);
    const header = lines.find((line) => line.startsWith("## ")) ?? "";
    if (!branch && header) {
      const name = header.slice(3).split("...")[0]!.split(" ")[0]!;
      if (name && name !== "HEAD" && name !== "No") branch = name;
    }
    upstreamGone = /\[[^\]]*\bgone\b[^\]]*\]/i.test(header);
    dirty = lines.length > 1;
  }

  let prNumber: number | null = null;
  let prMerged = false;
  if (branch && branch !== "main" && branch !== "master" && branch !== "HEAD") {
    const out = await run(
      "gh",
      ["pr", "list", "--head", branch, "--state", "merged", "--json", "number", "--limit", "1"],
      { cwd: directory, timeout: 10_000 },
    );
    if (out) {
      try {
        const parsed = JSON.parse(out) as { number?: number }[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          prNumber = parsed[0]?.number ?? null;
          prMerged = true;
        }
      } catch {
        // ignore malformed output
      }
    }
  }

  return { merged: Boolean(prMerged || upstreamGone), prNumber, upstreamGone, branch, dirty };
}

export async function checkWorkspaceMerges({ workspaces }: RpcInput<typeof checkWorkspaceMergesRpc>) {
  const merges: Record<string, WorkspaceMergeInfo> = {};
  const now = Date.now();
  const pending: { target: Target; key: string }[] = [];
  for (const target of workspaces) {
    const key = `${target.id}:${target.branch ?? ""}`;
    const hit = cache.get(key);
    if (hit && now - hit.at < TTL_MS) merges[target.id] = hit.info;
    else pending.push({ target, key });
  }

  let next = 0;
  const worker = async () => {
    while (next < pending.length) {
      const { target, key } = pending[next++]!;
      const info = await inspect(target);
      cache.set(key, { at: Date.now(), info });
      merges[target.id] = info;
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker));
  return { merges };
}
