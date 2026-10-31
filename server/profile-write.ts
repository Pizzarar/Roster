import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createProfileWriter, type WriteDeps } from "../shared/profile-writer";
import { backupConfig } from "./profiles-backup";

type PaseoApi = Parameters<Parameters<PluginServerContext["handle"]>[1]>[1]["paseo"];

/** The single serialized writer for Paseo's agentProfiles: every Roster write goes through it. */
export const writeProfiles = createProfileWriter();

export function profileDeps(paseo: PaseoApi, settings: WriteDeps["settings"]): WriteDeps {
  return {
    get: async () => (await paseo.config.get()).config,
    patch: async (profiles) => {
      await paseo.config.patch({ agentProfiles: profiles as never });
    },
    backup: backupConfig,
    settings,
  };
}
