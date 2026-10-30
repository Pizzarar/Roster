import { useSettings, type PluginSurfaceProps, type SettingsState } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { useCallback, useMemo, useState } from "react";
import { Text } from "react-native";
import { daysError, limitError, patternError, trackerError, trackerName } from "../shared/config";
import { rosterSettings, type RosterSettings, type Tracker, type TrackerKind } from "../shared/settings";

type Ready = Extract<SettingsState<typeof rosterSettings.schema>, { status: "ready" }>;
type TextKey = {
  [Key in keyof RosterSettings]: RosterSettings[Key] extends string ? Key : never;
}[keyof RosterSettings];
type SwitchKey = {
  [Key in keyof RosterSettings]: RosterSettings[Key] extends boolean ? Key : never;
}[keyof RosterSettings];

const PATTERNS: readonly { key: TextKey; label: string; hint: string }[] = [
  { key: "leadTitlePattern", label: "Lead title pattern", hint: "Agents pinned in the sidebar when they have no role label." },
  { key: "hideTitlePattern", label: "Retired title pattern", hint: "Hidden unless Old leads is on." },
  { key: "brainstormTitlePattern", label: "Brainstorm title pattern", hint: "Pinned below the leads as Brainstorm." },
  { key: "sidebarStripPattern", label: "Sidebar label strip", hint: "Removed from lead titles in the sidebar." },
];

const LABELS: readonly { key: TextKey; label: string; hint: string }[] = [
  { key: "roleLabel", label: "Role label key", hint: "Label whose value says lead, worker, and so on." },
  { key: "leadRoles", label: "Lead roles", hint: "Comma-separated role values for active leads." },
  { key: "oldLeadRoles", label: "Retired lead roles", hint: "Comma-separated role values hidden by default." },
  { key: "brainstormRoles", label: "Brainstorm roles", hint: "Comma-separated role values for the brainstorm row." },
  { key: "leadLabel", label: "Group label key", hint: "Agents sharing this label's value are grouped together." },
  { key: "taskLabel", label: "Task label key", hint: "Shown as a chip on each row." },
  { key: "staleWorkspaceDays", label: "Stale workspace days", hint: "Workspaces idle this long can be cleaned up." },
];

const KIND_OPTIONS: readonly { label: string; value: TrackerKind }[] = [
  { label: "Leads", value: "leads" },
  { label: "Brainstorm chats", value: "brainstorm" },
  { label: "Folder contains", value: "folder" },
  { label: "Title matches", value: "title" },
  { label: "Label equals", value: "label" },
];

const PATTERN_HINT: Partial<Record<TrackerKind, { label: string; hint: string; placeholder: string }>> = {
  folder: { label: "Folder", hint: "Part of the agent's folder path, any case.", placeholder: "Brain Squad" },
  title: { label: "Title pattern", hint: "Regular expression, case-insensitive.", placeholder: "^BRAINSTORM\b" },
  label: { label: "Label", hint: "key=value", placeholder: "role=brainstorm" },
};

const KIND_HINT: Partial<Record<TrackerKind, string>> = {
  leads: "Agents with a lead role label or a lead title.",
  brainstorm: "Agents with a brainstorm role label or a brainstorm title.",
};

const newId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const trackersError = (trackers: readonly Tracker[]) =>
  trackers.some((tracker) => trackerError(tracker) !== null || limitError(tracker.limit) !== null);

const SWITCHES: readonly { key: SwitchKey; label: string; hint: string }[] = [
  { key: "groupUnassignedByFolder", label: "Group unlabelled agents by folder", hint: "Otherwise they share one Unassigned group." },
  { key: "showStopButton", label: "Show Stop on running agents", hint: "Two taps; runs paseo stop on the daemon." },
  { key: "countSubagents", label: "Count sub-agents", hint: "Reads the recent timeline of running agents every 30 seconds." },
  { key: "detachNewLeads", label: "Detach new leads", hint: "A lead created by another agent is detached at once, so its spawner stops being woken for it." },
  { key: "adoptWorkers", label: "Hand workers to the new lead", hint: "On a handoff, the old lead's live workers are detached and assigned to the new lead." },
  { key: "relayWorkerEvents", label: "Relay handed-over workers", hint: "Their finished, failed and permission events are sent to the lead that owns them now." },
  { key: "labelInstruction", label: "Ask new agents to label themselves", hint: "Adds a line to every new agent's system prompt asking it to set role, group and task labels." },
];

