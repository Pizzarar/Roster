import { usePaseo, type PluginScreenProps } from "@getpaseo/plugin/client";
import { copyText, ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { makeStyles, Toggle, type Styles } from "./board";
import { useBoardConfig } from "./config";
import { relativeTime } from "./model";
import { useBoard, useNow } from "./store";
import { Chip, ConfirmButton, StatusDot } from "./ui";
import {
  agentsByWorkspace,
  cleanupVerdict,
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

function verdictColor(theme: Theme, verdict: CleanupVerdict): string {
  if (verdict.kind === "candidate") return theme.colors.statusSuccess;
  if (verdict.kind === "keep") return theme.colors.statusWarning;
  return theme.colors.foregroundMuted;
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
  onOpen,
  onArchive,
}: {
  row: WorkspaceRow;
  now: number;
  theme: Theme;
  styles: Styles;
  onOpen(row: WorkspaceRow): void;
  onArchive(row: WorkspaceRow): Promise<void>;
}) {
  const { workspace, verdict } = row;
  const details = [
    workspace.project,
    `active ${relativeTime(workspace.activityAt ?? workspace.createdAt, now)}`,
    `${row.agents.length} agent${row.agents.length === 1 ? "" : "s"}${row.running ? `, ${row.running} running` : ""}`,
  ];
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open workspace ${workspace.name}`}
        onPress={() => onOpen(row)}
        style={({ pressed }) => [
          { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 },
          pressed ? styles.rowPressed : null,
        ]}
      >
        <StatusDot color={verdictColor(theme, verdict)} />
        <View style={styles.rowBody}>
          <View style={styles.rowTitleLine}>
            <Text style={styles.text} numberOfLines={1}>
              {workspace.name}
            </Text>
            {workspace.kind !== "worktree" ? <Chip theme={theme} label={workspace.kind.replace("_", " ")} /> : null}
            {workspace.branch && workspace.branch !== workspace.name ? <Chip theme={theme} label={workspace.branch} /> : null}
            {workspace.pinned ? <Chip theme={theme} label="pinned" tone="accent" /> : null}
            {workspace.dirty ? <Chip theme={theme} label="uncommitted" tone="danger" /> : null}
            {workspace.ahead ? <Chip theme={theme} label={`${workspace.ahead} ahead`} tone="warning" /> : null}
            {workspace.pr ? (
              <Chip
                theme={theme}
                label={`PR${workspace.pr.number ? ` #${workspace.pr.number}` : ""} ${workspace.pr.merged ? "merged" : workspace.pr.state.toLowerCase()}`}
                tone={workspace.pr.merged ? "accent" : "muted"}
              />
            ) : null}
          </View>
          <Text style={styles.muted} numberOfLines={1}>
            {details.join(" · ")}
          </Text>
          {verdict.reasons.length ? (
            <Text style={[styles.muted, { color: verdictColor(theme, verdict) }]} numberOfLines={2}>
              {verdict.reasons.join(" · ")}
            </Text>
          ) : null}
        </View>
      </Pressable>
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
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<WorkspaceSort>("cleanup");
  const [filter, setFilter] = useState<Filter>("all");
  const [byProject, setByProject] = useState(false);

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
      .map(([key, list]) => ({ key, title: list[0]!.workspace.project as string | null, rows: list }))
      .sort((a, b) => (a.title ?? "").localeCompare(b.title ?? ""));
  }, [byProject, visible]);

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
  const archiveCandidates = async () => {
    let done = 0;
    for (const row of candidates) if (await archiveOne(row)) done += 1;
    toast.show(`Archived ${done} of ${candidates.length} workspaces`);
  };
  const open = (row: WorkspaceRow) => {
    if (navigation) navigation.openWorkspace({ workspaceId: row.workspace.id });
    else
      copyText(row.workspace.directory).then(
        () => toast.show("Path copied"),
        () => toast.error(`Could not copy: ${row.workspace.directory}`),
      );
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
          {state.truncated ? " · showing the 500 most recent" : ""}
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
      {sections.map((section) => (
        <View key={section.key} style={{ gap: 6 }}>
          {section.title ? (
            <Text style={styles.section}>
              {section.title.toUpperCase()} ({section.rows.length})
            </Text>
          ) : null}
          {section.rows.length > 0 ? (
            <View style={styles.group}>
              {section.rows.map((row, index) => (
                <View key={row.workspace.id}>
                  {index > 0 ? <View style={styles.divider} /> : null}
                  <WorkspaceRowView
                    row={row}
                    now={now}
                    theme={theme}
                    styles={styles}
                    onOpen={open}
                    onArchive={archive}
                  />
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ))}
    </ScrollView>
  );
}
