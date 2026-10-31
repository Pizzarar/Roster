// Pure agent-profile helpers. No imports, so scripts/test-profiles.ts can load this under plain Node.

/** The editable fields of a profile. Everything else on the entry is carried through untouched. */
export interface ProfileEdit {
  readonly model?: string;
  readonly modeId?: string;
  readonly thinkingOptionId?: string;
  readonly notes?: string;
}

export type ProfileEntry = { readonly id: string } & Readonly<Record<string, unknown>>;

export const EDITABLE_PROFILE_FIELDS = ["model", "modeId", "thinkingOptionId", "notes"] as const;

/** Where `agentProfiles` was found in the config document. */
export type ProfileLocation = "top" | "daemon";

export interface ProfileSource<T extends ProfileEntry = ProfileEntry> {
  readonly profiles: readonly T[];
  readonly location: ProfileLocation;
}

/** Profiles from `config.agentProfiles`, else `config.daemon.agentProfiles`, and which one it was. */
export function readProfiles<T extends ProfileEntry>(config: unknown): ProfileSource<T> {
  const doc = (config ?? {}) as { agentProfiles?: T[]; daemon?: { agentProfiles?: T[] } };
  if (Array.isArray(doc.agentProfiles)) return { profiles: doc.agentProfiles, location: "top" };
  if (Array.isArray(doc.daemon?.agentProfiles)) return { profiles: doc.daemon.agentProfiles, location: "daemon" };
  return { profiles: [], location: "top" };
}

/**
 * Applies `edit` to the profile `id`, returning the whole new array, or null when nothing changes
 * (unknown id, or every field already holds that value). Blank text removes the field.
 * The edited entry keeps every other field; other entries are returned as the same objects.
 */
export function applyProfileEdit<T extends ProfileEntry>(
  profiles: readonly T[],
  id: string,
  edit: ProfileEdit,
): T[] | null {
  const index = profiles.findIndex((profile) => profile.id === id);
  if (index < 0) return null;
  const current = profiles[index]!;
  const next: Record<string, unknown> = { ...current };
  let changed = false;
  for (const field of EDITABLE_PROFILE_FIELDS) {
    const value = edit[field];
    if (value === undefined) continue;
    const trimmed = value.trim();
    const before = typeof current[field] === "string" ? (current[field] as string) : "";
    if (trimmed === before) continue;
    changed = true;
    if (trimmed === "") delete next[field];
    else next[field] = trimmed;
  }
  if (!changed) return null;
  return profiles.map((profile, i) => (i === index ? (next as T) : profile));
}

/** Writing is only safe where `config.patch` can put the array back: the top-level key. */
export function canWriteProfiles(location: ProfileLocation): boolean {
  return location === "top";
}

/** The fields of `draft` that differ from `base` (the values shown when editing began): the user's actual edits. */
export function changedFields(base: ProfileEdit, draft: ProfileEdit): ProfileEdit {
  const out: Record<string, string> = {};
  for (const field of EDITABLE_PROFILE_FIELDS) {
    const value = draft[field];
    if (value !== undefined && value.trim() !== (base[field] ?? "").trim()) out[field] = value;
  }
  return out;
}
