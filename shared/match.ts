// Pure lead <-> brainstorm matching. No imports, so scripts/test-match.ts can load this under plain Node.

/** Lower-case, forward slashes, no trailing slash: for folder matching. */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export interface MatchableAgent {
  readonly labels?: Readonly<Record<string, string>>;
  readonly workspaceId?: string;
  readonly cwd: string;
}

interface LeadKeyConfig {
  readonly labels: { readonly lead: string };
}

const leadKeyOf = (agent: MatchableAgent, cfg: LeadKeyConfig) =>
  agent.labels?.[cfg.labels.lead]?.trim().toLowerCase();

/** Match a brainstorm to a lead: `lead=<key>` label first, then workspaceId, then normalized cwd. */
export function matchBrainstormForLead<T extends MatchableAgent>(
  lead: MatchableAgent,
  brainstorms: readonly T[],
  cfg: LeadKeyConfig,
): T | undefined {
  const key = (agent: MatchableAgent) => leadKeyOf(agent, cfg);
  const leadKey = key(lead);
  // A brainstorm that names a different lead must not be matched by location alone.
  const namesOtherLead = (b: MatchableAgent) => {
    const bKey = key(b);
    return Boolean(leadKey && bKey && bKey !== leadKey);
  };
  if (leadKey) {
    const byKey = brainstorms.find((b) => key(b) === leadKey);
    if (byKey) return byKey;
  }
  if (lead.workspaceId) {
    const byWs = brainstorms.find((b) => b.workspaceId === lead.workspaceId && !namesOtherLead(b));
    if (byWs) return byWs;
  }
  const leadCwd = normalizePath(lead.cwd);
  return brainstorms.find((b) => normalizePath(b.cwd) === leadCwd && !namesOtherLead(b));
}

/**
 * Pairs every lead with at most one brainstorm, each brainstorm used once. Leads with a `lead=` key claim
 * their keyed brainstorm first. An unlabeled lead then matches by workspace or cwd, but never takes a
 * brainstorm keyed to a different live lead.
 */
export function pairLeadsWithBrainstorms<L extends MatchableAgent & { readonly id: string }, B extends MatchableAgent & { readonly id: string }>(
  leads: readonly L[],
  brainstorms: readonly B[],
  cfg: LeadKeyConfig,
): { readonly pairs: Map<string, B | undefined>; readonly unpaired: B[] } {
  const pairs = new Map<string, B | undefined>();
  const claimed = new Set<string>();
  const liveLeadKeys = new Set(leads.map((l) => leadKeyOf(l, cfg)).filter((k): k is string => Boolean(k)));
  for (const lead of leads) {
    const leadKey = leadKeyOf(lead, cfg);
    const byKey = leadKey ? brainstorms.find((b) => !claimed.has(b.id) && leadKeyOf(b, cfg) === leadKey) : undefined;
    if (byKey) claimed.add(byKey.id);
    pairs.set(lead.id, byKey);
  }
  for (const lead of leads) {
    if (pairs.get(lead.id)) continue;
    const leadKey = leadKeyOf(lead, cfg);
    const candidates = brainstorms.filter((b) => {
      if (claimed.has(b.id)) return false;
      const bKey = leadKeyOf(b, cfg);
      return !bKey || bKey === leadKey || !liveLeadKeys.has(bKey);
    });
    const found = matchBrainstormForLead(lead, candidates, cfg);
    if (found) claimed.add(found.id);
    pairs.set(lead.id, found);
  }
  return { pairs, unpaired: brainstorms.filter((b) => !claimed.has(b.id)) };
}

/**
 * The brainstorm `lead` pairs with when matched against the whole live lead set, so every caller agrees.
 * `lead` is added to the set if absent (e.g. a not-yet-listed target).
 */
export function brainstormForLead<L extends MatchableAgent & { readonly id: string }, B extends MatchableAgent & { readonly id: string }>(
  lead: L,
  liveLeads: readonly L[],
  brainstorms: readonly B[],
  cfg: LeadKeyConfig,
): B | undefined {
  const all = liveLeads.some((l) => l.id === lead.id) ? liveLeads : [...liveLeads, lead];
  return pairLeadsWithBrainstorms(all, brainstorms, cfg).pairs.get(lead.id);
}

/** A "(old) …" title marks a retired agent whatever the settings say. */
const RETIRED_TITLE = /^\s*\(old\)/i;
export const isRetiredTitle = (title: string | null | undefined): boolean => RETIRED_TITLE.test(title ?? "");

/** The `ordN` generation in a lead title, or undefined. */
export const leadOrder = (title: string | null | undefined): number | undefined => {
  const m = /\bord(\d+)\b/i.exec(title ?? "");
  return m ? Number(m[1]) : undefined;
};

export interface ResolvableAgent {
  readonly id: string;
  readonly cwd: string;
  readonly title?: string | null;
  readonly createdAt?: string | null;
  readonly archivedAt?: string | null;
  readonly status?: string | null;
}

export interface LeadResolveRules<T> {
  /** Whether the agent counts as an active lead (retired titles and roles never do). */
  isLead(agent: T): boolean;
  /** The project a lead belongs to; two leads in one cwd with one area are successors of each other. */
  areaOf(agent: T): string;
}

const isLive = (a: ResolvableAgent) => !a.archivedAt && a.status !== "closed";
const createdMs = (a: ResolvableAgent) => {
  const ms = Date.parse(a.createdAt ?? "");
  return Number.isFinite(ms) ? ms : 0;
};
/** Positive when `a` is the later generation: ordN when both have one, else creation time. Never updatedAt, which any activity bumps. */
const compareGeneration = (a: ResolvableAgent, b: ResolvableAgent): number => {
  const oa = leadOrder(a.title);
  const ob = leadOrder(b.title);
  return oa !== undefined && ob !== undefined && oa !== ob ? oa - ob : createdMs(a) - createdMs(b);
};

/**
 * The lead a brainstorm should be created for. `requestedId` is whatever the caller held, possibly stale
 * or outside the listed page; `where.area` is the project the caller means.
 * - A live lead is kept unless a later generation (see compareGeneration) of the same area sits in the same cwd.
 * - Otherwise the latest live lead in `cwd` (or `rootPath`) of the requested lead's area, else of `where.area`.
 * - With no area known at all, the latest live lead in that location.
 * Returns undefined when nothing fits; it never crosses into another area.
 */
export function resolveLead<T extends ResolvableAgent>(
  requestedId: string | undefined,
  agents: readonly T[],
  where: { readonly cwd: string; readonly rootPath?: string; readonly area?: string },
  rules: LeadResolveRules<T>,
): T | undefined {
  const requested = requestedId ? agents.find((a) => a.id === requestedId) : undefined;
  const cwds = new Set([normalizePath(requested?.cwd ?? where.cwd), normalizePath(where.cwd)]);
  if (where.rootPath) cwds.add(normalizePath(where.rootPath));
  const latest = (list: readonly T[]) => list.reduce<T | undefined>((best, a) => (best && compareGeneration(best, a) >= 0 ? best : a), undefined);
  const here = agents.filter((a) => isLive(a) && rules.isLead(a) && cwds.has(normalizePath(a.cwd)));
  const area = (requested ? rules.areaOf(requested) : where.area?.trim() || "").toLowerCase();
  const inArea = area ? here.filter((a) => rules.areaOf(a).toLowerCase() === area) : here;

  if (requested && isLive(requested) && rules.isLead(requested)) {
    const later = latest(inArea.filter((a) => a.id !== requested.id && compareGeneration(a, requested) > 0));
    return later ?? requested;
  }
  return latest(inArea);
}
