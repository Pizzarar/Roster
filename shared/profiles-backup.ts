import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** Copies the daemon's config.json to a timestamped sibling before a bulk profile write. */
export const backupConfigRpc = defineRpc({
  name: "profiles.backup-config",
  input: z.object({}),
  output: z.object({ ok: z.boolean(), message: z.string(), path: z.string().optional() }),
});
