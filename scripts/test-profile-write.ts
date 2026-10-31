import assert from "node:assert/strict";
import { createProfileWriter, type WriteDeps } from "../shared/profile-writer.ts";
import { parseGroupOrder, DEFAULT_GROUP_ORDER } from "../shared/groups.ts";

const order = parseGroupOrder(DEFAULT_GROUP_ORDER);
const p = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, provider: "claude", ...extra });

/** A fake daemon: an in-memory agentProfiles list with patch/backup counters and an optional slow get. */
function fake(initial: ReturnType<typeof p>[], keepSorted: boolean, delay = 0) {
  const state = { profiles: initial, patches: 0, backups: [] as string[] };
  const deps: WriteDeps = {
    get: async () => {
      const snapshot = structuredClone({ agentProfiles: state.profiles });
      if (delay) await new Promise((r) => setTimeout(r, delay));
      return snapshot;
    },
    patch: async (profiles) => {
      state.patches++;
      state.profiles = structuredClone(profiles) as typeof initial;
    },
    backup: async (kind) => {
      state.backups.push(kind);
      return { ok: true, message: `bak-${kind}` };
    },
    settings: async () => ({ keepSorted, order }),
    makeId: () => "agent_profile_new",
  };
  return { state, deps };
}
const names = (l: { name: string }[]) => l.map((e) => e.name);
const base = () => [p("1", "Review - A"), p("2", "Lead - B"), p("3", "Implement - C")];

const tests: [string, () => Promise<void>][] = [
  ["edit + keep-sorted: one backup, one patch, edit applied and sorted", async () => {
    const { state, deps } = fake(base(), true);
    const res = await createProfileWriter()(deps, { kind: "edit", id: "1", fields: { model: "m9" } });
    assert.ok(res.ok && res.changed);
    assert.equal(state.patches, 1);
    assert.deepEqual(state.backups, ["edit"]);
    assert.deepEqual(names(state.profiles), ["Lead - B", "Implement - C", "Review - A"]);
    assert.equal((state.profiles[2] as { model?: string }).model, "m9");
  }],
  ["edit with keep-sorted off keeps the order", async () => {
    const { state, deps } = fake(base(), false);
    await createProfileWriter()(deps, { kind: "edit", id: "1", fields: { model: "m9" } });
    assert.deepEqual(names(state.profiles), ["Review - A", "Lead - B", "Implement - C"]);
  }],
  ["import adding a profile lands sorted in one write", async () => {
    const { state, deps } = fake(base(), true);
    const md = "### Lead - New\nprovider: claude\n";
    const res = await createProfileWriter()(deps, { kind: "import", markdown: md, deleteIds: [] });
    assert.ok(res.ok && res.changed, res.message);
    assert.equal(state.patches, 1);
    assert.deepEqual(state.backups, ["import"]);
    assert.deepEqual(names(state.profiles), ["Lead - B", "Lead - New", "Implement - C", "Review - A"]);
  }],
  ["import with errors writes nothing", async () => {
    const { state, deps } = fake(base(), true);
    const res = await createProfileWriter()(deps, { kind: "import", markdown: "not a profile", deleteIds: [] });
    assert.equal(res.ok, false);
    assert.equal(state.patches, 0);
    assert.equal(state.backups.length, 0);
  }],
  ["two queued ops apply in order and neither is lost", async () => {
    const { state, deps } = fake(base(), true, 5);
    const write = createProfileWriter();
    const [a, b] = await Promise.all([
      write(deps, { kind: "edit", id: "1", fields: { model: "one" } }),
      write(deps, { kind: "edit", id: "3", fields: { notes: "two" } }),
    ]);
    assert.ok(a.changed && b.changed);
    assert.equal(state.patches, 2);
    const byId = Object.fromEntries(state.profiles.map((e) => [e.id, e as Record<string, unknown>]));
    assert.equal(byId["1"]!.model, "one");
    assert.equal(byId["3"]!.notes, "two");
  }],
  ["a second sort is a no-op (no backup, no patch)", async () => {
    const { state, deps } = fake(base(), true);
    const write = createProfileWriter();
    await write(deps, { kind: "sort", auto: false });
    assert.equal(state.patches, 1);
    const again = await write(deps, { kind: "sort", auto: false });
    assert.ok(again.ok && !again.changed);
    assert.equal(state.patches, 1);
    assert.equal(state.backups.length, 1);
  }],
  ["auto sort does nothing when keep-sorted is off; manual sort still sorts", async () => {
    const { state, deps } = fake(base(), false);
    const write = createProfileWriter();
    const auto = await write(deps, { kind: "sort", auto: true });
    assert.ok(auto.ok && !auto.changed);
    assert.equal(state.patches, 0);
    const manual = await write(deps, { kind: "sort", auto: false });
    assert.ok(manual.changed);
    assert.deepEqual(names(state.profiles), ["Lead - B", "Implement - C", "Review - A"]);
  }],
  ["settings unavailable: no automatic sort, manual sort refuses, edits stay unsorted", async () => {
    const { state, deps } = fake(base(), true);
    deps.settings = async () => null;
    const write = createProfileWriter();
    assert.equal((await write(deps, { kind: "sort", auto: true })).ok, false);
    await write(deps, { kind: "edit", id: "1", fields: { model: "x" } });
    assert.deepEqual(names(state.profiles), ["Review - A", "Lead - B", "Implement - C"]);
  }],
  ["failed backup means no write", async () => {
    const { state, deps } = fake(base(), true);
    deps.backup = async () => ({ ok: false, message: "disk full" });
    const res = await createProfileWriter()(deps, { kind: "sort", auto: false });
    assert.equal(res.ok, false);
    assert.equal(state.patches, 0);
  }],
  ["entries survive deep-equal, unknown fields included", async () => {
    const weird = [p("1", "Review - A", { future: { deep: [1, { x: 2 }] }, odd: null }), p("2", "Lead - B")];
    const { state, deps } = fake(weird, true);
    await createProfileWriter()(deps, { kind: "sort", auto: false });
    const key = (e: unknown) => JSON.stringify(e);
    assert.deepEqual(state.profiles.map(key).sort(), weird.map(key).sort());
  }],
];

let failed = 0;
for (const [name, run] of tests) {
  try {
    await run();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed++;
    console.log(`not ok - ${name}\n${error instanceof Error ? error.stack : error}`);
  }
}
if (failed) process.exit(1);
