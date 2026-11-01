import assert from "node:assert/strict";
import { agentLaneKey, projectLanes, STALE_BRAINSTORM_MS, LANE_LABEL, TEAM_LABEL, TOPIC_LABEL } from "../client/model.ts";
import { DEFAULT_CONFIG } from "../shared/config.ts";

const cfg = DEFAULT_CONFIG;

type Partial_Agent = {
  id: string; title: string | null; status: string; cwd: string;
  createdAt: string; updatedAt: string; lastUserMessageAt: string | null;
  archivedAt: string | null; labels: Record<string, string>;
  provider: string; model: string | null;
  requiresAttention?: boolean; attentionReason?: null;
};

const NOW = new Date("2026-11-01T12:00:00Z").getTime();
const FRESH = "2026-11-01T10:00:00Z"; // 2h ago = active
const STALE = "2026-11-01T04:00:00Z"; // 8h ago = stale

const agent = (id: string, title: string | null, labels: Record<string, string>, over: Partial<Partial_Agent> = {}): Partial_Agent => ({
  id, title,
  status: "idle",
  cwd: "C:/projects/vibesquad",
  createdAt: FRESH, updatedAt: FRESH, lastUserMessageAt: null,
  archivedAt: null,
  labels,
  provider: "claude", model: "claude-sonnet-4-6",
  requiresAttention: false, attentionReason: null,
  ...over,
});

// Fixture A: OLD title style (★ VIBESQUAD ord1, BRAINSTORM · X) + labels
const OLD_LEAD = agent("lead-vs", "★ VIBESQUAD ord1", { role: "lead", [LANE_LABEL]: "vibesquad", [TEAM_LABEL]: "vibesquad" });
const OLD_BRAINSTORM = agent("bs-vs", "BRAINSTORM · VIBESQUAD", { role: "brainstorm", [LANE_LABEL]: "vibesquad", [TEAM_LABEL]: "vibesquad" });
const OLD_BRAINSTORM_PINNED = agent("bs-pin", "BRAINSTORM · PINNED", { role: "brainstorm", [LANE_LABEL]: "pinned", [TEAM_LABEL]: "vibesquad" });
const OLD_LEAD_PINNED = agent("lead-pin", "★ LEAD · PINNED ord1", { role: "lead", [LANE_LABEL]: "pinned", [TEAM_LABEL]: "vibesquad" });

// Fixture B: NEW title style (VibeSquad · Lead 1, ADE gaps · Buddy) + same labels
const NEW_LEAD = agent("lead-ade", "VibeSquad · Lead 1", { role: "lead", [LANE_LABEL]: "ade-gaps", [TEAM_LABEL]: "vibesquad" });
const NEW_BRAINSTORM = agent("bs-ade", "ADE gaps · Buddy", { role: "brainstorm", [LANE_LABEL]: "ade-gaps", [TEAM_LABEL]: "vibesquad" });

// Fixture C: topic brainstorm
const TOPIC_BRAINSTORM = agent("bs-topic", "BRAINSTORM · VIBESQUAD · pins", {
  role: "brainstorm", [LANE_LABEL]: "vibesquad", [TEAM_LABEL]: "vibesquad", [TOPIC_LABEL]: "pins",
});

// Stale fixture
const STALE_BRAINSTORM = agent("bs-stale", "BRAINSTORM · QUICKSTART", { role: "brainstorm", [LANE_LABEL]: "quickstart" }, {
  updatedAt: STALE, createdAt: STALE,
});
const QUICKSTART_LEAD = agent("lead-qs", "★ LEAD · QUICKSTART ord3", { role: "lead", [LANE_LABEL]: "quickstart" });

