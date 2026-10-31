import assert from "node:assert/strict";
import { resolveLead } from "../shared/match.ts";
import { isLeadAgent, wasLeadAgent, leadAreaFromTitle, DEFAULT_CONFIG } from "../shared/config.ts";
import { createBrainstorm, NeedsAubWatcher, type PaseoApi } from "../server/brainstorm.ts";

const cfg = DEFAULT_CONFIG;
const CWD = "C:/wt/plugins";
type A = { id: string; title: string; cwd: string; createdAt: string; updatedAt: string; status: string; archivedAt: string | null; labels: Record<string, string> };
const agent = (id: string, title: string, createdAt: string, over: Partial<A> = {}): A => ({
  id, title, cwd: CWD, createdAt, updatedAt: createdAt, status: "idle", archivedAt: null, labels: { role: "lead" }, ...over,
});
// ord6 is the one that kept getting activity (updatedAt late); ord7 is the real, later generation.
const OLD = agent("ord6", "★ LEAD · PLUGINS (Claude) ord6", "2026-10-30T07:44:00Z", { updatedAt: "2026-10-31T23:00:00Z" });
const NEW = agent("ord7", "★ LEAD · PLUGINS", "2026-10-31T18:04:00Z", { updatedAt: "2026-10-31T18:05:00Z" });
const rules = {
  isLead: (a: A) => isLeadAgent(a.title, a.labels, cfg),
  areaOf: (a: A) => leadAreaFromTitle(a.title, a.cwd, cfg),
};
const where = { cwd: CWD };

function fakePaseo(agents: A[]) {
  const created: unknown[] = [];
  const paseo = {
    agents: {
      list: async () => ({ entries: agents.map((agent) => ({ agent })) }),
      create: async (req: { title: string; labels: Record<string, string>; cwd: string }) => {
        await new Promise((r) => setTimeout(r, 20));
        created.push(req);
        return { id: `bs-${created.length}` };
      },
      ref: () => ({ send: async () => undefined }),
    },
    config: { get: async () => ({ config: { agentProfiles: [] } }) },
    providers: { listModes: async () => ({ modes: [] }) },
  } as unknown as PaseoApi;
  return { paseo, created };
}

