/**
 * The deployment's write rate (owner, 2026-10-28, question 14). A Convex
 * deployment refuses a mutation when everything together writes more than
 * its limit per second ("Too many writes per second", code TooManyWrites;
 * 4 MiB on the local backend). The F5 stress run saw two large drafts
 * started in the same second fail this way while files were being cut into
 * search pieces and labelled. A refused mutation keeps nothing it wrote, so
 * sending it again is safe; a draft's start does, briefly, before failing.
 */

/** Waits before each new try, in milliseconds; about 4 to 6 seconds in all. */
export const WRITE_RETRY_DELAYS_MS: readonly number[] = [250, 500, 1_000, 2_000];

/** Whether an error is the deployment refusing a write for its write rate. */
export function isWriteRateLimitError(error: unknown): boolean {
  const text =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return text.includes("TooManyWrites") || text.includes("Too many writes per second");
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Sends `send` and, while the write rate refuses it, sends it again after
 * each wait in WRITE_RETRY_DELAYS_MS, each stretched by up to half again so
 * two starts refused together do not try again together. Any other error,
 * or the last refusal, is thrown as it came.
 */
export async function retryOnWriteLimit<T>(
  send: () => Promise<T>,
  options: { wait?: (ms: number) => Promise<void>; random?: () => number } = {}
): Promise<T> {
  const wait = options.wait ?? sleep;
  const random = options.random ?? Math.random;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await send();
    } catch (error) {
      const delay = WRITE_RETRY_DELAYS_MS[attempt];
      if (delay === undefined || !isWriteRateLimitError(error)) throw error;
      await wait(delay + Math.floor(random() * (delay / 2)));
    }
  }
}

/** A mutation function that tries again while the write rate refuses it. */
export function withWriteRetry<A extends unknown[], R>(
  send: (...args: A) => Promise<R>
): (...args: A) => Promise<R> {
  return (...args: A) => retryOnWriteLimit(() => send(...args));
}
