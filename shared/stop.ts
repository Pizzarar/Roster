import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** Interrupt a running agent's turn (`paseo stop`). A no-op for idle agents. Never archives or deletes. */
export const stopAgentRpc = defineRpc({
  name: "agents.stop",
  input: z.object({ agentId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i) }),
  output: z.object({ ok: z.boolean(), message: z.string() }),
});