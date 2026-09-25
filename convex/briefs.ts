import { query, mutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { domainError } from "./lib/contracts";
import { getInternalProjectAccessOrNull } from "./lib/auth";
import {
  getReportEditAccessOrNull,
  requireReportEditAccess,
} from "./lib/roleCapabilities";
import { computeEditDistance } from "./lib/editDistance";
import { resolveGatedWorkflow } from "./lib/gatedWorkflow";
import { endsWithClipMark } from "./lib/seedRevisions";
// One definition per bound: the generation-side reader owns it. `generations.ts`
// imports nothing from this file, so this direction introduces no cycle.
import { MAX_BRIEF_ENTRY_ROWS } from "./generations";

const eligibilityReasonValidator = v.union(
  v.literal("business_risk"),
  v.literal("routine_engineering"),
  v.literal("outside_claim_period"),
  v.literal("not_technological")
);

const confidenceValidator = v.union(
  v.literal("established"),
  v.literal("partial"),
  v.literal("unresolved"),
  v.literal("unreliable")
);

type StorylineOrigin = "writer" | "derived" | "edited";

function storylineOriginOf(brief: Doc<"generationBriefs">): StorylineOrigin {
  return brief.storylineOrigin ?? brief.origin;
}

/** The newest version for this Brief's (projectId, inputsHash) — story 1's MAX(version). */
async function latestVersionOf(ctx: QueryCtx, brief: Doc<"generationBriefs">) {
  return await ctx.db
    .query("generationBriefs")
    .withIndex("by_projectId_and_inputsHash", (q) =>
      q.eq("projectId", brief.projectId).eq("inputsHash", brief.inputsHash)
    )
    .order("desc")
    .first();
}

async function partitionedBriefEntries(
  ctx: QueryCtx | MutationCtx,
  briefId: Id<"generationBriefs">
) {
  const [immutableInput, generatedOutput] = await Promise.all([
    ctx.db
      .query("generationBriefEntries")
      .withIndex("by_briefId_and_generatedOutput", (q) =>
        q.eq("briefId", briefId).eq("generatedOutput", undefined))
      .take(MAX_BRIEF_ENTRY_ROWS + 1),
    ctx.db
      .query("generationBriefEntries")
      .withIndex("by_briefId_and_generatedOutput", (q) =>
        q.eq("briefId", briefId).eq("generatedOutput", true))
      .take(MAX_BRIEF_ENTRY_ROWS + 1),
  ]);
  return { immutableInput, generatedOutput };
}

async function briefEntries(ctx: QueryCtx, briefId: Id<"generationBriefs">) {
  const { immutableInput, generatedOutput } = await partitionedBriefEntries(
    ctx,
    briefId
  );
  return [
    ...immutableInput.slice(0, MAX_BRIEF_ENTRY_ROWS),
    ...generatedOutput.slice(0, MAX_BRIEF_ENTRY_ROWS),
  ]
    .sort((left, right) => left._creationTime - right._creationTime);
}

/**
 * The entries a new version copies. Reads one past the bound and refuses
 * rather than writing a silent prefix: a truncated READ is recoverable, a
 * truncated write would drop entries 501+ from every later version.
 */
async function briefEntriesToCopy(
  ctx: MutationCtx,
  brief: Doc<"generationBriefs">
) {
  const { immutableInput, generatedOutput } = await partitionedBriefEntries(
    ctx,
    brief._id
  );
  const project = await ctx.db.get(brief.projectId);
  const originGeneration = await ctx.db.get(brief.generationId);
  let admissionGeneration = originGeneration;
  if (project?.activeGenerationId) {
    const activeGeneration = await ctx.db.get(project.activeGenerationId);
    const activeBrief = activeGeneration?.briefId
      ? await ctx.db.get(activeGeneration.briefId)
      : null;
    if (
      activeGeneration?.projectId === brief.projectId &&
      activeBrief?.inputsHash === brief.inputsHash
    ) {
      admissionGeneration = activeGeneration;
    }
  }
  if (!admissionGeneration || admissionGeneration.projectId !== brief.projectId) {
    domainError("INVALID_STATE", "This Brief's workflow context is unavailable");
  }
  const summaryAdmission = resolveGatedWorkflow(admissionGeneration) === "seeds";
  if (
    immutableInput.length > MAX_BRIEF_ENTRY_ROWS ||
    (!summaryAdmission &&
      immutableInput.length + generatedOutput.length > MAX_BRIEF_ENTRY_ROWS)
  ) {
    domainError(
      "INVALID_STATE",
      `This Brief has more than ${MAX_BRIEF_ENTRY_ROWS} entries and cannot be edited`
    );
  }
  if (generatedOutput.length > MAX_BRIEF_ENTRY_ROWS) {
    domainError(
      "INVALID_STATE",
      `This Brief has more than ${MAX_BRIEF_ENTRY_ROWS} generated questions and cannot be edited`
    );
  }
  return {
    admissionGenerationId: admissionGeneration._id,
    entries: [...immutableInput, ...generatedOutput]
      .sort((left, right) => left._creationTime - right._creationTime),
  };
}

/**
 * Story 4: the Brief the rail shows for a generation — the latest version for
 * the generation's (projectId, inputsHash), which is the one the next
 * identical-input run reuses. `editedSinceGeneration` is therefore a stored
 * fact (`latest._id !== generation.briefId`), not a client flag. Null for an
 * outsider, a missing generation, or a generation with no Brief.
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
    const generationBrief = await ctx.db.get(generation.briefId);
    if (!generationBrief) return null;
    const latest = (await latestVersionOf(ctx, generationBrief)) ?? generationBrief;

    const entries = await briefEntries(ctx, latest._id);
    const sourceIds = [...new Set(entries.map((entry) => entry.sourceId))];
    const sources = new Map<
      Id<"generationSources">,
      { label: string; kind: Doc<"generationSources">["kind"] }
    >();
    for (const sourceId of sourceIds) {
      const source = await ctx.db.get(sourceId);
      if (source) sources.set(sourceId, { label: source.label, kind: source.kind });
    }

    return {
      ...latest,
      storylineOrigin: storylineOriginOf(latest),
      entries: entries.map((entry) => ({
        ...entry,
        source: sources.get(entry.sourceId) ?? null,
      })),
      generationBriefId: generationBrief._id,
      editedSinceGeneration: latest._id !== generation.briefId,
      runBriefVersionId: generation.briefVersionId ?? generation.briefId,
      runBriefVersion:
        generation.briefVersionId === latest._id || generation.briefId === latest._id
          ? latest.version
          : (await ctx.db.get(generation.briefVersionId ?? generation.briefId))?.version ?? null,
      latestBriefVersionId: latest._id,
      appliesToNextGeneration:
        resolveGatedWorkflow(generation) === "seeds" &&
        generation.briefVersionId !== undefined &&
        latest._id !== generation.briefVersionId,
      regenerationDisabled:
        generation.status === "reserved" ||
        generation.status === "running" ||
        generation.status === "awaiting_selection" ||
        generation.status === "awaiting_input",
      canEdit: (await getReportEditAccessOrNull(ctx, latest.projectId)) !== null,
    };
  },
});

/**
 * Story 4: List entries in a Brief version. Null for an outsider and for a
 * Brief that does not exist — the two are indistinguishable by design.
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
    return await briefEntries(ctx, args.briefId);
  },
});

/**
 * Story 4: Save one Brief edit. The only Brief writer actions are: supply a
 * Storyline (type into an empty one), edit the Storyline or an entry, or
 * resolve a Storyline question.
 *
 * Every save inserts a NEW version (origin `edited`, with its edit
 * magnitude) and never mutates a row; the next generation with the same
 * inputsHash reuses that version. A save whose text equals the current text
 * inserts nothing and returns the current briefId.
 *
 * - `editedStorylineText`: the Brief-level Storyline (`storylineText`).
 * - `entryId` + `editedText`/`editedReason`/`editedConfidence`: one entry.
 *   Editing a `storyline` claim changes that claim, never `storylineText`.
 * - `entryId` + `resolvedBy`: resolve a Storyline question. `use_evidence`
 *   sets `storylineText` to the question's alternative.
 *
 * **Errors:**
 * - BRIEF_STALE: the Brief version has changed since the edit was initiated
 * - NOT_FOUND: entry or Brief not found
 * - INVALID_INPUT: empty text, or no (or more than one) edit target
 */
export const saveEntryEdit = mutation({
  args: {
    projectId: v.id("projects"),
    briefId: v.id("generationBriefs"),
    expectedBriefVersion: v.number(),
    // The Brief-level Storyline.
    editedStorylineText: v.optional(v.string()),
    // One entry.
    entryId: v.optional(v.id("generationBriefEntries")),
    editedText: v.optional(v.string()),
    editedReason: v.optional(eligibilityReasonValidator),
    editedConfidence: v.optional(confidenceValidator),
    // For storylineQuestion resolution
    resolvedBy: v.optional(
      v.union(v.literal("use_evidence"), v.literal("keep_storyline"))
    ),
    alternativeText: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"generationBriefs">> => {
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
    const latestForHash = await latestVersionOf(ctx, brief);
    if (
      !latestForHash ||
      latestForHash._id !== brief._id ||
      brief.version !== args.expectedBriefVersion
    ) {
      domainError("BRIEF_STALE", "The Brief was edited before this save completed");
    }

    const editsStoryline = args.editedStorylineText !== undefined;
    const editsEntry = args.entryId !== undefined;
    if (editsStoryline === editsEntry) {
      domainError("INVALID_INPUT", "Name exactly one thing to edit: the Storyline or one entry");
    }

    let newStorylineText = brief.storylineText;
    // A question resolution rewrites the Storyline from the section's
    // evidence, never from the writer's own typing.
    let resolvedFromEvidence = false;
    let targetId: Id<"generationBriefEntries"> | null = null;
    let entryPatch: Partial<Doc<"generationBriefEntries">> = {};
    let entryChanged = false;

    if (args.editedStorylineText !== undefined) {
      if (!args.editedStorylineText.trim()) {
        domainError("INVALID_INPUT", "The Storyline cannot be empty");
      }
      newStorylineText = args.editedStorylineText;
    } else if (args.entryId !== undefined) {
      const entry = await ctx.db.get(args.entryId);
      if (!entry || entry.briefId !== args.briefId) {
        domainError("NOT_FOUND", "Brief entry not found");
      }
      targetId = entry._id;

      if (args.resolvedBy !== undefined) {
        if (entry.group !== "storylineQuestion" || !entry.question) {
          domainError("INVALID_INPUT", "Only a Storyline question can be resolved");
        }
        if (entry.question.resolvedBy === undefined) {
          const alternative =
            args.resolvedBy === "use_evidence"
              ? (args.alternativeText ?? entry.question.alternativeText)
              : undefined;
          if (args.resolvedBy === "use_evidence") {
            if (!alternative?.trim()) {
              domainError("INVALID_INPUT", "The section's evidence has no Storyline text");
            }
            // A question stored before clipped questions were withheld can
            // carry a shortened alternative. It must never become the whole
            // Storyline; the writer's own text is theirs to choose.
            if (args.alternativeText === undefined && endsWithClipMark(alternative)) {
              domainError(
                "INVALID_INPUT",
                "This suggested Storyline was cut short, so it can't replace your Storyline. Edit the Storyline yourself instead."
              );
            }
            newStorylineText = alternative;
            resolvedFromEvidence = true;
          }
          entryPatch = {
            question: {
              ...entry.question,
              resolvedBy: args.resolvedBy,
              alternativeText:
                args.resolvedBy === "use_evidence" ? alternative : entry.question.alternativeText,
            },
          };
          entryChanged = true;
        }
      } else {
        if (args.editedText !== undefined) {
          if (!args.editedText.trim()) {
            domainError("INVALID_INPUT", "An entry cannot be empty");
          }
          if (args.editedText !== entry.text) {
            entryPatch.text = args.editedText;
            entryChanged = true;
          }
        }
        if (
          args.editedReason !== undefined &&
          entry.group === "claimExclusion" &&
          args.editedReason !== entry.reason
        ) {
          entryPatch.reason = args.editedReason;
          entryChanged = true;
        }
        if (
          args.editedConfidence !== undefined &&
          entry.group === "confidenceMap" &&
          args.editedConfidence !== entry.confidence
        ) {
          entryPatch.confidence = args.editedConfidence;
          entryChanged = true;
        }
      }
    }

    const storylineChanged = newStorylineText !== brief.storylineText;
    // Unchanged save: nothing to record, and no new version.
    if (!storylineChanged && !entryChanged) return brief._id;

    const previousOrigin = storylineOriginOf(brief);
    const storylineOrigin: StorylineOrigin = !storylineChanged
      ? previousOrigin
      : !resolvedFromEvidence && !brief.storylineText.trim() && newStorylineText.trim()
        ? "writer"
        : "edited";

    const { admissionGenerationId, entries } = await briefEntriesToCopy(ctx, brief);
    const now = Date.now();
    const newBriefId = await ctx.db.insert("generationBriefs", {
      projectId: args.projectId,
      generationId: admissionGenerationId,
      inputsHash: brief.inputsHash,
      version: brief.version + 1,
      origin: "edited",
      storylineOrigin,
      storylineText: newStorylineText,
      editMagnitude: {
        changedEntriesCount: entryChanged ? 1 : 0,
        storylineEditDistance: storylineChanged
          ? computeEditDistance(brief.storylineText, newStorylineText).ped
          : 0,
      },
      createdAt: now,
    });

    // Copy every entry into the new version; the edited one carries the
    // change and `edited: true` (its reason chip and citation stay).
    for (const entry of entries) {
      const { _id, _creationTime, ...fields } = entry;
      await ctx.db.insert("generationBriefEntries", {
        ...fields,
        ...(_id === targetId ? { ...entryPatch, edited: true } : {}),
        briefId: newBriefId,
        createdAt: now,
      });
    }

    return newBriefId;
  },
});
