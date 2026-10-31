// Live check: writes awkward label values through the plugin's real CLI path and reads them back.
// Usage: node --experimental-strip-types scripts/probe-label-write.ts <agentId>
import { labelArg, runPaseo } from "../server/paseo-cli.ts";

const agentId = process.argv[2];
if (!agentId) throw new Error("agent id required");

const values = [
  "TEST: live check of the raised-hands banner, ignore",
  'a "quoted" b = c & d ^ e | f < g > h %PATH% !x (y)',
  "trailing backslash \\",
  "",
];

// `update --json` echoes all labels as "k=v,k=v"; roster-probe is written last, so it is the tail.
const write = async (value: string): Promise<string> => {
  const { stdout } = await runPaseo(["agent", "update", agentId, "--label", labelArg("roster-probe", value), "--json"]);
  const labels: string = JSON.parse(stdout).labels;
  return labels.slice(labels.lastIndexOf("roster-probe=") + "roster-probe=".length);
};

let failed = 0;
for (const value of values) {
  const want = value.replace(/,/g, "，");
  const got = await write(value);
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} wrote ${JSON.stringify(value)} -> read ${JSON.stringify(got)}`);
}
console.log(failed ? `${failed} FAILED` : "all round-tripped");
process.exit(failed ? 1 : 0);
