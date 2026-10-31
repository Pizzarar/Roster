// Retry bookkeeping for the automatic re-sort that follows a settings change. No imports: loadable under plain Node.

export interface SortOutcome {
  readonly ok: boolean;
}

/**
 * A re-sort that waits for a daemon handle. `request()` marks it pending; it runs as soon as a handle is bound.
 * A rejected or `ok: false` run stays pending (retried on the next bind); an `ok: true` result, including a
 * deliberate no-op (keep-sorted off, already sorted), clears it.
 */
export function createPendingSort<H>(run: (handle: H) => Promise<SortOutcome>, onError: (error: unknown) => void) {
  let handle: H | null = null;
  let pending = false;
  const go = () => {
    if (!pending || handle === null) return;
    pending = false;
    run(handle).then(
      (result) => {
        if (!result.ok) pending = true;
      },
      (error) => {
        pending = true;
        onError(error);
      },
    );
  };
  return {
    request() {
      pending = true;
      go();
    },
    bind(next: H) {
      handle = next;
      go();
    },
    get pending() {
      return pending;
    },
  };
}
