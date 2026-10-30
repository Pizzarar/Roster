import type { PluginClientContext } from "@getpaseo/plugin/client";
import { useEffect, useSyncExternalStore } from "react";
import type { WorkspaceMergeInfo } from "../shared/workspaces";
import type { BoardAgent } from "./model";

type PaseoApi = PluginClientContext["paseo"];
type Workspace = Awaited<ReturnType<PaseoApi["workspaces"]["list"]>>["entries"][number];

const WORKSPACE_PAGE_LIMIT = 200;

/** The workspace fields Roster reads. */
export interface BoardWorkspace {
  readonly id: string;
  readonly projectId: string;
  readonly project: string;
  readonly name: string;
  readonly directory: string;
  readonly kind: Workspace["workspaceKind"];
  readonly status: Workspace["status"];
  readonly pinned: boolean;
  readonly archiving: boolean;
  readonly activityAt: string | null;
  readonly createdAt: string | null;
  readonly branch: string | null;
  /** Archiving deletes the folder: a worktree Paseo created. */
  readonly ownedWorktree: boolean;
  readonly dirty: boolean | null;
  /** Commits not on the base branch or origin; null when unknown. */
  readonly ahead: number | null;
  readonly pr: { readonly number: number | null; readonly state: string; readonly merged: boolean } | null;
  readonly runningServices: number;
  /** The PR merged, or its upstream branch is gone (squash merges leave commits ahead). */
  readonly merged: boolean;
  readonly upstreamGone: boolean;
}

function applyMerge(workspace: BoardWorkspace, info: WorkspaceMergeInfo | undefined): BoardWorkspace {
  if (!info) return workspace;
  return {
    ...workspace,
    branch: workspace.branch ?? info.branch,
    dirty: workspace.dirty ?? info.dirty,
    merged: Boolean(workspace.pr?.merged || info.merged || info.upstreamGone),
    upstreamGone: Boolean(info.upstreamGone),
    pr: workspace.pr
      ? { ...workspace.pr, number: workspace.pr.number ?? info.prNumber, merged: Boolean(workspace.pr.merged || info.merged) }
      : info.merged
        ? { number: info.prNumber, state: "MERGED", merged: true }
        : null,
  };
}

function toBoard(workspace: Workspace): BoardWorkspace {
  const git = workspace.gitRuntime ?? null;
  const pr = workspace.githubRuntime?.pullRequest ?? null;
  const ahead = git?.aheadOfOrigin ?? git?.aheadBehind?.ahead ?? null;
  return {
    id: workspace.id,
    projectId: workspace.projectId,
    project: workspace.projectCustomName?.trim() || workspace.projectDisplayName,
    name: workspace.title?.trim() || workspace.name,
    directory: workspace.workspaceDirectory ?? workspace.projectRootPath,
    kind: workspace.workspaceKind,
    status: workspace.status,
    pinned: Boolean(workspace.pinnedAt),
    archiving: Boolean(workspace.archivingAt),
    activityAt: workspace.activityAt ?? null,
    createdAt: workspace.createdAt ?? null,
    branch: git?.currentBranch ?? null,
    ownedWorktree: workspace.workspaceKind === "worktree" && git?.isPaseoOwnedWorktree !== false,
    dirty: git?.isDirty ?? null,
    ahead,
    pr: pr ? { number: pr.number ?? null, state: pr.state, merged: pr.isMerged } : null,
    runningServices: workspace.scripts.filter((script) => script.lifecycle === "running").length,
    merged: pr?.isMerged === true,
    upstreamGone: false,
  };
}

export interface WorkspaceState {
  readonly status: "idle" | "loading" | "ready" | "error";
  readonly error: string | null;
  readonly workspaces: ReadonlyMap<string, BoardWorkspace>;
  readonly truncated: boolean;
}

const INITIAL: WorkspaceState = { status: "idle", error: null, workspaces: new Map(), truncated: false };

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One owned `workspaces.list` subscription, open only while a Workspaces screen is mounted. */
class WorkspaceStore {
  private state: WorkspaceState = INITIAL;
  private readonly listeners = new Set<() => void>();
  private paseo: PaseoApi | null = null;
  private users = 0;
  private lifetime: AbortController | null = null;
  private release: (() => Promise<void>) | null = null;
  private generation = 0;
  private merges = new Map<string, WorkspaceMergeInfo>();

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = () => this.state;

