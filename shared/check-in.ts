// Pure check-in selection. No imports, so scripts/test-check-in.ts can load this under plain Node.

/** Lead label holding the ISO time Roster last checked in; durable across plugin reloads. */
export const CHECK_IN_AT_LABEL = "roster-checkin-at";
/** Lead labels holding the last check-in reply (truncated) and when it arrived; set only when the lead has no brainstorm. */
export const CHECK_IN_REPLY_LABEL = "roster-checkin-reply";
export const CHECK_IN_REPLY_AT_LABEL = "roster-checkin-reply-at";

export interface CheckInLead {
  readonly id: string;
  readonly status: "initializing" | "idle" | "running" | "error" | "closed";
  readonly archivedAt?: string | null;
  /** Last time the agent did anything (snapshot `lastActivityAt`, else `updatedAt`). */
  readonly lastActivityAt?: string | null;
  readonly updatedAt?: string | null;
  readonly labels?: Readonly<Record<string, string>>;
}

export interface CheckInRules {
  /** A lead silent this long reads as quiet, and a running one this long is no longer "mid-turn". */
  readonly quietMs: number;
  /** A lead checked in within this long is not pinged again . */
  readonly cooldownMs: number;
  /** A lead sent to this recently, per server memory, is ignored: stops a double-tap or two UIs double-sending. */
  readonly dedupeMs: number;
}

/** Window the UI locks a check-in button for, and the server ignores a repeat within. */
export const CHECK_IN_DEDUPE_MS = 4_000;

export type CheckInSkip = "not-live" | "initializing" | "running" | "cooldown" | "duplicate" | "not-found";

export interface CheckInPick<B> {
  readonly lead: CheckInLead;
  /** The lead's paired brainstorm; its reply is routed there. */
  readonly brainstorm: B | undefined;
}

/** Why minutes is unusable, or null. 0 turns the rule off. */
export function minutesError(value: string): string | null {
  const minutes = Number(value);
  return Number.isFinite(minutes) && minutes >= 0 ? null : "Enter a number of minutes, 0 or more";
}

/** Ms since the lead last did anything; NaN when unknown. */
export function quietForMs(lead: CheckInLead, now: number): number {
  const at = Date.parse(lead.lastActivityAt ?? lead.updatedAt ?? "");
  return Number.isFinite(at) ? Math.max(0, now - at) : Number.NaN;
}

/** The "looks frozen" signal for a sidebar row. `ms` is set for `quiet`. */
export function leadHealth(
  lead: CheckInLead,
  now: number,
  quietMs: number,
): { readonly kind: "ok" | "quiet" | "error" | "closed"; readonly ms?: number } {
  if (lead.status === "error") return { kind: "error" };
  if (lead.status === "closed") return { kind: "closed" };
  const ms = quietForMs(lead, now);
  return quietMs > 0 && ms >= quietMs ? { kind: "quiet", ms } : { kind: "ok" };
}

/** Ms since Roster last checked in with the lead; NaN when never. */
export function sinceCheckInMs(lead: CheckInLead, now: number): number {
  const at = Date.parse(lead.labels?.[CHECK_IN_AT_LABEL] ?? "");
  return Number.isFinite(at) ? Math.max(0, now - at) : Number.NaN;
}

/** "25m", "3h", "2d" for a quiet duration. */
export function formatQuiet(ms: number): string {
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

function inCooldown(lead: CheckInLead, now: number, cooldownMs: number): boolean {
  return cooldownMs > 0 && sinceCheckInMs(lead, now) < cooldownMs;
}

/**
 * Which leads to check in: every live lead, brainstorm or not. With `onlyLeadId` only that lead is considered;
 * the same rules apply, so the cooldown is what stops a double-tap.
 */
export function selectCheckIns<B extends { readonly id: string }>(input: {
  readonly leads: readonly CheckInLead[];
  readonly pairs: ReadonlyMap<string, B | undefined>;
  readonly now: number;
  readonly rules: CheckInRules;
  /** Lead id -> ms timestamp of the last check-in this server sent (memory, not the durable label). */
  readonly recentSentAt?: ReadonlyMap<string, number>;
  readonly onlyLeadId?: string;
}): { readonly picks: CheckInPick<B>[]; readonly skipped: { readonly id: string; readonly reason: CheckInSkip }[] } {
  const { pairs, now, rules, onlyLeadId } = input;
  const picks: CheckInPick<B>[] = [];
  const skipped: { id: string; reason: CheckInSkip }[] = [];
  const skip = (id: string, reason: CheckInSkip) => skipped.push({ id, reason });
  if (onlyLeadId && !input.leads.some((l) => l.id === onlyLeadId)) skip(onlyLeadId, "not-found");
  for (const lead of onlyLeadId ? input.leads.filter((l) => l.id === onlyLeadId) : input.leads) {
    if (lead.archivedAt || lead.status === "closed") skip(lead.id, "not-live");
    else if (now - (input.recentSentAt?.get(lead.id) ?? -Infinity) < rules.dedupeMs) skip(lead.id, "duplicate");
    else if (lead.status === "initializing") skip(lead.id, "initializing");
    else if (lead.status === "running" && !(quietForMs(lead, now) >= rules.quietMs)) skip(lead.id, "running");
    else if (inCooldown(lead, now, rules.cooldownMs)) skip(lead.id, "cooldown");
    else picks.push({ lead, brainstorm: pairs.get(lead.id) });
  }
  return { picks, skipped };
}

/** The prompt sent to a lead. The roster marker is appended by the caller. */
export const CHECK_IN_PROMPT =
  "Roster check-in. Reply in 3 short lines: (1) what you are working on; (2) anything broken or stuck, with evidence; (3) whether you are waiting on Aub. If you are, set your needs-aub label with a reason.";
