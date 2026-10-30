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
    profile: z.string().optional(),
    modeId: z.string().optional(),
  }),
  output: z.object({
    ok: z.boolean(),
    message: z.string(),
    agentId: z.string().optional(),
  }),
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
