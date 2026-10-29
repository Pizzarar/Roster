import { rosterSettings, type RosterSettings } from "./settings";

/** Sub-agent counting: poll the timeline tail of running agents while visible. */
export const SUBAGENT_POLL_MS = 30_000;
export const SUBAGENT_TIMELINE_TAIL = 150;
export const SUBAGENT_MAX_CONCURRENT = 2;

/** Daemon page limit for one agents.list call. */
export const AGENT_PAGE_LIMIT = 200;

/** Spawner label written by Paseo itself; not configurable. */
export const PARENT_LABEL = "paseo.parent-agent-id";

export interface BoardConfig {
  readonly leadTitle: RegExp | null;
  readonly hideTitle: RegExp | null;
  readonly brainstormTitle: RegExp | null;
  readonly sidebarStrip: RegExp | null;
  readonly labels: { readonly role: string; readonly lead: string; readonly task: string };
  readonly leadRoles: readonly string[];
  readonly oldLeadRoles: readonly string[];
  readonly brainstormRoles: readonly string[];
  readonly groupUnassignedByFolder: boolean;
  readonly showStopButton: boolean;
  readonly countSubagents: boolean;
}

export const DEFAULT_SETTINGS: RosterSettings = rosterSettings.schema.parse({});

/** Why a pattern does not compile, or null. */
export function patternError(source: string): string | null {
  if (!source.trim()) return null;
  try {
    new RegExp(source, "i");
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function compile(source: string, flags: string): RegExp | null {
  if (!source.trim() || patternError(source)) return null;
  return new RegExp(source, flags);
}

const list = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

export function compileConfig(values: RosterSettings): BoardConfig {
  return {
    leadTitle: compile(values.leadTitlePattern, "i"),
    hideTitle: compile(values.hideTitlePattern, "i"),
    brainstormTitle: compile(values.brainstormTitlePattern, "i"),
    sidebarStrip: compile(values.sidebarStripPattern, "gi"),
    labels: {
      role: values.roleLabel || "role",
      lead: values.leadLabel || "lead",
      task: values.taskLabel || "task",
    },
    leadRoles: list(values.leadRoles),
    oldLeadRoles: list(values.oldLeadRoles),
    brainstormRoles: list(values.brainstormRoles),
    groupUnassignedByFolder: values.groupUnassignedByFolder,
    showStopButton: values.showStopButton,
    countSubagents: values.countSubagents,
  };
}

export const DEFAULT_CONFIG: BoardConfig = compileConfig(DEFAULT_SETTINGS);
