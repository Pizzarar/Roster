import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { Icon, SidebarRow } from "@getpaseo/plugin/client/ui";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { TrackerConfig } from "../shared/config";
import { useBoardConfig } from "./config";
import { agentKind, analyzeBrainstormCoverage, compareAgents, isTracked, sidebarTitle, type BoardAgent } from "./model";
import { BOARD_SCREEN, OPEN_AGENT_SCREEN, WORKSPACES_SCREEN, navigationOf } from "./navigation";
import { useBoard, useSubagentWatch } from "./store";
import { attentionLabel, Chip, dotIcon, statusColor, subagentLabel } from "./ui";

interface Section {
  readonly tracker: TrackerConfig;
  readonly agents: readonly BoardAgent[];
}

/** Collapsed section ids, kept for the session so a remounted sidebar stays as it was. */
const collapsedSections = new Set<string>();

export function AgentBoardSidebarItem(props: PluginSidebarItemProps) {
  const { theme, currentScreen, openScreen } = props;
  const board = useBoard();
  const cfg = useBoardConfig();
  const [collapsed, setCollapsed] = useState(() => new Set(collapsedSections));
  const { sections, leads, running } = useMemo(() => {
    const agents = [...board.agents.values()].sort(compareAgents);
    return {
      leads: cfg.leadsPreset ? agents.filter((agent) => agentKind(agent, cfg) === "lead") : [],
      sections: cfg.trackers
        .filter((tracker) => !(cfg.leadsPreset && tracker.kind === "leads"))
        .map(
        (tracker): Section => ({ tracker, agents: agents.filter((agent) => isTracked(agent, tracker, cfg)) }),
        ),
      running: agents.filter((agent) => agent.status === "running").length,
    };
  }, [board.agents, cfg]);
  const coverage = useMemo(
    () =>
      cfg.brainstormPreset
        ? analyzeBrainstormCoverage([...board.agents.values()], cfg)
        : { candidates: [], missingLeads: [] },
    [board.agents, cfg],
  );
  const watched = useMemo(
    () =>
      cfg.countSubagents
        ? [
            ...new Set([
              ...leads.map((agent) => agent.id),
              ...sections.flatMap(({ tracker, agents }) => agents.slice(0, tracker.limit).map((agent) => agent.id)),
            ]),
          ]
        : [],
    [sections, leads, cfg],
  );
  useSubagentWatch(watched);

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
      sectionHeader: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 4,
        paddingHorizontal: 10,
        paddingTop: 8,
        paddingBottom: 2,
      },
      sectionTitle: {
        flex: 1,
        color: theme.colors.foregroundMuted,
        fontSize: 11,
        fontWeight: "600" as const,
        letterSpacing: 0.6,
        textTransform: "uppercase" as const,
      },
      muted: { color: theme.colors.foregroundMuted, fontSize: 12 },
      empty: { color: theme.colors.foregroundMuted, fontSize: 12, paddingHorizontal: 28, paddingVertical: 4 },
      divider: { height: 1, marginTop: 6, backgroundColor: theme.colors.border },
    }),
    [theme],
  );

  const navigation = navigationOf(props);
  const open = (agent: BoardAgent) => {
    if (navigation) navigation.openAgent({ agentId: agent.id });
    else openScreen({ screenId: OPEN_AGENT_SCREEN, params: { agentId: agent.id } });
  };
  const openBoard = () => openScreen({ screenId: BOARD_SCREEN });
  const isOpen = (agent: BoardAgent) =>
    currentScreen?.screenId === OPEN_AGENT_SCREEN && currentScreen.params.agentId === agent.id;
  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      collapsedSections.clear();
      for (const key of next) collapsedSections.add(key);
      return next;
    });

  const row = (agent: BoardAgent, sectionId: string) => {
    const attention = attentionLabel(agent);
    const subagents = subagentLabel(board.subagents.get(agent.id));
    const trailing =
      attention || subagents ? (
        <View style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
          {subagents ? <Chip theme={theme} label={subagents} tone="accent" /> : null}
          {attention ? (
            <Chip theme={theme} label="!" tone={agent.attentionReason === "error" ? "danger" : "warning"} />
          ) : null}
        </View>
      ) : undefined;
    return (
      <SidebarRow
        key={agent.id}
        id={`${sectionId}-${agent.id}`}
        icon={dotIcon(statusColor(theme, agent.status))}
        label={sidebarTitle(agent, cfg)}
        active={isOpen(agent)}
        trailing={trailing}
        onPress={() => open(agent)}
      />
    );
  };

  const section = ({ tracker, agents }: Section) => {
    const shut = collapsed.has(tracker.id);
    const attention = agents.some((agent) => agent.requiresAttention);
    const hidden = agents.length - tracker.limit;
    return (
      <View key={tracker.id}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${tracker.name}, ${agents.length} agents, ${shut ? "expand" : "collapse"}`}
          onPress={() => toggle(tracker.id)}
          style={styles.sectionHeader}
        >
          <Icon name={shut ? "ChevronRight" : "ChevronDown"} size={12} color={theme.colors.foregroundMuted} />
          <Text style={styles.sectionTitle} numberOfLines={1}>
            {tracker.name}
          </Text>
          {shut && attention ? <Chip theme={theme} label="!" tone="warning" /> : null}
          <Text style={styles.muted}>{agents.length}</Text>
        </Pressable>
        {shut ? null : agents.length === 0 ? (
          <Text style={styles.empty}>None active</Text>
        ) : (
          <>
            {agents.slice(0, tracker.limit).map((agent) => row(agent, tracker.id))}
            {hidden > 0 ? (
              <SidebarRow id={`${tracker.id}-more`} icon="LayoutList" label={`${hidden} more`} onPress={openBoard} />
            ) : null}
          </>
        )}
        {!shut && tracker.kind === "brainstorm" && (coverage.candidates.length > 0 || coverage.missingLeads.length > 0) ? (
          <SidebarRow
            id="brainstorm-coverage"
            icon="LayoutList"
            label={
              coverage.missingLeads.length > 0 && coverage.candidates.length > 0
                ? `${coverage.missingLeads.length} missing · ${coverage.candidates.length} to rename`
                : coverage.missingLeads.length > 0
                  ? `${coverage.missingLeads.length} active without brainstorm`
                  : `${coverage.candidates.length} to rename`
            }
            onPress={openBoard}
          />
        ) : null}
      </View>
    );
  };

  const status =
    board.status === "error" ? "offline" : board.status === "ready" ? `${running} running` : "loading…";

  return (
    <View style={styles.box}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open Roster, ${status}`}
        onPress={openBoard}
        style={[
          styles.header,
          currentScreen?.screenId === BOARD_SCREEN ? { backgroundColor: theme.colors.surface2 } : null,
        ]}
      >
        <Icon name="LayoutList" size={14} color={theme.colors.accent} />
        <Text style={styles.title}>Roster</Text>
        <Chip
          theme={theme}
          label={status}
          tone={board.status === "error" ? "danger" : running > 0 ? "accent" : "muted"}
        />
      </Pressable>
      {cfg.leadsPreset ? (
        <>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle} numberOfLines={1}>
              Leads
            </Text>
            {leads.some((agent) => agent.requiresAttention) ? <Chip theme={theme} label="!" tone="warning" /> : null}
            <Text style={styles.muted}>{leads.length}</Text>
          </View>
          {leads.length === 0 ? <Text style={styles.empty}>None active</Text> : leads.map((agent) => row(agent, "pinned-leads"))}
          <View style={styles.divider} />
        </>
      ) : null}
      {sections.map(section)}
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
