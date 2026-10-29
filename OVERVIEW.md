Agent Board pins your active leads and brainstorm chat above Workspaces in the sidebar, and adds an Agent Board screen that lists every agent on the daemon grouped by lead.

Leads are found by the `role=lead` label, or a title starting with `★ LEAD`. Titles starting with `(old)` are hidden unless "Old leads" is on. Workers are grouped by their `lead` label, falling back to the `paseo.parent-agent-id` chain.

The screen shows each agent's status, model, folder, last activity and attention reason, plus a "Worktrees with live agents" list that includes folders the Paseo sidebar may hide. Search matches titles, labels, models and folders. Toggles show old leads, archived agents (one-off fetch) and background agents.

A running agent can be interrupted with Stop (tap twice). This runs `paseo stop` on the daemon; it never archives or deletes. A "N sub-agents" chip appears when a running agent's recent timeline has running sub-agent tool calls.

Patterns and label keys are constants in `shared/config.ts`.
