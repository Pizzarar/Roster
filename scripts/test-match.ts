import assert from "node:assert/strict";
import { matchBrainstormForLead, normalizePath, pairLeadsWithBrainstorms } from "../shared/match.ts";

const cfg = { labels: { lead: "lead" } };
const CWD = "C:\\Users\\Fugma\\projects\\Escape-From-Idle";
// The live case: an unlabeled ★ LEAD and its brainstorm sit in different workspaces with the same cwd.
const lead = { id: "559e2ec8", labels: {}, workspaceId: "ws-lead", cwd: CWD };
const brainstorm = { id: "a44cd614", labels: { role: "brainstorm", lead: "main-game" }, workspaceId: "ws-other", cwd: CWD };

const tests: [string, () => void][] = [
  ["unlabeled lead pairs with a keyed brainstorm in another workspace, same cwd", () => {
    assert.equal(matchBrainstormForLead(lead, [brainstorm], cfg)?.id, "a44cd614");
    const { pairs, unpaired } = pairLeadsWithBrainstorms([lead], [brainstorm], cfg);
    assert.equal(pairs.get("559e2ec8")?.id, "a44cd614");
    assert.equal(unpaired.length, 0);
  }],
  ["cwd matching ignores case, slashes and trailing slash", () => {
    assert.equal(normalizePath("C:\\A\\B\\"), normalizePath("c:/a/b"));
  }],
  ["unlabeled lead never takes a brainstorm keyed to another live lead", () => {
    const uiLead = { id: "ui", labels: { lead: "ui-lab" }, workspaceId: "ws-ui", cwd: CWD };
    const uiBrainstorm = { id: "0dda30e2", labels: { lead: "ui-lab" }, workspaceId: "ws-x", cwd: CWD };
    const { pairs, unpaired } = pairLeadsWithBrainstorms([lead, uiLead], [uiBrainstorm, brainstorm], cfg);
    assert.equal(pairs.get("ui")?.id, "0dda30e2");
    assert.equal(pairs.get("559e2ec8")?.id, "a44cd614");
    assert.equal(unpaired.length, 0);
  }],
  ["lead with no brainstorm stays a lane with none; stray brainstorm is unpaired", () => {
    const far = { id: "far", labels: { lead: "other" }, workspaceId: "w", cwd: "C:\\elsewhere" };
    const { pairs, unpaired } = pairLeadsWithBrainstorms([lead], [far], cfg);
    assert.equal(pairs.get("559e2ec8"), undefined);
    assert.deepEqual(unpaired.map((b) => b.id), ["far"]);
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
