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

## 3. Proposed Next Steps for Roster (Owner Decision)

Aub's feedback: settings should act like **editable/removable presets** starting from what the user actually tracks, rather than a permanent wall of Lead/label/pattern fields.

### Options for Settings Redesign

1. **Option A — Removable Workflow Presets (Recommended):**
   - Replace the fixed Pattern/Label/Handoff sections with optional, removable presets:
     - **Brainstorm preset:** Sidebar section for Brainstorm chats + optional auto-title (`BRAINSTORM · <topic>`).
     - **Lead handoff & routing preset:** Background lead detach, worker adoption/relay, and lead-finder prompt line — works without pinning Leads in the sidebar if you remove the Leads section.
   - Any preset can be edited or removed completely; an "Advanced" drawer hides raw regex/label keys unless customized.
2. **Option B — Section-Scoped Rules:**
   - Attach title/label matching and auto-naming rules directly to each **Sidebar section** card. Removing a section removes its naming/matching rules, leaving only a single toggle for background child detachment.
3. **Option C — Minimalist (Folder/Title Trackers Only):**
   - Strip Lead/Brainstorm special-casing from settings entirely; every sidebar section is just a saved filter preset (Folder, Title regex, or Label) that can be added, edited, or deleted.
