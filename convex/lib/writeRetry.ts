import type { ActionCtx } from "../_generated/server";
import { retryOnWriteLimit } from "../../shared/writeLimit";
import { actionDeadline, RESERVED_NON_REQUEST_MS } from "../ai/actionDeadline";

/** Time kept free before the Convex action limit: a wait never runs into it. */
export const WRITE_RETRY_END_MARGIN_MS = 15_000;

/**
 * The action's ctx with every mutation it runs, and every function it
 * schedules, sent again while the deployment's write rate refuses it (owner,
 * 2026-10-28, question 14; `retryOnWriteLimit`). A refused mutation or
 * schedule keeps nothing, so this is safe for any of them. Wrap once, at the
 * top of the handler, and use the wrapped ctx for everything: the action's
 * deadline is keyed by its ctx (actionDeadline.ts). A wait that would run
 * within WRITE_RETRY_END_MARGIN_MS of the Convex action limit is not taken;
 * the refusal is thrown instead, so the action can still record it.
 */
export function withWriteRetries<C extends Pick<ActionCtx, "runMutation" | "scheduler">>(ctx: C): C {
  const wrapped = { ...ctx } as C;
  const mayWait = (ms: number) => {
    const deadline = actionDeadline(wrapped);
    if (deadline === undefined) return true;
    return Date.now() + ms < deadline + RESERVED_NON_REQUEST_MS - WRITE_RETRY_END_MARGIN_MS;
  };
  type AnyCall = (...args: unknown[]) => Promise<unknown>;
  const retried =
    (call: AnyCall): AnyCall =>
    (...args) =>
      retryOnWriteLimit(() => call(...args), { mayWait });
  wrapped.runMutation = retried(ctx.runMutation.bind(ctx) as unknown as AnyCall) as unknown as C["runMutation"];
  if (ctx.scheduler) {
    const scheduler = ctx.scheduler;
    wrapped.scheduler = {
      ...scheduler,
      ...(scheduler.runAfter ? { runAfter: retried(scheduler.runAfter.bind(scheduler) as unknown as AnyCall) } : {}),
      ...(scheduler.runAt ? { runAt: retried(scheduler.runAt.bind(scheduler) as unknown as AnyCall) } : {}),
    } as unknown as C["scheduler"];
  }
  return wrapped;
}
