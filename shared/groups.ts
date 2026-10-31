// Pure name-prefix grouping. No imports, so scripts/test-groups.ts can load this under plain Node.

export const OTHER_GROUP = "Other";

/** Workflow order of the groups; any other prefix follows alphabetically, then "Other". */
export const DEFAULT_GROUP_ORDER =
  "Lead, Brainstorm, Spec, Planner, Implement, Work Order, Mechanical, Audit, Review, Check, Pre-check, Scout, Art";

/** Split a comma-separated setting into trimmed, non-empty entries. */
export function parseGroupOrder(text: string): string[] {
  return text
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/** The text before the first " - " or " – " (hyphen and en dash alike), trimmed; null with no separator or an empty prefix. */
export function namePrefix(name: string | null | undefined): string | null {
  const text = name ?? "";
  const match = /\s[-–]\s/.exec(text);
  if (!match) return null;
  const prefix = text.slice(0, match.index).trim();
  return prefix === "" ? null : prefix;
}

/** Case-insensitive key for a group label. */
export function groupKey(label: string): string {
  return label.trim().toLowerCase();
}

export interface Grouped<T> {
  readonly key: string;
  /** First-seen casing. */
  readonly label: string;
  readonly items: T[];
}

/** Group sort rank: position in the order list, then alphabetical, then "Other" last. */
function compareGroups(order: readonly string[]) {
  const rank = new Map(order.map((label, index) => [groupKey(label), index]));
  const other = groupKey(OTHER_GROUP);
  return (a: { key: string; label: string }, b: { key: string; label: string }) => {
    if (a.key === other || b.key === other) return Number(a.key === other) - Number(b.key === other);
    const ra = rank.get(a.key);
    const rb = rank.get(b.key);
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
  };
}

/** Buckets items by the label `labelOf` returns (null becomes "Other"). Items keep their input order inside a group. */
export function groupByLabel<T>(
  items: readonly T[],
  labelOf: (item: T) => string | null,
  order: readonly string[],
): Grouped<T>[] {
  const buckets = new Map<string, Grouped<T>>();
  for (const item of items) {
    const label = labelOf(item)?.trim() || OTHER_GROUP;
    const key = groupKey(label);
    const bucket = buckets.get(key);
    if (bucket) bucket.items.push(item);
    else buckets.set(key, { key, label, items: [item] });
  }
  return [...buckets.values()].sort(compareGroups(order));
}

/** Group by name prefix. */
export function groupByPrefix<T>(
  items: readonly T[],
  nameOf: (item: T) => string | null | undefined,
  order: readonly string[],
): Grouped<T>[] {
  return groupByLabel(items, (item) => namePrefix(nameOf(item)), order);
}

export interface AgentGroupInput {
  /** Roster's existing classification, from role labels and title patterns. */
  readonly kind: "lead" | "old-lead" | "brainstorm" | "worker";
  /** Profile name when the agent carries one (a `profile` label), else null. */
  readonly profileName?: string | null;
  readonly title: string | null | undefined;
}

/**
 * The group label for a live agent: leads and brainstorms by their existing role, then the prefix of the profile
 * name, then the prefix of the title; null (→ "Other") when none has one.
 */
export function agentGroupLabel(agent: AgentGroupInput): string | null {
  if (agent.kind === "lead") return "Lead";
  if (agent.kind === "brainstorm") return "Brainstorm";
  return namePrefix(agent.profileName) ?? namePrefix(agent.title);
}
