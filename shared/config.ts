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
  readonly detachNewLeads: boolean;
  readonly adoptWorkers: boolean;
  readonly relayWorkerEvents: boolean;
  /** Milliseconds of inactivity before a workspace is a cleanup candidate. */
  readonly staleWorkspaceMs: number;
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

const DAY_MS = 86_400_000;

/** Why a stale-days value is unusable, or null. */
export function daysError(value: string): string | null {
  const days = Number(value);
  return Number.isFinite(days) && days >= 0 ? null : "Enter a number of days, 0 or more";
}

function staleDays(value: string): number {
  return daysError(value) ? 3 : Number(value);
}

/**
 * Whether an agent is an active lead: a lead `role` label, else a lead title.
 * Retired titles and retired roles never count.
 */
export function isLeadAgent(
  title: string | null | undefined,
  labels: Readonly<Record<string, string>>,
  cfg: BoardConfig,
): boolean {
  const text = title ?? "";
  if (cfg.hideTitle?.test(text)) return false;
  const role = labels[cfg.labels.role];
  const known = [...cfg.leadRoles, ...cfg.oldLeadRoles, ...cfg.brainstormRoles];
  if (role !== undefined && known.includes(role)) return cfg.leadRoles.includes(role);
  return cfg.leadTitle?.test(text) ?? false;
}

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
    detachNewLeads: values.detachNewLeads,
    adoptWorkers: values.adoptWorkers,
    relayWorkerEvents: values.relayWorkerEvents,
    staleWorkspaceMs: staleDays(values.staleWorkspaceDays) * DAY_MS,
  };
}

export const DEFAULT_CONFIG: BoardConfig = compileConfig(DEFAULT_SETTINGS);
