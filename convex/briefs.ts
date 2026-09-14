import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { domainError, sha256 } from "./lib/contracts";
import { getInternalProjectAccessOrNull } from "./lib/auth";
import { requireReportEditAccess } from "./lib/roleCapabilities";
import { computeEditDistance } from "./lib/editDistance";

/**
 * Story 4: Read the stored Brief for a generation.
 * Returns the Brief and its entries for the UI to display and edit. Null for
 * an outsider, a missing generation, or a generation with no Brief.
 */
export const getBrief = query({
  args: {
    generationId: v.id("generations"),
  },
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    if (
      !generation ||
      !(await getInternalProjectAccessOrNull(ctx, generation.projectId))
    ) {
      return null;
    }
    if (!generation.briefId) return null;

    const brief = await ctx.db.get(generation.briefId);
    if (!brief) return null;

    const entries = await ctx.db
      .query("generationBriefEntries")
      .withIndex("by_briefId", (q) => q.eq("briefId", brief._id))
      .collect();

    return {
      ...brief,
      entries,
    };
  },
});

/**
 * Story 4: List entries in a Brief version. Null for an outsider and for a
 * Brief that does not exist — the two are indistinguishable by design.
 * Used by the UI panel to display individual entries for editing.
 */
export const listBriefEntries = query({
  args: {
    briefId: v.id("generationBriefs"),
  },
  handler: async (ctx, args) => {
    // Access first: an outsider and a fabricated briefId give the same
    // answer, so a probe cannot tell a real Brief from an invented one.
    const brief = await ctx.db.get(args.briefId);
    if (!brief || !(await getInternalProjectAccessOrNull(ctx, brief.projectId))) {
      return null;
    }

    const entries = await ctx.db
      .query("generationBriefEntries")
      .withIndex("by_briefId", (q) => q.eq("briefId", args.briefId))
      .collect();

    return entries;
  },
});

/**
 * Story 4: Save an edit to a Brief entry.
 *
 * Creates a new Brief version with origin=edited and editMagnitude (changed
 * entries count + Storyline edit distance). The next generation with the same
 * inputsHash reuses this edited version.
 *
 * The entry being edited is copied into the new version with the change applied.
 * All other entries are copied as-is (unchanged).
 *
 * **Errors:**
 * - BRIEF_STALE: the Brief version has changed since the edit was initiated
 * - NOT_FOUND: entry or Brief not found
 */
export const saveEntryEdit = mutation({
  args: {
    projectId: v.id("projects"),
    briefId: v.id("generationBriefs"),
    expectedBriefVersion: v.number(),
    entryId: v.id("generationBriefEntries"),
    // The edited entry fields
    editedText: v.optional(v.string()),
    editedReason: v.optional(v.string()),
    editedConfidence: v.optional(v.string()),
    // For storylineQuestion resolution
    resolvedBy: v.optional(
      v.union(v.literal("use_evidence"), v.literal("keep_storyline"))
    ),
    alternativeText: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Authorize the writer to edit the report for this project
    await requireReportEditAccess(ctx, args.projectId);

    // Load the Brief and validate version (OCC fence). Brief rows are
    // immutable — an edit inserts a NEW row rather than mutating this one —
    // so staleness isn't visible on `brief` itself; it's whether a newer
    // version for this (projectId, inputsHash) already exists.
    const brief = await ctx.db.get(args.briefId);
    if (!brief || brief.projectId !== args.projectId) {
      domainError("NOT_FOUND", "Brief not found");
    }
    const latestForHash = await ctx.db
      .query("generationBriefs")
      .withIndex("by_projectId_and_inputsHash", (q) =>
        q.eq("projectId", brief.projectId).eq("inputsHash", brief.inputsHash)
      )
      .order("desc")
      .first();
    if (
      !latestForHash ||
      latestForHash._id !== brief._id ||
      brief.version !== args.expectedBriefVersion
    ) {
      domainError("BRIEF_STALE", "The Brief was edited before this save completed");
    }

    // Load the entry being edited
    const entry = await ctx.db.get(args.entryId);
    if (!entry || entry.briefId !== args.briefId) {
      domainError("NOT_FOUND", "Brief entry not found");
    }

    // Build the edited entry (only change the specified field)
    const editedEntry = { ...entry };
    if (args.editedText !== undefined) {
      editedEntry.text = args.editedText;
    }
    if (args.editedReason !== undefined && entry.group === "claimExclusion") {
      editedEntry.reason = args.editedReason as any;
    }
    if (args.editedConfidence !== undefined && entry.group === "confidenceMap") {
      editedEntry.confidence = args.editedConfidence as any;
    }

    // Handle storylineQuestion resolution
    if (
      entry.group === "storylineQuestion" &&
      args.resolvedBy &&
      entry.question
    ) {
      editedEntry.question = {
        ...entry.question,
        resolvedBy: args.resolvedBy,
        alternativeText:
          args.resolvedBy === "use_evidence" ? args.alternativeText : undefined,
      };
    }

    // Compute editMagnitude: count changed entries and Storyline edit distance
    const allEntries = await ctx.db
      .query("generationBriefEntries")
      .withIndex("by_briefId", (q) => q.eq("briefId", args.briefId))
      .collect();

    let changedEntriesCount = 0;
    let storylineEditDistance = 0;

    for (const oldEntry of allEntries) {
      if (oldEntry._id.toString() === args.entryId.toString()) {
        // This is the edited entry
        if (
          oldEntry.text !== editedEntry.text ||
          oldEntry.reason !== editedEntry.reason ||
          oldEntry.confidence !== editedEntry.confidence
        ) {
          changedEntriesCount++;
        }

        // If editing a Storyline entry, compute edit distance
        if (oldEntry.group === "storyline") {
          const result = computeEditDistance(
            oldEntry.text,
            editedEntry.text
          );
          storylineEditDistance = result.ped;
        }
      }
    }

    // For Storyline entry edits, update the Brief's storylineText
    let newStorylineText = brief.storylineText;
    if (entry.group === "storyline") {
      newStorylineText = args.editedText || brief.storylineText;
    }

    // Create a new Brief version with origin=edited
    const newBriefId = await ctx.db.insert("generationBriefs", {
      projectId: args.projectId,
      generationId: brief.generationId,
      inputsHash: brief.inputsHash,
      version: brief.version + 1,
      origin: "edited",
      storylineText: newStorylineText,
      editMagnitude: {
        changedEntriesCount,
        storylineEditDistance,
      },
      createdAt: Date.now(),
    });

    // Copy all entries to the new Brief version
    for (const oldEntry of allEntries) {
      const newEntry = { ...oldEntry };
      newEntry.briefId = newBriefId;
      newEntry.createdAt = Date.now();

      if (oldEntry._id.toString() === args.entryId.toString()) {
        // Apply the edit to this entry
        newEntry.text = editedEntry.text;
        if (editedEntry.reason !== undefined) {
          newEntry.reason = editedEntry.reason;
        }
        if (editedEntry.confidence !== undefined) {
          newEntry.confidence = editedEntry.confidence;
        }
        if (editedEntry.question !== undefined) {
          newEntry.question = editedEntry.question;
        }
      }

      // Remove the _id and _creationTime before re-inserting
      const { _id, _creationTime, ...entryFields } = newEntry;
      await ctx.db.insert("generationBriefEntries", entryFields as any);
    }

    return newBriefId;
  },
});
