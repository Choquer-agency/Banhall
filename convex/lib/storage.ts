import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/**
 * Whether any row holds this file: every `v.id("_storage")` field in the
 * schema, through its index.
 */
export async function isStorageReferenced(
  ctx: QueryCtx | MutationCtx,
  storageId: Id<"_storage">,
): Promise<boolean> {
  if (await ctx.db.query("projectDocuments")
    .withIndex("by_storageId", (q) => q.eq("storageId", storageId)).first()) return true;
  if (await ctx.db.query("brainSources")
    .withIndex("by_storageId", (q) => q.eq("storageId", storageId)).first()) return true;
  if (await ctx.db.query("ingestionItems")
    .withIndex("by_storageId", (q) => q.eq("storageId", storageId)).first()) return true;
  if (await ctx.db.query("ingestionItems")
    .withIndex("by_textStorageId", (q) => q.eq("textStorageId", storageId)).first()) return true;
  if (await ctx.db.query("transcripts")
    .withIndex("by_originalStorageId", (q) => q.eq("originalStorageId", storageId)).first()) return true;
  return false;
}

/**
 * Call after removing any discarded row's reference, in the same mutation.
 * Archive, revocation and soft deletion do not release retained original bytes.
 */
export async function deleteStorageIfUnreferenced(
  ctx: MutationCtx,
  storageId: Id<"_storage">,
): Promise<void> {
  if (await isStorageReferenced(ctx, storageId)) return;
  await ctx.storage.delete(storageId);
}
