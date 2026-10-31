import { usePaseo, useRpc, type PluginScreenProps } from "@getpaseo/plugin/client";
import { copyText, ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { autoArchiveStateRpc, runAutoArchiveRpc, undoAutoArchiveRpc, type AutoArchiveState } from "../shared/auto-archive";
import { createBrainstormRpc } from "../shared/brainstorm";
import { checkWorkspaceMergesRpc } from "../shared/workspaces";
import { makeStyles, Toggle, useAgentProfiles, type Styles } from "./board";
import { normalizePath, type BoardConfig } from "../shared/config";
import { useBoardConfig } from "./config";
import { agentKind, basename, displayTitle, leadArea, relativeTime, sidebarTitle, type BoardAgent } from "./model";
import { useBoard, useNow } from "./store";
import { Chip, ConfirmButton, StatusDot, statusColor } from "./ui";

interface BrainstormTarget {
  key: string;
  label: string;
  area: string;
  cwd: string;
  leadId?: string;
  leadTitle?: string;
  workspaceId?: string;
  projectDisplayName?: string;
  activityAt: string;
}
import {
  agentsByWorkspace,
  cleanupVerdict,
  hasActionableWarning,
  sortRows,
  useWorkspaces,
  workspaceStore,
  type CleanupVerdict,
  type WorkspaceRow,
  type WorkspaceSort,
} from "./workspaces";

type Theme = PluginScreenProps["theme"];
type Filter = "all" | CleanupVerdict["kind"];

const SORTS: readonly { value: WorkspaceSort; label: string }[] = [
  { value: "cleanup", label: "Cleanup first" },
  { value: "activity", label: "Recent" },
  { value: "name", label: "Name" },
  { value: "project", label: "Project" },
];

const FILTERS: readonly { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "candidate", label: "Safe to clean" },
  { value: "keep", label: "Check first" },
  { value: "blocked", label: "In use" },
];

function verdictColor(theme: Theme, row: WorkspaceRow): string {
  if (row.verdict.kind === "candidate") return theme.colors.statusSuccess;
  if (hasActionableWarning(row)) return theme.colors.statusWarning;
  return row.running > 0 ? theme.colors.statusSuccess : theme.colors.foregroundMuted;
}

function isLeadWorkspace(row: WorkspaceRow, cfg: BoardConfig): boolean {
  return row.agents.some((agent) => agentKind(agent, cfg) === "lead") || row.workspace.kind !== "worktree";
}

function matches(row: WorkspaceRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const { workspace } = row;
  const haystack = [workspace.name, workspace.project, workspace.directory, workspace.branch ?? "", workspace.kind]
    .join("\n")
    .toLowerCase();
  return q.split(/\s+/).every((term) => haystack.includes(term));
}

