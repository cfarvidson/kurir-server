/**
 * Detached per-user background runs that coalesce repeats. `kick` returns at
 * once and never throws: one run per user at a time, and a kick that lands
 * mid-run (or a run that asks for it) schedules exactly one rerun. Failures
 * are logged under `label` and never propagate, so a sync can fire a kick
 * without caring how it ends.
 */
export function createUserKicker(
  label: string,
  run: (userId: string) => Promise<boolean | void>,
) {
  const running = new Set<string>();
  const queued = new Set<string>();

  function kick(userId: string): void {
    if (running.has(userId)) {
      queued.add(userId);
      return;
    }
    running.add(userId);
    void (async () => {
      try {
        do {
          queued.delete(userId);
          try {
            // A run may ask for a rerun (more work left than one bounded
            // pass covers) by resolving true.
            if (await run(userId)) queued.add(userId);
          } catch (err) {
            console.error(`[${label}] run failed for ${userId}`, err);
          }
        } while (queued.has(userId));
      } finally {
        running.delete(userId);
      }
    })();
  }

  /** Test hook: forget in-flight state. */
  function reset(): void {
    running.clear();
    queued.clear();
  }

  return { kick, reset };
}
