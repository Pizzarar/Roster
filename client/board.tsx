import { useRpc, type PluginScreenProps } from "@getpaseo/plugin/client";
import { copyText, ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  agentKind,
  basename,
  displayTitle,
  groupAgents,
  liveWorktrees,
  matchesSearch,
  relativeTime,
  type BoardAgent,
  type LiveWorktree,
} from "./model";
import { boardStore, useBoard, useNow, useSubagentWatch, type SubagentCount } from "./store";
import type { BoardConfig } from "../shared/config";
import { stopAgentRpc } from "../shared/stop";
import { useBoardConfig } from "./config";
import { attentionLabel, Chip, StatusDot, statusColor, subagentLabel } from "./ui";

type Theme = PluginScreenProps["theme"];

function makeStyles(theme: Theme, compact: boolean) {
  return {
    screen: { flex: 1, backgroundColor: theme.colors.surface0 },
    content: { padding: compact ? 12 : 24, gap: compact ? 12 : 16, paddingBottom: 48 },
    title: { color: theme.colors.foreground, fontSize: compact ? 18 : 22, fontWeight: "600" as const },
    text: { color: theme.colors.foreground, fontSize: 14 },
    muted: { color: theme.colors.foregroundMuted, fontSize: 12 },
    section: { color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: "600" as const, letterSpacing: 0.5 },
    input: {
      color: theme.colors.foreground,
      backgroundColor: theme.colors.surface1,
      borderColor: theme.colors.border,
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: compact ? 8 : 6,
      fontSize: 14,
    },
    toggles: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 8 },
    group: {
      backgroundColor: theme.colors.surface1,
      borderColor: theme.colors.border,
      borderWidth: 1,
      borderRadius: 10,
      overflow: "hidden" as const,
    },
    groupHeader: {
      flexDirection: "row" as const,
      justifyContent: "space-between" as const,
      paddingHorizontal: compact ? 10 : 14,
      paddingVertical: 8,
      borderBottomColor: theme.colors.border,
      borderBottomWidth: 1,
    },
    row: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 8,
      paddingHorizontal: compact ? 10 : 14,
      paddingVertical: compact ? 10 : 8,
    },
    rowPressed: { backgroundColor: theme.colors.surface2 },
    rowBody: { flex: 1, minWidth: 0, gap: 2 },
    rowTitleLine: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, flexWrap: "wrap" as const },
    divider: { height: 1, backgroundColor: theme.colors.border },
    smallButton: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
  };
}
type Styles = ReturnType<typeof makeStyles>;

function Toggle({
  theme,
  label,
  value,
  onChange,
}: {
  theme: Theme;
  label: string;
  value: boolean;
  onChange(value: boolean): void;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      onPress={() => onChange(!value)}
      style={{
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: value ? theme.colors.accent : theme.colors.border,
        backgroundColor: value ? theme.colors.accent : "transparent",
      }}
    >
      <Text style={{ color: value ? theme.colors.accentForeground : theme.colors.foreground, fontSize: 12 }}>
        {value ? "✓ " : ""}
        {label}
      </Text>
    </Pressable>
  );
}

