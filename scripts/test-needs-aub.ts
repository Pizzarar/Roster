import assert from "node:assert/strict";
import { aubMayHaveReplied, aubReplied, isLeadAwaitingAub, needsAubStampMs } from "../shared/needs-aub.ts";

const AT = "2026-10-31T12:00:00.000Z";
const before = "2026-10-31T11:59:00.000Z";
const after = "2026-10-31T12:05:00.000Z";
const handled = { "needs-aub": "handled", "needs-aub-reason": "Pick tick rate", "needs-aub-at": AT };
const human = (timestamp: string) => ({ timestamp, item: { type: "user_message", text: "go with 20Hz" } });
const agentMsg = (timestamp: string) => ({
  timestamp,
  item: { type: "user_message", text: '<paseo-system version="1" kind="agent-message" source-agent-id="x">status</paseo-system>' },
});
const routing = (timestamp: string) => ({ timestamp, item: { type: "user_message", text: 'Lead "X" needs a decision on: ...' } });

const tests: [string, () => void][] = [
  ["unhandled flag with old brainstorm message -> waiting", () => {
    const labels = { "needs-aub": "Pick tick rate" };
    assert.equal(aubMayHaveReplied(labels, after), false);
    assert.equal(aubReplied(labels, after, [human(after)]), false);
    assert.equal(isLeadAwaitingAub({ labels }), true);
  }],
  ["unhandled flag ignores a stale needs-aub-at -> waiting", () => {
    const labels = { ...handled, "needs-aub": "New question" };
    assert.equal(aubReplied(labels, after, [human(after)]), false);
  }],
  ["routing prompt at/before needs-aub-at -> waiting", () => {
    assert.equal(aubReplied(handled, before, [routing(before)]), false);
    assert.equal(aubReplied(handled, AT, [routing(AT)]), false);
    assert.equal(isLeadAwaitingAub({ labels: handled }), true);
  }],
  ["human message after needs-aub-at -> cleared", () => {
    assert.equal(aubReplied(handled, after, [routing(before), human(after)]), true);
  }],
  ["agent-sent prompt after needs-aub-at does not clear", () => {
    assert.equal(aubMayHaveReplied(handled, after), true);
    assert.equal(aubReplied(handled, after, [agentMsg(after)]), false);
    assert.equal(aubReplied(handled, after, undefined), false);
  }],
  ["missing lastUserMessageAt -> waiting", () => {
    assert.equal(aubReplied(handled, null, [human(after)]), false);
    assert.equal(aubReplied(handled, undefined, [human(after)]), false);
  }],
  ["malformed or missing needs-aub-at -> waiting", () => {
    for (const at of ["not-a-date", "", undefined]) {
      const labels: Record<string, string> = { "needs-aub": "handled" };
      if (at !== undefined) labels["needs-aub-at"] = at;
      assert.equal(Number.isNaN(needsAubStampMs(labels)), true);
      assert.equal(aubReplied(labels, after, [human(after)]), false);
      assert.equal(isLeadAwaitingAub({ labels }), true);
    }
  }],
  ["cleared / none labels are not waiting", () => {
    assert.equal(isLeadAwaitingAub({ labels: { "needs-aub": "cleared" } }), false);
    assert.equal(isLeadAwaitingAub({ labels: {} }), false);
  }],
];

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    failed++;
    console.log(`FAIL ${name}\n${error instanceof Error ? error.message : error}`);
  }
}
console.log(`${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
