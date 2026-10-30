import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const agentId = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

export const handoffRecord = z.object({
  oldLeadId: z.string(),
  newLeadId: z.string(),
  at: z.string(),
  /** Workers moved from the old lead to the new one. */
  moved: z.array(z.string()),
});
export type HandoffRecord = z.output<typeof handoffRecord>;

/**
 * What Roster has rerouted. `relays` maps a moved worker to the lead that now hears
 * about it; the board groups those workers under that lead.
 */
export const handoffStateRpc = defineRpc({
  name: "handoffs.state",
  input: z.object({}),
  output: z.object({
    relays: z.record(z.string(), z.string()),
    handoffs: z.array(handoffRecord),
  }),
});

const handoffResult = z.object({ ok: z.boolean(), message: z.string() });

/**
 * Treat `agentId` as the successor of its spawner: detach it, then move the spawner's
 * live workers under it when worker adoption is on.
 */
export const promoteLeadRpc = defineRpc({
  name: "handoffs.promote",
  input: z.object({ agentId }),
  output: handoffResult,
});

/** Run the handoff for every live lead that still has a spawner. */
export const fixChainedLeadsRpc = defineRpc({
  name: "handoffs.fix-chains",
  input: z.object({}),
  output: handoffResult,
});
