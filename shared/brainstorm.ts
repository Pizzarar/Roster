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
    leadId: z.string().optional(),
    leadTitle: z.string().optional(),
    area: z.string().optional(),
    cwd: z.string(),
    profile: z.string().optional(),
    modeId: z.string().optional(),
    workspaceId: z.string().optional(),
    workspaceName: z.string().optional(),
    projectDisplayName: z.string().optional(),
    projectRootPath: z.string().optional(),
    reuseExisting: z.boolean().optional(),
    reason: z.string().optional(),
  }),
  output: z.object({
    ok: z.boolean(),
    message: z.string(),
    agentId: z.string().optional(),
    reused: z.boolean().optional(),
  }),
});

export const checkInLeadsRpc = defineRpc({
  name: "brainstorm.check-in-leads",
  /** `leadId` checks in just that lead; omitted, every live lead. */
  input: z.object({ leadId: z.string().optional() }),
  output: z.object({
    ok: z.boolean(),
    count: z.number(),
    message: z.string(),
  }),
});

const handActionOutput = z.object({ ok: z.boolean(), message: z.string() });

export const clearHandRpc = defineRpc({
  name: "needs-aub.clear",
  /** `flagAt` and `reason` are what the UI showed; a lead whose flag has since changed is left alone. */
  input: z.object({ leadId: z.string(), flagAt: z.string(), reason: z.string() }),
  output: handActionOutput,
});

export const snoozeHandRpc = defineRpc({
  name: "needs-aub.snooze",
  /** `flagAt` is the lead's current `needs-aub-at`; the snooze only applies to that flag. */
  input: z.object({ leadId: z.string(), flagAt: z.string(), reason: z.string() }),
  output: handActionOutput,
});

const PROVIDER_AUTO_MODES: Record<string, string> = {
  claude: "auto",
  "antigravity-cli": "accept-edits",
  codex: "full-access",
  opencode: "build",
};
const AUTO_MODE_FALLBACKS = ["auto", "accept-edits", "acceptEdits", "full-access", "build"];

/** The mode id a provider uses for its "auto" behaviour, checked against the modes it really offers. */
export function resolveProviderAutoMode(provider: string, availableModeIds?: readonly string[]): string {
  const mapped = PROVIDER_AUTO_MODES[provider.split("/")[0] ?? ""] ?? "auto";
  if (!availableModeIds?.length) return mapped;
  if (availableModeIds.includes(mapped)) return mapped;
  return AUTO_MODE_FALLBACKS.find((id) => availableModeIds.includes(id)) ?? mapped;
}
