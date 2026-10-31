import assert from "node:assert/strict";
import { agentGroupLabel, groupByLabel, groupByPrefix, namePrefix, parseGroupOrder, DEFAULT_GROUP_ORDER } from "../shared/groups.ts";

const order = parseGroupOrder(DEFAULT_GROUP_ORDER);
const labels = (names: string[]) => groupByPrefix(names, (n) => n, order).map((g) => g.label);

const tests: [string, () => void][] = [
  ["prefix: hyphen and en dash are the same, trimmed", () => {
    assert.equal(namePrefix("Review - Gemini"), "Review");
    assert.equal(namePrefix("  Review – Gemini "), "Review");
    assert.equal(namePrefix("Pre-check - x"), "Pre-check");
    assert.equal(namePrefix("A - B - C"), "A");
  }],
  ["prefix: no separator, empty prefix or null is Other", () => {
    assert.equal(namePrefix("Gemini"), null);
    assert.equal(namePrefix("Pre-check"), null);
    assert.equal(namePrefix(" - x"), null);
    assert.equal(namePrefix(null), null);
    assert.deepEqual(labels(["Gemini"]), ["Other"]);
  }],
  ["groups are case-insensitive and keep first-seen casing", () => {
    const g = groupByPrefix(["review - a", "Review - b", "REVIEW – c"], (n) => n, order);
    assert.equal(g.length, 1);
    assert.equal(g[0]!.label, "review");
    assert.equal(g[0]!.items.length, 3);
  }],
  ["order: configured first, then alphabetical, Other last", () => {
    assert.deepEqual(
      labels(["x", "Zeta - 1", "Audit - 1", "alpha - 1", "Lead - 1", "Review - 1", "Brainstorm - 1"]),
      ["Lead", "Brainstorm", "Audit", "Review", "alpha", "Zeta", "Other"],
    );
  }],
  ["order: a custom list changes ranking", () => {
    const g = groupByPrefix(["Lead - 1", "Art - 1"], (n) => n, ["art", "LEAD"]);
    assert.deepEqual(g.map((x) => x.label), ["Art", "Lead"]);
  }],
  ["parseGroupOrder trims and drops blanks", () => {
    assert.deepEqual(parseGroupOrder(" a, ,b ,"), ["a", "b"]);
  }],
  ["groupByLabel: items keep input order, null goes to Other", () => {
    const g = groupByLabel([1, 2, 3, 4], (n) => (n % 2 ? "Odd" : null), []);
    assert.deepEqual(g.map((x) => [x.label, x.items]), [["Odd", [1, 3]], ["Other", [2, 4]]]);
  }],
  ["agent mapping: role first, then profile prefix, then title prefix, else Other", () => {
    assert.equal(agentGroupLabel({ kind: "lead", title: "Review - x" }), "Lead");
    assert.equal(agentGroupLabel({ kind: "brainstorm", title: "x" }), "Brainstorm");
    assert.equal(agentGroupLabel({ kind: "worker", profileName: "Audit - Gemini", title: "Review - x" }), "Audit");
    assert.equal(agentGroupLabel({ kind: "worker", profileName: "Gemini", title: "Review – x" }), "Review");
    assert.equal(agentGroupLabel({ kind: "worker", title: "just a title" }), null);
    assert.equal(agentGroupLabel({ kind: "worker", title: null }), null);
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
