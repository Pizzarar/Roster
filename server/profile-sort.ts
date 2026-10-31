import type { PluginServerContext } from "@getpaseo/plugin/server";
import { canWriteProfiles, readProfiles, sameOrder, sortProfiles, type ProfileEntry } from "../shared/config";
import { backupConfig } from "./profiles-backup";

type PaseoApi = Parameters<Parameters<PluginServerContext["handle"]>[1]>[1]["paseo"];
type Entry = ProfileEntry & { readonly name?: unknown };

const names = (profiles: readonly Entry[]) => profiles.map((p) => String(p.name ?? p.id));

let queue: Promise<unknown> = Promise.resolve();

/** Sorts the fresh agentProfiles array. Backup first (no backup, no write); an already-sorted list is a no-op. */
export function sortProfilesInConfig(paseo: PaseoApi, order: readonly string[], dryRun = false) {
  const run = async () => {
    const fresh = readProfiles<Entry>((await paseo.config.get()).config);
    const sorted = sortProfiles(fresh.profiles, order);
    const before = names(fresh.profiles);
    const after = names(sorted);
    if (!canWriteProfiles(fresh.location)) {
      return { ok: false, changed: false, message: "Profiles live under daemon.agentProfiles and cannot be written.", before, after };
    }
    if (sameOrder(fresh.profiles, sorted)) return { ok: true, changed: false, message: "Already sorted", before, after };
    if (dryRun) return { ok: true, changed: true, message: "Would reorder", before, after };
    const saved = await backupConfig();
    if (!saved.ok) return { ok: false, changed: false, message: saved.message, before, after };
    await paseo.config.patch({ agentProfiles: sorted as never });
    return { ok: true, changed: true, message: `Sorted. ${saved.message}`, before, after };
  };
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}
