# Roster

A [Paseo](https://paseo.sh) plugin for people running a lot of agents at once. It pins your lead agents above Workspaces in the sidebar and adds a board of every agent on the daemon, grouped by who leads or spawned them.

It came out of two daily annoyances:

- Agents spawned by other agents are hard to find. You have to know which workspace they ended up in.
- Paseo's sidebar can hide workspaces that still have live agents in them.

<!-- Screenshots: docs/sidebar.png, docs/board.png -->

## What you get

**Sidebar (above Workspaces)**

- One row per active lead, with a status dot (running, idle, error), an attention marker, and a sub-agent count when it has any running.
- A Brainstorm row, if you have one.
- A **Roster (N running)** row that opens the board.

Tap a lead to jump to its chat.

**The Roster screen**

- Every agent, grouped by lead. Within a group, the lead comes first and its workers are indented under it.
- Each row shows the title, status, model, folder, last activity, attention reason (finished, error, needs permission) and task label.
- Search across titles, labels (`role=worker`), models and folders.
- Toggles for retired leads, archived agents and background agents.
- **Worktrees with live agents**: every folder that has a running or idle agent, including ones the Paseo sidebar is hiding. Tap one to open its workspace.
- **Stop** on running agents (tap twice). It runs `paseo stop`, which interrupts the current turn. It never archives or deletes anything, and it does nothing to idle agents.
- An **id** button that copies an agent's id, for use with `paseo send`, `paseo logs` and so on.

Open it from the sidebar, or with **Ctrl+K / ⌘K → Open Roster**.

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

- **Title patterns**: case-insensitive regular expressions for leads, retired leads and brainstorm. Leave one empty to turn it off.
- **Sidebar label strip**: removed from lead titles in the sidebar. With the default, `★ LEAD · MAIN GAME ord47 (talk here: …)` shows as `MAIN GAME ord47`.
- **Label keys and role values**: change these if you use something other than `role` / `lead` / `task`.
- **Group unlabelled agents by folder**: turn this off to put them all under Unassigned.
- **Show Stop on running agents**: turn this off for a strictly read-only board.
- **Count sub-agents**: turn this off to skip the timeline polling described below.

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

- `index.client.tsx` and `client/`: the sidebar, screens and settings.
- `index.server.ts` and `server/`: the Stop handler.
- `shared/`: the settings schema and the RPC contract.

The UI uses React Native primitives only, so it also works in the Paseo mobile app.

## Roadmap

- Optional: add a naming and labelling instruction to new agents, so leads label themselves automatically.
- Use Paseo's own sub-agent list once plugins can reach it.
- Open agents straight from the sidebar once the SDK allows it.

## License

MIT
