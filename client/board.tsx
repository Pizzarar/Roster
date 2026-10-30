import { usePaseo, useRpc, type PluginScreenProps } from "@getpaseo/plugin/client";
import { copyText, ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  agentKind,
  analyzeBrainstormCoverage,
  basename,
  chainedLeads,
  displayTitle,
  groupAgents,
  liveWorktrees,
  matchesSearch,
  relativeTime,
  type BoardAgent,
  type BrainstormCoverage,
  type LiveWorktree,
} from "./model";
import { boardStore, useBoard, useNow, useSubagentWatch, type SubagentCount } from "./store";
import { PARENT_LABEL, type BoardConfig } from "../shared/config";
import { stopAgentRpc } from "../shared/stop";
import { fixChainedLeadsRpc, type HandoffRecord } from "../shared/handoff";
import { createBrainstormRpc, renameBrainstormRpc } from "../shared/brainstorm";
import { useBoardConfig } from "./config";
import { attentionLabel, Chip, ConfirmButton, StatusDot, statusColor, subagentLabel } from "./ui";

type Theme = PluginScreenProps["theme"];

export function makeStyles(theme: Theme, compact: boolean) {
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
export type Styles = ReturnType<typeof makeStyles>;

export function Toggle({
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
  relayed,
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
  /** Moved here by a handoff; its events are relayed to this group's lead. */
  relayed: boolean;
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
            {relayed ? <Chip theme={theme} label="handed over" tone="accent" /> : null}
            {agent.archivedAt ? <Chip theme={theme} label="archived" /> : null}
            {task ? <Chip theme={theme} label={task} /> : null}
          </View>
          <Text style={styles.muted} numberOfLines={1}>
            {details.join(" · ")}
          </Text>
        </View>
      </Pressable>
      {cfg.showStopButton && agent.status === "running" && !agent.archivedAt ? (
        <ConfirmButton
          theme={theme}
          label="Stop"
          armedLabel="Confirm stop"
          busyLabel="Stopping…"
          accessibilityLabel={`Stop ${displayTitle(agent)}`}
          onConfirm={() => onStop(agent)}
        />
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

/** Leads still chained to their spawner, and recent handoffs with their retired lead. */
function BrainstormCoverageSection({
  coverage,
  theme,
  styles,
  onRename,
  onCreate,
}: {
  coverage: BrainstormCoverage;
  theme: Theme;
  styles: Styles;
  onRename: (candidate: BrainstormCoverage["candidates"][number]) => Promise<unknown>;
  onCreate: (missing: BrainstormCoverage["missingLeads"][number]) => Promise<unknown>;
}) {
  return (
    <>
      <Text style={styles.section}>BRAINSTORM COVERAGE</Text>
      <View style={styles.group}>
        {coverage.candidates.map((item, index) => (
          <View key={item.agent.id}>
            {index > 0 ? <View style={styles.divider} /> : null}
            <View style={styles.row}>
              <View style={styles.rowBody}>
                <Text style={styles.text} numberOfLines={1}>
                  {displayTitle(item.agent)} → {item.suggestedTitle}
                </Text>
                <Text style={styles.muted} numberOfLines={1}>
                  Rename and set role=brainstorm so it shows up in the sidebar
                </Text>
              </View>
              <ConfirmButton
                theme={theme}
                label="Rename"
                armedLabel="Confirm?"
                busyLabel="Renaming…"
                tone="accent"
                accessibilityLabel={`Rename ${displayTitle(item.agent)} to ${item.suggestedTitle}`}
                onConfirm={() => onRename(item)}
              />
            </View>
          </View>
        ))}
        {coverage.missingLeads.map((item, index) => (
          <View key={item.lead.id}>
            {index > 0 || coverage.candidates.length > 0 ? <View style={styles.divider} /> : null}
            <View style={styles.row}>
              <View style={styles.rowBody}>
                <Text style={styles.text} numberOfLines={1}>
                  {item.area} has no brainstorm chat
                </Text>
                <Text style={styles.muted} numberOfLines={1}>
                  {displayTitle(item.lead)} · {basename(item.lead.cwd)}
                </Text>
              </View>
              <ConfirmButton
                theme={theme}
                label="Create brainstorm"
                armedLabel="Spawn chat?"
                busyLabel="Creating…"
                tone="accent"
                accessibilityLabel={`Create brainstorm chat for ${item.area}`}
                onConfirm={() => onCreate(item)}
              />
            </View>
          </View>
        ))}
      </View>
    </>
  );
}

function HandoffSection({
  chained,
  handoffs,
  agents,
  cfg,
  now,
  theme,
  styles,
  onOpen,
  onFix,
  onArchive,
}: {
  chained: readonly BoardAgent[];
  handoffs: readonly HandoffRecord[];
  agents: ReadonlyMap<string, BoardAgent>;
  cfg: BoardConfig;
  now: number;
  theme: Theme;
  styles: Styles;
  onOpen(agent: BoardAgent): void;
  onFix(): Promise<void>;
  onArchive(agent: BoardAgent): Promise<void>;
}) {
  const recent = handoffs.slice(0, 8);
  if (chained.length === 0 && recent.length === 0) return null;
  const name = (id: string) => {
    const agent = agents.get(id);
    return agent ? displayTitle(agent) : `${id.slice(0, 8)} (archived)`;
  };
  const liveChildren = (id: string) => [...agents.values()].filter((agent) => agent.labels[PARENT_LABEL] === id).length;
  return (
    <>
      <Text style={styles.section}>LEAD HANDOFFS</Text>
      <View style={styles.group}>
        {chained.length > 0 ? (
          <View style={styles.row}>
            <View style={styles.rowBody}>
              <Text style={styles.text}>
                {chained.length} lead{chained.length === 1 ? " is" : "s are"} still a sub-agent of another agent
              </Text>
              <Text style={styles.muted} numberOfLines={2}>
                {chained.map((lead) => displayTitle(lead)).join(", ")}
              </Text>
              <Text style={styles.muted}>
                {cfg.adoptWorkers
                  ? "Fix detaches each lead and moves its old lead's workers to it."
                  : "Fix detaches each lead from its spawner."}
              </Text>
            </View>
            <ConfirmButton
              theme={theme}
              label="Fix"
              armedLabel={`Fix ${chained.length}?`}
              busyLabel="Fixing…"
              tone="accent"
              accessibilityLabel={`Detach ${chained.length} chained leads`}
              onConfirm={onFix}
            />
          </View>
        ) : null}
        {recent.map((handoff, index) => {
          const oldLead = agents.get(handoff.oldLeadId);
          const newLead = agents.get(handoff.newLeadId);
          const children = liveChildren(handoff.oldLeadId);
          return (
            <View key={`${handoff.oldLeadId}-${handoff.at}`}>
              {index > 0 || chained.length > 0 ? <View style={styles.divider} /> : null}
              <View style={styles.row}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${name(handoff.newLeadId)}`}
                  disabled={!newLead}
                  onPress={() => newLead && onOpen(newLead)}
                  style={({ pressed }) => [styles.rowBody, pressed ? styles.rowPressed : null]}
                >
                  <Text style={styles.text} numberOfLines={1}>
                    {name(handoff.oldLeadId)} → {name(handoff.newLeadId)}
                  </Text>
                  <Text style={styles.muted} numberOfLines={1}>
                    {relativeTime(handoff.at, now)} · moved {handoff.moved.length} worker
                    {handoff.moved.length === 1 ? "" : "s"}
                    {oldLead && children > 0 ? ` · old lead still has ${children} sub-agent${children === 1 ? "" : "s"}` : ""}
                  </Text>
                </Pressable>
                {oldLead ? (
                  <ConfirmButton
                    theme={theme}
                    label="Archive old lead"
                    armedLabel={children > 0 ? `Also archives ${children}?` : "Confirm archive"}
                    busyLabel="Archiving…"
                    accessibilityLabel={`Archive ${displayTitle(oldLead)}`}
                    onConfirm={() => onArchive(oldLead)}
                  />
                ) : null}
              </View>
            </View>
          );
        })}
      </View>
    </>
  );
}

export function AgentBoardScreen({ theme, layout, navigation }: PluginScreenProps) {
  const styles = useMemo(() => makeStyles(theme, layout.compact), [theme, layout.compact]);
  const board = useBoard();
  const cfg = useBoardConfig();
  const now = useNow();
  const toast = useToast();
  const paseo = usePaseo();
  const stopRpc = useRpc(stopAgentRpc);
  const fixChainsRpc = useRpc(fixChainedLeadsRpc);
  const renameRpc = useRpc(renameBrainstormRpc);
  const createRpc = useRpc(createBrainstormRpc);
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
  const relays = board.handoffs.relays;
  const groups = useMemo(() => groupAgents(all, visible, cfg, relays), [all, visible, cfg, relays]);
  const chained = useMemo(() => chainedLeads(live, cfg), [live, cfg]);
  const coverage = useMemo(() => analyzeBrainstormCoverage(live, cfg), [live, cfg]);
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
  const fixChains = async () => {
    try {
      const result = await fixChainsRpc({});
      if (result.ok) toast.show(result.message);
      else toast.error(result.message);
    } catch (error) {
      toast.error(`Fix failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    await boardStore.refreshHandoffs();
  };
  const archiveAgent = async (agent: BoardAgent) => {
    try {
      await paseo.agents.ref(agent.id).archive();
      toast.show(`Archived ${displayTitle(agent)}`);
    } catch (error) {
      toast.error(`Archive failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const renameCandidate = async (candidate: BrainstormCoverage["candidates"][number]) => {
    try {
      const res = await renameRpc({
        agentId: candidate.agent.id,
        title: candidate.suggestedTitle,
        leadKey: candidate.leadKey,
      });
      if (res.ok) toast.show(res.message);
      else toast.error(res.message);
    } catch (error) {
      toast.error(`Rename failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const createBrainstorm = async (missing: BrainstormCoverage["missingLeads"][number]) => {
    try {
      const res = await createRpc({
        leadId: missing.lead.id,
        leadTitle: displayTitle(missing.lead),
        area: missing.area,
        cwd: missing.lead.cwd,
      });
      if (res.ok) toast.show(res.message);
      else toast.error(res.message);
      if (res.agentId && navigation) {
        navigation.openAgent({ agentId: res.agentId });
      }
    } catch (error) {
      toast.error(`Create failed: ${error instanceof Error ? error.message : String(error)}`);
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
        {cfg.leadsPreset ? <Toggle theme={theme} label="Old leads" value={showOld} onChange={setShowOld} /> : null}
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

      <Text style={styles.section}>{cfg.leadsPreset ? "AGENTS BY LEAD" : "AGENTS"}</Text>
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
                  relayed={agent.id in board.handoffs.relays}
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

      {cfg.brainstormPreset && (coverage.candidates.length > 0 || coverage.missingLeads.length > 0) ? (
        <BrainstormCoverageSection
          coverage={coverage}
          theme={theme}
          styles={styles}
          onRename={renameCandidate}
          onCreate={createBrainstorm}
        />
      ) : null}

      {cfg.leadsPreset ? (
        <HandoffSection
          chained={chained}
          handoffs={board.handoffs.handoffs}
          agents={board.agents}
          cfg={cfg}
          now={now}
          theme={theme}
          styles={styles}
          onOpen={openAgent}
          onFix={fixChains}
          onArchive={archiveAgent}
        />
      ) : null}

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
