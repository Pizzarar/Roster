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
import { useAgentProfiles } from "./board";
import {
  DEFAULT_SETTINGS,
  daysError,
  limitError,
  patternError,
  trackerError,
  trackerName,
} from "../shared/config";
import {
  DEFAULT_BRAINSTORM_PROMPT,
  DEFAULT_LEAD_POINTER,
  DEFAULT_LEAD_PROMPT,
  rosterSettings,
  type RosterSettings,
  type Tracker,
  type TrackerKind,
} from "../shared/settings";

type Ready = Extract<SettingsState<typeof rosterSettings.schema>, { status: "ready" }>;
type TextKey = {
  [Key in keyof RosterSettings]: RosterSettings[Key] extends string ? Key : never;
}[keyof RosterSettings];
type SwitchKey = {
  [Key in keyof RosterSettings]: RosterSettings[Key] extends boolean ? Key : never;
}[keyof RosterSettings];

const TEXT_KEYS: readonly TextKey[] = [
  "brainstormPrompt",
  "brainstormTitlePattern",
  "brainstormRoles",
  "leadPrompt",
  "leadPointerPrompt",
  "leadTitlePattern",
  "hideTitlePattern",
  "sidebarStripPattern",
  "leadRoles",
  "oldLeadRoles",
  "roleLabel",
  "leadLabel",
  "taskLabel",
  "staleWorkspaceDays",
];

