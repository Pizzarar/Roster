import { usePaseo, type PluginScreenProps } from "@getpaseo/plugin/client";
import { ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  applyProfileEdit,
  changedFields,
  canWriteProfiles,
  groupByPrefix,
  readProfiles,
  type ProfileEdit,
  type ProfileLocation,
} from "../shared/config";
import { makeStyles, type AgentProfile } from "./board";
import { useBoardConfig } from "./config";
import { useGroupState } from "./groups";
import { Chip } from "./ui";

const FIELDS: readonly { key: keyof ProfileEdit; label: string }[] = [
  { key: "model", label: "Model" },
  { key: "modeId", label: "Mode" },
  { key: "thinkingOptionId", label: "Thinking" },
  { key: "notes", label: "Notes" },
];

const textOf = (profile: AgentProfile, key: keyof ProfileEdit): string => {
  const value = (profile as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
};

export function ProfilesScreen({ theme, layout }: PluginScreenProps) {
  const paseo = usePaseo();
  const toast = useToast();
  const cfg = useBoardConfig();
  const styles = useMemo(() => makeStyles(theme, layout.compact), [theme, layout.compact]);
  // Profile groups start open: this screen exists to browse them.
  const groupState = useGroupState(true);
  const [profiles, setProfiles] = useState<readonly AgentProfile[]>([]);
  const [location, setLocation] = useState<ProfileLocation>("top");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProfileEdit>({});
  /** Field values when editing began; only fields that differ from these are written. */
  const [base, setBase] = useState<ProfileEdit>({});
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await paseo.config.get();
      const source = readProfiles<AgentProfile>(res.config);
      setProfiles(source.profiles);
      setLocation(source.location);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [paseo]);
  useEffect(() => {
    void load();
  }, [load]);

  const writable = canWriteProfiles(location);
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = q
      ? profiles.filter((p) => `${p.name} ${p.provider} ${p.model ?? ""} ${p.modeId ?? ""}`.toLowerCase().includes(q))
      : profiles;
    return groupByPrefix(shown, (p) => p.name, cfg.groupOrder);
  }, [profiles, query, cfg.groupOrder]);

  const startEdit = (profile: AgentProfile) => {
    setEditing(profile.id);
    const values = Object.fromEntries(FIELDS.map(({ key }) => [key, textOf(profile, key)]));
    setBase(values);
    setDraft(values);
  };

  const save = async (id: string) => {
    setSaving(true);
    try {
      // Re-read first, and write only the fields the user changed, so edits made elsewhere since this screen
      // loaded (to any field, including ones shown here) are not overwritten. The profile is matched by id.
      const fresh = readProfiles<AgentProfile>((await paseo.config.get()).config);
      if (!canWriteProfiles(fresh.location)) throw new Error("Profiles live under daemon.agentProfiles; edit them in Paseo settings.");
      const next = applyProfileEdit(fresh.profiles, id, changedFields(base, draft));
      if (next) {
        const res = await paseo.config.patch({ agentProfiles: next as AgentProfile[] });
        const saved = readProfiles<AgentProfile>(res.config);
        setProfiles(saved.profiles);
        setLocation(saved.location);
        toast.show("Profile saved");
      } else {
        setProfiles(fresh.profiles);
        toast.show("No changes");
      }
      setEditing(null);
    } catch (error) {
      toast.error(`Could not save: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSaving(false);
    }
  };

  const button = (label: string, onPress: () => void, tone: "accent" | "muted" = "muted", disabled = false) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}>
      <Chip theme={theme} label={label} tone={tone} />
    </Pressable>
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Profiles</Text>
      <Text style={styles.muted}>
        Agent profiles grouped by name prefix ({profiles.length} total). Order is set in Roster settings.
        {writable ? "" : " Read-only: these profiles live under daemon.agentProfiles, which the plugin API cannot write. Edit them in Paseo’s own profile settings."}
      </Text>
      <TextInput value={query} onChangeText={setQuery} placeholder="Search name, provider, model, mode" style={styles.input} />
      {status === "loading" ? <Text style={styles.muted}>Loading…</Text> : null}
      {status === "error" ? <Text style={styles.muted}>Could not read the daemon config.</Text> : null}
      {status === "ready" && groups.length === 0 ? <Text style={styles.muted}>No profiles.</Text> : null}
      {groups.map((group) => {
        const id = `profiles:${group.key}`;
        const open = groupState.isOpen(id);
        return (
          <View key={group.key} style={styles.group}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: open }}
              accessibilityLabel={`${group.label}, ${group.items.length} profiles, ${open ? "collapse" : "expand"}`}
              onPress={() => groupState.toggle(id)}
              style={styles.groupHeader}
            >
              <Text style={[styles.text, { fontWeight: "600" }]}>
                {open ? "▾" : "▸"} {group.label}
              </Text>
              <Text style={styles.muted}>{group.items.length}</Text>
            </Pressable>
            {open
              ? group.items.map((profile) => (
                  <View key={profile.id} style={{ paddingHorizontal: 12, paddingVertical: 8, gap: 6 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <Text style={[styles.text, { flex: 1, minWidth: 120 }]} numberOfLines={1}>
                        {profile.name}
                      </Text>
                      <Chip theme={theme} label={profile.model ? `${profile.provider}/${profile.model}` : profile.provider} />
                      {profile.modeId ? <Chip theme={theme} label={profile.modeId} /> : null}
                      {profile.thinkingOptionId ? <Chip theme={theme} label={`think ${profile.thinkingOptionId}`} /> : null}
                      {writable && editing !== profile.id ? button("Edit", () => startEdit(profile)) : null}
                    </View>
                    {profile.notes && editing !== profile.id ? (
                      <Text style={styles.muted} numberOfLines={2}>
                        {profile.notes}
                      </Text>
                    ) : null}
                    {editing === profile.id ? (
                      <View style={{ gap: 6 }}>
                        {FIELDS.map(({ key, label }) => (
                          <View key={key} style={{ gap: 2 }}>
                            <Text style={styles.muted}>{label}</Text>
                            <TextInput
                              value={draft[key] ?? ""}
                              onChangeText={(text) => setDraft((d) => ({ ...d, [key]: text }))}
                              editable={!saving}
                              style={styles.input}
                              multiline={key === "notes"}
                            />
                          </View>
                        ))}
                        <View style={{ flexDirection: "row", gap: 8 }}>
                          {button(saving ? "Saving…" : "Save", () => void save(profile.id), "accent", saving)}
                          {button("Cancel", () => setEditing(null), "muted", saving)}
                        </View>
                      </View>
                    ) : null}
                  </View>
                ))
              : null}
          </View>
        );
      })}
    </ScrollView>
  );
}