const tests: [string, () => Promise<void> | void][] = [
  ["client leadArea and server area agree on a real title (default sidebarStrip)", async () => {
    const { leadArea } = await import("../client/model.ts");
    const lead = { ...OLD, lastUserMessageAt: null } as unknown as Parameters<typeof leadArea>[0];
    assert.equal(leadArea(lead, cfg), "PLUGINS");
    assert.equal(leadArea(lead, cfg), leadAreaFromTitle(OLD.title, OLD.cwd, cfg));
  }],
  ["watcher leaves the flag alone when the brainstorm could not be created", async () => {
    const flagged = agent("lead1", "★ LEAD · FLAG", "2026-10-31T10:00:00Z", { labels: { role: "lead", "needs-aub": "need a call" } });
    const { paseo, created } = fakePaseo([flagged]);
    let calls = 0;
    const list = paseo.agents.list.bind(paseo.agents);
    // checkNow and the stillFlagged check list first; createBrainstorm's own listing then fails.
    (paseo.agents as unknown as { list: typeof list }).list = (async (...a: Parameters<typeof list>) => {
      if (++calls >= 3) throw new Error("down");
      return list(...a);
    }) as typeof list;
    const watcher = new NeedsAubWatcher(() => cfg);
    await watcher.checkNow(paseo);
    assert.equal(created.length, 0);
    assert.equal((watcher as unknown as { routed: Map<string, unknown> }).routed.size, 0);
  }],
  ["mixed callers (cwd only, then cwd + root) share the lock and the recent create", async () => {
    const { paseo, created } = fakePaseo([NEW, OLD]);
    const first = { area: "PLUGINS", cwd: "C:/wt/mixed-root", reuseExisting: true };
    const second = { area: "PLUGINS", cwd: "C:/wt/mixed-root/sub", projectRootPath: "C:/wt/mixed-root", reuseExisting: true };
    const [a, b] = await Promise.all([createBrainstorm(first, paseo, cfg), createBrainstorm(second, paseo, cfg)]);
    assert.equal(created.length, 1);
    assert.equal(a.agentId, b.agentId);
    const c = await createBrainstorm({ ...first, cwd: "C:/wt/mixed-root" }, paseo, cfg);
    assert.equal(c.agentId, a.agentId);
    assert.equal(created.length, 1);
  }],
  ["a stale lead id resolves to the newest live lead of the project", () => {
    assert.equal(resolveLead("ord6", [OLD, NEW], where, rules)?.id, "ord7");
  }],
  ["the newest lead is kept as asked", () => {
    assert.equal(resolveLead("ord7", [OLD, NEW], where, rules)?.id, "ord7");
  }],
  ["a closed, archived or (old)-titled lead id resolves to the live one", () => {
    for (const bad of [
      agent("x", "★ LEAD · PLUGINS", "2026-10-31T20:00:00Z", { status: "closed" }),
      agent("x", "★ LEAD · PLUGINS", "2026-10-31T20:00:00Z", { archivedAt: "2026-10-31T21:00:00Z" }),
      agent("x", "  (OLD) ★ LEAD · PLUGINS", "2026-10-31T20:00:00Z"),
    ]) assert.equal(resolveLead("x", [bad, OLD, NEW], where, rules)?.id, "ord7");
  }],
  ["an unknown id resolves by location; no live lead gives undefined", () => {
    assert.equal(resolveLead("gone", [OLD, NEW], where, rules)?.id, "ord7");
    assert.equal(resolveLead("gone", [], where, rules), undefined);
  }],
  ["generation ranks by ordN, then createdAt, never updatedAt", () => {
    // OLD has the newest updatedAt, yet resolving from it must not stay on it, nor from NEW go back to it.
    assert.equal(resolveLead("ord6", [OLD, NEW], where, rules)?.id, "ord7");
    assert.equal(resolveLead("ord7", [NEW, OLD], where, rules)?.id, "ord7");
    const a = agent("a", "★ LEAD · PLUGINS ord8", "2026-10-29T00:00:00Z");
    const b = agent("b", "★ LEAD · PLUGINS ord9", "2026-10-28T00:00:00Z");
    assert.equal(resolveLead("a", [a, b], where, rules)?.id, "b");
  }],
  ["leadAreaFromTitle strips every parenthetical and the ordN token anywhere", () => {
    for (const t of ["★ LEAD · PLUGINS (Claude) ord6", "★ LEAD · PLUGINS ord6 (Claude)", "★ LEAD · (x) PLUGINS ord12"])
      assert.equal(leadAreaFromTitle(t, "C:/p", cfg).toLowerCase(), "plugins");
  }],
  ["with no id, the caller's area filters; another area is never returned", () => {
    const ui = agent("ui", "★ LEAD · UI LAB", "2026-10-31T19:00:00Z");
    const root = { cwd: "C:/wt/plugins/sub", rootPath: CWD };
    assert.equal(resolveLead(undefined, [OLD, NEW, ui], { ...root, area: "ui lab" }, rules)?.id, "ui");
    assert.equal(resolveLead("not-in-page", [OLD, NEW, ui], { ...root, area: "plugins" }, rules)?.id, "ord7");
    assert.equal(resolveLead(undefined, [OLD, NEW], { ...root, area: "Other" }, rules), undefined);
  }],
  ["wasLeadAgent counts (old) titles as former leads even with hideTitle off", () => {
    const noHide = { ...cfg, hideTitle: null };
    assert.equal(wasLeadAgent("(old) ★ LEAD · X", {}, noHide), true);
    assert.equal(wasLeadAgent("  (OLD) worker", {}, noHide), true);
    assert.equal(wasLeadAgent("x", { role: "former-lead" }, noHide), true);
    assert.equal(wasLeadAgent("plain worker", {}, noHide), false);
    assert.equal(isLeadAgent("(old) ★ LEAD · X", {}, noHide), false);
  }],
  ["a failed agent listing returns an error and creates nothing", async () => {
    const { paseo, created } = fakePaseo([NEW]);
    (paseo.agents as unknown as { list: () => Promise<never> }).list = async () => {
      throw new Error("down");
    };
    const res = await createBrainstorm({ area: "PLUGINS", cwd: "C:/wt/fail", reuseExisting: true }, paseo, cfg);
    assert.equal(res.ok, false);
    assert.equal(created.length, 0);
  }],
  ["worktrees of one project root share the lock and the recent create", async () => {
    const { paseo, created } = fakePaseo([NEW, OLD]);
    const mk = (cwd: string) => ({ area: "PLUGINS", cwd, projectRootPath: "C:/wt/proj-root", reuseExisting: true });
    const [a, b] = await Promise.all([createBrainstorm(mk("C:/wt/proj-root/a"), paseo, cfg), createBrainstorm(mk("C:/wt/proj-root/b"), paseo, cfg)]);
    assert.equal(created.length, 1);
    assert.equal(a.agentId, b.agentId);
  }],
  ["a lead for a different area in the same cwd is not a successor", () => {
    const ui = agent("ui", "★ LEAD · UI LAB", "2026-10-31T19:00:00Z");
    assert.equal(resolveLead("ord6", [OLD, ui], where, rules)?.id, "ord6");
  }],
  ["isLeadAgent rejects (old) titles, any case, leading space", () => {
    for (const t of ["(old) ★ LEAD · X", "  (OLD) ★ LEAD · X", "(Old)★ LEAD"]) assert.equal(isLeadAgent(t, {}, cfg), false);
    assert.equal(isLeadAgent("★ LEAD · X", {}, cfg), true);
    assert.equal(isLeadAgent("(old) x", { role: "lead" }, cfg), false);
  }],
  ["createBrainstorm names the current lead when given a stale id", async () => {
    const { paseo, created } = fakePaseo([NEW, OLD]);
    const res = await createBrainstorm({ leadId: "ord6", cwd: CWD + "/a", area: "PLUGINS" }, paseo, cfg);
    assert.equal(res.ok, true);
    assert.equal(created.length, 1);
    const prompt = (created[0] as { prompt: string }).prompt;
    assert.match(prompt, /ord7/);
    assert.doesNotMatch(prompt, /ord6/);
  }],
  ["two concurrent creates for one project yield one agent", async () => {
    const { paseo, created } = fakePaseo([NEW, OLD]);
    const input = { leadId: "ord6", leadTitle: OLD.title, area: "PLUGINS", cwd: "C:/wt/concurrent" };
    const [a, b] = await Promise.all([createBrainstorm(input, paseo, cfg), createBrainstorm(input, paseo, cfg)]);
    assert.equal(created.length, 1);
    assert.equal(a.agentId, b.agentId);
    assert.equal(b.reused, true);
  }],
  ["a just-created brainstorm not yet in the listing is reused", async () => {
    const { paseo, created } = fakePaseo([NEW, OLD]);
    const input = { area: "PLUGINS", cwd: "C:/wt/unlisted", reuseExisting: true };
    const first = await createBrainstorm(input, paseo, cfg);
    const second = await createBrainstorm(input, paseo, cfg);
    assert.equal(created.length, 1);
    assert.equal(second.agentId, first.agentId);
    assert.equal(second.reused, true);
  }],
];

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    failed++;
    console.log(`FAIL ${name}\n${error instanceof Error ? error.stack : error}`);
  }
}
console.log(`${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
