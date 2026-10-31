import { rosterSettings, type GuidanceRule, type RosterSettings, type Tracker, type TrackerKind } from "./settings";
import { normalizePath } from "./match";

/** Sub-agent counting: poll the timeline tail of running agents while visible. */
export const SUBAGENT_POLL_MS = 30_000;
export const SUBAGENT_TIMELINE_TAIL = 150;
export const SUBAGENT_MAX_CONCURRENT = 2;

/** Daemon page limit for one agents.list call. */
export const AGENT_PAGE_LIMIT = 200;

/** Spawner label written by Paseo itself; not configurable. */
export const PARENT_LABEL = "paseo.parent-agent-id";

/** A sidebar section, ready to match agents. */
export interface TrackerConfig {
  readonly id: string;
  readonly name: string;
  readonly kind: TrackerKind;
  /** `title`: the compiled pattern. */
  readonly title: RegExp | null;
  /** `folder`: lower-case path fragment with forward slashes. */
  readonly folder: string;
  /** `label`: key and value. */
  readonly label: readonly [string, string] | null;
  readonly limit: number;
}

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
  readonly labelInstruction: boolean;
  readonly trackers: readonly TrackerConfig[];
  /** Milliseconds of inactivity before a workspace is a cleanup candidate. */
  readonly staleWorkspaceMs: number;
  readonly autoArchiveAgents: boolean;
  readonly autoArchiveWorkspaces: boolean;
  readonly autoArchiveDryRun: boolean;
  readonly autoArchiveIntervalMs: number;
  readonly autoArchiveAgentMs: number;
  readonly autoArchiveWorkspaceMs: number;
  readonly brainstormPreset: boolean;
  readonly brainstormProfile: string;
  readonly brainstormModeId: string;
  readonly leadsPreset: boolean;
  readonly needsAubAutoSpawn: boolean;
  readonly needsAubPrompt: string;
  readonly brainstormPrompt: string;
  readonly leadPrompt: string;
  readonly leadPointerPrompt: string;
  readonly imagePrompt: string;
  readonly guidanceRules: readonly GuidanceRule[];
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

/** Why an auto-archive interval is unusable, or null. */
export function hoursError(value: string): string | null {
  const hours = Number(value);
  return Number.isFinite(hours) && hours >= 0.25 ? null : "Enter a number of hours, 0.25 or more";
}

const KIND_NAMES: Record<TrackerKind, string> = {
  leads: "Leads",
  brainstorm: "Brainstorm",
  title: "Title match",
  folder: "Folder",
  label: "Label",
};

export function trackerName(tracker: Pick<Tracker, "name" | "kind" | "pattern">): string {
  return tracker.name.trim() || (tracker.kind === "folder" && tracker.pattern.trim()) || KIND_NAMES[tracker.kind];
}

function parseLabel(pattern: string): [string, string] | null {
  const at = pattern.indexOf("=");
  if (at <= 0) return null;
  return [pattern.slice(0, at).trim(), pattern.slice(at + 1).trim()];
}

/** Why a sidebar section can't match anything, or null. */
export function trackerError(tracker: Pick<Tracker, "kind" | "pattern">): string | null {
  const pattern = tracker.pattern.trim();
  switch (tracker.kind) {
    case "title":
      return pattern ? patternError(pattern) : "Enter a pattern";
    case "folder":
      return pattern ? null : "Enter part of a folder path";
    case "label":
      return parseLabel(pattern) ? null : "Enter key=value";
    default:
      return null;
  }
}

/** Why a row limit is unusable, or null. */
export function limitError(value: string): string | null {
  const limit = Number(value);
  return Number.isInteger(limit) && limit >= 1 && limit <= 50 ? null : "Enter a whole number from 1 to 50";
}

