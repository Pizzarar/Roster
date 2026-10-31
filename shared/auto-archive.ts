import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const autoArchiveItemSchema = z.object({
  id: z.string(),
  kind: z.enum(["agent", "workspace"]),
  name: z.string(),
  project: z.string().optional(),
  directory: z.string().optional(),
  reason: z.string(),
  dryRun: z.boolean(),
  at: z.string(),
  undoneAt: z.string().optional(),
  undoError: z.string().optional(),
});
export type AutoArchiveItem = z.output<typeof autoArchiveItemSchema>;

export const autoArchivePassSchema = z.object({
  at: z.string(),
  dryRun: z.boolean(),
  agentIds: z.array(z.string()),
  workspaces: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      directory: z.string(),
    }),
  ),
  undoneAt: z.string().optional(),
});
export type AutoArchivePass = z.output<typeof autoArchivePassSchema>;

export const autoArchiveStateSchema = z.object({
  lastRunAt: z.string().nullable(),
  lastRunDry: z.boolean(),
  lastCount: z.number(),
  items: z.array(autoArchiveItemSchema),
  passes: z.array(autoArchivePassSchema).optional(),
});
export type AutoArchiveState = z.output<typeof autoArchiveStateSchema>;

export const autoArchiveStateRpc = defineRpc({
  name: "auto-archive.state",
  input: z.object({}),
  output: autoArchiveStateSchema,
});

export const runAutoArchiveRpc = defineRpc({
  name: "auto-archive.run",
  input: z.object({ dryRun: z.boolean().optional() }),
  output: autoArchiveStateSchema,
});

export const undoAutoArchiveRpc = defineRpc({
  name: "auto-archive.undo",
  input: z.object({
    itemId: z.string().optional(),
    at: z.string().optional(),
  }),
  output: z.object({
    state: autoArchiveStateSchema,
    restored: z.number(),
    failed: z.array(z.string()),
  }),
});
