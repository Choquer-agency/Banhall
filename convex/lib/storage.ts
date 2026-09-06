import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/**
 * Call after removing any discarded row's reference, in the same mutation.
 * Archive, revocation and soft deletion do not release retained original bytes.
 */
export async function deleteStorageIfUnreferenced(
  ctx: MutationCtx,
  storageId: Id<"_storage">,
): Promise<void> {
  if (await ctx.db.query("projectDocuments")
    .withIndex("by_storageId", (q) => q.eq("storageId", storageId)).first()) return;
  if (await ctx.db.query("brainSources")
    .withIndex("by_storageId", (q) => q.eq("storageId", storageId)).first()) return;
  if (await ctx.db.query("ingestionItems")
    .withIndex("by_storageId", (q) => q.eq("storageId", storageId)).first()) return;
  if (await ctx.db.query("ingestionItems")
    .withIndex("by_textStorageId", (q) => q.eq("textStorageId", storageId)).first()) return;

  await ctx.storage.delete(storageId);
}
