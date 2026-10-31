import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";
import { DEFAULT_GROUP_ORDER } from "./groups";

/**
 * What a sidebar section tracks. `leads` and `brainstorm` use Roster's own classification;
 * `title` is a regular expression, `folder` a path fragment, `label` a `key=value` pair.
 */
export const TRACKER_KINDS = ["leads", "brainstorm", "title", "folder", "label"] as const;
export type TrackerKind = (typeof TRACKER_KINDS)[number];

export const DEFAULT_BRAINSTORM_PROMPT =
  "Roster: if this is a brainstorm chat, set your title to `BRAINSTORM · <topic>` and label `role=brainstorm` with Paseo's update_agent tool (or `paseo agent update <PASEO_AGENT_ID> --name ... --label ...` if the MCP tool is unavailable).";
export const DEFAULT_LEAD_PROMPT =
  "Roster: if you are a project lead, set your title to `★ LEAD · <project>` and labels `role=lead,lead=<project>` with Paseo's update_agent tool (or `paseo agent update <PASEO_AGENT_ID> --name ... --label ...`); if you are a worker, set labels `role=worker,lead=<project>,task=<short task name>`. Pass `lead=<project>` on to agents you spawn.";
export const DEFAULT_LEAD_POINTER =
  "To find a project's current lead: run `paseo ls -g --json` and pick the agent whose cwd matches the project and whose name starts with ★ LEAD (never one starting with (old)).";
export const DEFAULT_IMAGE_PROMPT =
  "When sharing a local screenshot or image with the user, embed it inline with Markdown image syntax (![caption](file:///C:/absolute/path/to/image.png) using forward slashes) or read the image file so it renders directly in chat instead of only sending its file path.";
export const DEFAULT_NEEDS_AUB_PROMPT =
  'If you are a project lead (★ LEAD) and are blocked on a decision or have something Aub should see, run `paseo agent update $PASEO_AGENT_ID --label needs-aub="<one-line reason>"` (or use Paseo\'s update_agent tool to set label `needs-aub=<one-line reason>`).';

export const trackerSchema = z.object({
  id: z.string(),
  name: z.string().default(""),
  kind: z.enum(TRACKER_KINDS),
  pattern: z.string().default(""),
  /** Most rows shown; the rest are on the Roster screen. */
  limit: z.string().trim().default("6"),
});

export type Tracker = z.output<typeof trackerSchema>;

export const DEFAULT_TRACKERS: Tracker[] = [
  { id: "leads", name: "Leads", kind: "leads", pattern: "", limit: "6" },
  { id: "brainstorm", name: "Brainstorm", kind: "brainstorm", pattern: "", limit: "6" },
];

export const guidanceRuleSchema = z.object({
  id: z.string(),
  title: z.string().default(""),
  text: z.string().default(""),
  enabled: z.boolean().default(true),
});

export type GuidanceRule = z.output<typeof guidanceRuleSchema>;

export const DEFAULT_GUIDANCE_RULES: GuidanceRule[] = [
  {
    id: "critiques-and-proposals",
    title: "Critiques and proposals",
    text: 'When Aub asks you to critique a plan or pitch, open with the one principle that decides it (the "why not"), in 1-2 sentences, as a reusable rule. Then give the measurement that would confirm it. Only list gotchas that would change the decision. No exhaustive surveys.',
    enabled: true,
  },
  {
    id: "model-cost-rule",
    title: "Model cost rule",
    text: "Subscriptions carry the volume; pay-as-you-go API is overflow past a cap, never a replacement. Before proposing a cost change, name which cap is actually being hit.",
    enabled: true,
  },
];

/**
 * Host-wide settings, edited under Settings → Plugins → Roster.
 * Patterns are case-insensitive regular expressions; empty disables one.
 * Role lists are comma-separated `role` label values.
 */