function Form({ settings, theme }: { settings: Ready; theme: PluginSurfaceProps["theme"] }) {
  const [draft, setDraft] = useState(() => ({ values: settings.values, revision: settings.revision }));
  const [formKey, setFormKey] = useState(0);
  const errorStyle = useMemo(() => ({ color: theme.colors.statusDanger }), [theme]);
  const change = useCallback(
    (key: TextKey) => (text: string) =>
      setDraft((current) => ({ ...current, values: { ...current.values, [key]: text } })),
    [],
  );
  const trackersDirty = JSON.stringify(draft.values.trackers) !== JSON.stringify(settings.values.trackers);
  const dirty =
    trackersDirty || PATTERNS.concat(LABELS).some(({ key }) => draft.values[key] !== settings.values[key]);
  const invalid =
    PATTERNS.some(({ key }) => patternError(draft.values[key]) !== null) ||
    daysError(draft.values.staleWorkspaceDays) !== null ||
    trackersError(draft.values.trackers);
  const setTrackers = useCallback(
    (update: (trackers: Tracker[]) => Tracker[]) =>
      setDraft((current) => ({ ...current, values: { ...current.values, trackers: update(current.values.trackers) } })),
    [],
  );
  const editTracker = useCallback(
    (id: string, patch: Partial<Tracker>) =>
      setTrackers((trackers) => trackers.map((tracker) => (tracker.id === id ? { ...tracker, ...patch } : tracker))),
    [setTrackers],
  );
  const moveTracker = useCallback(
    (index: number) =>
      setTrackers((trackers) => {
        const next = [...trackers];
        [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
        return next;
      }),
    [setTrackers],
  );

  // Text fields go on top of the latest saved values, so a switch flipped mid-edit is kept.
  const save = useCallback(async () => {
    const values = { ...settings.values };
    for (const { key } of PATTERNS.concat(LABELS)) values[key] = draft.values[key];
    values.trackers = draft.values.trackers;
    if (await settings.save(values, settings.revision)) setDraft({ values, revision: settings.revision });
  }, [settings, draft]);
  const discard = useCallback(() => {
    setDraft({ values: settings.values, revision: settings.revision });
    setFormKey((key) => key + 1);
  }, [settings]);
  const reset = useCallback(async () => {
    if (await settings.reset()) setFormKey((key) => key + 1);
  }, [settings]);
  const toggle = useCallback(
    (key: SwitchKey) => (value: boolean) => {
      void settings.save({ ...settings.values, [key]: value }, settings.revision);
    },
    [settings],
  );

  // A save or reset elsewhere moves the revision; adopt it unless the user is editing.
  if (!dirty && draft.revision !== settings.revision) {
    setDraft({ values: settings.values, revision: settings.revision });
    setFormKey((key) => key + 1);
  }

  return (
    <>
      <SettingsSection title="Sidebar sections">
        {draft.values.trackers.map((tracker, index) => {
          const pattern = PATTERN_HINT[tracker.kind];
          return (
            <SettingsCard key={`${tracker.id}-${formKey}`}>
              <SettingsInput
                label="Name"
                hint={`Shown above the section. Empty uses "${trackerName({ ...tracker, name: "" })}".`}
                initialValue={tracker.name}
                onChangeText={(name) => editTracker(tracker.id, { name })}
                disabled={settings.saving}
              />
              <SettingsSelect
                label="Shows"
                hint={KIND_HINT[tracker.kind]}
                value={tracker.kind}
                options={KIND_OPTIONS}
                disabled={settings.saving}
                onValueChange={(kind) => editTracker(tracker.id, { kind })}
              />
              {pattern ? (
                <SettingsInput
                  key={tracker.kind}
                  label={pattern.label}
                  hint={pattern.hint}
                  placeholder={pattern.placeholder}
                  initialValue={tracker.pattern}
                  onChangeText={(text) => editTracker(tracker.id, { pattern: text })}
                  disabled={settings.saving}
                  error={trackerError(tracker)}
                />
              ) : null}
              <SettingsInput
                label="Most rows"
                hint="The rest are counted and listed on the Roster screen."
                initialValue={tracker.limit}
                onChangeText={(limit) => editTracker(tracker.id, { limit })}
                disabled={settings.saving}
                error={limitError(tracker.limit)}
              />
              {index > 0 ? (
                <SettingsAction label="Order" actionLabel="Move up" onPress={() => moveTracker(index)} />
              ) : null}
              <SettingsAction
                label="Remove this section"
                actionLabel="Remove"
                onPress={() => setTrackers((trackers) => trackers.filter(({ id }) => id !== tracker.id))}
              />
            </SettingsCard>
          );
        })}
        <SettingsCard>
          <SettingsAction
            label={
              draft.values.trackers.length === 0
                ? "No sections: the sidebar shows only Roster and Workspaces"
                : "Track something else, such as a folder of brainstorm chats"
            }
            actionLabel="+ Add section"
            disabled={settings.saving}
            onPress={() =>
              setTrackers((trackers) => [
                ...trackers,
                { id: newId(), name: "", kind: "folder", pattern: "", limit: "6" },
              ])
            }
          />
          {trackersDirty ? (
            <SettingsAction
              label={invalid ? "Fix the invalid value first" : "Sections changed"}
              actionLabel="Save"
              disabled={invalid || settings.saving}
              onPress={() => void save()}
            />
          ) : null}
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Behaviour">
        <SettingsCard>
          {SWITCHES.map(({ key, label, hint }) => (
            <SettingsSwitch
              key={key}
              label={label}
              hint={hint}
              value={settings.values[key]}
              disabled={settings.saving}
              onValueChange={toggle(key)}
            />
          ))}
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Title patterns (regular expressions, case-insensitive)">
        <SettingsCard key={`p${formKey}`}>
          {PATTERNS.map(({ key, label, hint }) => (
            <SettingsInput
              key={key}
              label={label}
              hint={hint}
              initialValue={draft.values[key]}
              onChangeText={change(key)}
              disabled={settings.saving}
              error={patternError(draft.values[key])}
            />
          ))}
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Labels (preferred over titles)">
        <SettingsCard key={`l${formKey}`}>
          {LABELS.map(({ key, label, hint }) => (
            <SettingsInput
              key={key}
              label={label}
              hint={hint}
              initialValue={draft.values[key]}
              onChangeText={change(key)}
              disabled={settings.saving}
              error={key === "staleWorkspaceDays" ? daysError(draft.values[key]) : null}
            />
          ))}
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Save">
        <SettingsCard>
          <SettingsAction
            label={invalid ? "Fix the invalid value first" : dirty ? "Unsaved changes" : "No changes"}
            actionLabel="Save"
            disabled={!dirty || invalid || settings.saving}
            onPress={() => void save()}
          />
          <SettingsAction label="Discard changes" actionLabel="Discard" disabled={!dirty} onPress={discard} />
          <SettingsAction
            label="Restore the default settings"
            actionLabel="Reset"
            disabled={settings.saving}
            onPress={() => void reset()}
          />
        </SettingsCard>
        {settings.saveError ? (
          <Text accessibilityRole="alert" style={errorStyle}>
            {settings.saveError}
          </Text>
        ) : null}
      </SettingsSection>
    </>
  );
}

export function RosterSettingsScreen({ theme }: PluginSurfaceProps) {
  const settings = useSettings(rosterSettings);
  const style = useMemo(() => ({ color: theme.colors.foreground }), [theme]);
  if (settings.status === "loading") return <Text style={style}>Loading settings…</Text>;
  if (settings.status !== "ready") {
    return (
      <SettingsSection title="Roster">
        <Text style={style}>{settings.error}</Text>
        <SettingsAction label="Try again" actionLabel="Reload" onPress={settings.reload} />
        {settings.status === "invalid" ? (
          <SettingsAction label="Restore the default settings" actionLabel="Reset" onPress={settings.reset} />
        ) : null}
      </SettingsSection>
    );
  }
  return <Form settings={settings} theme={theme} />;
}
