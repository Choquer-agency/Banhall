/** convex-test accepts maxIterations at runtime, but its published type omits it. */
export async function drainScheduledFunctions(
  test: { finishAllScheduledFunctions: (advanceTimers: () => void) => Promise<void> },
  advanceTimers: () => void
): Promise<void> {
  const drain = test.finishAllScheduledFunctions as (
    advanceTimers: () => void,
    maxIterations: number
  ) => Promise<void>;
  await drain.call(test, advanceTimers, 250);
}
