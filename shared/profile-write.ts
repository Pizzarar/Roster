import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/**
 * The one way Roster changes Paseo's agentProfiles. The daemon re-reads the config, applies the op to the fresh
 * array, also sorts when "Keep Paseo's profile list sorted" is on (read server-side), and writes once after one backup.
 */
export const profileWriteOp = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("edit"),
    id: z.string(),
    fields: z.object({
      model: z.string().optional(),
      modeId: z.string().optional(),
      thinkingOptionId: z.string().optional(),
      notes: z.string().optional(),
    }),
  }),
  /**
   * The plan the user previewed (planned field changes with the old values shown, created entries) plus the ticked
   * deletions. A missing `from`/`to` means undefined (JSON drops it): `to` missing removes the field.
   */
  z.object({
    kind: z.literal("import"),
    plan: z.object({
      changes: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          fields: z.array(z.object({ key: z.string(), from: z.unknown().optional(), to: z.unknown().optional() })),
        }),
      ),
      created: z.array(z.record(z.string(), z.unknown())),
    }),
    deleteIds: z.array(z.string()).default([]),
  }),
  /** `auto` sorts only when the keep-sorted setting is on; the manual button omits it. */
  z.object({ kind: z.literal("sort"), auto: z.boolean().default(false) }),
]);
export type ProfileWriteOp = z.input<typeof profileWriteOp>;

export const writeProfilesRpc = defineRpc({
  name: "profiles.write",
  input: profileWriteOp,
  output: z.object({ ok: z.boolean(), changed: z.boolean(), message: z.string() }),
});