export const rosterSettings = defineSettings({
  id: "roster",
  scope: "host",
  version: 1,
  schema: z.object({
    leadTitlePattern: z.string().default("^★ LEAD"),
    hideTitlePattern: z.string().default("^\\(old\\)"),
    brainstormTitlePattern: z.string().default("\\bbrainstorm"),
    sidebarStripPattern: z.string().default("^★ LEAD · |\\s*\\(talk here:.*\\)\\s*$"),
    roleLabel: z.string().trim().default("role"),
    leadLabel: z.string().trim().default("lead"),
    taskLabel: z.string().trim().default("task"),
    leadRoles: z.string().default("lead"),
    oldLeadRoles: z.string().default("former-lead, old-lead"),
    brainstormRoles: z.string().default("brainstorm"),
    /** Comma-separated group names, first to last, for prefix grouping; other prefixes follow A-Z, then Other. */
    groupOrder: z.string().default(DEFAULT_GROUP_ORDER),
    /** Keep Paseo's own profile list (the New chat picker) ordered by group; reorders agentProfiles in config.json. */
    keepProfilesSorted: z.boolean().default(true),
    groupUnassignedByFolder: z.boolean().default(true),
    showStopButton: z.boolean().default(true),
    countSubagents: z.boolean().default(true),
    /** Detach a new lead from the agent that spawned it. */
    detachNewLeads: z.boolean().default(true),
    /** On a handoff, move the old lead's live workers under the new lead. */
    adoptWorkers: z.boolean().default(true),
    /** Forward moved workers' finished, failed and permission events to the current lead. */
    relayWorkerEvents: z.boolean().default(true),
    /** Ask new agents to label themselves with role, group and task. */
    labelInstruction: z.boolean().default(false),
    /** Sidebar sections, top to bottom. */
    trackers: z.array(trackerSchema).default(() => DEFAULT_TRACKERS.map((tracker) => ({ ...tracker }))),
    /** Workspaces idle this many days are cleanup candidates. */
    staleWorkspaceDays: z.string().trim().default("3"),
    /** Archive agents idle this many days (never leads, running agents, or brainstorms with a live lead). */
    autoArchiveAgents: z.boolean().default(true),
    /** Archive clean, merged, agent-free Paseo worktrees idle this many days. */
    autoArchiveWorkspaces: z.boolean().default(false),
    autoArchiveDryRun: z.boolean().default(false),
    autoArchiveIntervalHours: z.string().trim().default("6"),
    autoArchiveAgentDays: z.string().trim().default("3"),
    autoArchiveWorkspaceDays: z.string().trim().default("3"),
    /** A lead silent this many minutes shows "quiet Nm" in the sidebar; a running one this long can be checked in. */
    checkInQuietMinutes: z.string().trim().default("20"),
    /** A lead checked in within this many minutes is not pinged again. */
    checkInCooldownMinutes: z.string().trim().default("15"),
    brainstormPreset: z.boolean().default(true),
    /** Profile id or name for new brainstorms; empty picks the first "brainstorm" profile. */
    brainstormProfile: z.string().default(""),
    /** Mode for new brainstorms: `auto` (per provider), `profile`, or a literal mode id. */
    brainstormModeId: z.string().default("auto"),
    brainstormPromptEnabled: z.boolean().default(true),
    brainstormPrompt: z.string().default(DEFAULT_BRAINSTORM_PROMPT),
    leadsPreset: z.boolean().default(true),
    needsAubAutoSpawn: z.boolean().default(true),
    needsAubPromptEnabled: z.boolean().default(true),
    needsAubPrompt: z.string().default(DEFAULT_NEEDS_AUB_PROMPT),
    leadPromptEnabled: z.boolean().default(false),
    leadPrompt: z.string().default(DEFAULT_LEAD_PROMPT),
    leadPointerEnabled: z.boolean().default(true),
    leadPointerPrompt: z.string().default(DEFAULT_LEAD_POINTER),
    imagePromptEnabled: z.boolean().default(true),
    imagePrompt: z.string().default(DEFAULT_IMAGE_PROMPT),
    guidanceRules: z.array(guidanceRuleSchema).default(() => DEFAULT_GUIDANCE_RULES.map((rule) => ({ ...rule }))),
  }),
});

export type RosterSettings = z.output<typeof rosterSettings.schema>;