function compileTracker(tracker: Tracker): TrackerConfig {
  const pattern = tracker.pattern.trim();
  return {
    id: tracker.id,
    name: trackerName(tracker),
    kind: tracker.kind,
    title: tracker.kind === "title" ? compile(pattern, "i") : null,
    folder: tracker.kind === "folder" ? normalizePath(pattern) : "",
    label: tracker.kind === "label" ? parseLabel(pattern) : null,
    limit: limitError(tracker.limit) ? 6 : Number(tracker.limit),
  };
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

/** Whether an agent is a brainstorm: a brainstorm role, else a brainstorm title. Leads and retired titles never count. */
export function isBrainstormAgent(
  title: string | null | undefined,
  labels: Readonly<Record<string, string>>,
  cfg: BoardConfig,
): boolean {
  if (isLeadAgent(title, labels, cfg) || cfg.hideTitle?.test(title ?? "")) return false;
  const role = labels[cfg.labels.role];
  if (role !== undefined && cfg.brainstormRoles.includes(role)) return true;
  if (role !== undefined && (cfg.leadRoles.includes(role) || cfg.oldLeadRoles.includes(role))) return false;
  return cfg.brainstormTitle?.test(title ?? "") ?? false;
}

export * from "./match";
export * from "./needs-aub";

export function compileConfig(values: RosterSettings): BoardConfig {
  const hasBrainstorm = values.brainstormPreset;
  const hasLeads = values.leadsPreset;

  return {
    leadTitle: hasLeads ? compile(values.leadTitlePattern, "i") : null,
    hideTitle: hasLeads ? compile(values.hideTitlePattern, "i") : null,
    brainstormTitle: hasBrainstorm ? compile(values.brainstormTitlePattern, "i") : null,
    sidebarStrip: hasLeads ? compile(values.sidebarStripPattern, "gi") : null,
    labels: {
      role: values.roleLabel || "role",
      lead: values.leadLabel || "lead",
      task: values.taskLabel || "task",
    },
    leadRoles: hasLeads ? list(values.leadRoles) : [],
    oldLeadRoles: hasLeads ? list(values.oldLeadRoles) : [],
    brainstormRoles: hasBrainstorm ? list(values.brainstormRoles) : [],
    groupUnassignedByFolder: values.groupUnassignedByFolder,
    showStopButton: values.showStopButton,
    countSubagents: values.countSubagents,
    detachNewLeads: hasLeads ? values.detachNewLeads : false,
    adoptWorkers: hasLeads ? values.adoptWorkers : false,
    relayWorkerEvents: hasLeads ? values.relayWorkerEvents : false,
    labelInstruction: values.labelInstruction,
    trackers: values.trackers.map(compileTracker),
    staleWorkspaceMs: staleDays(values.staleWorkspaceDays) * DAY_MS,
    autoArchiveAgents: values.autoArchiveAgents,
    autoArchiveWorkspaces: values.autoArchiveWorkspaces,
    autoArchiveDryRun: values.autoArchiveDryRun,
    autoArchiveIntervalMs: (hoursError(values.autoArchiveIntervalHours) ? 6 : Number(values.autoArchiveIntervalHours)) * 3_600_000,
    autoArchiveAgentMs: (daysError(values.autoArchiveAgentDays) ? 3 : Number(values.autoArchiveAgentDays)) * DAY_MS,
    autoArchiveWorkspaceMs: (daysError(values.autoArchiveWorkspaceDays) ? 3 : Number(values.autoArchiveWorkspaceDays)) * DAY_MS,
    brainstormPreset: hasBrainstorm,
    brainstormProfile: values.brainstormProfile.trim(),
    brainstormModeId: values.brainstormModeId.trim() || "auto",
    leadsPreset: hasLeads,
    needsAubAutoSpawn: hasLeads ? values.needsAubAutoSpawn : false,
    needsAubPrompt: hasLeads ? (values.needsAubPromptEnabled ? values.needsAubPrompt.trim() : "") : "",
    brainstormPrompt: hasBrainstorm ? (values.brainstormPromptEnabled ? values.brainstormPrompt.trim() : "") : "",
    leadPrompt: hasLeads ? (values.leadPromptEnabled ? values.leadPrompt.trim() : "") : "",
    leadPointerPrompt: hasLeads ? (values.leadPointerEnabled ? values.leadPointerPrompt.trim() : "") : "",
    imagePrompt: values.imagePromptEnabled ? values.imagePrompt.trim() : "",
    guidanceRules: values.guidanceRules.filter((r) => r.enabled && (r.title.trim() || r.text.trim())),
  };
}

export const DEFAULT_CONFIG: BoardConfig = compileConfig(DEFAULT_SETTINGS);

/** Re-exported for call sites that already import from config. */
export { isLeadAwaitingAub } from "./needs-aub";
