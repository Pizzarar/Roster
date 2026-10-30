import { isLeadAgent, PARENT_LABEL, type BoardConfig } from "../shared/config";

export type AgentStatus = "initializing" | "idle" | "running" | "error" | "closed";

/** The agent fields the board reads. A subset of the daemon's agent snapshot. */
export interface BoardAgent {
  readonly id: string;
  readonly title: string | null;
  readonly status: AgentStatus;
  readonly provider: string;
  readonly model: string | null;
  readonly cwd: string;
  readonly workspaceId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastUserMessageAt: string | null;
  readonly requiresAttention?: boolean;
  readonly attentionReason?: "finished" | "error" | "permission" | null;
  readonly archivedAt?: string | null;
  readonly labels: Readonly<Record<string, string>>;
}

export type AgentKind = "lead" | "old-lead" | "brainstorm" | "worker";

export function agentKind(agent: BoardAgent, cfg: BoardConfig): AgentKind {
  const title = agent.title ?? "";
  const role = agent.labels[cfg.labels.role];
  if (cfg.hideTitle?.test(title)) return "old-lead";
  if (role !== undefined) {
    if (cfg.leadRoles.includes(role)) return "lead";
    if (cfg.oldLeadRoles.includes(role)) return "old-lead";
    if (cfg.brainstormRoles.includes(role)) return "brainstorm";
  }
  if (cfg.leadTitle?.test(title)) return "lead";
  if (cfg.brainstormTitle?.test(title)) return "brainstorm";
  return "worker";
}

export function displayTitle(agent: BoardAgent): string {
  return agent.title?.trim() || `Agent ${agent.id.slice(0, 7)}`;
}

/** "★ LEAD · MAIN GAME ord47  (talk here: game / merges)" -> "MAIN GAME ord47". */
export function sidebarTitle(agent: BoardAgent, cfg: BoardConfig): string {
  const full = displayTitle(agent);
  const title = cfg.sidebarStrip ? full.replace(cfg.sidebarStrip, "") : full;
  return title.trim() || full;
}

export function basename(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function needsAttention(agent: BoardAgent): boolean {
  return agent.requiresAttention === true;
}

const STATUS_PRIORITY: Record<AgentStatus, number> = {
  running: 1,
  initializing: 2,
  error: 3,
  idle: 4,
  closed: 5,
};

export function compareAgents(a: BoardAgent, b: BoardAgent): number {
  const attention = Number(needsAttention(b)) - Number(needsAttention(a));
  if (attention !== 0) return attention;
  const status = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
  if (status !== 0) return status;
  return b.updatedAt.localeCompare(a.updatedAt);
}

export function relativeTime(iso: string | null | undefined, now: number): string {
  if (!iso) return "never";
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms)) return "unknown";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function matchesSearch(agent: BoardAgent, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    agent.title ?? "",
    agent.id,
    agent.model ?? "",
    agent.provider,
    agent.cwd,
    ...Object.entries(agent.labels).map(([key, value]) => `${key}=${value}`),
  ]
    .join("\n")
    .toLowerCase();
  return q.split(/\s+/).every((term) => haystack.includes(term));
}

/** Moved worker id -> the lead it reports to now (from Roster's handoff relay). */
export type Relays = Readonly<Record<string, string>>;

/** The spawner label, else the lead a handoff moved this worker to. */
export function parentOf(agent: BoardAgent, relays: Relays): string | undefined {
  return agent.labels[PARENT_LABEL] ?? relays[agent.id];
}

export interface BoardGroup {
  readonly key: string;
  readonly title: string;
  /** The spawner or lead first, then old leads, brainstorm, workers. */
  readonly agents: readonly BoardAgent[];
  /** The spawner heading a group that has no active lead; rendered like a lead. */
  readonly rootId: string | null;
}

const UNASSIGNED = "\u0000unassigned";
const BRAINSTORM = "\u0000brainstorm";

/**
 * The group an agent belongs to: the nearest `lead` label up its spawner chain, else the
 * nearest lead ancestor, else the root spawner, else brainstorm, folder or unassigned.
 */
