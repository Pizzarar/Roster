import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const workspaceMergeInfoSchema = z.object({
  merged: z.boolean(),
  prNumber: z.number().nullable(),
  upstreamGone: z.boolean(),
  branch: z.string().nullable(),
  dirty: z.boolean().nullable(),
});
export type WorkspaceMergeInfo = z.output<typeof workspaceMergeInfoSchema>;

/** Detect squash-merged PRs and deleted upstream branches for worktree workspaces. */
export const checkWorkspaceMergesRpc = defineRpc({
  name: "workspaces.check-merges",
  input: z.object({
    workspaces: z.array(
      z.object({
        id: z.string(),
        directory: z.string(),
        branch: z.string().nullable(),
      }),
    ),
  }),
  output: z.object({
    merges: z.record(z.string(), workspaceMergeInfoSchema),
  }),
});
