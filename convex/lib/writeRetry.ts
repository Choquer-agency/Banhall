import type { ActionCtx } from "../_generated/server";
import { retryOnWriteLimit } from "../../shared/writeLimit";

/**
 * The action's ctx with every mutation it runs sent again while the
 * deployment's write rate refuses it (owner, 2026-10-28, question 14;
 * `retryOnWriteLimit`). A refused mutation keeps nothing it wrote, so this
 * is safe for any mutation. Wrap once, at the top of the handler, and use
 * the wrapped ctx for everything: the action's deadline is keyed by its ctx
 * (actionDeadline.ts).
 */
export function withWriteRetries<C extends Pick<ActionCtx, "runMutation">>(ctx: C): C {
  const runMutation = ((reference: Parameters<C["runMutation"]>[0], ...rest: unknown[]) =>
    retryOnWriteLimit(() =>
      (ctx.runMutation as (reference: unknown, ...args: unknown[]) => Promise<unknown>)(reference, ...rest)
    )) as C["runMutation"];
  return { ...ctx, runMutation };
}
