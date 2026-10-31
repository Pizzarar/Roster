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

/** Role words (lower-case) that name a group without being its exact name. */
const ROLE_ALIASES: Readonly<Record<string, string>> = {
  implement: "Implement",
  "implement-hard": "Implement",
  build: "Implement",
  review: "Review",
  critique: "Review",
  "plan+review": "Review",
  plan: "Planner",
  planner: "Planner",
  "vet+plan": "Planner",
  spec: "Spec",
  audit: "Audit",
  census: "Audit",
  scout: "Scout",
  lookup: "Scout",
  check: "Check",
  "pre-check": "Pre-check",
  mechanical: "Mechanical",
  "work order": "Work Order",
  art: "Art",
  duet: "Art",
};

/**
 * The group a role word names: the whole text, else its leading word, matched case-insensitively against the
 * alias table and the configured group names. Unknown words return null, so they never become groups of their own.
 */
export function roleWordGroup(text: string | null | undefined, order: readonly string[] = []): string | null {
  const word = (text ?? "").trim().toLowerCase();
  if (word === "") return null;
  const configured = new Map(order.map((label) => [groupKey(label), label]));
  const lookup = (key: string): string | null => {
    const alias = ROLE_ALIASES[key];
    if (alias) return configured.get(groupKey(alias)) ?? alias;
    return configured.get(key) ?? null;
  };
  const words = word.split(/\s+/);
  return (
    lookup(word) ?? (words.length > 1 ? lookup(`${words[0]} ${words[1]}`) : null) ?? lookup(words[0]!)
  );
}

/** Drops a trailing "(...)" such as the model note in "implement (Sonnet)". */
const stripParenthetical = (text: string) => text.replace(/\s*\([^()]*\)\s*$/, "").trim();

/** The trailing "(...)" content of a title, or null. */
const trailingParenthetical = (text: string) => /\(([^()]*)\)\s*$/.exec(text)?.[1] ?? null;

export interface AgentGroupInput {
  /** Roster's existing classification, from role labels and title patterns. */
  readonly kind: "lead" | "old-lead" | "brainstorm" | "worker";
  /** The agent's role label value (e.g. "implement"), if any. */
  readonly role?: string | null;
  /** Profile name when the agent carries one (a `profile` label), else null. */
  readonly profileName?: string | null;
  readonly title: string | null | undefined;
}

/**
 * The group label for a live agent, first match wins: lead/brainstorm role; a known role label; the prefix of a
 * profile label; a profile name in the title's trailing parenthetical ("(Art - Gemini)"); the "·" convention
 * ("REVIEW · X" or "X · implement (Sonnet)"); the " - " title prefix. Null (becomes "Other") when none applies.
 */
export function agentGroupLabel(agent: AgentGroupInput, order: readonly string[] = []): string | null {
  if (agent.kind === "lead") return "Lead";
  if (agent.kind === "brainstorm") return "Brainstorm";
  const title = agent.title?.trim() ?? "";
  const dot = title.split(/\s·\s/);
  const dotRole =
    dot.length > 1 ? (roleWordGroup(stripParenthetical(dot[0]!), order) ?? roleWordGroup(stripParenthetical(dot[1]!), order)) : null;
  return (
    roleWordGroup(agent.role, order) ??
    namePrefix(agent.profileName) ??
    namePrefix(trailingParenthetical(title)) ??
    dotRole ??
    namePrefix(title)
  );
}
