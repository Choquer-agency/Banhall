/**
 * Self-service profile photo (WS1 spec section 6, decision 54: 5 MB cap,
 * PNG or JPG only).
 *
 * Upload flow, reusing the document upload machinery unchanged:
 * `documents.generateUploadUrl` -> POST the file -> `documents.claimUpload`
 * -> `account.setMyPhoto`. The claim proves the caller uploaded the file
 * (Convex does not record uploaders).
 *
 * A refused file cannot be deleted by `setMyPhoto` itself: a mutation that
 * throws rolls back every write, storage deletes included. The browser
 * releases a refused upload with `transcripts.discardTranscriptOriginals`
 * (it deletes the caller's own claimed, unreferenced upload from the last
 * hour); anything left over goes with the daily storage sweep, like every
 * other refused upload (`convex/lib/storage.ts`).
 */
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation } from "./_generated/server";
import { requireInternalActor } from "./lib/auth";
import { domainError } from "./lib/contracts";
import {
  FRESH_UPLOAD_MS,
  deleteStorageIfUnreferenced,
  isStorageReferenced,
  uploadClaimFor,
} from "./lib/storage";

/** Largest photo a person may save (decision 54). */
export const PROFILE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
/** Photo types a person may save (decision 54: image types, PNG or JPG). */
export const PROFILE_PHOTO_CONTENT_TYPES = ["image/png", "image/jpeg"] as const;

const UPLOAD_AGAIN = "The uploaded photo is no longer available. Upload it again.";

/**
 * Sets the caller's photo to a file they uploaded and claimed in the last
 * hour. Refuses another person's upload, a file a row already holds, a type
 * other than PNG or JPG, and anything over 5 MB. The previous photo is
 * released once no row holds it. Setting the current photo again is a no-op.
 */
export const setMyPhoto = mutation({
  args: { storageId: v.id("_storage") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireInternalActor(ctx);
    if (user.imageStorageId === args.storageId) return null;

    const claim = await uploadClaimFor(ctx, args.storageId);
    if (
      !claim ||
      claim.userId !== user._id ||
      Date.now() - claim.claimedAt > FRESH_UPLOAD_MS
    ) {
      domainError("INVALID_INPUT", UPLOAD_AGAIN);
    }
    const metadata = await ctx.db.system.get("_storage", args.storageId);
    if (!metadata) domainError("INVALID_INPUT", UPLOAD_AGAIN);
    if (await isStorageReferenced(ctx, args.storageId)) {
      domainError("INVALID_INPUT", "The uploaded file is already in use. Upload it again.");
    }
    const contentType = metadata.contentType?.toLowerCase();
    if (
      !contentType ||
      !(PROFILE_PHOTO_CONTENT_TYPES as readonly string[]).includes(contentType)
    ) {
      domainError("INVALID_INPUT", "Use a PNG or JPG file.");
    }
    if (metadata.size > PROFILE_PHOTO_MAX_BYTES) {
      domainError("INVALID_INPUT", "That photo is over 5 MB.");
    }

    const previous = user.imageStorageId;
    await ctx.db.patch(user._id, { imageStorageId: args.storageId });
    // The claim has done its job: the user row now holds the file.
    await ctx.db.delete(claim._id);
    if (previous) await deleteStorageIfUnreferenced(ctx, previous);
    return null;
  },
});

/** Clears the caller's photo and releases the file once no row holds it. */
export const removeMyPhoto = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const user = await requireInternalActor(ctx);
    const previous: Id<"_storage"> | undefined = user.imageStorageId;
    if (!previous) return null;
    await ctx.db.patch(user._id, { imageStorageId: undefined });
    await deleteStorageIfUnreferenced(ctx, previous);
    return null;
  },
});
