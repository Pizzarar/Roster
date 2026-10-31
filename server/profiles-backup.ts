import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** `~/.paseo/config.json` (or `$PASEO_HOME/config.json`) copied to `config.json.bak-<timestamp>-roster-import`. */
export async function backupConfig() {
  const source = join(process.env.PASEO_HOME || join(homedir(), ".paseo"), "config.json");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = `${source}.bak-${stamp}-roster-import`;
  try {
    const data = await readFile(source, "utf8");
    await writeFile(target, data, "utf8");
    if ((await readFile(target, "utf8")) !== data) throw new Error("the copy does not match the original");
    return { ok: true, message: `Backed up to ${target}`, path: target };
  } catch (error) {
    return { ok: false, message: `Could not back up ${source}: ${error instanceof Error ? error.message : String(error)}` };
  }
}
