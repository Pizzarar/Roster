import assert from "node:assert/strict";
import { DEFAULT_GROUP_ORDER, parseGroupOrder, sameOrder, sortProfiles } from "../shared/groups.ts";
import { compileConfig, DEFAULT_SETTINGS } from "../shared/config.ts";
import { rosterSettings } from "../shared/settings.ts";

const order = parseGroupOrder(DEFAULT_GROUP_ORDER);
const p = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, provider: "x", ...extra });
const names = (list: { name: string }[]) => list.map((e) => e.name);

const input = [
  p("1", "Review - Gemini", { future: { deep: [1, 2] }, unknownField: "keep" }),
  p("2", "Zeta - One"),
  p("3", "Lead - Gemini"),
  p("4", "Plain"),
  p("5", "Implement - Sonnet"),
  p("6", "Alpha - One"),
  p("7", "Lead - Claude"),
  p("8", "Review - Claude"),
  p("9", "Implement - Haiku"),
];

const tests: [string, () => void][] = [
  ["known order, then unknown prefixes A-Z, Other last", () => {
    assert.deepEqual(names(sortProfiles(input, order)), [
      "Lead - Gemini", "Lead - Claude",
      "Implement - Sonnet", "Implement - Haiku",
      "Review - Gemini", "Review - Claude",
      "Alpha - One", "Zeta - One",
      "Plain",
    ]);
  }],
  ["stable within a group (existing relative order kept)", () => {
    const out = sortProfiles(input, order);
    assert.deepEqual(names(out).filter((n) => n.startsWith("Lead")), ["Lead - Gemini", "Lead - Claude"]);
    assert.deepEqual(names(out).filter((n) => n.startsWith("Review")), ["Review - Gemini", "Review - Claude"]);
  }],
  ["idempotent, and a second pass is a no-op", () => {
    const once = sortProfiles(input, order);
    const twice = sortProfiles(once, order);
    assert.ok(sameOrder(once, twice));
    assert.deepEqual(twice, once);
    assert.ok(!sameOrder(input, once));
  }],
  ["same entry objects, deep-equal as a multiset, input untouched", () => {
    const snapshot = structuredClone(input);
    const out = sortProfiles(input, order);
    assert.equal(out.length, input.length);
    for (const entry of input) assert.ok(out.includes(entry));
    assert.deepEqual(input, snapshot);
    const key = (e: unknown) => JSON.stringify(e);
    assert.deepEqual(out.map(key).sort(), snapshot.map(key).sort());
    assert.deepEqual(out.find((e) => e.id === "1")!.future, { deep: [1, 2] });
  }],
  ["custom order respected", () => {
    const out = sortProfiles(input, ["Review", "Lead"]);
    assert.deepEqual(names(out).slice(0, 4), ["Review - Gemini", "Review - Claude", "Lead - Gemini", "Lead - Claude"]);
    // Prefixes not in the custom order follow A-Z.
    assert.deepEqual(names(out).slice(4), ["Alpha - One", "Implement - Sonnet", "Implement - Haiku", "Zeta - One", "Plain"]);
  }],
  ["prefix matching is case-insensitive", () => {
    assert.deepEqual(names(sortProfiles([p("a", "review - x"), p("b", "LEAD - y")], order)), ["LEAD - y", "review - x"]);
  }],
  ["empty and nameless entries are fine", () => {
    assert.deepEqual(sortProfiles([], order), []);
    const nameless = { id: "n" };
    assert.deepEqual(sortProfiles([nameless, p("l", "Lead - A")], order), [p("l", "Lead - A"), nameless]);
  }],
  ["keepProfilesSorted resolves to ON when stored settings lack the key", () => {
    assert.equal(DEFAULT_SETTINGS.keepProfilesSorted, true);
    assert.equal(rosterSettings.schema.parse({ groupOrder: "Lead" }).keepProfilesSorted, true);
    assert.equal(compileConfig(rosterSettings.schema.parse({})).keepProfilesSorted, true);
    assert.equal(compileConfig(rosterSettings.schema.parse({ keepProfilesSorted: false })).keepProfilesSorted, false);
  }],
];

let failed = 0;
for (const [name, run] of tests) {
  try {
    run();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed++;
    console.log(`not ok - ${name}\n${error instanceof Error ? error.stack : error}`);
  }
}
if (failed) process.exit(1);
