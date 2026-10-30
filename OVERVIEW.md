Roster pins your active leads and brainstorm chat above Workspaces in the sidebar, and adds a Roster screen that lists every agent on the daemon grouped by lead.

Leads are found by the `role=lead` label, or a title starting with `★ LEAD`. Titles starting with `(old)` are hidden unless "Old leads" is on. Workers are grouped by their `lead` label, falling back to the `paseo.parent-agent-id` chain.

The screen shows each agent's status, model, folder, last activity and attention reason, plus a "Worktrees with live agents" list that includes folders the Paseo sidebar may hide. Search matches titles, labels, models and folders. Toggles show old leads, archived agents (one-off fetch) and background agents.

A running agent can be interrupted with Stop (tap twice). This runs `paseo stop` on the daemon; it never archives or deletes. A "N sub-agents" chip appears when a running agent's recent timeline has running sub-agent tool calls.

Lead handoffs: a new lead spawned by another agent is detached from it at once. If the spawner was a lead, its live workers move to the new lead, and their finished, failed and permission events are relayed to whichever lead owns them now. The board shows leads that are still sub-agents (with a Fix) and recent handoffs (with Archive old lead). Every new agent also gets one system-prompt line on how to find a project's current lead.

The Workspaces screen lists every workspace with sorting, grouping by project, cleanup filters and git/PR chips. Safe workspaces can be archived one at a time or in bulk; archiving a Paseo worktree deletes its folder.

Settings live under Settings → Plugins → Roster.
