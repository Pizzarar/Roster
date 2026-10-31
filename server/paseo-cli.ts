import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// Runs the paseo CLI without a shell. On Windows `paseo.cmd` can only run through cmd.exe, which re-parses
// arguments (`&`, `^`, `"`, `%`), so we run the CLI's own JS entry with node instead.

/** Directories that may hold the npm-installed @getpaseo/cli (next to paseo.cmd). */
function npmBinDirs(): string[] {
  const dirs: string[] = [];
  if (process.env.PASEO_CLI) dirs.push(dirname(process.env.PASEO_CLI));
  if (process.env.APPDATA) dirs.push(join(process.env.APPDATA, "npm"));
  return dirs;
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path, "utf8");
    return true;
  } catch {
    return false;
  }
}

let cachedEntry: Promise<string | null> | undefined;

/** The CLI's `bin/paseo` script, or null when it isn't an npm install we can find. */
export function resolveCliEntry(): Promise<string | null> {
  cachedEntry ??= (async () => {
    for (const dir of npmBinDirs()) {
      const entry = join(dir, "node_modules", "@getpaseo", "cli", "bin", "paseo");
      if (await exists(entry)) return entry;
    }
    return null;
  })();
  return cachedEntry;
}

export interface CliResult {
  readonly stdout: string;
  readonly stderr: string;
}

function execFileNoShell(command: string, args: string[], timeout: number): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout, encoding: "utf8", windowsHide: true, shell: false }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stdout, stderr }));
      else resolve({ stdout, stderr });
    });
  });
}

/** Run `paseo <args>` with every argument delivered verbatim. */
export async function runPaseo(args: string[], timeout = 30_000): Promise<CliResult> {
  const entry = await resolveCliEntry();
  if (entry) return execFileNoShell("node", ["--disable-warning=DEP0040", entry, ...args], timeout);
  if (process.platform !== "win32") return execFileNoShell(process.env.PASEO_CLI || "paseo", args, timeout);
  // Windows without a locatable npm install (e.g. the bundled paseo.cmd): fall back to the plugin helper.
  const { execCommand } = await import("@getpaseo/plugin/server");
  const candidates = [process.env.PASEO_CLI, "paseo"].filter((c): c is string => Boolean(c));
  if (process.env.LOCALAPPDATA) {
    candidates.push(join(process.env.LOCALAPPDATA, "Programs", "Paseo", "resources", "bin", "paseo.cmd"));
  }
  let last: unknown = new Error("paseo CLI not found");
  for (const command of candidates) {
    try {
      return await execCommand(command, args, { timeout });
    } catch (error) {
      last = error;
      if ((error as { code?: unknown }).code !== "ENOENT") break;
    }
  }
  throw last;
}

/**
 * `paseo agent update --label` splits each value on commas, and a segment without `=` aborts the whole
 * update. Labels are single-line text, so swap commas for a fullwidth comma and flatten newlines.
 */
export function labelArg(key: string, value: string): string {
  return `${key}=${value.replace(/,/g, "，").replace(/[\r\n]+/g, " ")}`;
}
