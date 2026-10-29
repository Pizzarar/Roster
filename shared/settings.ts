import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

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
  }),
});

export type RosterSettings = z.output<typeof rosterSettings.schema>;
