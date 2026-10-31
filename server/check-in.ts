import type { PluginHookAgent } from "@getpaseo/plugin/server";
import { leadAreaFromTitle, updateAgentLabels, type PaseoApi } from "./brainstorm";
import {
  AGENT_PAGE_LIMIT,
  CHECK_IN_AT_LABEL,
  CHECK_IN_DEDUPE_MS,
  CHECK_IN_PROMPT,
  CHECK_IN_REPLY_AT_LABEL,
  CHECK_IN_REPLY_LABEL,
  isBrainstormAgent,
  isLeadAgent,
  pairLeadsWithBrainstorms,
  ROSTER_PROMPT_MARKER,
  selectCheckIns,
  sinceCheckInMs,
  type BoardConfig,
} from "../shared/config";

/** A pending check-in whose turn never ended is forgotten after this long. */
const PENDING_MAX_MS = 30 * 60_000;
const REPLY_CHARS = 280;

interface Pending {
  readonly sentAt: number;
  readonly title: string;
}

const minutes = (ms: number) => `${Math.max(1, Math.round(ms / 60_000))}m`;

/**
 * Check in with live leads. The RPC returns right after sending. The reply is captured from the
 * agent.turn_ended hook: when the lead's turn ends, the last assistant message since the prompt is read from its
 * timeline and sent to the lead's current brainstorm (marked as a Roster prompt). With no brainstorm, the
 * truncated reply is written to the lead's `roster-checkin-reply` label for the Workspaces screen.
 */
export class CheckIns {
  private readonly pending = new Map<string, Pending>();
  /** Lead id -> when we last sent a check-in; stamped synchronously right before each send. */
  private readonly recentSentAt = new Map<string, number>();

  constructor(private readonly getConfig: () => BoardConfig) {}

  private async liveLeadsAndBrainstorms(paseo: PaseoApi, cfg: BoardConfig) {
    const listed = await paseo.agents
      .list({ includeBackground: true, filter: { includeBackground: true }, page: { limit: AGENT_PAGE_LIMIT } })
      .catch(() => null);
    if (!listed) return null;
    const live = listed.entries.map((e) => e.agent).filter((a) => !a.archivedAt && a.status !== "closed");
    return {
      leads: live.filter((a) => isLeadAgent(a.title, a.labels ?? {}, cfg)),
      brainstorms: live.filter((a) => isBrainstormAgent(a.title, a.labels ?? {}, cfg)),
    };
  }

