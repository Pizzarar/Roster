// Markdown export / import / diff of agent profiles. Pure, no imports, so scripts/test-profiles-md.ts can load it
// under plain Node.

export type Entry = Record<string, unknown>;

/**
 * Export format, per profile (group headings are cosmetic and ignored on import):
 *
 *   ## Review
 *   ### Review - Gemini
 *   id: agent_profile_...
 *   provider: gemini
 *   model: gemini-3-pro
 *   featureValues: {"fast":true}
 *   notes:
 *   ```
 *   multi-line text
 *   ```
 *
 * Text values are written raw when that is unambiguous, else as a JSON string. Notes sit in a fence longer than any
 * backtick run inside them. Other fields are JSON on one line. A paste whose line breaks are all CRLF is read as LF.
 */
const RAW_KEYS = ["id", "provider", "model", "modeId", "thinkingOptionId", "icon", "color"] as const;
const KEY_LINE = /^([A-Za-z_][\w.-]*):(.*)$/;
/** Text fields where a blank value means "remove the field". */
const REMOVABLE_TEXT = ["model", "modeId", "thinkingOptionId", "icon", "color", "notes"];

const encodeText = (s: string) =>
  s === "" || s !== s.trim() || /[\r\n]/.test(s) || s.startsWith('"') ? JSON.stringify(s) : s;

