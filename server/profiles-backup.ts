import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** `~/.paseo/config.json` (or `$PASEO_HOME/config.json`) copied to `config.json.bak-<timestamp>-roster-<kind>`; never overwrites a backup. */
export async function backupConfig(kind: "edit" | "import" | "sort" = "import") {
  const source = join(process.env.PASEO_HOME || join(homedir(), ".paseo"), "config.json");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  try {
    const data = await readFile(source, "utf8");
    let target = "";
    for (let n = 0; ; n++) {
      target = `${source}.bak-${stamp}-roster-${kind}${n === 0 ? "" : `-${n}`}`;
      try {
        await writeFile(target, data, { encoding: "utf8", flag: "wx" });
        break;
      } catch (error) {
        if ((error as { code?: string }).code !== "EEXIST" || n >= 50) throw error;
      }
    }
    if ((await readFile(target, "utf8")) !== data) throw new Error("the copy does not match the original");
    return { ok: true, message: `Backed up to ${target}`, path: target };
  } catch (error) {
    return { ok: false, message: `Could not back up ${source}: ${error instanceof Error ? error.message : String(error)}` };
  }
}
