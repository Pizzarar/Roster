# Roster

A [Paseo](https://paseo.sh) plugin for people running a lot of agents at once. It pins the agents you care about (leads, brainstorm chats, or anything you pick) in a box above Workspaces in the sidebar, adds a board of every agent on the daemon grouped by who leads or spawned them, hands workers over cleanly when one lead replaces another, and gives you a screen for sorting and cleaning up workspaces.

It came out of two daily annoyances:

- Agents spawned by other agents are hard to find. You have to know which workspace they ended up in.
- Paseo's sidebar can hide workspaces that still have live agents in them.

<!-- Screenshots: docs/sidebar.png, docs/board.png -->

## What you get

**Sidebar (above Workspaces)**

A boxed panel with:

- A **Roster** header showing how many agents are running. Tap it to open the board.
- One collapsible section per thing you track. By default that's **Leads** and **Brainstorm**; add, remove and reorder sections in settings. A section can show leads, brainstorm chats, agents whose folder contains some text, agents whose title matches a pattern, or agents with a given label.
- One row per agent, with a status dot (running, idle, error), an attention marker, and a sub-agent count when it has any running. Each section shows up to its row limit, then "N more".
- A **Workspaces** row.

Tap an agent to jump to its chat. Closed and archived agents are never shown.

**The Roster screen**

- Every agent, grouped by lead. Within a group, the lead comes first and its workers are indented under it.
- Each row shows the title, status, model, folder, last activity, attention reason (finished, error, needs permission) and task label.
- Search across titles, labels (`role=worker`), models and folders.
- Toggles for retired leads, archived agents and background agents.
- **Worktrees with live agents**: every folder that has a running or idle agent, including ones the Paseo sidebar is hiding. Tap one to open its workspace.
- **Stop** on running agents (tap twice). It runs `paseo stop`, which interrupts the current turn. It never archives or deletes anything, and it does nothing to idle agents.
- An **id** button that copies an agent's id, for use with `paseo send`, `paseo logs` and so on.

- **Lead handoffs**: how many leads are still a sub-agent of another agent, with a two-tap **Fix**, plus recent handoffs with a two-tap **Archive old lead**. Workers moved to a new lead are grouped under it with a "handed over" chip.

Open it from the sidebar, or with **Ctrl+K / ⌘K → Open Roster**.

**The Workspaces screen**

Open it from the **Workspaces** row in the sidebar, or with **Ctrl+K → Roster: workspaces and cleanup**.

- Every workspace, kept live. Sort by cleanup candidates first, most recent, name or project, and optionally group by project.
- Filters: **safe to clean**, **check first** and **in use**.
- Chips for branch, uncommitted changes, commits ahead, PR merged or open, and pinned.
- **Archive** (tap twice) on one workspace, or **Archive N** for every safe one at once.
- Archive is blocked for workspaces with running agents or services, pinned workspaces, Paseo worktrees with uncommitted changes, and anything that isn't a worktree.

Archiving a Paseo-owned worktree deletes its folder, so the confirm button reads **Delete folder?**. A workspace counts as stale after the number of days in settings (3 by default).

## Lead handoffs

When a lead gets near its context limit, it usually spawns its replacement. By default Paseo makes the new lead a sub-agent of the old one. That causes two problems: the old lead keeps being woken by the new lead's finish notices, and archiving the old lead also archives the new one and its workers.

Roster fixes this:

- **Detach**: as soon as a new lead is created by another agent, Roster detaches it. A new lead is an agent with a lead role label or a title matching the lead pattern.
- **Adopt**: if the spawner was a lead, the new lead becomes its successor. The old lead's live workers are detached and assigned to the new lead. A worker the old lead spawns later is moved too.
- **Relay**: when a moved worker finishes, fails or asks for permission, Roster sends a short `[Roster relay]` message to its current lead, following the chain of successors.

To make an existing agent a lead by hand, use **Ctrl+K → Roster: promote to lead** on that agent. Handoff state is kept in `~/.paseo/plugin-data/roster/handoffs.json`.

**Finding the lead.** Roster also adds one line to every new agent's system prompt telling it how to find a project's current lead: `paseo ls -g --json`, then the agent in that project's folder whose name starts with `★ LEAD` and not `(old)`.

## Install

You need Paseo 0.13.2 or newer, with plugins enabled (**Settings → Plugins → Enable plugins**).

```bash
paseo plugin install github:Pizzarar/Roster
```

Or from a local clone:

```bash
git clone https://github.com/Pizzarar/Roster.git
cd Roster
npm install
paseo plugin install "$(pwd)"
```

Check that it shows `running`:

```bash
paseo plugin ls
```

## How Roster finds your leads

Roster reads the agent's labels first and falls back to its title. Nothing is required: with no labels or naming rules at all, agents are grouped by the agent that spawned them, then by folder.

| What | Label (preferred) | Title fallback (default pattern) |
| --- | --- | --- |
| Active lead, pinned in the sidebar | `role=lead` | `^★ LEAD` |
| Retired lead, hidden by default | `role=former-lead` or `role=old-lead` | `^\(old\)` |
| Brainstorm chat | `role=brainstorm` | `^BRAINSTORM\b` |
| Group | `lead=<name>`, shared by a lead and its workers | spawner chain (`paseo.parent-agent-id`) |
| Task chip | `task=<name>` | none |

Grouping order for each agent:

1. the nearest `lead` label up its spawner chain;
2. else the nearest lead ancestor;
3. else the agent at the top of its spawner chain;
4. else Brainstorm, its folder, or Unassigned.

### Setting labels

Labels are set when an agent is created, or later through Paseo's MCP `update_agent` tool. A simple convention is to have each lead label itself, and pass the labels on to the workers it spawns:

```text
Lead:    role=lead     lead=game
Worker:  role=worker   lead=game   task=REFRESH-2
```

If your agents follow a naming rule instead, change the title patterns in settings.

## Settings

Find them under **Settings → Plugins → Roster**, or **Ctrl+K → Roster settings**. They apply to everyone connected to the same daemon.

- **Sidebar sections**: what the sidebar box tracks, top to bottom. **+ Add section** adds one; each has a name, what it shows (Leads, Brainstorm chats, Folder contains, Title matches, Label equals), a pattern where needed, and a row limit. For example, a section showing **Folder contains** `Brain Squad` tracks every live chat in that folder.
- **Workflow presets**:
  - **Brainstorm preset**: pinned Brainstorm matching and auto-naming prompt. Includes an independent switch to ask brainstorm chats to name and label themselves, prompt text customization, title pattern (`^BRAINSTORM\b`), and role label values. Can be removed to turn off brainstorm matching/auto-naming, and restored at any time.
  - **Leads & handoffs preset**: full lead matching, handoffs, and prompts. Includes independent switches to ask leads/workers to name and label themselves (`leadPromptEnabled`), tell new agents how to find a project's lead (`leadPointerEnabled`), plus handoff toggles (`detachNewLeads`, `adoptWorkers`, `relayWorkerEvents`), title patterns (`leadTitlePattern`, `hideTitlePattern`, `sidebarStripPattern`), and role lists (`leadRoles`, `oldLeadRoles`). Can be removed to turn off lead matching, handoffs, and lead prompts, and restored at any time.
- **Board & workspaces**:
  - **Group unlabelled agents by folder**: turn this off to put them all under Unassigned.
  - **Show Stop on running agents**: turn this off for a strictly read-only board.
  - **Count sub-agents**: turn this off to skip the timeline polling described below.
  - **Role / Group / Task label keys**: change these if you use custom label keys instead of `role`, `lead`, or `task`.
  - **Stale workspace days**: how many idle days make a workspace a cleanup candidate.

## Sub-agent counts

Paseo tracks the sub-agents an agent starts inside its own chat (Claude's Task tool, for example), but plugins can't read that list yet. As a workaround, Roster checks the last 150 timeline entries of each running agent every 30 seconds, two at a time. It counts sub-agent tool calls that are still running and shows the count as a chip. Idle agents are not polled. On a heavily loaded daemon you may want this off.

## Known limits

- **Sidebar taps:** the Paseo plugin SDK gives sidebar items no direct way to open an agent. Roster opens a tiny in-between screen that immediately forwards to the agent's chat.
- **200 agents:** the live list holds the 200 most recently updated agents, and the board says so when there are more. The archived list is fetched once when you turn it on and doesn't update live.
- **One host:** Roster shows the daemon you're connected to; it doesn't combine several hosts.
- **Stop:** this needs the `paseo` CLI on the daemon machine. Roster looks for it on `PATH`, then in npm's global folder on Windows.

## Development

```bash
npm install
npm run typecheck
paseo plugin install /absolute/path/to/Roster   # first time
paseo plugin reload roster                       # after edits
paseo plugin logs roster                         # server output
```

Layout:

- `index.client.tsx` and `client/`: the sidebar, the Roster and Workspaces screens, and settings.
- `index.server.ts` and `server/`: Stop, lead handoffs and relays, and the lead-finding system-prompt line.
- `shared/`: the settings schema and the RPC contract.

The UI uses React Native primitives only, so it also works in the Paseo mobile app.

## Roadmap

- A lead-lookup tool for agents that follows handoffs, instead of the system-prompt line.
- Use Paseo's own sub-agent list once plugins can reach it.
- Open agents straight from the sidebar once the SDK allows it.

## License

MIT
