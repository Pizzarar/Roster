// Pure clear/snooze logic for raised hands. No imports, so scripts/test-clear-hand.ts can load this under plain Node.
export const CLEARED_BY_LABEL = "needs-aub-cleared-by";
export const CLEARED_AT_LABEL = "needs-aub-cleared-at";
export const SNOOZE_UNTIL_LABEL = "needs-aub-snooze-until";
/** The `needs-aub-at` value of the flag that was snoozed; a different (newer) flag is never hidden by it. */
export const SNOOZE_AT_LABEL = "needs-aub-snooze-at";

/** Window the UI locks a clear/snooze button for, and the server ignores a repeat within. */
export const CLEAR_HAND_DEDUPE_MS = 4_000;
export const SNOOZE_MS = 60 * 60_000;

/** Same end state as the NeedsAubWatcher's clear after a human reply, plus who/when, and any snooze dropped. */
export function clearHandLabels(nowMs: number): Record<string, string> {
  return {
    "needs-aub": "cleared",
    "needs-aub-at": "",
    "needs-aub-reason": "",
    [CLEARED_BY_LABEL]: "aub",
    [CLEARED_AT_LABEL]: new Date(nowMs).toISOString(),
    [SNOOZE_UNTIL_LABEL]: "",
    [SNOOZE_AT_LABEL]: "",
  };
}

export function snoozeHandLabels(flagAt: string, nowMs: number): Record<string, string> {
  return {
    [SNOOZE_UNTIL_LABEL]: new Date(nowMs + SNOOZE_MS).toISOString(),
    [SNOOZE_AT_LABEL]: flagAt,
  };
}

/**
 * Display-only: hidden while the snooze is unexpired and keyed to the flag's current `needs-aub-at`.
 * An unhandled flag (a fresh reason the watcher hasn't routed yet) is a re-flag and always shows.
 */
export function isHandSnoozed(labels: Readonly<Record<string, string>> | undefined, nowMs: number): boolean {
  const until = Date.parse(labels?.[SNOOZE_UNTIL_LABEL] ?? "");
  if (!Number.isFinite(until) || nowMs >= until) return false;
  if (labels?.["needs-aub"]?.trim().toLowerCase() !== "handled") return false;
  const at = labels?.["needs-aub-at"]?.trim();
  return !!at && labels?.[SNOOZE_AT_LABEL]?.trim() === at;
}

/** True when a repeat of the same action for a lead falls inside the dedupe window. */
export function isDuplicateClick(lastMs: number | undefined, nowMs: number, windowMs = CLEAR_HAND_DEDUPE_MS): boolean {
  return lastMs !== undefined && nowMs - lastMs < windowMs;
}