/** `groups` come from groupByPrefix, in group order. */
export function serializeProfiles(groups: readonly { label: string; items: readonly Entry[] }[]): string {
  const out: string[] = [];
  for (const group of groups) {
    out.push(`## ${group.label}`, "");
    for (const profile of group.items) {
      const name = profile.name;
      if (typeof name !== "string" || name === "" || name !== name.trim() || /[\r\n]/.test(name)) {
        throw new Error(`Profile ${JSON.stringify(profile.id)} has a name that cannot be written as a heading.`);
      }
      out.push(`### ${name}`);
      for (const key of RAW_KEYS) {
        if (!(key in profile)) continue;
        const value = profile[key];
        out.push(`${key}: ${typeof value === "string" ? encodeText(value) : JSON.stringify(value)}`);
      }
      if ("featureValues" in profile) out.push(`featureValues: ${JSON.stringify(profile.featureValues)}`);
      for (const [key, value] of Object.entries(profile)) {
        if (key === "name" || key === "notes" || key === "featureValues" || (RAW_KEYS as readonly string[]).includes(key)) continue;
        if (!/^[A-Za-z_][\w.-]*$/.test(key)) throw new Error(`Profile "${name}" has a field name that cannot be written: ${key}`);
        out.push(`${key}: ${JSON.stringify(value)}`);
      }
      if (typeof profile.notes === "string") {
        const longest = Math.max(0, ...(profile.notes.match(/`+/g) ?? []).map((run) => run.length));
        const fence = "`".repeat(Math.max(3, longest + 1));
        out.push("notes:", fence, ...(profile.notes === "" ? [] : profile.notes.split("\n")), fence);
      }
      out.push("");
    }
  }
  return out.join("\n");
}

export interface ParseResult {
  readonly profiles: Entry[];
  readonly errors: string[];
}

export function parseProfiles(markdown: string): ParseResult {
  const text = /\n/.test(markdown.replace(/\r\n/g, "")) ? markdown : markdown.replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const profiles: Entry[] = [];
  const errors: string[] = [];
  let current: Entry | null = null;
  let label = "";
  const at = (i: number) => `line ${i + 1}`;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.replace(/\r$/, "");
    if (line.startsWith("###") && (line === "###" || line.startsWith("### "))) {
      const name = line.slice(3).trim();
      if (name === "") {
        errors.push(`${at(i)}: a profile has no name`);
        current = null;
        continue;
      }
      current = { name };
      label = name;
      profiles.push(current);
      continue;
    }
    if (line.startsWith("#") || line.trim() === "") continue;
    if (!current) {
      errors.push(`${at(i)}: text before the first "### name" heading`);
      continue;
    }
    const match = KEY_LINE.exec(line);
    if (!match) {
      errors.push(`${at(i)} (${label}): expected "key: value"`);
      continue;
    }
    const key = match[1]!;
    const rest = match[2]!.trim();
    if (key === "name") {
      errors.push(`${at(i)} (${label}): the name is the ### heading, not a field`);
      continue;
    }
    if (key in current) {
      errors.push(`${at(i)} (${label}): duplicate field "${key}"`);
      continue;
    }
    if (key === "notes") {
      const fence = (lines[i + 1] ?? "").replace(/\r$/, "");
      if (rest !== "" || !/^`{3,}$/.test(fence)) {
        errors.push(`${at(i)} (${label}): notes must be followed by a fenced block`);
        continue;
      }
      const body: string[] = [];
      let j = i + 2;
      while (j < lines.length && lines[j]!.replace(/\r$/, "") !== fence) body.push(lines[j++]!);
      if (j >= lines.length) {
        errors.push(`${at(i)} (${label}): the notes block is never closed`);
        break;
      }
      current.notes = body.join("\n");
      i = j;
      continue;
    }
    if ((RAW_KEYS as readonly string[]).includes(key)) {
      if (rest.startsWith('"')) {
        try {
          const value: unknown = JSON.parse(rest);
          if (typeof value !== "string") throw new Error("not a string");
          current[key] = value;
        } catch {
          errors.push(`${at(i)} (${label}): ${key} is not a valid quoted string`);
        }
      } else current[key] = rest;
      continue;
    }
    try {
      const value: unknown = JSON.parse(rest);
      if (key === "featureValues" && (value === null || typeof value !== "object" || Array.isArray(value))) {
        throw new Error("not an object");
      }
      current[key] = value;
    } catch {
      errors.push(`${at(i)} (${label}): ${key} is not valid JSON${key === "featureValues" ? " (an object is expected)" : ""}`);
    }
  }
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const profile of profiles) {
    if (profile.id === "") delete profile.id;
    const id = profile.id;
    if (typeof id === "string") {
      if (ids.has(id)) errors.push(`duplicate id ${id}`);
      ids.add(id);
    } else {
      const name = profile.name as string;
      if (names.has(name)) errors.push(`two profiles named "${name}" have no id`);
      names.add(name);
    }
  }
  return { profiles, errors };
}

const stable = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Entry).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  ) ?? "undefined";
export const sameValue = (a: unknown, b: unknown) => stable(a) === stable(b);

export interface FieldChange {
  readonly key: string;
  readonly from: unknown;
  /** undefined removes the field. */
  readonly to: unknown;
}
export interface ProfileChange {
  readonly id: string;
  readonly name: string;
  readonly fields: FieldChange[];
}
export interface ImportPlan {
  readonly changes: ProfileChange[];
  /** Profiles in the paste that match nothing; `id` may be absent until Apply. */
  readonly created: Entry[];
  /** In the config but not in the paste. Never deleted unless explicitly chosen. */
  readonly missing: { id: string; name: string }[];
  readonly errors: string[];
}

/** What pasting `parsed` over `current` would change. Fields the paste omits are left alone. */
export function diffProfiles(current: readonly Entry[], parsed: readonly Entry[]): ImportPlan {
  const errors: string[] = [];
  const byId = new Map(current.map((p) => [p.id as string, p]));
  const matched = new Set<string>();
  const changes: ProfileChange[] = [];
  const created: Entry[] = [];
  for (const entry of parsed) {
    const name = entry.name as string;
    let target: Entry | undefined;
    if (typeof entry.id === "string") target = byId.get(entry.id);
    else {
      const same = current.filter((p) => p.name === name);
      if (same.length > 1) {
        errors.push(`"${name}" matches ${same.length} profiles by name; add its id to the paste`);
        continue;
      }
      target = same[0];
    }
    if (!target) {
      if (typeof entry.provider !== "string" || entry.provider === "") {
        errors.push(`new profile "${name}" needs a provider`);
        continue;
      }
      // A blank optional field on a new profile means "not set": leave it out.
      created.push(Object.fromEntries(Object.entries(entry).filter(([key, value]) => !(value === "" && REMOVABLE_TEXT.includes(key)))));
      continue;
    }
    const id = target.id as string;
    if (matched.has(id)) {
      errors.push(`"${name}" and another pasted profile both match ${id}`);
      continue;
    }
    matched.add(id);
    const fields: FieldChange[] = [];
    for (const [key, raw] of Object.entries(entry)) {
      if (key === "id") continue;
      const before = target[key];
      const remove = raw === "" && REMOVABLE_TEXT.includes(key);
      if (remove) {
        if (before !== undefined && before !== "") fields.push({ key, from: before, to: undefined });
      } else if (!sameValue(before, raw)) fields.push({ key, from: before, to: raw });
    }
    if (fields.length > 0) changes.push({ id, name: (target.name as string) ?? name, fields });
  }
  const missing = current.filter((p) => !matched.has(p.id as string)).map((p) => ({ id: p.id as string, name: String(p.name) }));
  return { changes, created, missing, errors };
}

/** An id in the daemon's existing style: `agent_profile_<time base36>_<10 random base36>`. */
export function makeProfileId(now: number, random: () => number): string {
  let suffix = "";
  while (suffix.length < 10) suffix += Math.floor(random() * 36).toString(36);
  return `agent_profile_${now.toString(36)}_${suffix}`;
}

/**
 * Applies a plan to the profiles as they are now: only the planned fields are written (every other field and every
 * other profile is untouched), `deleteIds` removes only those profiles, new profiles are appended. Returns null when
 * nothing would change. Throws if the plan has errors.
 */
export function applyPlan(
  fresh: readonly Entry[],
  plan: ImportPlan,
  deleteIds: ReadonlySet<string>,
  makeId: () => string,
): Entry[] | null {
  if (plan.errors.length > 0) throw new Error(plan.errors[0]);
  const changeById = new Map(plan.changes.map((c) => [c.id, c]));
  let changed = false;
  const out: Entry[] = [];
  for (const profile of fresh) {
    const id = profile.id as string;
    if (deleteIds.has(id)) {
      changed = true;
      continue;
    }
    const change = changeById.get(id);
    if (!change) {
      out.push(profile);
      continue;
    }
    const next: Entry = { ...profile };
    for (const { key, to } of change.fields) {
      if (to === undefined) delete next[key];
      else next[key] = to;
    }
    if (sameValue(next, profile)) out.push(profile);
    else {
      changed = true;
      out.push(next);
    }
  }
  const taken = new Set(fresh.map((p) => p.id as string));
  for (const entry of plan.created) {
    const id = typeof entry.id === "string" ? entry.id : makeId();
    if (taken.has(id)) {
      if (typeof entry.id === "string") continue;
      throw new Error("Generated an id that already exists; try again.");
    }
    taken.add(id);
    out.push({ ...entry, id });
    changed = true;
  }
  return changed ? out : null;
}
