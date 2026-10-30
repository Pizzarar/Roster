// The scaffold ships without @types/node; declare only what server modules use.
declare module "node:fs/promises" {
  export function readFile(path: string, encoding: "utf8"): Promise<string>;
  export function writeFile(path: string, data: string, encoding: "utf8"): Promise<void>;
  export function rename(from: string, to: string): Promise<void>;
  export function mkdir(path: string, options: { recursive: true }): Promise<string | undefined>;
}

declare module "node:path" {
  export function join(...parts: string[]): string;
  export function dirname(path: string): string;
}

declare module "node:os" {
  export function homedir(): string;
}

declare const process: { platform: string; env: Record<string, string | undefined> };