function AgentRow({
  agent,
  indent,
  subagents,
  now,
  cfg,
  theme,
  styles,
  onOpen,
  onCopy,
  onStop,
}: {
  agent: BoardAgent;
  indent: boolean;
  subagents: SubagentCount | undefined;
  now: number;
  cfg: BoardConfig;
  theme: Theme;
  styles: Styles;
  onOpen(agent: BoardAgent): void;
  onCopy(text: string, what: string): void;
  onStop(agent: BoardAgent): Promise<void>;
}) {
  const kind = agentKind(agent, cfg);
  const attention = attentionLabel(agent);
  const subagentText = subagentLabel(subagents);
  const task = agent.labels.task;
  const details = [
    agent.status,
    agent.model ?? agent.provider,
    basename(agent.cwd),
    `active ${relativeTime(agent.updatedAt, now)}`,
  ];
  return (
    <View style={[styles.row, indent ? { paddingLeft: 30 } : null]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${displayTitle(agent)}`}
        onPress={() => onOpen(agent)}
        style={({ pressed }) => [
          { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 },
          pressed ? styles.rowPressed : null,
        ]}
      >
        <StatusDot color={statusColor(theme, agent.status)} />
        <View style={styles.rowBody}>
          <View style={styles.rowTitleLine}>
            <Text
              style={[styles.text, kind === "lead" ? { fontWeight: "600" } : null]}
              numberOfLines={1}
            >
              {displayTitle(agent)}
            </Text>
            {attention ? (
              <Chip theme={theme} label={attention} tone={agent.attentionReason === "error" ? "danger" : "warning"} />
            ) : null}
            {subagentText ? <Chip theme={theme} label={subagentText} tone="accent" /> : null}
            {kind === "old-lead" ? <Chip theme={theme} label="old" /> : null}
            {agent.archivedAt ? <Chip theme={theme} label="archived" /> : null}
            {task ? <Chip theme={theme} label={task} /> : null}
          </View>
          <Text style={styles.muted} numberOfLines={1}>
            {details.join(" · ")}
          </Text>
        </View>
      </Pressable>
      {cfg.showStopButton && agent.status === "running" && !agent.archivedAt ? (
        <StopButton agent={agent} theme={theme} styles={styles} onStop={onStop} />
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Copy agent id of ${displayTitle(agent)}`}
        onPress={() => onCopy(agent.id, "Agent id")}
        style={styles.smallButton}
      >
        <Text style={styles.muted}>id</Text>
      </Pressable>
    </View>
  );
}

/** Two taps: the first arms it for a few seconds, the second interrupts the running turn. */
function StopButton({
  agent,
  theme,
  styles,
  onStop,
}: {
  agent: BoardAgent;
  theme: Theme;
  styles: Styles;
  onStop(agent: BoardAgent): Promise<void>;
}) {
  const [state, setState] = useState<"idle" | "armed" | "stopping">("idle");
  useEffect(() => {
    if (state !== "armed") return undefined;
    const timer = setTimeout(() => setState("idle"), 4000);
    return () => clearTimeout(timer);
  }, [state]);
  const danger = theme.colors.statusDanger;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        state === "armed" ? `Confirm stop ${displayTitle(agent)}` : `Stop ${displayTitle(agent)}`
      }
      disabled={state === "stopping"}
      onPress={() => {
        if (state === "idle") setState("armed");
        else if (state === "armed") {
          setState("stopping");
          void onStop(agent).finally(() => setState("idle"));
        }
      }}
      style={[
        styles.smallButton,
        { borderColor: danger },
        state === "armed" ? { backgroundColor: danger } : null,
      ]}
    >
      <Text style={{ fontSize: 12, color: state === "armed" ? theme.colors.surface0 : danger }}>
        {state === "armed" ? "Confirm stop" : state === "stopping" ? "Stopping…" : "Stop"}
      </Text>
    </Pressable>
  );
}

