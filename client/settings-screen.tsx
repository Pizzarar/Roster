import { useSettings, type PluginSurfaceProps, type SettingsState } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsSection,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { useCallback, useMemo, useState } from "react";
import { Text } from "react-native";
import { daysError, patternError } from "../shared/config";
import { rosterSettings, type RosterSettings } from "../shared/settings";

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

const SWITCHES: readonly { key: SwitchKey; label: string; hint: string }[] = [
  { key: "groupUnassignedByFolder", label: "Group unlabelled agents by folder", hint: "Otherwise they share one Unassigned group." },
  { key: "showStopButton", label: "Show Stop on running agents", hint: "Two taps; runs paseo stop on the daemon." },
  { key: "countSubagents", label: "Count sub-agents", hint: "Reads the recent timeline of running agents every 30 seconds." },
  { key: "detachNewLeads", label: "Detach new leads", hint: "A lead created by another agent is detached at once, so its spawner stops being woken for it." },
  { key: "adoptWorkers", label: "Hand workers to the new lead", hint: "On a handoff, the old lead's live workers are detached and assigned to the new lead." },
  { key: "relayWorkerEvents", label: "Relay handed-over workers", hint: "Their finished, failed and permission events are sent to the lead that owns them now." },
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
  const dirty = PATTERNS.concat(LABELS).some(({ key }) => draft.values[key] !== settings.values[key]);
  const invalid =
    PATTERNS.some(({ key }) => patternError(draft.values[key]) !== null) ||
    daysError(draft.values.staleWorkspaceDays) !== null;

  // Text fields go on top of the latest saved values, so a switch flipped mid-edit is kept.
  const save = useCallback(async () => {
    const values = { ...settings.values };
    for (const { key } of PATTERNS.concat(LABELS)) values[key] = draft.values[key];
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
