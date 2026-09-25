/**
 * Action time limit for provider requests (2026-09-25, cutoff review P2-2).
 *
 * A generation action can make several model calls one after another, and
 * one structured call can make two requests (the cut-off or malformed-answer
 * repair), each with its own timeout and SDK retry. Their sum could pass
 * Convex's 600 s action limit, and a killed action leaves its rows "running"
 * until the stale reaper finds them. So each generation action records its
 * deadline on its ActionCtx when it starts, and the two gateway transports
 * (instrumentedAnthropic, openRouterChatCompletion) read it before every
 * request:
 *
 * - With less than MIN_USEFUL_REQUEST_MS left, the request is not sent. It
 *   fails at once with ActionTimeBudgetError, which the action's own failure
 *   handling turns into the writer-facing state. It never counts as a model
 *   fault (modelFaultCode).
 * - Otherwise the request's timeout is cut to the time left, and a transport
 *   retry is allowed only when every attempt, at that timeout, plus the
 *   retry backoff still fits.
 * - An attempt that timed out on a timeout cut short by the deadline also
 *   fails with ActionTimeBudgetError: the time ran out, not the model.
 *
 * Only transport options change. Request bodies are never touched, and an
 * action that records no deadline sends exactly what it sent before.
 *
 * Pure: no Convex runtime imports, so the arithmetic unit-tests directly.
 */

/** Convex terminates an action after 10 minutes of wall time. */
export const CONVEX_ACTION_LIMIT_MS = 600_000;

/**
 * Named reserve for every part of the action that is not a provider request
 * in flight: SDK retry backoff (at most 8 s per retry by default, more only
 * if the provider sends Retry-After), the claim and frozen-input reads before
 * the first call, banned-word scrubs and section metrics between calls, and
 * claim hashing plus the provenance and candidate writes (or the failure
 * write) after the last one. 60 s is the spec floor and is conservative
 * against that work.
 */
export const RESERVED_NON_REQUEST_MS = 60_000;

/**
 * Wall time, from the action's start, by which every provider request must
 * have finished: the action limit less the reserve for the work around the
 * requests, including the failure write when time runs out.
 */
export const ACTION_REQUEST_WINDOW_MS = CONVEX_ACTION_LIMIT_MS - RESERVED_NON_REQUEST_MS;

/**
 * Below this much time left a request is not sent. A shorter request would
 * almost always time out on a real answer, after being billed for it.
 */
export const MIN_USEFUL_REQUEST_MS = 20_000;

/**
 * The longest default backoff the Anthropic SDK sleeps before its retry
 * (0.5 s doubling to an 8 s cap). A retry is allowed only if the attempts
 * and this sleep fit the time left.
 */
export const MAX_SDK_RETRY_BACKOFF_MS = 8_000;

/** What the writer sees when a step runs out of time. No colon: it is shown as is. */
export const ACTION_TIME_BUDGET_MESSAGE =
  "This step ran out of time before the AI could finish, so it was stopped. Try again, or choose a faster model if it keeps happening.";

/**
 * Not enough time was left in the action to wait for a model answer. Our
 * own arithmetic, never the model's fault: it is not counted in the error
 * rate that can roll a model back.
 */
export class ActionTimeBudgetError extends Error {
  constructor() {
    super(ACTION_TIME_BUDGET_MESSAGE);
    this.name = "ActionTimeBudgetError";
  }
}

const deadlines = new WeakMap<object, number>();

/**
 * Records the deadline of the action that owns `ctx`: `startedAt` (the
 * handler's first line) plus ACTION_REQUEST_WINDOW_MS. Call once, at the top
 * of each generation action handler. Returns the deadline.
 */
export function startActionDeadline(ctx: object, startedAt: number = Date.now()): number {
  const deadline = startedAt + ACTION_REQUEST_WINDOW_MS;
  deadlines.set(ctx, deadline);
  return deadline;
}

/** The deadline recorded for `ctx`, or undefined when its action set none. */
export function actionDeadline(ctx: object): number | undefined {
  return deadlines.get(ctx);
}

/** The transport options one request may use. */
export type RequestBudget = {
  /** Per-attempt timeout: the transport default, or less near the deadline. */
  timeoutMs: number;
  /** Transport retries: the default, or fewer when they would not fit. */
  maxRetries: number;
  /** True when the deadline cut the timeout below the transport default. */
  shortened: boolean;
};

/**
 * The options a request may use at `now`, given the deadline and the
 * transport defaults. Undefined deadline: the defaults, unchanged. Throws
 * ActionTimeBudgetError when less than MIN_USEFUL_REQUEST_MS is left.
 */
export function requestBudget(args: {
  deadline: number | undefined;
  now: number;
  timeoutMs: number;
  maxRetries: number;
  backoffMs?: number;
}): RequestBudget {
  const { deadline, now, timeoutMs, maxRetries } = args;
  if (deadline === undefined) return { timeoutMs, maxRetries, shortened: false };
  const remaining = deadline - now;
  if (remaining < MIN_USEFUL_REQUEST_MS) throw new ActionTimeBudgetError();
  const timeout = Math.min(timeoutMs, remaining);
  const backoff = args.backoffMs ?? MAX_SDK_RETRY_BACKOFF_MS;
  let retries = maxRetries;
  while (retries > 0 && (retries + 1) * timeout + retries * backoff > remaining) retries -= 1;
  return { timeoutMs: timeout, maxRetries: retries, shortened: timeout < timeoutMs };
}
