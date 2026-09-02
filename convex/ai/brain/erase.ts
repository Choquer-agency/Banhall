import type { ActionCtx } from "../../_generated/server";
import { brain } from "./rag";

/**
 * The one seam that defines what "erased" means for a Brain RAG entry.
 *
 * `@convex-dev/rag`'s `delete`/`deleteAsync` return `void` and signal nothing,
 * so the ONLY honest confirmation is a positive read: `getEntry` returning
 * `null`. Reading first also avoids `deleteAsync`'s `Entry <id> not found`
 * throw and `deleteSync`'s `_del` on a missing document, so "already absent"
 * can never masquerade as a failure.
 *
 * Deliberately minimal — read, delete, re-read — with no branching beyond the
 * two null checks: it is mocked in tests (convex-test has no registration for the `rag`
 * component), so its own sequence is only exercised against a live deployment.
 *
 * NOT a `"use node"` module — it runs in the default Convex runtime.
 */
export type EraseOutcome = "confirmed" | "already_absent";

export async function eraseBrainEntry(
  ctx: ActionCtx,
  entryId: string
): Promise<EraseOutcome> {
  const entryId_ = entryId as never;
  if ((await brain.getEntry(ctx, { entryId: entryId_ })) === null) {
    return "already_absent";
  }
  await brain.delete(ctx, { entryId: entryId_ });
  if ((await brain.getEntry(ctx, { entryId: entryId_ })) !== null) {
    throw new Error(
      `Brain entry ${entryId} is still present after delete — erasure not confirmed`
    );
  }
  return "confirmed";
}