const PATTERN_KEYS: readonly TextKey[] = [
  "leadTitlePattern",
  "hideTitlePattern",
  "brainstormTitlePattern",
  "sidebarStripPattern",
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



function Form({ settings, theme }: { settings: Ready; theme: PluginSurfaceProps["theme"] }) {
  const [draft, setDraft] = useState(() => ({ values: settings.values, revision: settings.revision }));
  const [formKey, setFormKey] = useState(0);
  const profiles = useAgentProfiles();
  const errorStyle = useMemo(() => ({ color: theme.colors.statusDanger }), [theme]);
  const change = useCallback(
    (key: TextKey) => (text: string) =>
      setDraft((current) => ({ ...current, values: { ...current.values, [key]: text } })),
    [],
  );
  const trackersDirty = JSON.stringify(draft.values.trackers) !== JSON.stringify(settings.values.trackers);
  const dirty =
    trackersDirty || TEXT_KEYS.some((key) => draft.values[key] !== settings.values[key]);
  const invalid =
    PATTERN_KEYS.some((key) => patternError(draft.values[key]) !== null) ||
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

  const buildValues = useCallback(
    (patch?: Partial<RosterSettings>): RosterSettings => {
      const values: RosterSettings = { ...settings.values };
      for (const key of TEXT_KEYS) values[key] = draft.values[key];
      values.trackers = draft.values.trackers;
      return patch ? { ...values, ...patch } : values;
    },
    [settings.values, draft.values],
  );

  // Text fields go on top of the latest saved values, so a switch flipped mid-edit is kept.
  const save = useCallback(async () => {
    const values = buildValues();
    if (await settings.save(values, settings.revision)) setDraft({ values, revision: settings.revision });
  }, [settings, buildValues]);
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
      <SettingsSection title="Workflow presets">
        {settings.values.brainstormPreset ? (
          <SettingsCard key={`brainstorm-${formKey}`}>
            <SettingsSelect
              label="Default brainstorm profile"
              hint="Profile used when spawning a brainstorm chat from the board."
              value={settings.values.brainstormProfile}
              options={[
                { label: "Auto (Brainstorm profile)", value: "" },
                ...profiles.map((p) => ({
                  label: `${p.name} (${p.model ? `${p.provider}/${p.model}` : p.provider})`,
                  value: p.id,
                })),
              ]}
              disabled={settings.saving}
              onValueChange={(value) => {
                const values = buildValues({ brainstormProfile: value });
                void settings.save(values, settings.revision);
                setDraft((current) => ({ ...current, values: { ...current.values, brainstormProfile: value } }));
              }}
            />
            <SettingsSelect
              label="Default brainstorm mode"
              hint="Resolves each provider's real auto mode ID (Claude: auto, Gemini: accept-edits)."
              value={settings.values.brainstormModeId}
              options={[
                { label: "Auto mode (per provider)", value: "auto" },
                { label: "Profile default", value: "profile" },
                { label: "Plan mode", value: "plan" },
                { label: "Always ask / Default", value: "default" },
              ]}
              disabled={settings.saving}
              onValueChange={(value) => {
                const values = buildValues({ brainstormModeId: value });
                void settings.save(values, settings.revision);
                setDraft((current) => ({ ...current, values: { ...current.values, brainstormModeId: value } }));
              }}
            />
            <SettingsSwitch
              label="Ask brainstorm chats to name and label themselves"
              hint="Adds the prompt line below to new agents so brainstorm chats title themselves and set their role label."
              value={settings.values.brainstormPromptEnabled}
              disabled={settings.saving}
              onValueChange={toggle("brainstormPromptEnabled")}
            />
            <SettingsInput
              label="Brainstorm prompt"
              hint="System-prompt line added when the switch above is on."
              initialValue={draft.values.brainstormPrompt}
              onChangeText={change("brainstormPrompt")}
              disabled={settings.saving}
            />
            <SettingsInput
              label="Brainstorm title pattern"
              hint="Pinned as Brainstorm when an agent has no role label."
              initialValue={draft.values.brainstormTitlePattern}
              onChangeText={change("brainstormTitlePattern")}
              disabled={settings.saving}
              error={patternError(draft.values.brainstormTitlePattern)}
            />
            <SettingsInput
              label="Brainstorm roles"
              hint="Comma-separated role label values for brainstorm chats."
              initialValue={draft.values.brainstormRoles}
              onChangeText={change("brainstormRoles")}
              disabled={settings.saving}
            />
            <SettingsAction
              label="Remove Brainstorm preset"
              actionLabel="Remove"
              disabled={settings.saving}
              onPress={async () => {
                const values = buildValues({
                  brainstormPreset: false,
                  trackers: draft.values.trackers.filter((t) => t.kind !== "brainstorm"),
                });
                if (await settings.save(values, settings.revision)) {
                  setDraft({ values, revision: settings.revision });
                  setFormKey((key) => key + 1);
                }
              }}
            />
          </SettingsCard>
        ) : (
          <SettingsCard>
            <SettingsAction
              label="Brainstorm preset removed (brainstorm matching and auto-naming are off)"
              actionLabel="+ Add Brainstorm preset"
              disabled={settings.saving}
              onPress={async () => {
                const values = buildValues({
                  brainstormPreset: true,
                  brainstormTitlePattern:
                    draft.values.brainstormTitlePattern || DEFAULT_SETTINGS.brainstormTitlePattern,
                  brainstormRoles: draft.values.brainstormRoles || DEFAULT_SETTINGS.brainstormRoles,
                  brainstormPrompt: draft.values.brainstormPrompt || DEFAULT_BRAINSTORM_PROMPT,
                  trackers: draft.values.trackers.some((t) => t.kind === "brainstorm")
                    ? draft.values.trackers
                    : [
                        ...draft.values.trackers,
                        { id: "brainstorm", name: "Brainstorm", kind: "brainstorm" as const, pattern: "", limit: "6" },
                      ],
                });
                if (await settings.save(values, settings.revision)) {
                  setDraft({ values, revision: settings.revision });
                  setFormKey((key) => key + 1);
                }
              }}
            />
          </SettingsCard>
        )}
        {settings.values.leadsPreset ? (
          <SettingsCard key={`leads-${formKey}`}>
            <SettingsSwitch
              label="Ask leads and workers to name and label themselves"
              hint="Adds the lead and worker naming/labeling prompt line below to new agents."
              value={settings.values.leadPromptEnabled}
              disabled={settings.saving}
              onValueChange={toggle("leadPromptEnabled")}
            />
            <SettingsInput
              label="Lead & worker prompt"
              hint="System-prompt line added when the switch above is on."
              initialValue={draft.values.leadPrompt}
              onChangeText={change("leadPrompt")}
              disabled={settings.saving}
            />
            <SettingsSwitch
              label="Tell new agents how to find a project's lead"
              hint="Adds the lead-lookup prompt line below to every new agent."
              value={settings.values.leadPointerEnabled}
              disabled={settings.saving}
              onValueChange={toggle("leadPointerEnabled")}
            />
            <SettingsInput
              label="Lead lookup prompt"
              hint="System-prompt line telling agents how to find a project's current lead."
              initialValue={draft.values.leadPointerPrompt}
              onChangeText={change("leadPointerPrompt")}
              disabled={settings.saving}
            />
            <SettingsSwitch
              label="Detach new leads"
              hint="A lead created by another agent is detached at once, so its spawner stops being woken for it."
              value={settings.values.detachNewLeads}
              disabled={settings.saving}
              onValueChange={toggle("detachNewLeads")}
            />
            <SettingsSwitch
              label="Hand workers to the new lead"
              hint="On a handoff, the old lead's live workers are detached and assigned to the new lead."
              value={settings.values.adoptWorkers}
              disabled={settings.saving}
              onValueChange={toggle("adoptWorkers")}
            />
            <SettingsSwitch
              label="Relay handed-over workers"
              hint="Their finished, failed and permission events are sent to the lead that owns them now."
              value={settings.values.relayWorkerEvents}
              disabled={settings.saving}
              onValueChange={toggle("relayWorkerEvents")}
            />
            <SettingsInput
              label="Lead title pattern"
              hint="Agents pinned in the sidebar when they have no role label."
              initialValue={draft.values.leadTitlePattern}
              onChangeText={change("leadTitlePattern")}
              disabled={settings.saving}
              error={patternError(draft.values.leadTitlePattern)}
            />
            <SettingsInput
              label="Retired title pattern"
              hint="Hidden unless Old leads is on."
              initialValue={draft.values.hideTitlePattern}
              onChangeText={change("hideTitlePattern")}
              disabled={settings.saving}
              error={patternError(draft.values.hideTitlePattern)}
            />
            <SettingsInput
              label="Sidebar label strip"
              hint="Removed from lead titles in the sidebar."
              initialValue={draft.values.sidebarStripPattern}
              onChangeText={change("sidebarStripPattern")}
              disabled={settings.saving}
              error={patternError(draft.values.sidebarStripPattern)}
            />
            <SettingsInput
              label="Lead roles"
              hint="Comma-separated role values for active leads."
              initialValue={draft.values.leadRoles}
              onChangeText={change("leadRoles")}
              disabled={settings.saving}
            />
            <SettingsInput
              label="Retired lead roles"
              hint="Comma-separated role values hidden by default."
              initialValue={draft.values.oldLeadRoles}
              onChangeText={change("oldLeadRoles")}
              disabled={settings.saving}
            />
            <SettingsAction
              label="Remove Leads & handoffs preset"
              actionLabel="Remove"
              disabled={settings.saving}
              onPress={async () => {
                const values = buildValues({
                  leadsPreset: false,
                  trackers: draft.values.trackers.filter((t) => t.kind !== "leads"),
                });
                if (await settings.save(values, settings.revision)) {
                  setDraft({ values, revision: settings.revision });
                  setFormKey((key) => key + 1);
                }
              }}
            />
          </SettingsCard>
        ) : (
          <SettingsCard>
            <SettingsAction
              label="Leads & handoffs preset removed (lead matching, handoffs and lead prompts are off)"
              actionLabel="+ Add Leads preset"
              disabled={settings.saving}
              onPress={async () => {
                const values = buildValues({
                  leadsPreset: true,
                  leadTitlePattern: draft.values.leadTitlePattern || DEFAULT_SETTINGS.leadTitlePattern,
                  hideTitlePattern: draft.values.hideTitlePattern || DEFAULT_SETTINGS.hideTitlePattern,
                  sidebarStripPattern: draft.values.sidebarStripPattern || DEFAULT_SETTINGS.sidebarStripPattern,
                  leadRoles: draft.values.leadRoles || DEFAULT_SETTINGS.leadRoles,
                  oldLeadRoles: draft.values.oldLeadRoles || DEFAULT_SETTINGS.oldLeadRoles,
                  leadPrompt: draft.values.leadPrompt || DEFAULT_LEAD_PROMPT,
                  leadPointerPrompt: draft.values.leadPointerPrompt || DEFAULT_LEAD_POINTER,
                  trackers: draft.values.trackers.some((t) => t.kind === "leads")
                    ? draft.values.trackers
                    : [
                        { id: "leads", name: "Leads", kind: "leads" as const, pattern: "", limit: "6" },
                        ...draft.values.trackers,
                      ],
                });
                if (await settings.save(values, settings.revision)) {
                  setDraft({ values, revision: settings.revision });
                  setFormKey((key) => key + 1);
                }
              }}
            />
          </SettingsCard>
        )}
      </SettingsSection>
      <SettingsSection title="Board & workspaces">
        <SettingsCard key={`general-${formKey}`}>
          <SettingsSwitch
            label="Group unlabelled agents by folder"
            hint="Otherwise they share one Unassigned group."
            value={settings.values.groupUnassignedByFolder}
            disabled={settings.saving}
            onValueChange={toggle("groupUnassignedByFolder")}
          />
          <SettingsSwitch
            label="Show Stop on running agents"
            hint="Two taps; runs paseo stop on the daemon."
            value={settings.values.showStopButton}
            disabled={settings.saving}
            onValueChange={toggle("showStopButton")}
          />
          <SettingsSwitch
            label="Count sub-agents"
            hint="Reads the recent timeline of running agents every 30 seconds."
            value={settings.values.countSubagents}
            disabled={settings.saving}
            onValueChange={toggle("countSubagents")}
          />
          <SettingsInput
            label="Role label key"
            hint="Label whose value says lead, worker, and so on."
            initialValue={draft.values.roleLabel}
            onChangeText={change("roleLabel")}
            disabled={settings.saving}
          />
          <SettingsInput
            label="Group label key"
            hint="Agents sharing this label's value are grouped together."
            initialValue={draft.values.leadLabel}
            onChangeText={change("leadLabel")}
            disabled={settings.saving}
          />
          <SettingsInput
            label="Task label key"
            hint="Shown as a chip on each row."
            initialValue={draft.values.taskLabel}
            onChangeText={change("taskLabel")}
            disabled={settings.saving}
          />
          <SettingsInput
            label="Stale workspace days"
            hint="Workspaces idle this long can be cleaned up."
            initialValue={draft.values.staleWorkspaceDays}
            onChangeText={change("staleWorkspaceDays")}
            disabled={settings.saving}
            error={daysError(draft.values.staleWorkspaceDays)}
          />
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
