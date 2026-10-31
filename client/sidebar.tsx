import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, SidebarRow, useToast } from "@getpaseo/plugin/client/ui";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useLeadBrainstorm } from "./brainstorm-link";
import { checkInLeadsRpc, clearHandRpc, snoozeHandRpc } from "../shared/brainstorm";
import { CLEAR_HAND_DEDUPE_MS } from "../shared/clear-hand";
import { CHECK_IN_DEDUPE_MS, formatQuiet, leadHealth } from "../shared/check-in";
import { useBoardConfig } from "./config";
import {
  agentKind,
  compareAgents,
  leadShortId,
  projectLanes,
  raisedHandsQueue,
  relativeTime,
  runningWorkersByLead,
  type BoardAgent,
  type ProjectLane,
  type RaisedHandItem,
} from "./model";
import { BOARD_SCREEN, OPEN_AGENT_SCREEN, WORKSPACES_SCREEN, navigationOf } from "./navigation";
import { useBoard, useNow } from "./store";
import { attentionLabel, Chip, dotIcon, ringIcon, statusColor } from "./ui";

export function AgentBoardSidebarItem(props: PluginSidebarItemProps) {
  const { theme, currentScreen, openScreen } = props;
  const board = useBoard();
  const cfg = useBoardConfig();
  const now = useNow();
  const [handsOpen, setHandsOpen] = useState(false);
  const [handIndex, setHandIndex] = useState(0);
  const toast = useToast();
  const checkInRpc = useRpc(checkInLeadsRpc);
  /** Leads whose check-in button is locked (in flight, then a few seconds after). */
  const clearRpc = useRpc(clearHandRpc);
  const snoozeRpc = useRpc(snoozeHandRpc);
  /** Lead id -> "cleared" / "snoozed" while its hand buttons are locked (in flight, then a few seconds after). */
  const [handSent, setHandSent] = useState<ReadonlyMap<string, string>>(new Map());
  const [lockedLeads, setLockedLeads] = useState<ReadonlySet<string>>(new Set());
  const { lanes, running } = useMemo(() => {
    const agents = [...board.agents.values()].sort(compareAgents);
    const live = agents.filter((agent) => !agent.archivedAt && agent.status !== "closed");
    const leads = cfg.leadsPreset ? live.filter((agent) => agentKind(agent, cfg) === "lead") : [];
    const brainstorms = cfg.brainstormPreset ? live.filter((agent) => agentKind(agent, cfg) === "brainstorm") : [];
    return {
      lanes: projectLanes(leads, brainstorms, cfg),
      running: agents.filter((agent) => agent.status === "running").length,
    };
  }, [board.agents, cfg]);
  const queue = useMemo(() => raisedHandsQueue([...board.agents.values()], cfg, now), [board.agents, cfg, now]);
  const workers = useMemo(
    () => runningWorkersByLead([...board.agents.values()], cfg, board.handoffs.relays),
    [board.agents, board.handoffs.relays, cfg],
  );
  const handAt = queue.length > 0 ? handIndex % queue.length : 0;
  const hand: RaisedHandItem | undefined = queue[handAt];

  const styles = useMemo(
    () => ({
      box: {
        marginHorizontal: 6,
        marginVertical: 6,
        paddingBottom: 4,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 10,
        backgroundColor: theme.colors.surface1,
        overflow: "hidden" as const,
      },
      header: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      },
      title: { flex: 1, color: theme.colors.foreground, fontSize: 13, fontWeight: "600" as const },
      sectionHeader: { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 2 },
      sectionTitle: {
        color: theme.colors.foregroundMuted,
        fontSize: 11,
        fontWeight: "600" as const,
        letterSpacing: 0.6,
        textTransform: "uppercase" as const,
      },
      muted: { color: theme.colors.foregroundMuted, fontSize: 12 },
      text: { color: theme.colors.foreground, fontSize: 12 },
      empty: { color: theme.colors.foregroundMuted, fontSize: 12, paddingHorizontal: 28, paddingVertical: 4 },
      banner: { paddingHorizontal: 10, paddingVertical: 6, gap: 4 },
      bannerLine: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
      divider: { height: 1, marginTop: 6, backgroundColor: theme.colors.border },
    }),
    [theme],
  );

  const navigation = navigationOf(props);
  const openAgentId = (agentId: string) => {
    if (navigation) navigation.openAgent({ agentId });
    else openScreen({ screenId: OPEN_AGENT_SCREEN, params: { agentId } });
  };
  const { openOrCreate, busyLeadId } = useLeadBrainstorm(openAgentId);
  const checkInLead = async (lead: BoardAgent) => {
    if (lockedLeads.has(lead.id)) return;
    setLockedLeads((s) => new Set(s).add(lead.id));
    try {
      const res = await checkInRpc({ leadId: lead.id });
      if (res.ok) toast.show(res.message);
      else toast.error(res.message);
    } catch (error) {
      toast.error(`Check-in failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setTimeout(() => setLockedLeads((s) => new Set([...s].filter((id) => id !== lead.id))), CHECK_IN_DEDUPE_MS);
    }
  };
  const handAction = async (lead: BoardAgent, kind: "clear" | "snooze") => {
    if (handSent.has(lead.id)) return;
    const sent = kind === "clear" ? "cleared" : "snoozed";
    setHandSent((m) => new Map(m).set(lead.id, sent));
    try {
      const res =
        kind === "clear"
          ? await clearRpc({ leadId: lead.id })
          : await snoozeRpc({ leadId: lead.id, flagAt: lead.labels["needs-aub-at"] ?? "" });
      if (!res.ok) toast.error(res.message);
    } catch (error) {
      toast.error(`Could not ${kind}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setTimeout(
        () => setHandSent((m) => new Map([...m].filter(([id]) => id !== lead.id))),
        CLEAR_HAND_DEDUPE_MS,
      );
    }
  };
  const handButtons = (item: RaisedHandItem) => {
    const sent = handSent.get(item.lead.id);
    const canSnooze = !!item.lead.labels["needs-aub-at"] && item.lead.labels["needs-aub"]?.toLowerCase() === "handled";
    return (
      <>
        {canSnooze ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Snooze raised hand for ${item.lead.title ?? "lead"} for 1 hour`}
            disabled={sent !== undefined}
            onPress={() => void handAction(item.lead, "snooze")}
          >
            <Chip theme={theme} label={sent === "snoozed" ? "✓ 1h" : "💤 1h"} tone={sent === "snoozed" ? "accent" : "muted"} />
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Clear raised hand for ${item.lead.title ?? "lead"}`}
          disabled={sent !== undefined}
          onPress={() => void handAction(item.lead, "clear")}
        >
          <Chip theme={theme} label={sent === "cleared" ? "✓" : "✕"} tone={sent === "cleared" ? "accent" : "muted"} />
        </Pressable>
      </>
    );
  };
  const openBoard = () => openScreen({ screenId: BOARD_SCREEN });
  const isOpen = (agent: BoardAgent | undefined) =>
    agent !== undefined &&
    currentScreen?.screenId === OPEN_AGENT_SCREEN &&
    currentScreen.params.agentId === agent.id;

  /** Row body: the project's brainstorm; with none, create it and open it. */
  const openLane = (lane: ProjectLane) => {
    if (lane.brainstorm) openAgentId(lane.brainstorm.id);
    else if (lane.lead) void openOrCreate(lane.lead, undefined);
  };

  const laneRow = (lane: ProjectLane) => {
    const { lead, brainstorm } = lane;
    const noBrainstorm = !brainstorm && cfg.brainstormPreset;
    const busy = lead !== undefined && busyLeadId === lead.id;
    const raisedItem = lead ? queue.find((item) => item.lead.id === lead.id) : undefined;
    const raised = raisedItem !== undefined;
    const attending = brainstorm ?? lead;
    const attention = attending ? attentionLabel(attending) : null;
    const workerCount = lead ? (workers.get(lead.id) ?? 0) : 0;
    const leadChip = lead ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open lead ${lane.title}`}
        onPress={() => openAgentId(lead.id)}
      >
        <Chip
          theme={theme}
          label={`★ ${leadShortId(lead, cfg)}${workerCount > 0 ? ` · ${workerCount}w` : ""}`}
          tone={isOpen(lead) ? "accent" : "muted"}
        />
      </Pressable>
    ) : (
      <Chip theme={theme} label="no lead" />
    );
    const health = lead ? leadHealth(lead, now, cfg.checkInQuietMs) : undefined;
    const healthChip =
      health?.kind === "error" ? (
        <Chip theme={theme} label="error" tone="danger" />
      ) : health?.kind === "quiet" ? (
        <Chip theme={theme} label={`quiet ${formatQuiet(health.ms ?? 0)}`} tone="warning" />
      ) : null;
    const locked = lead !== undefined && lockedLeads.has(lead.id);
    const checkInButton = lead ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Check in with ${lane.title}`}
        disabled={locked}
        onPress={() => void checkInLead(lead)}
      >
        <Chip theme={theme} label={locked ? "✓" : "↻"} tone={locked ? "accent" : "muted"} />
      </Pressable>
    ) : null;
    return (
      <SidebarRow
        key={lane.key}
        id={`lane-${lane.key}`}
        icon={
          brainstorm ? dotIcon(statusColor(theme, brainstorm.status)) : ringIcon(theme.colors.foregroundMuted)
        }
        label={lane.title}
        active={isOpen(brainstorm)}
        onPress={() => openLane(lane)}
        trailing={
          <View style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
            {raised && raisedItem ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Clear raised hand for ${lane.title}`}
                disabled={handSent.has(raisedItem.lead.id)}
                onPress={() => void handAction(raisedItem.lead, "clear")}
              >
                <Text style={styles.text}>{handSent.has(raisedItem.lead.id) ? "✓" : "🙋"}</Text>
              </Pressable>
            ) : null}
            {attention ? <Chip theme={theme} label="!" tone="warning" /> : null}
            {noBrainstorm ? <Text style={styles.muted}>{busy ? "…" : "＋ chat"}</Text> : null}
            {healthChip}
            {checkInButton}
            {leadChip}
          </View>
        }
      />
    );
  };

  const handLabel = (item: RaisedHandItem, number: number) => {
    const lane = lanes.find((l) => l.lead?.id === item.lead.id);
    const project = lane?.title ?? item.lead.title ?? "";
    return `🙋 ${number}. ${project}${item.flaggedAt ? ` · ${relativeTime(item.flaggedAt, now)}` : ""}`;
  };
  const openHand = (item: RaisedHandItem) => void openOrCreate(item.lead, item.brainstorm);

  const status =
    board.status === "error" ? "offline" : board.status === "ready" ? `${running} run` : "loading…";

  return (
    <View style={styles.box}>
      <View
        style={[
          styles.header,
          currentScreen?.screenId === BOARD_SCREEN ? { backgroundColor: theme.colors.surface2 } : null,
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open Roster, ${status}`}
          onPress={openBoard}
          style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8 }}
        >
          <Icon name="LayoutList" size={14} color={theme.colors.accent} />
          <Text style={styles.title}>Roster</Text>
        </Pressable>
        {queue.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${queue.length} waiting on you, ${handsOpen ? "collapse" : "expand"}`}
            onPress={() => setHandsOpen((v) => !v)}
          >
            <Chip theme={theme} label={`🙋 ${queue.length}`} tone="warning" />
          </Pressable>
        ) : null}
        <Chip
          theme={theme}
          label={status}
          tone={board.status === "error" ? "danger" : running > 0 ? "accent" : "muted"}
        />
      </View>
      {hand ? (
        <View>
          <View style={styles.banner}>
            <View style={styles.bannerLine}>
              <Text style={[styles.text, { flex: 1, minWidth: 0, fontWeight: "600" }]} numberOfLines={1}>
                {handLabel(hand, handAt + 1)}
              </Text>
              {queue.length > 1 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Next raised hand"
                  onPress={() => setHandIndex(handAt + 1)}
                >
                  <Chip theme={theme} label={`${handAt + 1}/${queue.length} ▸`} />
                </Pressable>
              ) : null}
            </View>
            <View style={styles.bannerLine}>
              <Text style={[styles.muted, { flex: 1, minWidth: 0 }]} numberOfLines={2}>
                “{hand.reason}”
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open brainstorm for ${hand.lead.title ?? "lead"}`}
                disabled={busyLeadId === hand.lead.id}
                onPress={() => openHand(hand)}
              >
                <Chip theme={theme} label={busyLeadId === hand.lead.id ? "…" : "Open"} tone="accent" />
              </Pressable>
              {handButtons(hand)}
            </View>
          </View>
          {handsOpen
            ? queue.map((item, index) => (
                <View key={item.lead.id} style={[styles.banner, { paddingVertical: 3 }]}>
                  <View style={styles.bannerLine}>
                    <Text style={[styles.text, { flex: 1, minWidth: 0 }]} numberOfLines={1}>
                      {handLabel(item, index + 1)}
                    </Text>
                    <Pressable accessibilityRole="button" onPress={() => openHand(item)}>
                      <Chip theme={theme} label="Open" tone="accent" />
                    </Pressable>
                    {handButtons(item)}
                  </View>
                  <Text style={styles.muted} numberOfLines={2}>
                    {item.reason}
                  </Text>
                </View>
              ))
            : null}
          <View style={styles.divider} />
        </View>
      ) : null}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle} numberOfLines={1}>
          Projects
        </Text>
      </View>
      {lanes.length === 0 ? <Text style={styles.empty}>None active</Text> : lanes.map(laneRow)}
      <View style={styles.divider} />
      <SidebarRow
        id="workspaces"
        icon="FolderTree"
        label="Workspaces"
        active={currentScreen?.screenId === WORKSPACES_SCREEN}
        onPress={() => openScreen({ screenId: WORKSPACES_SCREEN })}
      />
    </View>
  );
}