  private set(patch: Partial<WorkspaceState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  /** Fold server-side merge detection into the loaded workspaces. */
  applyMerges(merges: Record<string, WorkspaceMergeInfo>) {
    for (const [id, info] of Object.entries(merges)) this.merges.set(id, info);
    const workspaces = new Map<string, BoardWorkspace>();
    for (const [id, workspace] of this.state.workspaces) workspaces.set(id, applyMerge(workspace, this.merges.get(id)));
    this.set({ workspaces });
  }

  start(paseo: PaseoApi) {
    this.paseo = paseo;
    if (this.users > 0) void this.open();
  }

  async stop() {
    this.paseo = null;
    await this.close();
    this.state = INITIAL;
  }

  /** Keep the subscription open while the returned release has not been called. */
  use(): () => void {
    this.users += 1;
    if (this.users === 1) void this.open();
    return () => {
      this.users -= 1;
      if (this.users === 0) void this.close();
    };
  }

  retry() {
    void this.open();
  }

  private async close() {
    this.generation += 1;
    this.lifetime?.abort();
    this.lifetime = null;
    const release = this.release;
    this.release = null;
    await release?.().catch(() => undefined);
  }

  private async open() {
    const paseo = this.paseo;
    if (!paseo) return;
    await this.close();
    const generation = this.generation;
    const lifetime = new AbortController();
    this.lifetime = lifetime;
    this.set({ status: "loading", error: null });
    try {
      const result = await paseo.workspaces.list({
        subscribe: {},
        sort: [{ key: "activity_at", direction: "desc" }],
        page: { limit: WORKSPACE_PAGE_LIMIT },
      });
      const { subscription } = result;
      if (generation !== this.generation) {
        void subscription.release().catch(() => undefined);
        return;
      }
      this.release = () => subscription.release();
      const replace = (entries: readonly Workspace[], hasMore: boolean) => {
        const workspaces = new Map<string, BoardWorkspace>();
        for (const workspace of entries) if (!workspace.internal) workspaces.set(workspace.id, applyMerge(toBoard(workspace), this.merges.get(workspace.id)));
        this.set({ status: "ready", error: null, workspaces, truncated: hasMore });
      };
      replace(result.entries, result.pageInfo.hasMore);
      subscription.subscribe({
        snapshot: (snapshot) => {
          if (generation === this.generation) replace(snapshot.entries, snapshot.pageInfo.hasMore);
        },
        update: (update) => {
          if (generation !== this.generation || update.type !== "workspace_update") return;
          const payload = update.payload;
          const workspaces = new Map(this.state.workspaces);
          if (payload.kind === "upsert" && !payload.workspace.internal) {
            workspaces.set(payload.workspace.id, applyMerge(toBoard(payload.workspace), this.merges.get(payload.workspace.id)));
          } else {
            workspaces.delete(payload.kind === "upsert" ? payload.workspace.id : payload.id);
          }
          this.set({ workspaces });
        },
        error: (error) => {
          if (generation === this.generation) this.set({ status: "error", error: message(error) });
        },
      });
    } catch (error) {
      if (generation === this.generation && !lifetime.signal.aborted) {
        this.set({ status: "error", error: message(error) });
      }
    }
  }
}

export const workspaceStore = new WorkspaceStore();

/** Subscribe to workspaces while mounted. */
export function useWorkspaces(): WorkspaceState {
  useEffect(() => workspaceStore.use(), []);
  return useSyncExternalStore(workspaceStore.subscribe, workspaceStore.getSnapshot, workspaceStore.getSnapshot);
}

// ---- cleanup model -----------------------------------------------------------------

export type CleanupVerdict =
  /** Nothing would be lost and nothing is using it. */
  | { readonly kind: "candidate"; readonly reasons: readonly string[] }
  /** Archiving is allowed but should be considered: unpushed commits, not stale yet. */
  | { readonly kind: "keep"; readonly reasons: readonly string[] }
  /** Archiving is blocked here: live agents, uncommitted work, services, pinned. */
  | { readonly kind: "blocked"; readonly reasons: readonly string[] };

export interface WorkspaceRow {
  readonly workspace: BoardWorkspace;
  readonly agents: readonly BoardAgent[];
  readonly running: number;
  readonly verdict: CleanupVerdict;
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** Why archiving this workspace is safe, worth a second look, or blocked. */
export function cleanupVerdict(
  workspace: BoardWorkspace,
  agents: readonly BoardAgent[],
  staleMs: number,
  now: number,
): CleanupVerdict {
  const blocked: string[] = [];
  const running = agents.filter((agent) => agent.status === "running" || agent.status === "initializing").length;
  if (running > 0) blocked.push(`${plural(running, "agent")} running`);
  if (workspace.pinned) blocked.push("pinned");
  if (workspace.archiving) blocked.push("archiving now");
  if (workspace.runningServices > 0) blocked.push(`${plural(workspace.runningServices, "service")} running`);
  if (workspace.ownedWorktree && workspace.dirty) blocked.push("uncommitted changes");
  if (workspace.kind !== "worktree") blocked.push(`${workspace.kind.replace("_", " ")} (not a worktree)`);
  if (blocked.length) return { kind: "blocked", reasons: blocked };

  const keep: string[] = [];
  const reasons: string[] = [];
  const merged = workspace.merged || workspace.pr?.merged === true || workspace.upstreamGone;
  if (workspace.ahead && workspace.ahead > 0 && !merged) keep.push(`${plural(workspace.ahead, "unpushed commit")}`);
  if (workspace.pr && !merged && workspace.pr.state.toUpperCase() === "OPEN") keep.push("PR open");
  const last = Date.parse(workspace.activityAt ?? workspace.createdAt ?? "");
  const idleMs = Number.isFinite(last) ? now - last : Infinity;
  if (merged) {
    reasons.push(workspace.pr?.number ? `PR #${workspace.pr.number} merged` : workspace.upstreamGone ? "merged (upstream deleted)" : "PR merged");
  }
  if (idleMs >= staleMs) reasons.push(Number.isFinite(idleMs) ? `idle ${Math.floor(idleMs / 86_400_000)}d` : "no activity");
  else if (!merged) keep.push("recently active");
  if (agents.length > 0) reasons.push(`${plural(agents.length, "idle agent")} will be archived`);
  if (workspace.dirty === null && workspace.ownedWorktree) keep.push("git state unknown");
  if (keep.length) return { kind: "keep", reasons: [...keep, ...reasons] };
  return { kind: "candidate", reasons };
}

export type WorkspaceSort = "activity" | "name" | "project" | "cleanup";

const VERDICT_ORDER: Record<CleanupVerdict["kind"], number> = { candidate: 0, keep: 1, blocked: 2 };

export function sortRows(rows: WorkspaceRow[], sort: WorkspaceSort): WorkspaceRow[] {
  const activity = (row: WorkspaceRow) => row.workspace.activityAt ?? row.workspace.createdAt ?? "";
  const byActivity = (a: WorkspaceRow, b: WorkspaceRow) => activity(b).localeCompare(activity(a));
  const byName = (a: WorkspaceRow, b: WorkspaceRow) => a.workspace.name.localeCompare(b.workspace.name);
  return rows.sort((a, b) => {
    switch (sort) {
      case "name":
        return byName(a, b);
      case "project":
        return a.workspace.project.localeCompare(b.workspace.project) || byActivity(a, b);
      case "cleanup":
        // Candidates first, oldest first within a verdict.
        return VERDICT_ORDER[a.verdict.kind] - VERDICT_ORDER[b.verdict.kind] || -byActivity(a, b);
      default:
        return byActivity(a, b);
    }
  });
}

/** Agents attached to a workspace: by workspace id, else by folder. */
export function agentsByWorkspace(
  workspaces: Iterable<BoardWorkspace>,
  agents: readonly BoardAgent[],
): Map<string, BoardAgent[]> {
  const norm = (path: string) => path.replace(/[\\/]+$/, "").toLowerCase();
  const byDir = new Map<string, string>();
  const result = new Map<string, BoardAgent[]>();
  for (const workspace of workspaces) {
    byDir.set(norm(workspace.directory), workspace.id);
    result.set(workspace.id, []);
  }
  for (const agent of agents) {
    if (agent.archivedAt) continue;
    const id = agent.workspaceId && result.has(agent.workspaceId) ? agent.workspaceId : byDir.get(norm(agent.cwd));
    if (id) result.get(id)!.push(agent);
  }
  return result;
}
