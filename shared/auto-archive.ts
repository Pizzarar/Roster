import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const autoArchiveItemSchema = z.object({
  id: z.string(),
  kind: z.enum(["agent", "workspace"]),
  name: z.string(),
  project: z.string().optional(),
  reason: z.string(),
  dryRun: z.boolean(),
  at: z.string(),
});
export type AutoArchiveItem = z.output<typeof autoArchiveItemSchema>;

export const autoArchiveStateSchema = z.object({
  lastRunAt: z.string().nullable(),
  lastRunDry: z.boolean(),
  lastCount: z.number(),
  items: z.array(autoArchiveItemSchema),
});
export type AutoArchiveState = z.output<typeof autoArchiveStateSchema>;

export const autoArchiveStateRpc = defineRpc({
  name: "autoArchive.state",
  input: z.object({}),
  output: autoArchiveStateSchema,
});

export const runAutoArchiveRpc = defineRpc({
  name: "autoArchive.run",
  input: z.object({ dryRun: z.boolean().optional() }),
  output: autoArchiveStateSchema,
});
