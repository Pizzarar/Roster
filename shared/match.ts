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
