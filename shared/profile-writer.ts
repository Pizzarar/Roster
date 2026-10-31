// Pure orchestration for profile writes; the daemon API, backup and settings are injected so tests can fake them.
import { sameOrder, sortProfiles } from "./groups";
import { applyProfileEdit, canWriteProfiles, readProfiles, type ProfileEntry, type ProfileEdit } from "./profiles";
import { applyPlan, makeProfileId, sameValue, type Entry, type ImportPlan } from "./profiles-md";

/** A previewed import plan as it crosses the RPC: `from`/`to` are absent when undefined. */
export interface WirePlan {
  readonly changes: readonly { id: string; name: string; fields: readonly { key: string; from?: unknown; to?: unknown }[] }[];
  readonly created: readonly Entry[];
}

export type WriteOp =
  | { kind: "edit"; id: string; fields: ProfileEdit }
  | { kind: "import"; plan: WirePlan; deleteIds: readonly string[] }
  | { kind: "sort"; auto: boolean };

export interface WriteDeps {
  get(): Promise<unknown>;
  patch(profiles: ProfileEntry[]): Promise<void>;
  /** Returns ok:false (and writes nothing) when the config could not be backed up. */
  backup(kind: "edit" | "import" | "sort"): Promise<{ ok: boolean; message: string }>;
  /** Current settings, or null while they are unavailable. */
  settings(): Promise<{ keepSorted: boolean; order: readonly string[] } | null>;
  makeId?: () => string;
}

export interface WriteResult {
  ok: boolean;
  changed: boolean;
  message: string;
}

export const STALE_PLAN = "Profiles changed since Preview; click Preview again.";

/** Null when the previewed plan still describes the fresh config; otherwise the reason to refuse. */
export function stalePlan(fresh: readonly ProfileEntry[], plan: WirePlan, deleteIds: readonly string[]): string | null {
  const byId = new Map(fresh.map((p) => [p.id, p]));
  for (const id of deleteIds) if (!byId.has(id)) return STALE_PLAN;
  for (const change of plan.changes) {
    const target = byId.get(change.id);
    if (!target) return STALE_PLAN;
    // The old value Preview showed must still be what is stored; other fields may have changed freely.
    for (const field of change.fields) if (!sameValue((target as Entry)[field.key], field.from)) return STALE_PLAN;
  }
  const names = new Set(fresh.map((p) => (p as Entry).name));
  for (const entry of plan.created) {
    if (names.has(entry.name)) return STALE_PLAN;
    if (typeof entry.id === "string" && byId.has(entry.id)) return STALE_PLAN;
  }
  return null;
}

const fail = (message: string): WriteResult => ({ ok: false, changed: false, message });

async function run(deps: WriteDeps, op: WriteOp): Promise<WriteResult> {
  const fresh = readProfiles<ProfileEntry>(await deps.get());
  if (!canWriteProfiles(fresh.location)) return fail("Profiles live under daemon.agentProfiles and cannot be written.");
  const settings = await deps.settings();
  const wantSort = op.kind === "sort" ? !op.auto || (settings?.keepSorted ?? false) : (settings?.keepSorted ?? false);
  if (op.kind === "sort" && !settings) return fail("Roster settings are not loaded yet.");

  let next: readonly ProfileEntry[] = fresh.profiles;
  if (op.kind === "edit") {
    next = applyProfileEdit(fresh.profiles, op.id, op.fields) ?? fresh.profiles;
  } else if (op.kind === "import") {
    const stale = stalePlan(fresh.profiles, op.plan, op.deleteIds);
    if (stale) return fail(stale);
    const plan = { changes: op.plan.changes, created: op.plan.created, missing: [], errors: [] } as unknown as ImportPlan;
    const makeId = deps.makeId ?? (() => makeProfileId(Date.now(), Math.random));
    const applied = applyPlan(fresh.profiles as readonly Entry[], plan, new Set(op.deleteIds), makeId);
    next = (applied as ProfileEntry[] | null) ?? fresh.profiles;
  }
  if (wantSort && settings) next = sortProfiles(next as readonly (ProfileEntry & { name?: unknown })[], settings.order);
  // Same objects in the same order means nothing changed (edits and imports build new objects).
  if (sameOrder(fresh.profiles, next)) return { ok: true, changed: false, message: op.kind === "sort" ? "Already sorted" : "No changes" };

  const saved = await deps.backup(op.kind);
  if (!saved.ok) return fail(saved.message);
  await deps.patch(next as ProfileEntry[]);
  return { ok: true, changed: true, message: saved.message };
}

/** Builds a writer that runs ops one at a time, each against a freshly read config. */
export function createProfileWriter() {
  let queue: Promise<unknown> = Promise.resolve();
  return (deps: WriteDeps, op: WriteOp): Promise<WriteResult> => {
    const task = () => run(deps, op);
    const next = queue.then(task, task);
    queue = next.catch(() => undefined);
    return next;
  };
}
