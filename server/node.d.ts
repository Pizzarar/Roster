// The scaffold ships without @types/node; declare only what server modules use.
declare module "node:fs/promises" {
  export function readFile(path: string, encoding: "utf8"): Promise<string>;
  export function writeFile(path: string, data: string, encoding: "utf8" | { encoding: "utf8"; flag?: string }): Promise<void>;
  export function rename(from: string, to: string): Promise<void>;
  export function mkdir(path: string, options: { recursive: true }): Promise<string | undefined>;
  export function stat(path: string): Promise<{ isDirectory(): boolean }>;
}

declare module "node:path" {
  export function join(...parts: string[]): string;
  export function dirname(path: string): string;
}

declare module "node:os" {
  export function homedir(): string;
}

declare const process: { platform: string; env: Record<string, string | undefined> };

declare module "node:child_process" {
  export function execFile(
    file: string,
    args: string[],
    options: { timeout?: number; encoding?: "utf8"; windowsHide?: boolean; shell?: boolean },
    callback: (error: Error | null, stdout: string, stderr: string) => void,
  ): unknown;
}
