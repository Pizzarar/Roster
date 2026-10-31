import type { PluginServerContext } from "@getpaseo/plugin/server";
import { execCommand } from "@getpaseo/plugin/server";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  isBrainstormAgent,
  isLeadAgent,
  normalizePath,
  type BoardConfig,
} from "../shared/config";
import type { AutoArchiveItem, AutoArchivePass, AutoArchiveState } from "../shared/auto-archive";
import { checkWorkspaceMerges } from "./workspaces";

type PaseoApi = Parameters<Parameters<PluginServerContext["handle"]>[1]>[1]["paseo"];

/** The agent fields the pass reads. */
interface AgentSnapshot {
  readonly id: string;
  readonly title: string | null;
  readonly status: string;
  readonly cwd: string;
  readonly workspaceId?: string | null;
  readonly createdAt?: string | null;
  readonly updatedAt?: string | null;
  readonly archivedAt?: string | null;
  readonly internal?: boolean;
  readonly labels: Readonly<Record<string, string>>;
}

const MAX_ITEMS = 50;
const PAGE_LIMIT = 200;
const DAY_MS = 86_400_000;
const TICK_MS = 600_000;
const STARTUP_DELAY_MS = 5_000;

function stateFile(): string {
  const home = process.env.PASEO_HOME || join(homedir(), ".paseo");
  return join(home, "plugin-data", "roster", "auto-archive.json");
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function paseoCandidates(): string[] {
  const env = process.env.PASEO_CLI;
  const appData = process.env.APPDATA;
  const localAppData = process.env.LOCALAPPDATA;
  const candidates: string[] = [];
  if (env) candidates.push(env);
  candidates.push("paseo");
  if (appData) candidates.push(join(appData, "npm", "paseo.cmd"));
  if (localAppData) candidates.push(join(localAppData, "Programs", "Paseo", "resources", "bin", "paseo.cmd"));
  return candidates;
}

async function unarchiveAgent(agentId: string): Promise<void> {
  const candidates = paseoCandidates();
  let lastError: unknown = null;
  for (const cmd of candidates) {
    try {
      await execCommand(cmd, ["agent", "reload", "--json", agentId], { timeout: 30_000 });
      return;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error(`Failed to unarchive agent ${agentId}`);
}

const EMPTY: AutoArchiveState = { lastRunAt: null, lastRunDry: false, lastCount: 0, items: [], passes: [] };

/** Archives agents and Paseo-owned worktrees that have sat idle past the configured thresholds. */
export class AutoArchiver {
  private state: AutoArchiveState = EMPTY;
  private paseo: PaseoApi | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly ready: Promise<void>;
  private startupRan = false;
  private lastScheduledAt = Date.now();
  private timers: ReturnType<typeof setTimeout>[] = [];
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly getConfig: () => BoardConfig) {
    this.ready = this.load();
  }

  bind(paseo: PaseoApi) {
    this.paseo = paseo;
    if (!this.startupRan) {
      this.startupRan = true;
      void this.runPass().catch((error) => console.error(`auto-archive failed: ${message(error)}`));
    }
  }

  /** Start the schedule; the returned function stops it. */
  start(): () => void {
    this.interval = setInterval(() => {
      const cfg = this.getConfig();
      if (!this.paseo || Date.now() - this.lastScheduledAt < cfg.autoArchiveIntervalMs) return;
      void this.runPass().catch((error) => console.error(`auto-archive failed: ${message(error)}`));
    }, TICK_MS);
    this.timers.push(
      setTimeout(() => {
        if (this.startupRan || !this.paseo) return;
        this.startupRan = true;
        void this.runPass().catch((error) => console.error(`auto-archive failed: ${message(error)}`));
      }, STARTUP_DELAY_MS),
    );
    return () => {
      if (this.interval) clearInterval(this.interval);
      this.interval = null;
      for (const timer of this.timers) clearTimeout(timer);
      this.timers = [];
    };
  }

  async snapshot(): Promise<AutoArchiveState> {
    await this.ready;
    return this.state;
  }

  private async load() {
    try {
      const parsed = JSON.parse(await readFile(stateFile(), "utf8")) as Partial<AutoArchiveState>;
      this.state = {
        lastRunAt: parsed.lastRunAt ?? null,
        lastRunDry: Boolean(parsed.lastRunDry),
        lastCount: parsed.lastCount ?? 0,
        items: Array.isArray(parsed.items) ? parsed.items.slice(0, MAX_ITEMS) : [],
        passes: Array.isArray(parsed.passes) ? parsed.passes.slice(0, MAX_ITEMS) : [],
      };
    } catch {
      this.state = EMPTY;
    }
  }

  private async save() {
    const file = stateFile();
    try {
      await mkdir(dirname(file), { recursive: true });
      const temp = `${file}.tmp`;
      await writeFile(temp, JSON.stringify(this.state, null, 2), "utf8");
      await rename(temp, file);
    } catch (error) {
      console.error(`auto-archive state not saved: ${message(error)}`);
    }
  }

  runPass(options?: { dryRun?: boolean; paseo?: PaseoApi }): Promise<AutoArchiveState> {
    if (options?.paseo) this.paseo = options.paseo;
    const next = this.queue.then(() => this.ready).then(() => this.pass(options));
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async pass(options?: { dryRun?: boolean }): Promise<AutoArchiveState> {
    const paseo = this.paseo;
    if (!paseo) return this.state;
    const cfg = this.getConfig();
    const dryRun = options?.dryRun ?? cfg.autoArchiveDryRun;
    const forced = options?.dryRun === true;
    const now = Date.now();
    const at = new Date(now).toISOString();
    this.lastScheduledAt = now;
    const found: AutoArchiveItem[] = [];

    const result = await paseo.agents.list({
      includeBackground: true,
      filter: { includeBackground: true },
      page: { limit: PAGE_LIMIT },
    });
    const agents = result.entries
      .map(({ agent }) => agent as AgentSnapshot)
      .filter((agent) => !agent.archivedAt && !agent.internal);

    const archivedAgents = new Set<string>();
    if (cfg.autoArchiveAgents || forced) {
      const leads = agents.filter((agent) => isLeadAgent(agent.title, agent.labels, cfg));
      const leadKeys = new Set(
        leads.map((lead) => lead.labels[cfg.labels.lead]?.toLowerCase()).filter((key): key is string => Boolean(key)),
      );
      const leadFolders = new Set(leads.map((lead) => normalizePath(lead.cwd)));
      for (const agent of agents) {
        if (agent.status === "running" || agent.status === "initializing") continue;
        if (isLeadAgent(agent.title, agent.labels, cfg)) continue;
        if (isBrainstormAgent(agent.title, agent.labels, cfg)) {
          const key = agent.labels[cfg.labels.lead]?.toLowerCase();
          const alive =
            (key !== undefined && leadKeys.has(key)) ||
            leadFolders.has(normalizePath(agent.cwd)) ||
            (!key && leads.length > 0);
          if (alive) continue;
        }
        const last = Date.parse(agent.updatedAt ?? agent.createdAt ?? "");
        const idleMs = Number.isFinite(last) ? now - last : 0;
        if (idleMs < cfg.autoArchiveAgentMs) continue;
        if (!dryRun) {
          try {
            await paseo.agents.ref(agent.id).archive();
            archivedAgents.add(agent.id);
          } catch (error) {
            console.error(`auto-archive agent ${agent.id} failed: ${message(error)}`);
            continue;
          }
        }
        found.push({
          id: agent.id,
          kind: "agent",
          name: agent.title?.trim() || agent.id.slice(0, 8),
          directory: agent.cwd,
          reason: `idle ${Math.floor(idleMs / DAY_MS)}d`,
          dryRun,
          at,
        });
      }
    }

    if (cfg.autoArchiveWorkspaces || forced) {
      const live = agents.filter((agent) => !archivedAgents.has(agent.id));
      const workspaces = (await paseo.workspaces.list({ page: { limit: PAGE_LIMIT } })).entries;
      const byId = new Set(live.map((agent) => agent.workspaceId).filter((id): id is string => Boolean(id)));
      const byDir = new Set(live.map((agent) => normalizePath(agent.cwd)));
      const candidates = workspaces.filter((w) => {
        if (w.internal || w.archivingAt || w.pinnedAt || w.workspaceKind !== "worktree") return false;
        if (w.gitRuntime?.isPaseoOwnedWorktree === false) return false;
        if (!w.scripts.every((script) => script.lifecycle !== "running")) return false;
        const directory = w.workspaceDirectory ?? w.projectRootPath;
        if (byId.has(w.id) || byDir.has(normalizePath(directory))) return false;
        const last = Date.parse(w.activityAt ?? w.createdAt ?? "");
        const idleMs = Number.isFinite(last) ? now - last : 0;
        return idleMs >= cfg.autoArchiveWorkspaceMs;
      });
      if (candidates.length > 0) {
        const { merges } = await checkWorkspaceMerges({
          workspaces: candidates.map((w) => ({
            id: w.id,
            directory: w.workspaceDirectory ?? w.projectRootPath,
            branch: w.gitRuntime?.currentBranch ?? null,
          })),
        });
        for (const w of candidates) {
          const info = merges[w.id];
          const merged = w.githubRuntime?.pullRequest?.isMerged === true || Boolean(info?.merged) || Boolean(info?.upstreamGone);
          if (info?.dirty !== false || !merged) continue;
          const last = Date.parse(w.activityAt ?? w.createdAt ?? "");
          const idleMs = Number.isFinite(last) ? now - last : 0;
          if (!dryRun) {
            try {
              const res = await paseo.workspaces.archive(w.id);
              if (res.error) continue;
            } catch (error) {
              console.error(`auto-archive workspace ${w.id} failed: ${message(error)}`);
              continue;
            }
          }
          const prNumber = info?.prNumber ?? w.githubRuntime?.pullRequest?.number ?? null;
          found.push({
            id: w.id,
            kind: "workspace",
            name: w.title?.trim() || w.name,
            project: w.projectCustomName?.trim() || w.projectDisplayName,
            directory: w.workspaceDirectory ?? w.projectRootPath,
            reason: `${prNumber ? `PR #${prNumber} merged` : "merged"} · idle ${Math.floor(idleMs / DAY_MS)}d`,
            dryRun,
            at,
          });
        }
      }
    }

    const passEntry: AutoArchivePass = {
      at,
      dryRun,
      agentIds: found.filter((i) => i.kind === "agent").map((i) => i.id),
      workspaces: found
        .filter((i) => i.kind === "workspace")
        .map((i) => ({ id: i.id, name: i.name, directory: i.directory ?? "" })),
    };

    this.state = {
      lastRunAt: at,
      lastRunDry: dryRun,
      lastCount: found.length,
      items: [...found, ...this.state.items].slice(0, MAX_ITEMS),
      passes: [passEntry, ...(this.state.passes ?? [])].slice(0, MAX_ITEMS),
    };
    await this.save();
    return this.state;
  }

  undo(options?: {
    itemId?: string;
    at?: string;
    paseo?: PaseoApi;
  }): Promise<{ state: AutoArchiveState; restored: number; failed: string[] }> {
    if (options?.paseo) this.paseo = options.paseo;
    const next = this.queue.then(() => this.ready).then(() => this.runUndo(options));
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async runUndo(options?: {
    itemId?: string;
    at?: string;
  }): Promise<{ state: AutoArchiveState; restored: number; failed: string[] }> {
    const paseo = this.paseo;
    let restored = 0;
    const failed: string[] = [];
    const nowIso = new Date().toISOString();

    let targetItems: AutoArchiveItem[] = [];
    if (options?.itemId) {
      targetItems = this.state.items.filter(
        (item) => item.id === options.itemId && (!options.at || item.at === options.at) && !item.dryRun && !item.undoneAt,
      );
    } else {
      const targetAt = options?.at ?? this.state.items.find((i) => !i.dryRun && !i.undoneAt)?.at;
      targetItems = this.state.items.filter(
        (item) => Boolean(targetAt) && item.at === targetAt && !item.dryRun && !item.undoneAt,
      );
    }

    for (const item of targetItems) {
      if (item.kind === "agent") {
        try {
          await unarchiveAgent(item.id);
          item.undoneAt = nowIso;
          delete item.undoError;
          restored += 1;
        } catch (error) {
          item.undoError = message(error);
          failed.push(`${item.name}: ${item.undoError}`);
        }
      } else if (item.kind === "workspace") {
        const dir = item.directory;
        const st = dir ? await stat(dir).catch(() => null) : null;
        if (!dir || !st?.isDirectory()) {
          item.undoError = "can't restore: folder deleted";
          failed.push(`${item.name}: can't restore: folder deleted`);
        } else if (!paseo) {
          item.undoError = "Paseo API not connected";
          failed.push(`${item.name}: Paseo API not connected`);
        } else {
          try {
            await paseo.workspaces.open(dir);
            item.undoneAt = nowIso;
            delete item.undoError;
            restored += 1;
          } catch (error) {
            item.undoError = message(error);
            failed.push(`${item.name}: ${item.undoError}`);
          }
        }
      }
    }

    if (this.state.passes) {
      for (const pass of this.state.passes) {
        const passItems = this.state.items.filter((item) => item.at === pass.at && !item.dryRun);
        if (passItems.length > 0 && passItems.every((item) => Boolean(item.undoneAt))) {
          pass.undoneAt = pass.undoneAt ?? nowIso;
        }
      }
    }

    await this.save();
    return { state: this.state, restored, failed };
  }
}
