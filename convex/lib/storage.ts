import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { domainError } from "./contracts";

/**
 * Every schema field that holds a file, as `table.field`. The storage
 * sweep (`transcripts.sweepUnreferencedStorage`) counts, and once an admin
 * switches it to "delete" deletes, any file older than a day that none of
 * them holds, so `isStorageReferenced` must check each one.
 * `convex/storageSweep.test.ts` walks the schema and fails on a
 * `v.id("_storage")` field missing here, and scans the source for modules
 * that create stored files.
 */
export const STORAGE_REFERENCE_FIELDS = [
  "projectDocuments.storageId",
  "brainSources.storageId",
  "ingestionItems.storageId",
  "ingestionItems.textStorageId",
  "transcripts.originalStorageId",
] as const;

/**
 * Whether any row holds this file: every `v.id("_storage")` field in the
 * schema (`STORAGE_REFERENCE_FIELDS`), through its index.
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
 * How recently a file must have been uploaded for a save to attach it: the
 * browser saves within seconds of its upload, so an hour is generous.
 */
export const FRESH_UPLOAD_MS = 60 * 60 * 1000;

/**
 * Refuses a storage id a save may not attach: a file that is gone, or one
 * uploaded more than FRESH_UPLOAD_MS ago. Convex does not record who
 * uploaded a file, so freshness stands in for "the caller's own upload": an
 * old orphan (an upload whose save never ran, or a file an erased project
 * left behind) cannot be claimed by a project.
 */
export async function requireFreshUpload(
  ctx: QueryCtx | MutationCtx,
  storageId: Id<"_storage">,
  message = "The uploaded file is no longer available. Upload it again.",
): Promise<void> {
  const metadata = await ctx.db.system.get("_storage", storageId);
  if (!metadata || Date.now() - metadata._creationTime > FRESH_UPLOAD_MS) {
    domainError("INVALID_INPUT", message);
  }
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
