import assert from "node:assert/strict";
import { applyProfileEdit, canWriteProfiles, changedFields, readProfiles } from "../shared/profiles.ts";

const a = { id: "a", name: "Review - Gemini", provider: "gemini", model: "m1", modeId: "x", color: "red", featureValues: { k: 1 }, future: { deep: true } };
const b = { id: "b", name: "Lead - Opus", provider: "claude", extra: [1, 2] };

const tests: [string, () => void][] = [
  ["unknown fields on the edited profile survive", () => {
    const out = applyProfileEdit([a, b], "a", { model: "m2", notes: "hi" })!;
    assert.deepEqual(out[0], { ...a, model: "m2", notes: "hi" });
    assert.deepEqual(out[0]!.future, { deep: true });
  }],
  ["other profiles are untouched (same objects, same order)", () => {
    const out = applyProfileEdit([a, b], "a", { modeId: "y" })!;
    assert.equal(out.length, 2);
    assert.equal(out[1], b);
  }],
  ["input is not mutated", () => {
    const copy = structuredClone(a);
    applyProfileEdit([a], "a", { model: "z" });
    assert.deepEqual(a, copy);
  }],
  ["no-op returns null", () => {
    assert.equal(applyProfileEdit([a, b], "a", { model: "m1", modeId: " x " }), null);
    assert.equal(applyProfileEdit([a, b], "a", {}), null);
    assert.equal(applyProfileEdit([a, b], "nope", { model: "z" }), null);
    assert.equal(applyProfileEdit([b], "b", { notes: "" }), null);
  }],
  ["blank text removes the field", () => {
    const out = applyProfileEdit([a], "a", { modeId: "  " })!;
    assert.equal("modeId" in out[0]!, false);
    assert.equal(out[0]!.provider, "gemini");
  }],
  ["changedFields keeps only what the user touched", () => {
    const base = { model: "m1", modeId: "x", thinkingOptionId: "", notes: "old" };
    assert.deepEqual(changedFields(base, { ...base, model: "m2" }), { model: "m2" });
    assert.deepEqual(changedFields(base, base), {});
    assert.deepEqual(changedFields(base, { ...base, notes: "" }), { notes: "" });
  }],
  ["an external edit to an untouched field survives a save (matched by id)", () => {
    const base = { model: "m1", modeId: "x", thinkingOptionId: "", notes: "old" };
    const draft = { ...base, model: "m2" };
    const fresh = [{ ...a, notes: "changed in Paseo settings" }, { ...b, name: "a" }];
    const out = applyProfileEdit(fresh, "a", changedFields(base, draft))!;
    assert.equal(out[0]!.model, "m2");
    assert.equal(out[0]!.notes, "changed in Paseo settings");
    assert.equal(out[1], fresh[1]);
  }],
  ["nesting is detected: top is writable, daemon is not", () => {
    assert.deepEqual(readProfiles({ agentProfiles: [a] }), { profiles: [a], location: "top" });
    assert.deepEqual(readProfiles({ daemon: { agentProfiles: [a] } }), { profiles: [a], location: "daemon" });
    assert.equal(readProfiles({}).profiles.length, 0);
    assert.equal(canWriteProfiles("top"), true);
    assert.equal(canWriteProfiles("daemon"), false);
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
