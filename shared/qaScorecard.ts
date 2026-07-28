import { z } from "zod";

/**
 * The one runtime contract for a QA scorecard, shared by the agent that
 * produces it (convex/ai/qaAgent.ts) and the panel that renders it
 * (src/lib/components/editor/QAScorePanel.svelte).
 *
 * It lives here because the shape was previously declared three times — a
 * TypeScript interface, the provider's JSON Schema, and a separate frontend
 * Zod schema — and they drifted. The frontend required `paragraph` to be a
 * number and a deduction to be positive; the model legitimately returns
 * `paragraph: null` for section-wide gaps and `deduction: 0` for warnings.
 * Zod being all-or-nothing meant those discarded an entire valid 8.7KB
 * scorecard, and the panel showed "No QA scorecard yet" while every retry
 * burned a real API call.
 *
 * Two rules keep that from recurring:
 *  1. Be permissive about things that don't change meaning — absent vs null,
 *     zero deductions, unknown extra keys.
 *  2. Never drop the whole scorecard over one bad row. Per-item `.catch()`
 *     degrades a malformed entry instead of the entire report's QA.
 */

export const qaIssueSchema = z.union([
  // Older reports stored issues as bare strings.
  z.string().transform((text) => ({
    text,
    severity: "deduction" as const,
    deduction: undefined,
    paragraph: null,
  })),
  z.object({
    text: z.string(),
    severity: z.enum(["deduction", "warning"]).catch("deduction"),
    // A warning legitimately costs 0 points.
    deduction: z.number().nonnegative().optional(),
    paragraph: z.number().int().positive().nullable().optional(),
  }),
]);

// Scores are percentages. An out-of-range value is meaningless rather than
// merely odd, and rendering it would misreport report quality.
const percentage = z.number().min(0).max(100);

const sectionScoreSchema = z.object({
  score: percentage.catch(0),
  issues: z.array(qaIssueSchema.catch({
    text: "(an issue in this report could not be read)",
    severity: "warning" as const,
    deduction: undefined,
    paragraph: null,
  })).default([]),
  strengths: z.array(z.string()).default([]),
});

export const qaScorecardSchema = z.object({
  overall_score: percentage,
  section_scores: z.record(z.string(), sectionScoreSchema).default({}),
  cra_compliance: z.record(z.string(), z.boolean()).default({}),
  hallucination_risks: z.array(z.string()).default([]),
  ai_language_flags: z.array(z.string()).default([]),
  superlative_flags: z.array(z.string()).default([]),
  gaps_requiring_client_followup: z
    .array(
      z.object({
        section: z.string(),
        // Null when the gap spans the section rather than one paragraph.
        paragraph: z.number().int().nonnegative().nullable().optional(),
        question: z.string(),
      })
    )
    .default([]),
  suggested_improvements: z.array(z.string()).default([]),
});

export type QAScorecardParsed = z.infer<typeof qaScorecardSchema>;