  async run(paseo: PaseoApi, onlyLeadId?: string) {
    const cfg = this.getConfig();
    const found = await this.liveLeadsAndBrainstorms(paseo, cfg);
    if (!found) return { ok: false, count: 0, message: "Could not list agents" };
    const { leads, brainstorms } = found;
    const { pairs } = pairLeadsWithBrainstorms(leads, brainstorms, cfg);
    const now = Date.now();
    for (const [id, at] of this.recentSentAt) if (now - at > CHECK_IN_DEDUPE_MS) this.recentSentAt.delete(id);
    for (const [id, p] of this.pending) if (now - p.sentAt > PENDING_MAX_MS) this.pending.delete(id);

    const { picks, skipped } = selectCheckIns({
      leads,
      pairs,
      now,
      rules: { quietMs: cfg.checkInQuietMs, cooldownMs: cfg.checkInCooldownMs, dedupeMs: CHECK_IN_DEDUPE_MS },
      recentSentAt: this.recentSentAt,
      onlyLeadId,
    });
    const nameOf = (id: string) => {
      const lead = leads.find((l) => l.id === id);
      return lead ? leadAreaFromTitle(lead.title, lead.cwd, cfg) : id.slice(0, 8);
    };

    const sent: string[] = [];
    const notes: string[] = [];
    for (const { lead } of picks) {
      const name = nameOf(lead.id);
      // Selection ran before earlier sends awaited, so another run may have reserved this lead since. Re-check and
      // stamp in one synchronous step, before the send's await.
      const last = this.recentSentAt.get(lead.id);
      if (this.pending.has(lead.id) || (last !== undefined && Date.now() - last < CHECK_IN_DEDUPE_MS)) {
        notes.push(`${name} (just checked in)`);
        continue;
      }
      this.recentSentAt.set(lead.id, Date.now());
      this.pending.set(lead.id, { sentAt: now, title: name });
      try {
        await paseo.agents
          .ref(lead.id)
          .send(
            `${CHECK_IN_PROMPT}\n\n${ROSTER_PROMPT_MARKER}`,
            lead.status === "running" ? { activeTurnBehavior: "steer" } : undefined,
          );
      } catch {
        this.pending.delete(lead.id);
        this.recentSentAt.delete(lead.id);
        notes.push(`${name} (send failed)`);
        continue;
      }
      // Stamped after the send so a failed send doesn't burn the cooldown; `recentSentAt` covers the gap.
      await updateAgentLabels(lead.id, { [CHECK_IN_AT_LABEL]: new Date(now).toISOString() });
      sent.push(name);
    }
    for (const { id, reason } of skipped) {
      const lead = leads.find((l) => l.id === id);
      const why =
        reason === "running"
          ? "busy, skipped"
          : reason === "duplicate"
            ? "just checked in"
            : reason === "cooldown"
              ? `checked in ${minutes(lead ? sinceCheckInMs(lead, now) : 0)} ago`
              : reason === "initializing"
                ? "starting up"
                : reason === "not-found"
                  ? "lead not found"
                  : "not live";
      notes.push(`${nameOf(id)} (${why})`);
    }

    const parts = [
      sent.length > 0 ? `Checked in: ${sent.join(", ")}` : "No leads checked in",
      ...(notes.length > 0 ? [`Skipped: ${notes.join(", ")}`] : []),
    ];
    return { ok: true, count: sent.length, message: parts.join(" · ") };
  }

  /** A lead archived while we wait for its reply: there will be none. */
  onArchived(agent: PluginHookAgent): void {
    this.pending.delete(agent.id);
    this.recentSentAt.delete(agent.id);
  }

  /** A lead's turn ended: if we're waiting on its check-in reply, read it and route it. */
  async onTurnEnded(
    agent: PluginHookAgent,
    outcome: { kind: "completed" } | { kind: "failed"; error: { message: string } } | { kind: "canceled" },
    paseo: PaseoApi,
  ): Promise<void> {
    const pending = this.pending.get(agent.id);
    if (!pending) return;
    this.pending.delete(agent.id);
    if (outcome.kind !== "completed") return;
    let reply = "";
    try {
      const page = await paseo.agents.ref(agent.id).timeline.refetch({ direction: "tail", limit: 20 });
      for (const { item, timestamp } of page.entries) {
        if (item.type === "assistant_message" && item.text.trim() && Date.parse(timestamp) >= pending.sentAt) {
          reply = item.text.trim();
        }
      }
    } catch {
      // A busy daemon can time out; the check-in just has no captured reply.
    }
    if (!reply) return;
    // Re-resolve against a fresh live list: the brainstorm may have been archived or created since the send.
    const cfg = this.getConfig();
    const found = await this.liveLeadsAndBrainstorms(paseo, cfg);
    const lead = found?.leads.find((l) => l.id === agent.id);
    if (found && !lead) return;
    const brainstorm =
      found && lead ? pairLeadsWithBrainstorms(found.leads, found.brainstorms, cfg).pairs.get(lead.id) : undefined;
    if (brainstorm) {
      const routed = await paseo.agents
        .ref(brainstorm.id)
        .send(`Check-in reply from lead "${pending.title}":\n\n${reply}\n\n${ROSTER_PROMPT_MARKER}`)
        .then(() => true)
        .catch((error) => {
          console.error(`check-in routing for ${agent.id} failed: ${error}`);
          return false;
        });
      if (routed) return;
    }
    await updateAgentLabels(agent.id, {
      [CHECK_IN_REPLY_LABEL]: reply.length > REPLY_CHARS ? `${reply.slice(0, REPLY_CHARS)}…` : reply,
      [CHECK_IN_REPLY_AT_LABEL]: new Date().toISOString(),
    });
  }
}
