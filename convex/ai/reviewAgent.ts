"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import Anthropic from "@anthropic-ai/sdk";
import { PD_REVIEW_SYSTEM_PROMPT } from "./prompts";
import { generateStructured } from "./structured";
import { MODEL } from "./model";
import type { ContextDoc } from "./analyzerAgent";

/** BNH-39: structured feedback report for an externally written PD. */
export interface PdReviewResult {
  summary: string;
  qualitative_score: number;
  score_rationale: string;
  strengths: string[];
  risks: string[];
  suggested_strengthening: string[];
}

const PD_REVIEW_SCHEMA = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description:
        "Two or three sentences: what the PD covers and the overall verdict.",
    },
    qualitative_score: {
      type: "number",
      description: "CRA-eligibility strength as written, 0-100.",
    },
    score_rationale: {
      type: "string",
      description: "One sentence justifying the score.",
    },
    strengths: {
      type: "array",
      items: { type: "string" },
      description: "Things to keep, each tied to a CRA criterion.",
    },
    risks: {
      type: "array",
      items: { type: "string" },
      description:
        "Areas to improve — eligibility or audit risks, each referencing the offending passage.",
    },
    suggested_strengthening: {
      type: "array",
      items: { type: "string" },
      description: "Specific rewrites or additions, not restated risks.",
    },
  },
  required: [
    "summary",
    "qualitative_score",
    "score_rationale",
    "strengths",
    "risks",
    "suggested_strengthening",
  ],
} as const;

export const runPdReview = internalAction({
  args: {
    reviewId: v.id("pdReviews"),
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    try {
      const input = await ctx.runQuery(internal.pdReviews.getReviewInput, {
        reviewId: args.reviewId,
      });
      if (!input || !input.pdContent.trim()) {
        throw new Error("Uploaded PD has no extractable text");
      }
      const contextDocs: ContextDoc[] = await ctx.runQuery(
        internal.documents.getContextDocsForGeneration,
        { projectId: args.projectId }
      );

      const parts = [
        `Review the following SR&ED Project Description for "${input.title}" (client: ${input.clientName}).`,
        `## Written PD under review (${input.fileName})\n${input.pdContent}`,
      ];
      if (input.transcript) {
        parts.push(`## Interview transcript (context)\n${input.transcript}`);
      }
      for (const doc of contextDocs) {
        parts.push(
          `## Supporting document — ${doc.fileName} (${doc.category})\n${doc.content}`
        );
      }

      const anthropic = new Anthropic();
      const result = await generateStructured<PdReviewResult>(anthropic, {
        system: PD_REVIEW_SYSTEM_PROMPT,
        user: parts.join("\n\n"),
        toolName: "submit_pd_review",
        description: "Submit the structured feedback report for the written PD.",
        schema: PD_REVIEW_SCHEMA as never,
        maxTokens: 4096,
      });

      await ctx.runMutation(internal.pdReviews.completePdReview, {
        reviewId: args.reviewId,
        result: JSON.stringify(result),
        model: MODEL,
      });
    } catch (e) {
      await ctx.runMutation(internal.pdReviews.failPdReview, {
        reviewId: args.reviewId,
        error: e instanceof Error ? e.message : "Unknown error",
      });
    }
  },
});
