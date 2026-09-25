"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { instrumentedAnthropic } from "./instrument";
import { PD_REVIEW_SYSTEM_PROMPT } from "./prompts";
import { generateStructured } from "./structured";
import { pdReviewResultSchema } from "../../shared/pdReview";
import type { z } from "zod";
import { MODEL } from "./model";
import type { ContextDoc } from "./analyzerAgent";
import { normalizeProviderError } from "./providers";
import {
  CHARS_PER_TOKEN,
  cutToBudget,
  formatCount,
  truncationNotice,
} from "./trustedContext";

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
        "Areas to improve: eligibility or audit risks, each referencing the offending passage.",
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

/**
 * Input budget for a PD review (cost phase 1). The review used to send the
 * written PD, every transcript joined and every supporting document whole,
 * with no bound. The PD under review is the primary input and is spent
 * first; the transcript and the documents follow in that order. Starting
 * values sized like the analyzer's (150k tokens overall).
 */
export const PD_REVIEW_INPUT_BUDGET = {
  totalTokens: 150_000,
  pdTokens: 60_000,
  transcriptTokens: 60_000,
  perDocumentTokens: 10_000,
  maxDocuments: 12,
} as const;

export type PdReviewInputBudget = {
  totalTokens: number;
  pdTokens: number;
  transcriptTokens: number;
  perDocumentTokens: number;
  maxDocuments: number;
};

/**
 * The review's user message, deterministic for the same inputs. A cut keeps
 * a prefix and says how much was dropped; documents that do not fit at all
 * are counted in one closing line rather than silently disappearing.
 */
export function buildPdReviewUserMessage(
  input: {
    title: string;
    clientName: string;
    fileName: string;
    pdContent: string;
    transcript: string;
  },
  contextDocs: ReadonlyArray<Pick<ContextDoc, "fileName" | "category" | "content">>,
  budget: PdReviewInputBudget = PD_REVIEW_INPUT_BUDGET
): string {
  const chars = (tokens: number) => Math.max(0, tokens) * CHARS_PER_TOKEN;
  let remaining = chars(budget.totalTokens);
  const spend = (text: string, capTokens: number): string | null => {
    const kept = cutToBudget(text, Math.min(chars(capTokens), remaining));
    if (!kept.length) return null;
    remaining -= kept.length;
    return kept.length < text.length
      ? `${kept}\n${truncationNotice(text.length - kept.length, text.length)}`
      : kept;
  };
  const parts = [
    `Review the following SR&ED Project Description for "${input.title}" (client: ${input.clientName}).`,
    `## Written PD under review (${input.fileName})\n${spend(input.pdContent, budget.pdTokens) ?? ""}`,
  ];
  if (input.transcript) {
    const transcript = spend(input.transcript, budget.transcriptTokens);
    parts.push(
      `## Interview transcript (context)\n${transcript ?? truncationNotice(input.transcript.length, input.transcript.length)}`
    );
  }
  let omitted = 0;
  contextDocs.forEach((doc, index) => {
    const body = index < budget.maxDocuments ? spend(doc.content, budget.perDocumentTokens) : null;
    if (body === null) {
      omitted += 1;
      return;
    }
    parts.push(`## Supporting document: ${doc.fileName} (${doc.category})\n${body}`);
  });
  if (omitted > 0) {
    parts.push(
      `[${formatCount(omitted)} further supporting document(s) were omitted to fit the context budget.]`
    );
  }
  return parts.join("\n\n");
}

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


      const anthropic = instrumentedAnthropic(ctx, {
        callSite: "pd_review",
        capability: "review",
        projectId: args.projectId,
        ...(input.createdBy ? { userId: input.createdBy } : {}),
      });
      const result = await generateStructured<PdReviewResult>(anthropic, {
        system: PD_REVIEW_SYSTEM_PROMPT,
        user: buildPdReviewUserMessage(input, contextDocs),
        toolName: "submit_pd_review",
        description: "Submit the structured feedback report for the written PD.",
        schema: PD_REVIEW_SCHEMA as never,
        maxTokens: 4096,
        // Validate before storing. An unreadable result used to be saved as
        // `completed`, which rendered a blank report the writer could not
        // retry (retry only accepts `failed`). Now it lands in the catch below
        // and becomes an honest, retryable failure.
        validate: pdReviewResultSchema satisfies z.ZodType<PdReviewResult>,
      });

      await ctx.runMutation(internal.pdReviews.completePdReview, {
        reviewId: args.reviewId,
        result: JSON.stringify(result),
        model: MODEL,
      });
    } catch (error) {
      const normalized = normalizeProviderError(error);
      await ctx.runMutation(internal.pdReviews.failPdReview, {
        reviewId: args.reviewId,
        error: `${normalized.code}: ${normalized.message}`,
      });
    }
  },
});
