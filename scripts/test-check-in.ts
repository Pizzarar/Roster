import assert from "node:assert/strict";
import { CHECK_IN_AT_LABEL, leadHealth, selectCheckIns, type CheckInLead } from "../shared/check-in.ts";
import { brainstormForLead, pairLeadsWithBrainstorms } from "../shared/match.ts";

const MIN = 60_000;
const now = Date.parse("2026-10-31T12:00:00Z");
const ago = (minutes: number) => new Date(now - minutes * MIN).toISOString();
const rules = { quietMs: 20 * MIN, cooldownMs: 15 * MIN, dedupeMs: 4_000 };
const cfg = { labels: { lead: "lead" } };

type TestLead = CheckInLead & { cwd: string };
const lead = (id: string, over: Partial<TestLead> = {}): TestLead => ({
  id,
  status: "idle",
  lastActivityAt: ago(60),
  cwd: `/w/${id}`,
  labels: { lead: id },
  ...over,
});
const brainstorm = (key: string) => ({ id: `b-${key}`, cwd: `/w/${key}`, labels: { lead: key } });

function run(leads: TestLead[], onlyLeadId?: string, recentSentAt?: Map<string, number>) {
  const { pairs } = pairLeadsWithBrainstorms(leads, [brainstorm("a")], cfg);
  const { picks, skipped } = selectCheckIns({ leads, pairs, now, rules, onlyLeadId, recentSentAt });
  return { ids: picks.map((p) => p.lead.id), picks, skipped };
}

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`ok - ${name}`);
};

test("a lead with a brainstorm is included, paired to it", () => {
  const r = run([lead("a"), lead("b")]);
  assert.deepEqual(r.ids, ["a", "b"]);
  assert.equal(r.picks[0]?.brainstorm?.id, "b-a");
  assert.equal(r.picks[1]?.brainstorm, undefined);
});

test("running under the threshold is skipped", () => {
  const r = run([lead("a", { status: "running", lastActivityAt: ago(2) })]);
  assert.deepEqual(r.ids, []);
  assert.deepEqual(r.skipped, [{ id: "a", reason: "running" }]);
});

test("running over the threshold is included", () => {
  assert.deepEqual(run([lead("a", { status: "running", lastActivityAt: ago(45) })]).ids, ["a"]);
});

test("checked in within the cooldown is skipped; past it is included", () => {
  const fresh = lead("a", { labels: { lead: "a", [CHECK_IN_AT_LABEL]: ago(5) } });
  const old = lead("b", { labels: { lead: "b", [CHECK_IN_AT_LABEL]: ago(30) } });
  const r = run([fresh, old]);
  assert.deepEqual(r.ids, ["b"]);
  assert.deepEqual(r.skipped, [{ id: "a", reason: "cooldown" }]);
});

test("closed and archived leads are excluded", () => {
  const r = run([lead("a", { status: "closed" }), lead("b", { archivedAt: ago(1) })]);
  assert.deepEqual(r.ids, []);
  assert.deepEqual(r.skipped.map((s) => s.reason), ["not-live", "not-live"]);
});

test("single-lead path: only that lead, cooldown and mid-turn still skip", () => {
  const leads = [
    lead("a", { labels: { lead: "a", [CHECK_IN_AT_LABEL]: ago(1) } }),
    lead("b"),
    lead("c", { status: "running", lastActivityAt: ago(1) }),
  ];
  assert.deepEqual(run(leads, "b").ids, ["b"]);
  assert.deepEqual(run(leads, "a").skipped, [{ id: "a", reason: "cooldown" }]);
  assert.deepEqual(run(leads, "c").skipped, [{ id: "c", reason: "running" }]);
  assert.deepEqual(run(leads, "zzz").skipped, [{ id: "zzz", reason: "not-found" }]);
});

test("server dedupe: a repeat within the window is ignored even with no cooldown label", () => {
  const leads = [lead("a"), lead("b")];
  const recent = new Map([["a", now - 1_000], ["b", now - 5_000]]);
  const r = run(leads, undefined, recent);
  assert.deepEqual(r.ids, ["b"]);
  assert.deepEqual(r.skipped, [{ id: "a", reason: "duplicate" }]);
  assert.deepEqual(run(leads, "a", recent).skipped, [{ id: "a", reason: "duplicate" }]);
});

test("health: error, quiet and ok", () => {
  assert.equal(leadHealth(lead("a", { status: "error" }), now, rules.quietMs).kind, "error");
  assert.deepEqual(leadHealth(lead("a", { lastActivityAt: ago(25) }), now, rules.quietMs), { kind: "quiet", ms: 25 * MIN });
  assert.equal(leadHealth(lead("a", { lastActivityAt: ago(5) }), now, rules.quietMs).kind, "ok");
  assert.equal(leadHealth(lead("a", { lastActivityAt: ago(500) }), now, 0).kind, "ok");
});

test("brainstormForLead agrees with the pairing used here", () => {
  const leads = [lead("a"), lead("b")];
  assert.equal(brainstormForLead(leads[0]!, leads, [brainstorm("a")], cfg)?.id, "b-a");
});

console.log(`${passed}/${passed} passed`);
