import assert from "node:assert/strict";
import { groupByPrefix, parseGroupOrder, DEFAULT_GROUP_ORDER } from "../shared/groups.ts";
import { applyPlan, diffProfiles, makeProfileId, parseProfiles, serializeProfiles, type Entry } from "../shared/profiles-md.ts";

const order = parseGroupOrder(DEFAULT_GROUP_ORDER);
const exportMd = (profiles: Entry[]) => serializeProfiles(groupByPrefix(profiles, (p) => String(p.name), order));
const newId = () => "agent_profile_new";

const a: Entry = {
  id: "agent_profile_a", name: "Review - Gemini", provider: "gemini", model: "m1", modeId: "x", thinkingOptionId: "low",
  icon: "eye", color: "red", featureValues: { k: 1, nested: { z: [1, 2] } }, future: { deep: true }, flag: null, count: 3, label: "txt",
  notes: "line one\n\nline `three` with ``` fence\n````four\n  indented\ntrailing\n",
};
const b: Entry = { id: "agent_profile_b", name: "Lead - Opus", provider: "claude", notes: "", empty: "", odd: " spaced ", quote: '"q"' };
const c: Entry = { id: "agent_profile_c", name: "Gemini", provider: "gemini", model: ' "weird" ', modeId: "" , notes: "a\r\nb" };
const all = () => structuredClone([a, b, c]);