function WorkspaceRowView({
  row,
  now,
  theme,
  styles,
  cfg,
  expanded,
  onToggle,
  onOpen,
  onArchive,
}: {
  row: WorkspaceRow;
  now: number;
  theme: Theme;
  styles: Styles;
  cfg: BoardConfig;
  expanded: boolean;
  onToggle(id: string): void;
  onOpen(row: WorkspaceRow): void;
  onArchive(row: WorkspaceRow): Promise<void>;
}) {
  const { workspace, verdict } = row;
  const isMerged = workspace.merged || workspace.pr?.merged === true;
  const lead = row.agents.some((agent) => agentKind(agent, cfg) === "lead");
  const main = lead || workspace.kind !== "worktree";
  const activity = relativeTime(workspace.activityAt ?? workspace.createdAt, now);
  const meta =
    row.agents.length > 0 ? `${row.agents.length} ag${row.running ? ` (${row.running} run)` : ""} · ${activity}` : activity;
  const detail = [
    workspace.branch && workspace.branch !== workspace.name ? workspace.branch : null,
    workspace.directory,
    ...verdict.reasons,
  ].filter(Boolean);
  return (
    <View>
      <View style={[styles.row, { paddingVertical: 6 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open workspace ${workspace.name}`}
          onPress={() => onOpen(row)}
          style={({ pressed }) => [
            { flex: 1, flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 },
            pressed ? styles.rowPressed : null,
          ]}
        >
          <StatusDot color={verdictColor(theme, row)} />
          <Text style={[styles.text, { flexShrink: 1, fontWeight: main ? "600" : "400" }]} numberOfLines={1}>
            {workspace.name}
          </Text>
          {lead ? <Chip theme={theme} label="★ lead" tone="accent" /> : null}
          {workspace.kind !== "worktree" ? <Chip theme={theme} label={workspace.kind.replace("_", " ")} /> : null}
          {workspace.pinned ? <Chip theme={theme} label="pinned" tone="accent" /> : null}
          {workspace.dirty ? <Chip theme={theme} label="uncommitted" tone="danger" /> : null}
          {workspace.ahead && !isMerged ? <Chip theme={theme} label={`${workspace.ahead} ahead`} tone="warning" /> : null}
          {isMerged ? (
            <Chip theme={theme} label={workspace.pr?.number ? `PR #${workspace.pr.number} merged` : "merged"} tone="accent" />
          ) : workspace.pr ? (
            <Chip
              theme={theme}
              label={`PR${workspace.pr.number ? ` #${workspace.pr.number}` : ""} ${workspace.pr.state.toLowerCase()}`}
              tone="warning"
            />
          ) : null}
        </Pressable>
        <Text style={styles.muted} numberOfLines={1}>
          {meta}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${expanded ? "Collapse" : "Expand"} ${workspace.name}`}
          onPress={() => onToggle(workspace.id)}
          style={styles.smallButton}
        >
          <Text style={styles.text}>{expanded ? "▾" : "▸"}</Text>
        </Pressable>
      </View>
      {expanded ? (
        <View style={[styles.row, { paddingTop: 0, paddingVertical: 6 }]}>
          <Text style={[styles.muted, { flex: 1, minWidth: 0 }]} numberOfLines={2}>
            {detail.join(" · ")}
          </Text>
          <ConfirmButton
            theme={theme}
            label="Archive"
            armedLabel={workspace.ownedWorktree ? "Delete folder?" : "Confirm"}
            busyLabel="Archiving…"
            accessibilityLabel={`Archive workspace ${workspace.name}`}
            disabled={verdict.kind === "blocked"}
            onConfirm={() => onArchive(row)}
          />
        </View>
      ) : null}
    </View>
  );
}

export function WorkspacesScreen({ theme, layout, navigation }: PluginScreenProps) {
  const styles = useMemo(() => makeStyles(theme, layout.compact), [theme, layout.compact]);
  const paseo = usePaseo();
  const toast = useToast();
  const cfg = useBoardConfig();
  const board = useBoard();
  const state = useWorkspaces();
  const now = useNow();
  const checkMerges = useRpc(checkWorkspaceMergesRpc);
  const fetchAutoState = useRpc(autoArchiveStateRpc);
  const runAutoArchive = useRpc(runAutoArchiveRpc);
  const undoAutoArchive = useRpc(undoAutoArchiveRpc);
  const [undoBusy, setUndoBusy] = useState(false);
  const [autoState, setAutoState] = useState<AutoArchiveState | null>(null);
  const [showAutoLog, setShowAutoLog] = useState(false);
  const createRpc = useRpc(createBrainstormRpc);
  const profiles = useAgentProfiles();
  const [selectedTargetKey, setSelectedTargetKey] = useState<string | null>(null);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [creatingBrainstorm, setCreatingBrainstorm] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<WorkspaceSort>("cleanup");
  const [filter, setFilter] = useState<Filter>("all");
  const [byProject, setByProject] = useState(true);
  const [expandedRows, setExpandedRows] = useState<ReadonlySet<string>>(new Set());
  const [expandedIdle, setExpandedIdle] = useState<ReadonlySet<string>>(new Set());

  const worktreeKey = useMemo(
    () =>
      JSON.stringify(
        [...state.workspaces.values()]
          .filter((workspace) => workspace.kind === "worktree")
          .map((workspace) => ({ id: workspace.id, directory: workspace.directory, branch: workspace.branch })),
      ),
    [state.workspaces],
  );
  useEffect(() => {
    if (state.status !== "ready") return;
    const workspaces = JSON.parse(worktreeKey) as { id: string; directory: string; branch: string | null }[];
    if (workspaces.length === 0) return;
    let cancelled = false;
    checkMerges({ workspaces }).then(
      (res) => {
        if (!cancelled) workspaceStore.applyMerges(res.merges);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status, worktreeKey]);

  useEffect(() => {
    let cancelled = false;
    fetchAutoState({}).then(
      (res) => {
        if (!cancelled) setAutoState(res);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const runAuto = async (dryRun: boolean) => {
    try {
      setAutoState(await runAutoArchive({ dryRun }));
      if (dryRun) setShowAutoLog(true);
    } catch (error) {
      toast.error(`Auto-archive failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const undoAuto = async (input: { itemId?: string; at?: string } = {}) => {
    setUndoBusy(true);
    try {
      const res = await undoAutoArchive(input);
      setAutoState(res.state);
      if (res.failed.length > 0) {
        toast.error(res.restored > 0 ? `Restored ${res.restored} · ${res.failed.join(" · ")}` : res.failed.join(" · "));
      } else if (res.restored > 0) {
        toast.show(`Restored ${res.restored} item${res.restored === 1 ? "" : "s"}`);
      } else {
        toast.show("Nothing to undo");
      }
    } catch (error) {
      toast.error(`Undo failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setUndoBusy(false);
    }
  };

  const rows = useMemo(() => {
    const agents = agentsByWorkspace(state.workspaces.values(), [...board.agents.values()]);
    const list = [...state.workspaces.values()].map((workspace): WorkspaceRow => {
      const attached = agents.get(workspace.id) ?? [];
      return {
        workspace,
        agents: attached,
        running: attached.filter((agent) => agent.status === "running").length,
        verdict: cleanupVerdict(workspace, attached, cfg.staleWorkspaceMs, now),
      };
    });
    return sortRows(list, sort);
  }, [state.workspaces, board.agents, cfg.staleWorkspaceMs, now, sort]);

  const counts = useMemo(() => {
    const result = { candidate: 0, keep: 0, blocked: 0 };
    for (const row of rows) result[row.verdict.kind] += 1;
    return result;
  }, [rows]);
  const visible = rows.filter((row) => (filter === "all" || row.verdict.kind === filter) && matches(row, query));
  const candidates = visible.filter((row) => row.verdict.kind === "candidate");

  const sections = useMemo(() => {
    if (!byProject) return [{ key: "all", title: null as string | null, rows: visible }];
    const map = new Map<string, WorkspaceRow[]>();
    for (const row of visible) {
      const bucket = map.get(row.workspace.projectId);
      if (bucket) bucket.push(row);
      else map.set(row.workspace.projectId, [row]);
    }
    return [...map.entries()]
      .map(([key, list]) => ({
        key,
        title: list[0]!.workspace.project as string | null,
        // Lead/main workspaces first, then the chosen sort order.
        rows: [...list.filter((r) => isLeadWorkspace(r, cfg)), ...list.filter((r) => !isLeadWorkspace(r, cfg))],
      }))
      .sort((a, b) => (a.title ?? "").localeCompare(b.title ?? ""));
  }, [byProject, visible, cfg]);
  const foldIdle = byProject && filter === "all" && !query.trim();
  const toggleIn = (setter: typeof setExpandedRows) => (id: string) =>
    setter((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const toggleRow = toggleIn(setExpandedRows);
  const toggleIdle = toggleIn(setExpandedIdle);

  const archiveOne = async (row: WorkspaceRow): Promise<boolean> => {
    try {
      const result = await paseo.workspaces.archive(row.workspace.id);
      if (result.error) {
        toast.error(`${row.workspace.name}: ${result.error}`);
        return false;
      }
      return true;
    } catch (error) {
      toast.error(`${row.workspace.name}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  };
  const archive = async (row: WorkspaceRow) => {
    if (await archiveOne(row)) toast.show(`Archived ${row.workspace.name}`);
  };
  const archiveMany = async (list: readonly WorkspaceRow[]) => {
    let done = 0;
    for (const row of list) if (await archiveOne(row)) done += 1;
    toast.show(`Archived ${done} of ${list.length} workspaces`);
  };
  const archiveCandidates = () => archiveMany(candidates);
  const open = (row: WorkspaceRow) => {
    if (navigation) navigation.openWorkspace({ workspaceId: row.workspace.id });
    else
      copyText(row.workspace.directory).then(
        () => toast.show("Path copied"),
        () => toast.error(`Could not copy: ${row.workspace.directory}`),
      );
  };

  const targets = useMemo(() => {
    const liveLeads = [...board.agents.values()].filter(
      (a) => !a.archivedAt && a.status !== "closed" && agentKind(a, cfg) === "lead",
    );
    const leadTargets: BrainstormTarget[] = liveLeads.map((lead) => {
      const area = leadArea(lead, cfg);
      return {
        key: `lead:${lead.id}`,
        label: `★ ${area} (${basename(lead.cwd)})`,
        area,
        cwd: lead.cwd,
        leadId: lead.id,
        leadTitle: displayTitle(lead),
        activityAt: lead.updatedAt,
      };
    });

    const leadCwds = new Set(leadTargets.map((t) => normalizePath(t.cwd)));
    const leadProjects = new Set(leadTargets.map((t) => t.area.toLowerCase()));

    const byProj = new Map<string, WorkspaceRow[]>();
    for (const row of rows) {
      const proj = row.workspace.project;
      const list = byProj.get(proj);
      if (list) list.push(row);
      else byProj.set(proj, [row]);
    }

    const wsTargets: BrainstormTarget[] = [];
    for (const [project, projRows] of byProj.entries()) {
      const sortedRows = [...projRows].sort((a, b) => {
        const aTime = a.workspace.activityAt ?? a.workspace.createdAt ?? "";
        const bTime = b.workspace.activityAt ?? b.workspace.createdAt ?? "";
        return bTime.localeCompare(aTime);
      });
      const topRow = sortedRows[0];
      if (!topRow) continue;
      const normCwd = normalizePath(topRow.workspace.directory);
      if (leadCwds.has(normCwd) || leadProjects.has(project.toLowerCase())) {
        continue;
      }
      wsTargets.push({
        key: `ws:${topRow.workspace.id}`,
        label: `${topRow.workspace.project} (${topRow.workspace.name})`,
        area: topRow.workspace.project,
        cwd: topRow.workspace.directory,
        workspaceId: topRow.workspace.id,
        projectDisplayName: topRow.workspace.project,
        activityAt: topRow.workspace.activityAt ?? topRow.workspace.createdAt ?? "",
      });
    }

    return [...leadTargets, ...wsTargets].sort((a, b) => b.activityAt.localeCompare(a.activityAt));
  }, [board.agents, rows, cfg]);

  const selectedTarget = useMemo(
    () => targets.find((t) => t.key === selectedTargetKey) ?? targets[0],
    [targets, selectedTargetKey],
  );

  const liveBrainstorms = useMemo(
    () =>
      [...board.agents.values()].filter(
        (a) => !a.archivedAt && a.status !== "closed" && agentKind(a, cfg) === "brainstorm",
      ),
    [board.agents, cfg],
  );

  const spawnBrainstorm = async (target?: BrainstormTarget, profileId?: string) => {
    if (!target) return;
    setCreatingBrainstorm(true);
    try {
      const res = await createRpc({
        leadId: target.leadId,
        leadTitle: target.leadTitle,
        area: target.area,
        cwd: target.cwd,
        workspaceId: target.workspaceId,
        workspaceName: target.workspaceId ? target.label : undefined,
        projectDisplayName: target.projectDisplayName,
        profile: profileId || cfg.brainstormProfile || undefined,
        modeId: cfg.brainstormModeId || "auto",
        reuseExisting: true,
      });
      if (res.ok) {
        toast.show(res.message);
        if (res.agentId && navigation) {
          navigation.openAgent({ agentId: res.agentId });
        }
      } else {
        toast.error(res.message);
      }
    } catch (error) {
      toast.error(`Create failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setCreatingBrainstorm(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={{ gap: 4 }}>
        <Text style={styles.title}>Workspaces</Text>
        <Text style={styles.muted}>
          {state.status === "ready"
            ? `${rows.length} workspaces · ${counts.candidate} safe to clean · ${counts.keep} to check · ${counts.blocked} in use`
            : state.status === "error"
              ? `Could not load workspaces: ${state.error ?? "unknown error"}`
              : "Loading workspaces…"}
          {state.truncated ? " · showing the 200 most recent" : ""}
        </Text>
        <Text style={styles.muted}>
          Archiving closes the workspace and archives its agents. For a worktree Paseo created, it also deletes the
          folder; uncommitted work blocks it here.
        </Text>
        {state.status === "error" ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => workspaceStore.retry()}
            style={[styles.smallButton, { alignSelf: "flex-start" }]}
          >
            <Text style={styles.text}>Retry</Text>
          </Pressable>
        ) : null}
      </View>

      {cfg.brainstormPreset ? (
        <View style={styles.group}>
          <View style={[styles.row, { flexWrap: "wrap", justifyContent: "space-between" }]}>
            <Text style={[styles.text, { fontWeight: "600" }]}>Brainstorm</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => setShowProjectPicker((v) => !v)}
              style={styles.smallButton}
            >
              <Text style={styles.text}>{selectedTarget ? selectedTarget.label : "Select project"} ▾</Text>
            </Pressable>
            <View style={{ flex: 1 }} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
              <Pressable
                accessibilityRole="button"
                disabled={creatingBrainstorm || !selectedTarget}
                onPress={() => void spawnBrainstorm(selectedTarget)}
                style={[
                  styles.smallButton,
                  { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
                  (creatingBrainstorm || !selectedTarget) && { opacity: 0.6 },
                ]}
              >
                <Text style={{ color: theme.colors.accentForeground, fontWeight: "600", fontSize: 14 }}>
                  {creatingBrainstorm ? "Creating…" : "Create brainstorm"}
                </Text>
              </Pressable>
              {profiles.length > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setShowProfileMenu((v) => !v)}
                  style={[styles.smallButton, { borderColor: theme.colors.accent }]}
                >
                  <Text style={{ color: theme.colors.accent, fontWeight: "600", fontSize: 14 }}>▾</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
          {showProjectPicker && targets.length > 0 ? (
            <View>
              <View style={styles.divider} />
              <View style={[styles.row, { flexWrap: "wrap", gap: 6 }]}>
                {targets.map((target) => {
                  const isSelected = target.key === selectedTarget?.key;
                  return (
                    <Pressable
                      key={target.key}
                      accessibilityRole="button"
                      onPress={() => {
                        setSelectedTargetKey(target.key);
                        setShowProjectPicker(false);
                      }}
                      style={[
                        styles.smallButton,
                        isSelected && { backgroundColor: theme.colors.surface2, borderColor: theme.colors.accent },
                      ]}
                    >
                      <Text
                        style={[
                          styles.text,
                          isSelected && { color: theme.colors.accent, fontWeight: "600" },
                        ]}
                      >
                        {target.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}
          {showProfileMenu && profiles.length > 0 ? (
            <View>
              <View style={styles.divider} />
              <View style={[styles.row, { flexWrap: "wrap", gap: 6 }]}>
                {profiles.map((p) => (
                  <Pressable
                    key={p.id}
                    accessibilityRole="button"
                    onPress={() => {
                      setShowProfileMenu(false);
                      void spawnBrainstorm(selectedTarget, p.id);
                    }}
                    style={styles.smallButton}
                  >
                    <Text style={styles.text}>{p.name}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
          {liveBrainstorms.length > 0 ? (
            <View>
              <View style={styles.divider} />
              <View style={[styles.row, { flexWrap: "wrap", gap: 6 }]}>
                <Text style={styles.muted}>Active:</Text>
                {liveBrainstorms.map((b) => (
                  <Pressable
                    key={b.id}
                    accessibilityRole="button"
                    onPress={() => {
                      if (navigation) navigation.openAgent({ agentId: b.id });
                      else
                        copyText(b.id).then(
                          () => toast.show("Brainstorm id copied"),
                          () => toast.error(`Could not copy: ${b.id}`),
                        );
                    }}
                    style={[styles.smallButton, { flexDirection: "row", alignItems: "center", gap: 6 }]}
                  >
                    <StatusDot color={statusColor(theme, b.status)} />
                    <Text style={[styles.text, { flexShrink: 1 }]} numberOfLines={1}>
                      Open {sidebarTitle(b, cfg)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={styles.group}>
        <View style={[styles.row, { flexWrap: "wrap", justifyContent: "space-between" }]}>
          <Text style={[styles.text, { flex: 1, minWidth: 160 }]}>
            {autoState?.lastRunAt
              ? `${autoState.lastRunDry ? "Dry run: would auto-archive" : "Auto-archived"} ${autoState.lastCount} · View / Undo · ${relativeTime(autoState.lastRunAt, now)}`
              : "Auto-archive ready"}
          </Text>
          <Pressable accessibilityRole="button" onPress={() => setShowAutoLog((v) => !v)} style={styles.smallButton}>
            <Text style={styles.text}>{showAutoLog ? "Hide log" : `View (${autoState?.items.length ?? 0})`}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={undoBusy || !autoState?.items.some((i) => !i.dryRun && !i.undoneAt)}
            onPress={() => void undoAuto({})}
            style={[
              styles.smallButton,
              (undoBusy || !autoState?.items.some((i) => !i.dryRun && !i.undoneAt)) && { opacity: 0.5 },
            ]}
          >
            <Text style={styles.text}>{undoBusy ? "Undoing…" : "Undo"}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => void runAuto(true)} style={styles.smallButton}>
            <Text style={styles.text}>Dry run</Text>
          </Pressable>
          <ConfirmButton
            theme={theme}
            label="Run now"
            armedLabel="Archive idle items?"
            busyLabel="Archiving…"
            accessibilityLabel="Run auto-archive now"
            onConfirm={() => runAuto(false)}
          />
        </View>
        {showAutoLog && autoState ? (
          <View>
            {autoState.items.length === 0 ? (
              <View style={styles.row}>
                <Text style={styles.muted}>Nothing logged yet.</Text>
              </View>
            ) : null}
            {autoState.items.slice(0, 15).map((item) => (
              <View key={`${item.id}-${item.at}`}>
                <View style={styles.divider} />
                <View style={[styles.row, { paddingVertical: 6 }]}>
                  <Chip
                    theme={theme}
                    label={item.undoneAt ? "[undone]" : item.dryRun ? "[dry run]" : "[archived]"}
                    tone={item.undoneAt ? "muted" : item.dryRun ? "muted" : "accent"}
                  />
                  <Chip theme={theme} label={item.kind} />
                  <Text style={[styles.text, { flexShrink: 1 }]} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={[styles.muted, { flex: 1, minWidth: 0 }]} numberOfLines={1}>
                    {item.reason} · {relativeTime(item.at, now)}
                  </Text>
                  {item.undoError ? (
                    <Text style={[styles.text, { color: theme.colors.statusDanger }]} numberOfLines={1}>
                      {item.undoError}
                    </Text>
                  ) : null}
                  {!item.dryRun && !item.undoneAt ? (
                    <Pressable
                      accessibilityRole="button"
                      disabled={undoBusy}
                      onPress={() => void undoAuto({ itemId: item.id, at: item.at })}
                      style={[styles.smallButton, undoBusy && { opacity: 0.5 }]}
                    >
                      <Text style={styles.text}>Undo</Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      if (item.kind === "agent" && navigation) navigation.openAgent({ agentId: item.id });
                      else
                        copyText(item.id).then(
                          () => toast.show("Id copied"),
                          () => toast.error(`Could not copy: ${item.id}`),
                        );
                    }}
                    style={styles.smallButton}
                  >
                    <Text style={styles.text}>{item.kind === "agent" && navigation ? "Open chat" : "Copy id"}</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search name, project, branch, folder"
        placeholderTextColor={theme.colors.foregroundMuted}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
        accessibilityLabel="Search workspaces"
      />
      <View style={{ gap: 6 }}>
        <Text style={styles.section}>SORT</Text>
        <View style={styles.toggles}>
          {SORTS.map((option) => (
            <Toggle
              key={option.value}
              theme={theme}
              label={option.label}
              value={sort === option.value}
              onChange={() => setSort(option.value)}
            />
          ))}
          <Toggle theme={theme} label="Group by project" value={byProject} onChange={setByProject} />
        </View>
        <Text style={styles.section}>SHOW</Text>
        <View style={styles.toggles}>
          {FILTERS.map((option) => (
            <Toggle
              key={option.value}
              theme={theme}
              label={option.value === "all" ? option.label : `${option.label} (${counts[option.value]})`}
              value={filter === option.value}
              onChange={() => setFilter(option.value)}
            />
          ))}
        </View>
      </View>

      {candidates.length > 0 ? (
        <View style={[styles.group, styles.row, { justifyContent: "space-between" }]}>
          <Text style={[styles.text, { flex: 1 }]}>
            {candidates.length} shown workspace{candidates.length === 1 ? " is" : "s are"} safe to clean
          </Text>
          <ConfirmButton
            theme={theme}
            label={`Archive ${candidates.length}`}
            armedLabel={`Archive all ${candidates.length}?`}
            busyLabel="Archiving…"
            accessibilityLabel={`Archive ${candidates.length} safe workspaces`}
            onConfirm={archiveCandidates}
          />
        </View>
      ) : null}

      {visible.length === 0 && state.status === "ready" ? <Text style={styles.muted}>No workspaces match.</Text> : null}
      {sections.map((section) => {
        if (section.rows.length === 0) return null;
        const activeRows: WorkspaceRow[] = [];
        const idleRows: WorkspaceRow[] = [];
        for (const row of section.rows) {
          const idle =
            foldIdle &&
            row.agents.length === 0 &&
            !isLeadWorkspace(row, cfg) &&
            row.verdict.kind !== "candidate" &&
            !hasActionableWarning(row);
          (idle ? idleRows : activeRows).push(row);
        }
        const idleOpen = expandedIdle.has(section.key);
        const safeRows = section.rows.filter((r) => r.verdict.kind === "candidate");
        const renderRow = (row: WorkspaceRow, divider: boolean) => (
          <View key={row.workspace.id}>
            {divider ? <View style={styles.divider} /> : null}
            <WorkspaceRowView
              row={row}
              now={now}
              theme={theme}
              styles={styles}
              cfg={cfg}
              expanded={expandedRows.has(row.workspace.id)}
              onToggle={toggleRow}
              onOpen={open}
              onArchive={archive}
            />
          </View>
        );
        return (
          <View key={section.key} style={styles.group}>
            {section.title ? (
              <View style={[styles.groupHeader, { alignItems: "center" }]}>
                <Text style={styles.section}>
                  {section.title.toUpperCase()} ({section.rows.length})
                </Text>
                {safeRows.length > 0 ? (
                  <ConfirmButton
                    theme={theme}
                    label={`Archive all safe (${safeRows.length})`}
                    armedLabel={`Archive ${safeRows.length}?`}
                    busyLabel="Archiving…"
                    tone="accent"
                    accessibilityLabel={`Archive ${safeRows.length} safe workspaces in ${section.title ?? "group"}`}
                    onConfirm={() => archiveMany(safeRows)}
                  />
                ) : null}
              </View>
            ) : null}
            {activeRows.map((row, index) => renderRow(row, index > 0))}
            {idleRows.length > 0 ? (
              <View>
                {activeRows.length > 0 ? <View style={styles.divider} /> : null}
                <Pressable
                  accessibilityRole="button"
                  onPress={() => toggleIdle(section.key)}
                  style={({ pressed }) => [styles.row, { paddingVertical: 6 }, pressed ? styles.rowPressed : null]}
                >
                  <Text style={styles.muted}>
                    {idleOpen ? "▾" : "▸"} Idle ({idleRows.length})
                  </Text>
                </Pressable>
                {idleOpen ? idleRows.map((row) => renderRow(row, true)) : null}
              </View>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}
