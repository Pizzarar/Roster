import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/**
 * Sorts Paseo's agentProfiles array by Roster group order. The daemon re-reads the config, sorts the fresh array,
 * and writes only when the order changes (after a backup). `dryRun` reports without writing.
 */
export const sortProfilesRpc = defineRpc({
  name: "profiles.sort",
  input: z.object({ dryRun: z.boolean().default(false) }),
  output: z.object({
    ok: z.boolean(),
    changed: z.boolean(),
    message: z.string(),
    before: z.array(z.string()),
    after: z.array(z.string()),
  }),
});