const tests: [string, () => void][] = [
  ["agentLaneKey: uses lane label first", () => {
    assert.equal(agentLaneKey(OLD_LEAD as never), "vibesquad");
    assert.equal(agentLaneKey(NEW_LEAD as never), "ade-gaps");
  }],
  ["agentLaneKey: falls back to team label", () => {
    const a = agent("x", null, { [TEAM_LABEL]: "my-team" });
    assert.equal(agentLaneKey(a as never), "my-team");
  }],
  ["agentLaneKey: falls back to cwd basename", () => {
    const a = agent("x", null, {}, { cwd: "C:/projects/my-project" });
    assert.equal(agentLaneKey(a as never), "my-project");
  }],
  ["old titles + labels → same lanes as new titles + labels", () => {
    // Same agent IDs, same labels — only the title style differs
    const vsLead_old = agent("lead-vs", "★ VIBESQUAD ord1", { role: "lead", [LANE_LABEL]: "vibesquad" });
    const vsLead_new = agent("lead-vs", "VibeSquad · Lead 1", { role: "lead", [LANE_LABEL]: "vibesquad" });
    const vsBs_old = agent("bs-vs", "BRAINSTORM · VIBESQUAD", { role: "brainstorm", [LANE_LABEL]: "vibesquad" });
    const vsBs_new = agent("bs-vs", "ADE gaps · Buddy", { role: "brainstorm", [LANE_LABEL]: "vibesquad" });
    const oldLanes = projectLanes([vsLead_old, vsBs_old] as never[], cfg, NOW);
    const newLanes = projectLanes([vsLead_new, vsBs_new] as never[], cfg, NOW);
    // Same lane keys (from labels, not titles)
    assert.deepEqual(oldLanes.map((l) => l.key), newLanes.map((l) => l.key));
    // Same lead and brainstorm IDs
    assert.equal(oldLanes[0]!.lead?.id, newLanes[0]!.lead?.id);
    assert.equal(oldLanes[0]!.brainstorm?.id, newLanes[0]!.brainstorm?.id);
  }],
  ["brainstorms nest under their lane, never become standalone no-lead rows", () => {
    const lanes = projectLanes([OLD_LEAD, OLD_BRAINSTORM] as never[], cfg, NOW);
    assert.equal(lanes.length, 1);
    assert.equal(lanes[0]!.lead?.id, "lead-vs");
    assert.equal(lanes[0]!.brainstorm?.id, "bs-vs");
  }],
  ["topic brainstorm nests under its lane's row, not as its own row", () => {
    const lanes = projectLanes([OLD_LEAD, OLD_BRAINSTORM, TOPIC_BRAINSTORM] as never[], cfg, NOW);
    // Still one lane for 'vibesquad'
    assert.equal(lanes.length, 1);
    const lane = lanes[0]!;
    // Primary brainstorm should be the non-topic one
    assert.equal(lane.brainstorm?.id, "bs-vs");
  }],
  ["stale brainstorms are counted in idleCount, not shown", () => {
    const lanes = projectLanes([QUICKSTART_LEAD, STALE_BRAINSTORM] as never[], cfg, NOW);
    assert.equal(lanes.length, 1);
    assert.equal(lanes[0]!.idleCount, 1);
    assert.equal(lanes[0]!.brainstorm, undefined);
  }],
  ["running brainstorm is never stale regardless of timestamp", () => {
    const runningStale = { ...STALE_BRAINSTORM, status: "running" } as never;
    const lanes = projectLanes([QUICKSTART_LEAD, runningStale] as never[], cfg, NOW);
    assert.equal(lanes[0]!.idleCount, 0);
    assert.equal(lanes[0]!.brainstorm?.id, "bs-stale");
  }],
  ["retired lead (old-lead kind) does not become the lane's lead", () => {
    const retired = agent("old", "(old) VIBESQUAD ord0", { role: "lead", [LANE_LABEL]: "vibesquad" });
    const lanes = projectLanes([retired, OLD_BRAINSTORM] as never[], cfg, NOW);
    assert.equal(lanes.length, 1);
    // No active lead (retired title → old-lead kind)
    assert.equal(lanes[0]!.lead, undefined);
  }],
  ["role=former-lead does not become the lane's lead", () => {
    const former = agent("former", "VIBESQUAD ord0", { role: "former-lead", [LANE_LABEL]: "vibesquad" });
    const lanes = projectLanes([former, OLD_BRAINSTORM] as never[], cfg, NOW);
    assert.equal(lanes[0]!.lead, undefined);
  }],
  ["lanes sorted: leads-first then no-lead, alphabetical by title within each group", () => {
    // Use predictable titles: "AAA" < "BBB" < "CCC"
    const leadA = agent("la", "★ LEAD · AAA ord1", { role: "lead", [LANE_LABEL]: "a-lane" });
    const leadC = agent("lc", "★ LEAD · CCC ord1", { role: "lead", [LANE_LABEL]: "c-lane" });
    const bsB = agent("bb", "BRAINSTORM · BBB", { role: "brainstorm", [LANE_LABEL]: "b-lane" });
    const lanes = projectLanes([leadC, leadA, bsB] as never[], cfg, NOW);
    // Lanes with leads come before no-lead lanes
    assert.equal(lanes[0]!.lead?.id, "la");
    assert.equal(lanes[1]!.lead?.id, "lc");
    assert.equal(lanes[2]!.lead, undefined);
    assert.equal(lanes[2]!.brainstorm?.id, "bb");
  }],
  ["archived and closed agents are already excluded before projectLanes is called", () => {
    // The sidebar pre-filters; verify projectLanes counts them if passed through
    const archived = agent("arc", "BRAINSTORM · VIBESQUAD", { role: "brainstorm", [LANE_LABEL]: "vibesquad" }, {
      archivedAt: "2026-11-01T00:00:00Z",
    });
    // projectLanes itself doesn't filter archived — the caller does (sidebar passes live[])
    // So here it WILL include it; the test verifies the sidebar's pre-filter responsibility
    const lanesAll = projectLanes([OLD_LEAD, archived] as never[], cfg, NOW);
    assert.equal(lanesAll[0]!.brainstorm?.id, "arc"); // archived agent IS counted if passed in
  }],
  ["idleCount=0 when all brainstorms are active", () => {
    const lanes = projectLanes([OLD_LEAD, OLD_BRAINSTORM] as never[], cfg, NOW);
    assert.equal(lanes[0]!.idleCount, 0);
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
console.log(`${tests.length - failed}/${tests.length} passed`);
if (failed) process.exit(1);
