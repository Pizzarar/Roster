import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const renameBrainstormRpc = defineRpc({
  name: "brainstorm.rename",
  input: z.object({
    agentId: z.string(),
    title: z.string(),
    leadKey: z.string().optional(),
  }),
  output: z.object({
    ok: z.boolean(),
    message: z.string(),
  }),
});

export const createBrainstormRpc = defineRpc({
  name: "brainstorm.create",
  input: z.object({
    leadId: z.string(),
    leadTitle: z.string(),
    area: z.string(),
    cwd: z.string(),
  }),
  output: z.object({
    ok: z.boolean(),
    message: z.string(),
    agentId: z.string().optional(),
  }),
});