const tests: [string, () => void][] = [
  ["export -> import round-trips exactly, including awkward values and notes", () => {
    const parsed = parseProfiles(exportMd(all()));
    assert.deepEqual(parsed.errors, []);
    const byId = new Map(parsed.profiles.map((p) => [p.id, p]));
    for (const original of all()) assert.deepStrictEqual(byId.get(original.id), original);
    assert.equal(parsed.profiles.length, 3);
  }],
  ["export -> import with no edits is zero changes", () => {
    const plan = diffProfiles(all(), parseProfiles(exportMd(all())).profiles);
    assert.deepEqual(plan.errors, []);
    assert.equal(plan.changes.length + plan.created.length + plan.missing.length, 0);
    assert.equal(applyPlan(all(), plan, new Set(), newId), null);
  }],
  ["groups appear as ## headings in group order and are ignored on import", () => {
    const md = exportMd(all());
    const headings = md.split("\n").filter((l) => l.startsWith("## "));
    assert.deepEqual(headings, ["## Lead", "## Review", "## Other"]);
    assert.equal(parseProfiles(md.replace("## Review", "## Whatever")).profiles.length, 3);
  }],
  ["editing one field changes only that field", () => {
    const md = exportMd(all()).replace("model: m1", "model: m2");
    const plan = diffProfiles(all(), parseProfiles(md).profiles);
    assert.deepEqual(plan.errors, []);
    assert.equal(plan.changes.length, 1);
    assert.deepEqual(plan.changes[0]!.fields, [{ key: "model", from: "m1", to: "m2" }]);
    const out = applyPlan(all(), plan, new Set(), newId)!;
    assert.deepStrictEqual(out[0], { ...a, model: "m2" });
    assert.deepStrictEqual(out[1], b);
    assert.deepStrictEqual(out[2], c);
  }],
  ["only planned fields are written: a field changed elsewhere meanwhile survives", () => {
    const md = exportMd(all()).replace("model: m1", "model: m2");
    const plan = diffProfiles(all(), parseProfiles(md).profiles);
    const fresh = all();
    fresh[0]!.notes = "changed in Paseo settings";
    const out = applyPlan(fresh, plan, new Set(), newId)!;
    assert.equal(out[0]!.model, "m2");
    assert.equal(out[0]!.notes, "changed in Paseo settings");
  }],
  ["notes with backticks and newlines survive an edit of the notes", () => {
    const edited = all();
    edited[0]!.notes = "```\nnot a fence end\n`````\n";
    const plan = diffProfiles(all(), parseProfiles(exportMd(edited)).profiles);
    assert.deepEqual(plan.changes.map((x) => x.fields.map((f) => f.key)), [["notes"]]);
    assert.equal(applyPlan(all(), plan, new Set(), newId)![0]!.notes, "```\nnot a fence end\n`````\n");
  }],
  ["a field left out of the paste is left alone; a blank optional field is removed", () => {
    const md = exportMd(all()).replace(/^color: red\n/m, "").replace(/^icon: eye$/m, "icon:");
    const plan = diffProfiles(all(), parseProfiles(md).profiles);
    assert.deepEqual(plan.changes[0]!.fields, [{ key: "icon", from: "eye", to: undefined }]);
    const out = applyPlan(all(), plan, new Set(), newId)!;
    assert.equal("icon" in out[0]!, false);
    assert.equal(out[0]!.color, "red");
  }],
  ["matching by id survives a rename; without an id it matches the exact name", () => {
    const renamed = parseProfiles(exportMd(all()).replace("### Lead - Opus", "### Lead - Opus 2")).profiles;
    const p1 = diffProfiles(all(), renamed);
    assert.deepEqual(p1.changes[0]!.fields, [{ key: "name", from: "Lead - Opus", to: "Lead - Opus 2" }]);
    const p2 = diffProfiles(all(), parseProfiles("### Lead - Opus\nmodel: opus\n").profiles);
    assert.equal(p2.changes[0]!.id, "agent_profile_b");
    assert.deepEqual(p2.missing.map((m) => m.id), ["agent_profile_a", "agent_profile_c"]);
  }],
  ["new profiles are previewed and appended with a generated id; missing profiles are never deleted unless ticked", () => {
    const md = "### Scout - New\nprovider: claude\nmodel: m\n\n### Lead - Opus\nprovider: claude\n";
    const plan = diffProfiles(all(), parseProfiles(md).profiles);
    assert.deepEqual(plan.errors, []);
    assert.equal(plan.created.length, 1);
    assert.deepEqual(plan.missing.map((m) => m.id), ["agent_profile_a", "agent_profile_c"]);
    const kept = applyPlan(all(), plan, new Set(), newId)!;
    assert.deepEqual(kept.map((p) => p.id), ["agent_profile_a", "agent_profile_b", "agent_profile_c", "agent_profile_new"]);
    assert.deepStrictEqual(kept[0], a);
    const deleted = applyPlan(all(), plan, new Set(["agent_profile_c"]), newId)!;
    assert.deepEqual(deleted.map((p) => p.id), ["agent_profile_a", "agent_profile_b", "agent_profile_new"]);
    assert.equal(applyPlan(all(), diffProfiles(all(), []), new Set(), newId), null);
    assert.equal(applyPlan(all(), diffProfiles(all(), []), new Set(["agent_profile_a"]), newId)!.length, 2);
  }],
  ["a new profile needs a provider", () => {
    const plan = diffProfiles(all(), parseProfiles("### Scout - New\nmodel: m\n").profiles);
    assert.match(plan.errors[0]!, /needs a provider/);
  }],
  ["malformed pastes give clear errors and Apply writes nothing", () => {
    const cases: [string, RegExp][] = [
      ["### \nprovider: x\n", /no name/],
      ["### X\nprovider: x\nfeatureValues: {oops}\n", /featureValues is not valid JSON/],
      ["### X\nprovider: x\nfeatureValues: [1]\n", /object is expected/],
      ["### X\nid: dup\nprovider: x\n### Y\nid: dup\nprovider: x\n", /duplicate id dup/],
      ["### X\nprovider: x\nprovider: y\n", /duplicate field/],
      ["### X\nprovider: x\nnotes:\nno fence\n", /fenced block/],
      ["### X\nprovider: x\nnotes:\n```\nnever closed\n", /never closed/],
      ["### X\nprovider: x\nrubbish line\n", /key: value/],
      ["stray text\n### X\nprovider: x\n", /before the first/],
      ["### X\nprovider: x\nextra: nope\n", /extra is not valid JSON/],
      ["### X\nprovider: \"x\n", /quoted string/],
      ["### X\nprovider: x\n### X\nprovider: x\n", /two profiles named/],
    ];
    for (const [md, re] of cases) {
      const plan = diffProfiles(all(), parseProfiles(md).profiles);
      const errors = [...parseProfiles(md).errors, ...plan.errors];
      assert.ok(errors.some((e) => re.test(e)), `${md} -> ${errors.join(" | ")}`);
    }
    const bad = { changes: [], created: [], missing: [], errors: ["boom"] };
    assert.throws(() => applyPlan(all(), bad, new Set(["agent_profile_a"]), newId), /boom/);
  }],
  ["the fence outgrows backticks in notes", () => {
    const md = exportMd([{ id: "i", name: "X", provider: "p", notes: "a ````` b" }]);
    assert.ok(md.includes("\n``````\n"));
  }],
  ["CRLF pastes are read as LF only when every line break is CRLF", () => {
    const md = exportMd([{ id: "i", name: "X", provider: "p", notes: "one\ntwo" }]);
    assert.equal(parseProfiles(md.replace(/\n/g, "\r\n")).profiles[0]!.notes, "one\ntwo");
  }],
  ["generated ids look like the daemon's", () => {
    let n = 0.5;
    const id = makeProfileId(1_700_000_000_000, () => (n = (n * 7919) % 1));
    assert.match(id, /^agent_profile_[0-9a-z]{8}_[0-9a-z]{10}$/);
  }],
];

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.error(`FAIL ${name}\n${e}`);
  }
}
if (failed) process.exit(1);
