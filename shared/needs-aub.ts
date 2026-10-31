// Pure needs-aub flag helpers. No imports, so scripts/test-needs-aub.ts can load this under plain Node.
export const NEEDS_AUB_LABEL = "needs-aub";
export const NEEDS_AUB_REASON_LABEL = "needs-aub-reason";
export const NEEDS_AUB_AT_LABEL = "needs-aub-at";

/** True when a lead has flagged needs-aub (including after auto-spawn sets needs-aub=handled). */
export function isWaitingOnAub(labels: Readonly<Record<string, string>> | undefined): boolean {
  const raw = labels?.[NEEDS_AUB_LABEL]?.trim();
  if (!raw) return false;
  return !/^(?:none|false|cleared|0)$/i.test(raw);
}

/** Non-null when needs-aub has a fresh reason that hasn't been marked handled yet. */
export function unhandledNeedsAubReason(labels: Readonly<Record<string, string>> | undefined): string | null {
  const raw = labels?.[NEEDS_AUB_LABEL]?.trim();
  if (!raw) return null;
  if (/^(?:handled|none|false|cleared|0)$/i.test(raw)) return null;
  return raw;
}

export function needsAubReasonText(labels: Readonly<Record<string, string>> | undefined): string {
  return (
    unhandledNeedsAubReason(labels) ||
    labels?.[NEEDS_AUB_REASON_LABEL]?.trim() ||
    "Waiting on your decision"
  );
}

/** Parsed `needs-aub-at` stamp in ms; NaN when missing or malformed. */
export function needsAubStampMs(labels: Readonly<Record<string, string>> | undefined): number {
  const raw = labels?.[NEEDS_AUB_AT_LABEL]?.trim();
  return raw ? Date.parse(raw) : Number.NaN;
}

/** The flag a UI showed when Aub acted on it; a clear/snooze only applies if the lead still carries exactly this. */
export interface ExpectedHand {
  readonly flagAt: string;
  readonly reason: string;
}

export function handMatches(labels: Readonly<Record<string, string>> | undefined, expected: ExpectedHand): boolean {
  return (labels?.[NEEDS_AUB_AT_LABEL]?.trim() ?? "") === expected.flagAt && needsAubReasonText(labels) === expected.reason;
}

/** Stable marker Roster appends to every prompt it sends into a brainstorm, so those never read as Aub typing. */
export const ROSTER_PROMPT_MARKER = "<!-- roster -->";

/** Prompts Roster itself sent, and agent-sent prompts (send_agent_prompt), which arrive in a `<paseo-system ...>` envelope. */
export function isAgentSentPrompt(text: string | null | undefined): boolean {
  const body = text ?? "";
  return /^\s*<paseo-system\b/.test(body) || body.includes(ROSTER_PROMPT_MARKER);
}

export interface TimelineTailEntry {
  readonly timestamp: string;
  readonly item: { readonly type: string; readonly text?: string };
}

/**
 * Cheap pre-check: a routed flag (`needs-aub=handled` with a valid `needs-aub-at`) and a brainstorm user
 * message newer than that stamp. `lastUserMessageAt` also counts agent-sent prompts, so this alone never clears.
 */
export function aubMayHaveReplied(
  labels: Readonly<Record<string, string>> | undefined,
  lastUserMessageAt: string | null | undefined,
): boolean {
  if (!isWaitingOnAub(labels) || unhandledNeedsAubReason(labels)) return false;
  const stampMs = needsAubStampMs(labels);
  const userMs = Date.parse(lastUserMessageAt ?? "");
  return Number.isFinite(stampMs) && Number.isFinite(userMs) && userMs > stampMs;
}

/** True when the brainstorm timeline tail holds a human-typed user message newer than the routed flag. */
export function aubReplied(
  labels: Readonly<Record<string, string>> | undefined,
  lastUserMessageAt: string | null | undefined,
  tail: readonly TimelineTailEntry[] | undefined,
): boolean {
  if (!aubMayHaveReplied(labels, lastUserMessageAt)) return false;
  const stampMs = needsAubStampMs(labels);
  return (tail ?? []).some(
    (e) =>
      e.item.type === "user_message" &&
      !isAgentSentPrompt(e.item.text) &&
      Date.parse(e.timestamp) > stampMs,
  );
}

/**
 * The lead is flagged needs-aub and the flag has not been cleared. Drives every 🙋 badge and the queue.
 * Clients never decide "answered": only the NeedsAubWatcher clears the flag, after verifying a human message.
 */
export function isLeadAwaitingAub(lead: { readonly labels?: Readonly<Record<string, string>> }): boolean {
  return isWaitingOnAub(lead.labels);
}