function WorktreeRow({
  worktree,
  theme,
  styles,
  onOpen,
}: {
  worktree: LiveWorktree;
  theme: Theme;
  styles: Styles;
  onOpen(worktree: LiveWorktree): void;
}) {
  const running = worktree.agents.filter((agent) => agent.status === "running").length;
  const titles = worktree.agents.slice(0, 3).map(displayTitle).join(", ");
  const more = worktree.agents.length > 3 ? ` +${worktree.agents.length - 3}` : "";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open workspace ${worktree.name}`}
      onPress={() => onOpen(worktree)}
      style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
    >
      <StatusDot color={running > 0 ? theme.colors.statusSuccess : theme.colors.foregroundMuted} />
      <View style={styles.rowBody}>
        <Text style={styles.text} numberOfLines={1}>
          {worktree.name}{" "}
          <Text style={styles.muted}>
            {worktree.agents.length} agent{worktree.agents.length === 1 ? "" : "s"}, {running} running
          </Text>
        </Text>
        <Text style={styles.muted} numberOfLines={1}>
          {worktree.cwd}
        </Text>
        <Text style={styles.muted} numberOfLines={1}>
          {titles}
          {more}
        </Text>
      </View>
      {worktree.workspaceId ? null : <Chip theme={theme} label="copy path" />}
    </Pressable>
  );
}

export function AgentBoardScreen({ theme, layout, navigation }: PluginScreenProps) {
  const styles = useMemo(() => makeStyles(theme, layout.compact), [theme, layout.compact]);
  const board = useBoard();
  const cfg = useBoardConfig();
  const now = useNow();
  const toast = useToast();
  const stopRpc = useRpc(stopAgentRpc);
  const [query, setQuery] = useState("");
  const [showOld, setShowOld] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    if (showArchived && board.archived === null && board.archivedStatus !== "loading") {
      void boardStore.loadArchived();
    }
  }, [showArchived, board.archived, board.archivedStatus]);

  const live = useMemo(() => [...board.agents.values()], [board.agents]);
  const all = useMemo(
    () => (showArchived && board.archived ? [...live, ...board.archived.filter((a) => !board.agents.has(a.id))] : live),
    [live, showArchived, board.archived, board.agents],
  );
  const visible = useMemo(
    () =>
      all.filter(
        (agent) => (showOld || agentKind(agent, cfg) !== "old-lead") && matchesSearch(agent, query),
      ),
    [all, showOld, query, cfg],
  );
  const groups = useMemo(() => groupAgents(all, visible, cfg), [all, visible, cfg]);
  const worktrees = useMemo(() => liveWorktrees(live), [live]);
  useSubagentWatch(
    useMemo(
      () => (cfg.countSubagents ? live.filter((agent) => agent.status === "running").map((agent) => agent.id) : []),
      [live, cfg],
    ),
  );

  const running = live.filter((agent) => agent.status === "running").length;
  const attention = live.filter((agent) => agent.requiresAttention).length;

  const copy = (text: string, what: string) => {
    copyText(text).then(
      () => toast.show(`${what} copied`),
      () => toast.error(`Could not copy. ${what}: ${text}`),
    );
  };
  const openAgent = (agent: BoardAgent) => {
    if (navigation) navigation.openAgent({ agentId: agent.id });
    else copy(agent.id, "Agent id");
  };
  const stopAgent = async (agent: BoardAgent) => {
    try {
      const result = await stopRpc({ agentId: agent.id });
      if (result.ok) toast.show(`Stop sent to ${displayTitle(agent)}`);
      else toast.error(`Stop failed: ${result.message}`);
    } catch (error) {
      toast.error(`Stop failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const openWorktree = (worktree: LiveWorktree) => {
    if (navigation && worktree.workspaceId) navigation.openWorkspace({ workspaceId: worktree.workspaceId });
    else copy(worktree.cwd, "Path");
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={{ gap: 4 }}>
        <Text style={styles.title}>Roster</Text>
        <Text style={styles.muted}>
          {board.status === "ready"
            ? `${live.length} agents · ${running} running · ${attention} need attention`
            : board.status === "error"
              ? `Could not load agents: ${board.error ?? "unknown error"}`
              : "Loading agents…"}
          {board.truncated ? " · showing the 200 most recent" : ""}
        </Text>
        {board.status === "error" ? (
          <Pressable accessibilityRole="button" onPress={() => boardStore.retry()} style={[styles.smallButton, { alignSelf: "flex-start" }]}>
            <Text style={styles.text}>Retry</Text>
          </Pressable>
        ) : null}
      </View>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search title, task, label (role=worker), model, folder"
        placeholderTextColor={theme.colors.foregroundMuted}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
        accessibilityLabel="Search agents"
      />
      <View style={styles.toggles}>
        <Toggle theme={theme} label="Old leads" value={showOld} onChange={setShowOld} />
        <Toggle theme={theme} label="Archived" value={showArchived} onChange={setShowArchived} />
        <Toggle
          theme={theme}
          label="Background"
          value={board.includeBackground}
          onChange={(value) => boardStore.setIncludeBackground(value)}
        />
      </View>
      {showArchived && board.archivedStatus === "loading" ? (
        <Text style={styles.muted}>Loading archived agents…</Text>
      ) : null}
      {showArchived && board.archivedStatus === "error" ? (
        <Text style={styles.muted}>Could not load archived agents.</Text>
      ) : null}

      <Text style={styles.section}>AGENTS BY LEAD</Text>
      {groups.length === 0 && board.status === "ready" ? (
        <Text style={styles.muted}>No agents match.</Text>
      ) : null}
      {groups.map((group) => {
        const hasLead = group.rootId !== null || group.agents.some((agent) => agentKind(agent, cfg) === "lead");
        return (
          <View key={group.key} style={styles.group}>
            <View style={styles.groupHeader}>
              <Text style={[styles.text, { fontWeight: "600" }]} numberOfLines={1}>
                {group.title}
              </Text>
              <Text style={styles.muted}>{group.agents.length}</Text>
            </View>
            {group.agents.map((agent, index) => (
              <View key={agent.id}>
                {index > 0 ? <View style={styles.divider} /> : null}
                <AgentRow
                  agent={agent}
                  indent={hasLead && agent.id !== group.rootId && agentKind(agent, cfg) === "worker"}
                  subagents={board.subagents.get(agent.id)}
                  now={now}
                  cfg={cfg}
                  theme={theme}
                  styles={styles}
                  onOpen={openAgent}
                  onCopy={copy}
                  onStop={stopAgent}
                />
              </View>
            ))}
          </View>
        );
      })}

      <Text style={styles.section}>WORKTREES WITH LIVE AGENTS ({worktrees.length})</Text>
      <View style={styles.group}>
        {worktrees.length === 0 ? (
          <View style={styles.row}>
            <Text style={styles.muted}>No running or idle agents.</Text>
          </View>
        ) : null}
        {worktrees.map((worktree, index) => (
          <View key={worktree.cwd}>
            {index > 0 ? <View style={styles.divider} /> : null}
            <WorktreeRow worktree={worktree} theme={theme} styles={styles} onOpen={openWorktree} />
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

/** Opened by sidebar rows, which have no navigation of their own. */
export function OpenAgentScreen({ theme, layout, navigation, params }: PluginScreenProps) {
  const styles = useMemo(() => makeStyles(theme, layout.compact), [theme, layout.compact]);
  const board = useBoard();
  const toast = useToast();
  const agentId = params.agentId ?? "";
  const agent = board.agents.get(agentId);

  useEffect(() => {
    if (agentId && navigation) navigation.openAgent({ agentId });
  }, [agentId, navigation]);

  return (
    <View style={[styles.screen, styles.content]}>
      <Text style={styles.title}>{agent ? displayTitle(agent) : "Agent"}</Text>
      <Text style={styles.muted}>
        {navigation ? "Opening the agent's chat…" : "This Paseo app cannot open agents from plugins."}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={() =>
          copyText(agentId).then(
            () => toast.show("Agent id copied"),
            () => toast.error(`Could not copy: ${agentId}`),
          )
        }
        style={[styles.smallButton, { alignSelf: "flex-start" }]}
      >
        <Text style={styles.text}>Copy id {agentId}</Text>
      </Pressable>
      {agent ? <Text style={styles.muted}>{agent.cwd}</Text> : null}
      {agent && navigation && agent.workspaceId ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.openWorkspace({ workspaceId: agent.workspaceId! })}
          style={[styles.smallButton, { alignSelf: "flex-start" }]}
        >
          <Text style={styles.text}>Open workspace {basename(agent.cwd)}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
