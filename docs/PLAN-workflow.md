# Roster Workflow & Settings Plan

Agreed between `★ LEAD · PLUGINS ord4` (`56979d5e`) and `Brainstorm Quickstart Quide` (`91dae751`).

## 1. How Aub Works in Paseo

- **Single touchpoint:** Aub talks only to a **Brainstorm** chat to riff, resolve design questions, and reply with short approvals (`"dispatch"`, `"all approved"`, `"go with recs"`).
- **Brainstorm dispatches Leads:** Brainstorm writes a brief file and spawns or messages the project's `★ LEAD`, then detaches it so Brainstorm isn't woken by every worker turn.
- **Leads run teams autonomously:** Each `★ LEAD` dispatches workers by Paseo profile and only returns to Aub at checkpoints (outline/decisions, draft, results), usually through Brainstorm.
- **Implication for Roster:** Aub needs instant access to active **Brainstorm** chats and workspace cleanup, while Lead discovery and handoff detachment mostly serve agent-to-agent coordination in the background.

## 2. Lessons Learned (Quickstart & Profile Audit)

- **L9 — Context handoffs (150k / 200k):** Leads hand off at 150k tokens (done by 200k) by spawning a successor `★ LEAD` and retiring as `(old)`.
- **L10 — Old agents waking up (~10% of Lead spend):** Parent chats get woken when child agents finish unless children are detached or old parents are archived. Roster's auto-detach on lead creation and Brainstorm-to-Lead detachment directly prevent this spend.
- **Global Lead lookup (`paseo ls -g`):** Provider `list_agents` is folder-scoped; finding a project's current `★ LEAD` requires global lookup (`paseo ls -g --json`).
- **Titles vs. labels:** `labelInstruction` previously asked agents only to set `role`/`lead`/`task` labels (not their display title), and CLI providers without Paseo's MCP `update_agent` tool need the `paseo agent update` CLI fallback.
- **Review rule (2026-10-30):** Cross-family review is required only for EFI main development. Side projects like Roster may use same-family review, but never the author's own session and always a different model from the author (e.g., Sonnet reviews Opus, or Gemini Argon reviews Sonnet/Flash).

## 3. Workflow Presets Settings Redesign (Implemented)

Aub's feedback: settings should act like **editable/removable presets** starting from what the user actually tracks, rather than a permanent wall of Lead/label/pattern fields.

**Option A — Removable Workflow Presets (Implemented):**
- Replaced the fixed Pattern/Label/Behaviour sections with modular preset cards:
  - **Brainstorm preset:** Pinned Brainstorm matching, independent prompt switch (`brainstormPromptEnabled`), editable prompt, title pattern, and role values. Removing turns off brainstorm matching and auto-naming; restoring re-adds the default tracker and patterns.
  - **Leads & handoffs preset:** Lead and worker auto-naming switch (`leadPromptEnabled`), lead lookup pointer switch (`leadPointerEnabled`), handoff switches (`detachNewLeads`, `adoptWorkers`, `relayWorkerEvents`), title patterns, and role lists. Removing turns off lead matching, handoffs, and lead prompts; restoring re-adds the default leads tracker and configurations.
- **Board & workspaces section:** General board settings (`groupUnassignedByFolder`, `showStopButton`, `countSubagents`), label key mapping, and stale workspace cleanup days.
