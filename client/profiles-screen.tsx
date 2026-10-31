import { usePaseo, useRpc, type PluginScreenProps } from "@getpaseo/plugin/client";
import { copyText, ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  applyProfileEdit,
  changedFields,
  canWriteProfiles,
  groupByPrefix,
  readProfiles,
  sameOrder,
  sortProfiles,
  type ProfileEdit,
  type ProfileLocation,
} from "../shared/config";
import { writeProfilesRpc } from "../shared/profile-write";
import {
  applyPlan,
  diffProfiles,
  makeProfileId,
  parseProfiles,
  serializeProfiles,
  type Entry,
  type ImportPlan,
} from "../shared/profiles-md";
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
  const write = useRpc(writeProfilesRpc);
  const [sortPreview, setSortPreview] = useState<{ before: string[]; after: string[]; groups: { label: string; names: string[] }[] } | null>(null);
  const [sorting, setSorting] = useState(false);
  const [sortChanged, setSortChanged] = useState(false);
  const [bulk, setBulk] = useState<"export" | "import" | null>(null);
  const [exportText, setExportText] = useState("");
  const [pasted, setPasted] = useState("");
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [deleteIds, setDeleteIds] = useState<ReadonlySet<string>>(new Set());
  const [applying, setApplying] = useState(false);

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
  // Once per open: the daemon sorts only if its own copy of the keep-sorted setting is ON and the order is off.
  useEffect(() => {
    void (async () => {
      try {
        const res = await write({ kind: "sort", auto: true });
        if (res.changed) toast.show(res.message);
      } catch {
        // Settings not ready or daemon busy: the next open tries again.
      }
      await load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const openSortPreview = async () => {
    try {
      const fresh = readProfiles<AgentProfile>((await paseo.config.get()).config);
      const sorted = sortProfiles(fresh.profiles, cfg.groupOrder);
      setSortPreview({
        before: fresh.profiles.map((p) => p.name),
        after: sorted.map((p) => p.name),
        groups: groupByPrefix(sorted, (p) => p.name, cfg.groupOrder).map((g) => ({ label: g.label, names: g.items.map((p) => p.name) })),
      });
      setSortChanged(!sameOrder(fresh.profiles, sorted));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };
  const applySort = async () => {
    setSorting(true);
    try {
      const res = await write({ kind: "sort", auto: false });
      if (!res.ok) throw new Error(res.message);
      toast.show(res.message);
      setSortPreview(null);
      await load();
    } catch (error) {
      toast.error(`Could not sort: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSorting(false);
    }
  };

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
      // The daemon re-reads the config and applies only the fields the user changed (matched by id), so edits made
      // elsewhere since this screen loaded are not overwritten; it also re-sorts when that setting is on.
      const res = await write({ kind: "edit", id, fields: changedFields(base, draft) });
      if (!res.ok) throw new Error(res.message);
      toast.show(res.changed ? "Profile saved" : "No changes");
      await load();
      setEditing(null);
    } catch (error) {
      toast.error(`Could not save: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSaving(false);
    }
  };

  const openExport = async () => {
    try {
      // Re-read so the export is the config as it is now, not the list loaded when the screen opened.
      const fresh = readProfiles<AgentProfile>((await paseo.config.get()).config);
      setProfiles(fresh.profiles);
      setLocation(fresh.location);
      const all = groupByPrefix(fresh.profiles as readonly Entry[], (p) => String(p.name ?? ""), cfg.groupOrder);
      setExportText(serializeProfiles(all));
      setBulk("export");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  /** Diffs the paste against the config as it is right now, so the preview matches what Apply will see. */
  const preview = async () => {
    try {
      const current = readProfiles<AgentProfile>((await paseo.config.get()).config);
      if (!canWriteProfiles(current.location)) {
        throw new Error("Profiles live under daemon.agentProfiles and cannot be written from here.");
      }
      const parsed = parseProfiles(pasted);
      const next = diffProfiles(current.profiles as readonly Entry[], parsed.errors.length ? [] : parsed.profiles);
      setPlan({ ...next, errors: [...parsed.errors, ...next.errors], missing: parsed.errors.length ? [] : next.missing });
      setDeleteIds(new Set());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };
  const toggleDelete = (id: string) =>
    setDeleteIds((s) => {
      const n = new Set(s);
      if (!n.delete(id)) n.add(id);
      return n;
    });
  const apply = async () => {
    if (!plan || plan.errors.length > 0) return;
    setApplying(true);
    try {
      // One daemon-side write: re-parse and re-diff the paste against the fresh config, apply, sort if the setting is
      // on, back up once, patch once.
      const res = await write({ kind: "import", markdown: pasted, deleteIds: [...deleteIds] });
      if (!res.ok) throw new Error(res.message);
      toast.show(res.changed ? `Profiles updated. ${res.message}` : "No changes");
      await load();
      setPlan(null);
      setPasted("");
      setBulk(null);
    } catch (error) {
      toast.error(`Could not apply: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setApplying(false);
    }
  };
  const show = (value: unknown) => {
    if (value === undefined) return "(removed)";
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return JSON.stringify(text.length > 80 ? `${text.slice(0, 80)}…` : text);
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
      {writable ? (
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          {button("Export as markdown", () => void openExport(), bulk === "export" ? "accent" : "muted")}
          {button("Import from markdown", () => setBulk(bulk === "import" ? null : "import"), bulk === "import" ? "accent" : "muted")}
          {button("Sort Paseo's profile list", () => void openSortPreview(), sortPreview ? "accent" : "muted")}
        </View>
      ) : null}
      {sortPreview ? (
        <View style={[styles.group, { padding: 12, gap: 8 }]}>
          <Text style={styles.muted}>
            Paseo's New chat picker lists profiles in this order. {sortChanged ? "Apply reorders them (config backup first); nothing else changes." : "Already sorted: nothing to change."}
          </Text>
          <Text style={[styles.text, { fontWeight: "600" }]}>Current order</Text>
          <Text style={styles.muted}>{sortPreview.before.map((n, i) => `${i + 1}. ${n}`).join("\n")}</Text>
          <Text style={[styles.text, { fontWeight: "600" }]}>New order</Text>
          {sortPreview.groups.map((g) => (
            <View key={g.label}>
              <Text style={styles.text}>{g.label}</Text>
              <Text style={styles.muted}>{g.names.map((n) => `  ${n}`).join("\n")}</Text>
            </View>
          ))}
          <View style={{ flexDirection: "row", gap: 8 }}>
            {button(sorting ? "Applying…" : "Apply", () => void applySort(), "accent", sorting || !sortChanged)}
            {button("Close", () => setSortPreview(null), "muted", sorting)}
          </View>
        </View>
      ) : null}
      {bulk === "export" ? (
        <View style={[styles.group, { padding: 12, gap: 8 }]}>
          <Text style={styles.muted}>All {profiles.length} profiles. Copy this, edit it, and paste it into Import.</Text>
          <TextInput value={exportText} editable={false} multiline style={[styles.input, { minHeight: 200, maxHeight: 360 }]} />
          <View style={{ flexDirection: "row", gap: 8 }}>
            {button("Copy", () => void copyText(exportText).then(() => toast.show("Copied")))}
            {button("Close", () => setBulk(null))}
          </View>
        </View>
      ) : null}
      {bulk === "import" ? (
        <View style={[styles.group, { padding: 12, gap: 8 }]}>
          <Text style={styles.muted}>
            Paste profiles in the export format. Profiles match by id, else exact name; fields you leave out are not
            changed; a blank model, mode, thinking, icon, color or notes removes it. Nothing is deleted unless you tick it.
          </Text>
          <TextInput
            value={pasted}
            onChangeText={(text) => {
              setPasted(text);
              setPlan(null);
            }}
            multiline
            placeholder={"### Profile name\nid: ...\nprovider: ..."}
            style={[styles.input, { minHeight: 200, maxHeight: 360 }]}
          />
          <View style={{ flexDirection: "row", gap: 8 }}>
            {button("Preview", () => void preview(), "accent", pasted.trim() === "")}
            {button("Close", () => {
              setBulk(null);
              setPlan(null);
            })}
          </View>
          {plan ? (
            <View style={{ gap: 6 }}>
              {plan.errors.map((error, i) => (
                <Text key={i} style={[styles.text, { color: theme.colors.statusDanger }]}>
                  {error}
                </Text>
              ))}
              {plan.errors.length === 0 && plan.changes.length + plan.created.length === 0 && plan.missing.length === 0 ? (
                <Text style={styles.muted}>No changes.</Text>
              ) : null}
              {plan.errors.length === 0
                ? plan.changes.map((change) => (
                    <View key={change.id} style={{ gap: 2 }}>
                      <Text style={[styles.text, { fontWeight: "600" }]}>{change.name}</Text>
                      {change.fields.map((field) => (
                        <Text key={field.key} style={styles.muted}>
                          {field.key}: {show(field.from)} → {show(field.to)}
                        </Text>
                      ))}
                    </View>
                  ))
                : null}
              {plan.errors.length === 0
                ? plan.created.map((entry, i) => (
                    <Text key={i} style={styles.text}>
                      + New: {String(entry.name)} ({String(entry.provider)}
                      {entry.model ? `/${String(entry.model)}` : ""}){entry.id ? "" : " (id generated on Apply)"}
                    </Text>
                  ))
                : null}
              {plan.errors.length === 0 && plan.missing.length > 0 ? (
                <View style={{ gap: 4 }}>
                  <Text style={styles.muted}>Not in the paste (kept unless you tick Delete):</Text>
                  {plan.missing.map((m) => (
                    <Pressable
                      key={m.id}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: deleteIds.has(m.id) }}
                      onPress={() => toggleDelete(m.id)}
                    >
                      <Text style={deleteIds.has(m.id) ? [styles.text, { color: theme.colors.statusDanger }] : styles.muted}>
                        {deleteIds.has(m.id) ? "☑ Delete" : "☐ Keep"} {m.name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              {plan.errors.length === 0 && plan.changes.length + plan.created.length + deleteIds.size > 0 ? (
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {button(applying ? "Applying…" : "Apply", () => void apply(), "accent", applying)}
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}
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