function groupKeyOf(
  agent: BoardAgent,
  byId: ReadonlyMap<string, BoardAgent>,
  parents: ReadonlySet<string>,
  cfg: BoardConfig,
  relays: Relays,
): string {
  const seen = new Set<string>();
  let current: BoardAgent | undefined = agent;
  let root: BoardAgent = agent;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    root = current;
    const lead = current.labels[cfg.labels.lead];
    if (lead) return `lead:${lead}`;
    if (current !== agent && agentKind(current, cfg) === "lead") return `agent:${current.id}`;
    const parentId = parentOf(current, relays);
    current = parentId ? byId.get(parentId) : undefined;
  }
  if (root !== agent) return `agent:${root.id}`;
  const kind = agentKind(agent, cfg);
  if (kind === "lead" || kind === "old-lead" || parents.has(agent.id)) return `agent:${agent.id}`;
  if (kind === "brainstorm") return BRAINSTORM;
  if (cfg.groupUnassignedByFolder) return `folder:${basename(agent.cwd).toLowerCase()}`;
  return UNASSIGNED;
}

const KIND_ORDER: Record<AgentKind, number> = { lead: 0, "old-lead": 1, brainstorm: 2, worker: 3 };

/**
 * Groups agents by lead. `all` resolves spawner chains (include hidden agents there);
 * `visible` is what gets placed.
 */
export function groupAgents(
  all: readonly BoardAgent[],
  visible: readonly BoardAgent[],
  cfg: BoardConfig,
  relays: Relays = {},
): BoardGroup[] {
  const byId = new Map(all.map((agent) => [agent.id, agent]));
  const parents = new Set<string>();
  for (const agent of all) {
    const parentId = parentOf(agent, relays);
    if (parentId && byId.has(parentId)) parents.add(parentId);
  }
  const buckets = new Map<string, BoardAgent[]>();
  for (const agent of visible) {
    const key = groupKeyOf(agent, byId, parents, cfg, relays);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(agent);
    else buckets.set(key, [agent]);
  }
  const kindOf = (agent: BoardAgent) => KIND_ORDER[agentKind(agent, cfg)];
  const groups = [...buckets.entries()].map(([key, agents]) => {
    // The group's root agent (spawner) leads its own group.
    const rootId = key.startsWith("agent:") ? key.slice(6) : null;
    agents.sort(
      (a, b) =>
        Number(b.id === rootId) - Number(a.id === rootId) || kindOf(a) - kindOf(b) || compareAgents(a, b),
    );
    const activeLead = agents.find((agent) => agentKind(agent, cfg) === "lead");
    const root = rootId ? byId.get(rootId) : undefined;
    let title: string;
    if (key === UNASSIGNED) title = "Unassigned";
    else if (key === BRAINSTORM) title = "Brainstorm";
    else if (activeLead) title = sidebarTitle(activeLead, cfg);
    else if (key.startsWith("lead:")) title = `${cfg.labels.lead}=${key.slice(5)}`;
    else if (key.startsWith("folder:")) title = `Folder: ${basename(agents[0]!.cwd)}`;
    else title = sidebarTitle(root ?? agents[0]!, cfg);
    const rank =
      key === UNASSIGNED ? 4 : key.startsWith("folder:") ? 3 : key === BRAINSTORM ? 2 : activeLead ? 0 : 1;
    return { key, title, agents, rootId: activeLead ? null : rootId, rank };
  });
  groups.sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title));
  return groups.map(({ key, title, agents, rootId }) => ({ key, title, agents, rootId }));
}
export interface LiveWorktree {
  readonly cwd: string;
  readonly name: string;
  readonly workspaceId: string | null;
  readonly agents: readonly BoardAgent[];
}

/** Every distinct folder with a running or idle, non-archived agent. */
export function liveWorktrees(agents: readonly BoardAgent[]): LiveWorktree[] {
  const byCwd = new Map<string, BoardAgent[]>();
  for (const agent of agents) {
    if (agent.archivedAt) continue;
    if (agent.status !== "running" && agent.status !== "idle") continue;
    const key = agent.cwd.replace(/[\\/]+$/, "").toLowerCase();
    const bucket = byCwd.get(key);
    if (bucket) bucket.push(agent);
    else byCwd.set(key, [agent]);
  }
  return [...byCwd.values()]
    .map((list) => {
      list.sort(compareAgents);
      return {
        cwd: list[0]!.cwd,
        name: basename(list[0]!.cwd),
        workspaceId: list.find((agent) => agent.workspaceId)?.workspaceId ?? null,
        agents: list,
      };
    })
    .sort((a, b) => compareAgents(a.agents[0]!, b.agents[0]!) || a.name.localeCompare(b.name));
}

/** Live leads that are still children of another agent: the chains a handoff fixes. */
export function chainedLeads(agents: readonly BoardAgent[], cfg: BoardConfig): BoardAgent[] {
  return agents.filter(
    (agent) => !agent.archivedAt && agent.labels[PARENT_LABEL] && isLeadAgent(agent.title, agent.labels, cfg),
  );
}
