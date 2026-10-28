/**
 * The deployment's write rate (owner, 2026-10-28, question 14). A Convex
 * deployment refuses a mutation when everything together writes more than
 * its limit per second ("Too many writes per second", code TooManyWrites;
 * 4 MiB on the local backend). The F5 stress run saw two large drafts
 * started in the same second fail this way while files were being cut into
 * search pieces and labelled. A refused mutation keeps nothing it wrote, so
 * sending it again is safe; a draft's start does, briefly, before failing.
 *
 * The browser needs none of this: on a refusal the deployment closes the
 * WebSocket (code 1013, TooManyWrites) and the Convex client sends the
 * mutation again once it reconnects, with no error for the page (seen live,
 * 2026-10-28). Actions and the HTTP client do get the error.
 */

/**
 * Waits before each new try, in milliseconds: about 16 to 24 seconds in all.
 * The first four alone (about 4 to 6 seconds) lost to a 12-second burst on
 * the live check (review round 1, 2026-10-28).
 */
export const WRITE_RETRY_DELAYS_MS: readonly number[] = [250, 500, 1_000, 2_000, 4_000, 8_000];

/**
 * Whether an error is the deployment refusing a write for its write rate.
 * By its words only: the code TooManyWrites may also name one function's
 * own write limit, which fails the same way every time (review, 2026-10-28).
 */
export function isWriteRateLimitError(error: unknown): boolean {
  const text =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return text.includes("Too many writes per second");
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
  options: {
    wait?: (ms: number) => Promise<void>;
    random?: () => number;
    /** False when a wait of `ms` would leave too little time (an action's deadline). */
    mayWait?: (ms: number) => boolean;
  } = {}
): Promise<T> {
  const wait = options.wait ?? sleep;
  const random = options.random ?? Math.random;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await send();
    } catch (error) {
      const delay = WRITE_RETRY_DELAYS_MS[attempt];
      if (delay === undefined || !isWriteRateLimitError(error)) throw error;
      const ms = delay + Math.floor(random() * (delay / 2));
      if (options.mayWait && !options.mayWait(ms)) throw error;
      await wait(ms);
    }
  }
}
