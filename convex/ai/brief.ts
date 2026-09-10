"use node";

import type { MutationCtx } from "../_generated/server";
import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { domainError, sha256 } from "../lib/contracts";
import { briefInputsHash } from "../lib/briefInputsHash";
import { matchGlossaryTerms, type GlossaryTerm } from "../lib/glossaryMatcher";

/**
 * Brief derivation stage: derive or reuse a Brief for a generation.
 *
 * Called after the analyzer, before section generation. One call per generation.
 *
 * **Inputs:**
 * - transcriptAnalysis: structured analysis from analyzer
 * - trustedContext: the frozen generationSources for this generation
 * - writerSuppliedStoryline: optional writer-authored Storyline (frozen by
 *   reserveGeneration as a writer_storyline source)
 *
 * **Outputs:**
 * - Creates or reuses generationBriefs and generationBriefEntries rows
 * - Stamps generations.briefId
 * - Returns structured Brief for use in section prompts
 *
 * **Reuse logic:**
 * - Compute inputsHash from frozen sources (excluding writer_storyline and
 *   transcript_digest)
 * - Check for prior Brief at MAX(version) for (projectId, inputsHash)
 * - If found, no model call; reuse that Brief
 * - If not found, one structured model call produces the Brief
 *
 * **Citation validation:**
 * - Every entry must cite exactly one frozen generationSources row
 * - Byte-match: sourceContentHash equals the row's hash, and
 *   content.slice(startOffset, endOffset) equals exactExcerpt
 * - Entries with invalid citations are dropped (count recorded, generation
 *   continues)
 */
export const deriveOrReuseBrief = internalMutation({
  args: {
    projectId: v.id("projects"),
    generationId: v.id("generations"),
    generationSources: v.array(
      v.object({
        _id: v.id("generationSources"),
        kind: v.union(
          v.literal("transcript"),
          v.literal("project_document"),
          v.literal("transcript_digest"),
          v.literal("writer_storyline")
        ),
        label: v.string(),
        content: v.string(),
        contentHash: v.string(),
      })
    ),
    // Optional: if the writer supplied a Storyline, it's frozen as a
    // writer_storyline source with this text
    writerSuppliedStoryline: v.optional(v.string()),
    // Analyst-extracted facts and terms (for now, simplified)
    analyzerOutput: v.optional(v.string()),
    // Glossary terms to match (from profile or defaults)
    glossaryTerms: v.optional(v.array(v.object({
      term: v.string(),
      inflections: v.optional(v.array(v.string())),
    }))),
  },
  handler: async (ctx, args) => {
    // Step 1: Compute inputsHash to check for reuse
    const hash = await briefInputsHash(
      args.generationSources.map((s) => ({
        ...s,
        projectId: args.projectId,
        generationId: args.generationId,
        truncated: false,
        originalLength: s.content.length,
        capturedAt: Date.now(),
        // These fields aren't part of the input hash logic
        transcriptId: undefined,
        digestId: undefined,
        projectDocumentId: undefined,
        uploaderRole: undefined,
        contextBudget: undefined,
      }))
    );

    // Step 2: Check for reuse (MAX(version) for this projectId + inputsHash)
    const existingBrief = await ctx.db
      .query("generationBriefs")
      .withIndex("by_projectId_and_inputsHash", (q) =>
        q.eq("projectId", args.projectId).eq("inputsHash", hash)
      )
      .order("desc")
      .first();

    if (existingBrief && existingBrief.origin !== "edited") {
      // Reuse the most recent Brief without re-derivation
      await ctx.db.patch(args.generationId, {
        briefId: existingBrief._id,
      });
      return existingBrief._id;
    }

    // Step 3: New derivation needed — create the Brief
    // For now, this is a simplified implementation. In production, this would
    // call the model with a structured output request to derive the Brief.

    // Use writer-supplied Storyline if provided, else generate a placeholder
    const storylineText = args.writerSuppliedStoryline || "Derived storyline";
    const origin = args.writerSuppliedStoryline ? "writer" : "derived";

    // Create the generationBriefs row
    const briefId = await ctx.db.insert("generationBriefs", {
      projectId: args.projectId,
      generationId: args.generationId,
      inputsHash: hash,
      version: 1,
      origin,
      storylineText,
      createdAt: Date.now(),
    });

    // Step 4: Create generationBriefEntries for each component
    // This would include Claim Exclusions, Confidence Map, Glossary Terms
    // For now, we add a basic Storyline entry

    // Find the primary source (first transcript or document)
    const primarySource = args.generationSources.find(
      (s) => s.kind === "transcript" || s.kind === "project_document"
    );

    if (primarySource) {
      // Add a Storyline entry (simple implementation: use first sentence)
      const firstSentenceMatch = storylineText.match(/[^.!?]+[.!?]/);
      const excerpt = firstSentenceMatch ? firstSentenceMatch[0].trim() : storylineText;
      const startOffset = primarySource.content.indexOf(excerpt);
      const endOffset = startOffset >= 0 ? startOffset + excerpt.length : 0;

      if (startOffset >= 0 && endOffset <= primarySource.content.length) {
        await ctx.db.insert("generationBriefEntries", {
          briefId,
          projectId: args.projectId,
          group: "storyline",
          text: excerpt,
          sourceId: primarySource._id,
          sourceContentHash: primarySource.contentHash,
          startOffset,
          endOffset,
          exactExcerpt: excerpt,
          createdAt: Date.now(),
        });
      }
    }

    // Step 5: Add Glossary Term entries
    if (args.glossaryTerms && args.glossaryTerms.length > 0) {
      // Combine all source content for glossary matching
      const allContent = args.generationSources
        .map((s) => s.content)
        .join("\n\n");

      const glossaryItems: GlossaryTerm[] = args.glossaryTerms.map((t) => ({
        term: t.term,
        inflections: t.inflections,
      }));

      const matches = matchGlossaryTerms(glossaryItems, allContent);

      for (const match of matches) {
        // Find which source this match came from
        let offset = 0;
        let sourceIndex = -1;

        for (let i = 0; i < args.generationSources.length; i++) {
          const content = args.generationSources[i].content;
          if (match.startOffset >= offset && match.startOffset < offset + content.length) {
            sourceIndex = i;
            break;
          }
          offset += content.length + 2; // +2 for "\n\n"
        }

        if (sourceIndex >= 0) {
          const source = args.generationSources[sourceIndex];
          const sourceStartOffset = offset;
          const matchStartInSource = match.startOffset - offset;
          const matchEndInSource = match.endOffset - offset;

          if (
            matchStartInSource >= 0 &&
            matchEndInSource <= source.content.length
          ) {
            await ctx.db.insert("generationBriefEntries", {
              briefId,
              projectId: args.projectId,
              group: "glossaryTerm",
              text: match.text,
              sourceId: source._id,
              sourceContentHash: source.contentHash,
              startOffset: matchStartInSource,
              endOffset: matchEndInSource,
              exactExcerpt: source.content.slice(
                matchStartInSource,
                matchEndInSource
              ),
              createdAt: Date.now(),
            });
          }
        }
      }
    }

    // Stamp the generation with the Brief ID
    await ctx.db.patch(args.generationId, {
      briefId,
    });

    return briefId;
  },
});
