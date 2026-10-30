import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/**
 * What a sidebar section tracks. `leads` and `brainstorm` use Roster's own classification;
 * `title` is a regular expression, `folder` a path fragment, `label` a `key=value` pair.
 */
export const TRACKER_KINDS = ["leads", "brainstorm", "title", "folder", "label"] as const;
export type TrackerKind = (typeof TRACKER_KINDS)[number];

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
    brainstormTitlePattern: z.string().default("^BRAINSTORM\\b"),
    sidebarStripPattern: z.string().default("^★ LEAD · |\\s*\\(talk here:.*\\)\\s*$"),
    roleLabel: z.string().trim().default("role"),
    leadLabel: z.string().trim().default("lead"),
    taskLabel: z.string().trim().default("task"),
    leadRoles: z.string().default("lead"),
    oldLeadRoles: z.string().default("former-lead, old-lead"),
    brainstormRoles: z.string().default("brainstorm"),
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
  }),
});

export type RosterSettings = z.output<typeof rosterSettings.schema>;
