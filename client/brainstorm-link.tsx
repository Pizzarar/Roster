import { useRpc, type PluginHostProps } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/ui";
import { useCallback, useState } from "react";
import { Pressable, Text } from "react-native";
import { createBrainstormRpc } from "../shared/brainstorm";
import { useBoardConfig } from "./config";
import { displayTitle, leadArea, type BoardAgent } from "./model";

type Theme = PluginHostProps["theme"];

/**
 * Opens a lead's matched brainstorm, or creates one (reusing an existing match server-side) and opens it.
 * `openAgent` is the caller's own navigation, since sidebar and screens navigate differently.
 */
export function useLeadBrainstorm(openAgent: (agentId: string) => void) {
  const cfg = useBoardConfig();
  const toast = useToast();
  const createRpc = useRpc(createBrainstormRpc);
  const [busyLeadId, setBusyLeadId] = useState<string | null>(null);
  const openOrCreate = useCallback(
    async (lead: BoardAgent, brainstorm: BoardAgent | undefined) => {
      if (brainstorm) {
        openAgent(brainstorm.id);
        return;
      }
      setBusyLeadId(lead.id);
      try {
        const res = await createRpc({
          leadId: lead.id,
          leadTitle: displayTitle(lead),
          area: leadArea(lead, cfg),
          cwd: lead.cwd,
          workspaceId: lead.workspaceId,
          profile: cfg.brainstormProfile || undefined,
          modeId: cfg.brainstormModeId || "auto",
          reuseExisting: true,
        });
        if (res.ok) toast.show(res.message);
        else toast.error(res.message);
        if (res.agentId) openAgent(res.agentId);
      } catch (error) {
        toast.error(`Create failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        setBusyLeadId(null);
      }
    },
    [cfg, createRpc, openAgent, toast],
  );
  return { openOrCreate, busyLeadId };
}

/** 💬 opens the lead's brainstorm; ＋💬 creates one. */
export function BrainstormChip({
  theme,
  exists,
  busy = false,
  onPress,
}: {
  theme: Theme;
  exists: boolean;
  busy?: boolean;
  onPress(): void;
}) {
  const color = exists ? theme.colors.accent : theme.colors.foregroundMuted;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={exists ? "Open brainstorm" : "Create brainstorm"}
      disabled={busy}
      onPress={onPress}
      style={{
        borderWidth: 1,
        borderColor: color,
        borderRadius: 999,
        paddingHorizontal: 6,
        paddingVertical: 1,
        opacity: busy ? 0.6 : 1,
      }}
    >
      <Text style={{ color, fontSize: 11 }} numberOfLines={1}>
        {busy ? "…" : exists ? "💬" : "＋💬"}
      </Text>
    </Pressable>
  );
}
