import assert from "node:assert/strict";
import { clearHandLabels, CLEAR_HAND_DEDUPE_MS, isDuplicateClick, isHandSnoozed, snoozeHandLabels, SNOOZE_MS } from "../shared/clear-hand.ts";
import { handMatches, aubMayHaveReplied, isLeadAwaitingAub, isWaitingOnAub, unhandledNeedsAubReason } from "../shared/needs-aub.ts";

const NOW = Date.parse("2026-10-31T12:00:00.000Z");
const AT = "2026-10-31T11:00:00.000Z";
const handled = { "needs-aub": "handled", "needs-aub-reason": "Pick tick rate", "needs-aub-at": AT };

const tests: [string, () => void][] = [
  ["clear writes the cleared state and who/when", () => {
    const labels = clearHandLabels(NOW);
    assert.equal(labels["needs-aub"], "cleared");
    assert.equal(labels["needs-aub-at"], "");
    assert.equal(labels["needs-aub-reason"], "");
    assert.equal(labels["needs-aub-cleared-by"], "aub");
    assert.equal(labels["needs-aub-cleared-at"], new Date(NOW).toISOString());
    assert.equal(isWaitingOnAub({ ...handled, ...labels }), false);
    assert.equal(isLeadAwaitingAub({ labels: { ...handled, ...labels } }), false);
  }],
  ["a cleared hand is not routed again by the watcher gate", () => {
    const labels = { ...handled, ...clearHandLabels(NOW) };
    assert.equal(unhandledNeedsAubReason(labels), null);
    assert.equal(aubMayHaveReplied(labels, "2026-10-31T13:00:00.000Z"), false);
  }],
  ["snooze writes until = now + 1h keyed to needs-aub-at", () => {
    const labels = snoozeHandLabels(AT, NOW);
    assert.equal(labels["needs-aub-snooze-until"], new Date(NOW + SNOOZE_MS).toISOString());
    assert.equal(labels["needs-aub-snooze-at"], AT);
  }],
  ["snooze hides the hand until expiry, then shows it", () => {
    const labels = { ...handled, ...snoozeHandLabels(AT, NOW) };
    assert.equal(isHandSnoozed(labels, NOW + 1), true);
    assert.equal(isHandSnoozed(labels, NOW + SNOOZE_MS - 1), true);
    assert.equal(isHandSnoozed(labels, NOW + SNOOZE_MS), false);
    assert.equal(isLeadAwaitingAub({ labels }), true, "snooze never changes the flag itself");
  }],
  ["snooze keyed to an old needs-aub-at does not hide a new flag", () => {
    const labels = { ...handled, ...snoozeHandLabels(AT, NOW), "needs-aub-at": "2026-10-31T12:10:00.000Z" };
    assert.equal(isHandSnoozed(labels, NOW + 1), false);
  }],
  ["a re-flag with a new unhandled reason shows while snoozed", () => {
    const labels = { ...handled, ...snoozeHandLabels(AT, NOW), "needs-aub": "New question" };
    assert.equal(isHandSnoozed(labels, NOW + 1), false);
  }],
  ["no snooze labels -> not snoozed", () => {
    assert.equal(isHandSnoozed(handled, NOW), false);
    assert.equal(isHandSnoozed(undefined, NOW), false);
  }],
  ["a matching flag clears; a changed reason or at is refused", () => {
    const shown = { flagAt: AT, reason: "Pick tick rate" };
    assert.equal(handMatches(handled, shown), true);
    assert.equal(handMatches({ ...handled, "needs-aub": "New question" }, shown), false);
    assert.equal(handMatches({ ...handled, "needs-aub-at": "2026-10-31T12:10:00.000Z" }, shown), false);
    assert.equal(handMatches({ "needs-aub": "cleared" }, shown), false);
  }],
  ["an unhandled flag (before routing, no at) still matches what was shown", () => {
    const labels = { "needs-aub": "Pick tick rate" };
    assert.equal(handMatches(labels, { flagAt: "", reason: "Pick tick rate" }), true);
    assert.equal(handMatches({ ...labels, "needs-aub": "Other" }, { flagAt: "", reason: "Pick tick rate" }), false);
  }],
  ["dedupe window", () => {
    assert.equal(isDuplicateClick(undefined, NOW), false);
    assert.equal(isDuplicateClick(NOW, NOW + CLEAR_HAND_DEDUPE_MS - 1), true);
    assert.equal(isDuplicateClick(NOW, NOW + CLEAR_HAND_DEDUPE_MS), false);
  }],
];

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL - ${name}\n${error}`);
  }
}
console.log(`${tests.length - failed}/${tests.length} passed`);
if (failed) process.exit(1);
