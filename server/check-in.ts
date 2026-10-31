import type { PluginHookAgent } from "@getpaseo/plugin/server";
import { leadAreaFromTitle, updateAgentLabels, type PaseoApi } from "./brainstorm";
import {
  AGENT_PAGE_LIMIT,
  CHECK_IN_AT_LABEL,
  CHECK_IN_DEDUPE_MS,
  CHECK_IN_PROMPT,
  isBrainstormAgent,
  isLeadAgent,
  pairLeadsWithBrainstorms,
  ROSTER_PROMPT_MARKER,
  selectCheckIns,
  sinceCheckInMs,
  type BoardConfig,
} from "../shared/config";

/** How long the RPC waits for replies before returning; late replies still get routed to their brainstorm. */
const REPLY_WAIT_MS = 60_000;
/** A pending check-in whose turn never ended is forgotten after this long. */
const PENDING_MAX_MS = 30 * 60_000;
const REPLY_CHARS = 280;

interface Pending {
  readonly sentAt: number;
  readonly title: string;
  readonly brainstormId: string | undefined;
  readonly settle: (reply: string | null) => void;
}

const minutes = (ms: number) => `${Math.max(1, Math.round(ms / 60_000))}m`;

/**
 * Check in with live leads. The reply is captured from the agent.turn_ended hook, not by polling: when the lead's
 * turn ends, the last assistant message since the prompt is read from its timeline and sent to the project's
 * brainstorm (marked as a Roster prompt). Leads with no brainstorm get their reply in the RPC result, if it
 * arrives within REPLY_WAIT_MS.
 */
export class CheckIns {
  private readonly pending = new Map<string, Pending>();
  /** Lead id -> when we last sent a check-in; reserved synchronously after selection so concurrent runs can't both send. */
  private readonly recentSentAt = new Map<string, number>();

  constructor(private readonly getConfig: () => BoardConfig) {}

  async run(paseo: PaseoApi, onlyLeadId?: string) {
    const cfg = this.getConfig();
    const listed = await paseo.agents
      .list({ includeBackground: true, filter: { includeBackground: true }, page: { limit: AGENT_PAGE_LIMIT } })
      .catch(() => null);
    if (!listed) return { ok: false, count: 0, message: "Could not list agents" };
    const live = listed.entries.map((e) => e.agent).filter((a) => !a.archivedAt && a.status !== "closed");
    const leads = live.filter((a) => isLeadAgent(a.title, a.labels ?? {}, cfg));
    const brainstorms = live.filter((a) => isBrainstormAgent(a.title, a.labels ?? {}, cfg));
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
    for (const { lead } of picks) this.recentSentAt.set(lead.id, now);
    const nameOf = (id: string) => {
      const lead = leads.find((l) => l.id === id);
      return lead ? leadAreaFromTitle(lead.title, lead.cwd, cfg) : id.slice(0, 8);
    };

    const sent: { name: string; reply: Promise<string | null>; routed: boolean }[] = [];
    const notes: string[] = [];
    for (const { lead, brainstorm } of picks) {
      const name = nameOf(lead.id);
      if (this.pending.has(lead.id)) {
        notes.push(`${name} (awaiting reply)`);
        continue;
      }
      const reply = new Promise<string | null>((settle) => {
        this.pending.set(lead.id, { sentAt: now, title: name, brainstormId: brainstorm?.id, settle });
      });
      try {
        await paseo.agents
          .ref(lead.id)
          .send(
            `${CHECK_IN_PROMPT}\n\n${ROSTER_PROMPT_MARKER}`,
            lead.status === "running" ? { activeTurnBehavior: "steer" } : undefined,
          );
      } catch {
        this.pending.delete(lead.id);
        notes.push(`${name} (send failed)`);
        continue;
      }
      // Stamped after the send so a failed send doesn't burn the cooldown; `pending` covers the gap.
      await updateAgentLabels(lead.id, { [CHECK_IN_AT_LABEL]: new Date(now).toISOString() });
      sent.push({ name, reply, routed: brainstorm !== undefined });
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

    const replies = await Promise.race([
      Promise.all(sent.map((s) => s.reply)),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), REPLY_WAIT_MS)),
    ]);
    const unrouted = sent
      .map((s, i) => ({ s, text: replies?.[i] ?? null }))
      .filter(({ s, text }) => !s.routed && text)
      .map(({ s, text }) => `${s.name}: ${text}`);

    const parts = [
      sent.length > 0 ? `Checked in with ${sent.length} lead${sent.length === 1 ? "" : "s"}` : "No leads checked in",
      ...(notes.length > 0 ? [`Skipped: ${notes.join(", ")}`] : []),
      ...unrouted,
    ];
    return { ok: true, count: sent.length, message: parts.join("\n") };
  }

  /** A lead's turn ended: if we're waiting on its check-in reply, read it and route it to the brainstorm. */
  async onTurnEnded(
    agent: PluginHookAgent,
    outcome: { kind: "completed" } | { kind: "failed"; error: { message: string } } | { kind: "canceled" },
    paseo: PaseoApi,
  ): Promise<void> {
    const pending = this.pending.get(agent.id);
    if (!pending) return;
    this.pending.delete(agent.id);
    if (outcome.kind !== "completed") {
      pending.settle(null);
      return;
    }
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
    if (reply && pending.brainstormId) {
      await paseo.agents
        .ref(pending.brainstormId)
        .send(`Check-in reply from lead "${pending.title}":\n\n${reply}\n\n${ROSTER_PROMPT_MARKER}`)
        .catch((error) => console.error(`check-in routing for ${agent.id} failed: ${error}`));
    }
    pending.settle(reply ? (reply.length > REPLY_CHARS ? `${reply.slice(0, REPLY_CHARS)}…` : reply) : null);
  }
}
