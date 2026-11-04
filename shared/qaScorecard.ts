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
 *
 * 2026-10-30 (owner, "please fix all properly", item 4): QA items rendered
 * as "(an issue in this report could not be read)", one or two per
 * section, always warnings. The QA prompt says a warning MUST have no
 * deduction, so the model sent `"deduction": null`; `.optional()` rejects
 * null, and the item's `.catch` swapped the whole issue, text and all, for
 * the placeholder. `paragraph: 0` failed the same way (`positive()`). Now a
 * null deduction reads as none and a paragraph of 0 as section-wide; an item
 * still malformed keeps its own text when it has one; and the follow-up
 * questions and the string lists drop or salvage a bad row instead of
 * failing the whole scorecard.
 */

/** A text worth showing: a string with something in it. */
function usableText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A deduction as the model sends it: null is no deduction (a warning has
 * none), and a number written as a string is that number.
 */
function deductionInput(value: unknown): unknown {
  if (value === null) return undefined;
  if (typeof value === "string" && /^\s*\d+(?:\.\d+)?\s*$/.test(value)) return Number(value);
  return value;
}

/** A paragraph of 0 names no paragraph: the item is section-wide. */
function paragraphInput(value: unknown): unknown {
  return value === 0 ? null : value;
}

/** The deduction of a salvaged item: a usable amount, or none. */
function salvagedDeduction(value: unknown): number | undefined {
  const amount = deductionInput(value);
  return typeof amount === "number" && Number.isFinite(amount) && amount >= 0 ? amount : undefined;
}

/** The paragraph of a salvaged item: a [P#] number, or section-wide. */
function salvagedParagraph(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

const ISSUE_PLACEHOLDER = {
  text: "(an issue in this report could not be read)",
  severity: "warning" as const,
  deduction: undefined,
  paragraph: null,
};

type SalvagedIssue = {
  text: string;
  severity: "deduction" | "warning";
  deduction: number | undefined;
  paragraph: number | null;
};

/** A malformed issue keeps its own text when it has one; only an issue with none becomes the placeholder. */
function salvageIssue(input: unknown): SalvagedIssue {
  const text = isRecord(input) ? usableText(input.text) : undefined;
  if (!isRecord(input) || text === undefined) return ISSUE_PLACEHOLDER;
  const severity = input.severity;
  return {
    text,
    severity: severity === "deduction" || severity === "warning" ? severity : "warning",
    deduction: salvagedDeduction(input.deduction),
    paragraph: salvagedParagraph(input.paragraph),
  };
}

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
    // A warning legitimately costs 0 points, or none (null).
    deduction: z.preprocess(deductionInput, z.number().nonnegative().optional()),
    // Null, absent or 0: section-wide.
    paragraph: z.preprocess(paragraphInput, z.number().int().positive().nullable().optional()),
  }),
]);

/**
 * A list of strings: a bad row is dropped, or its text kept when it is an
 * object with one; null reads as empty, and a lone string as a list of one.
 */
const stringList = z
  .preprocess((value) => {
    if (value === undefined) return undefined;
    if (typeof value === "string") return [value];
    if (!Array.isArray(value)) return [];
    return value.flatMap((row) => {
      if (typeof row === "string") return [row];
      const text = isRecord(row) ? usableText(row.text) : undefined;
      return text === undefined ? [] : [text];
    });
  }, z.array(z.string()).optional())
  .transform((rows) => rows ?? []);

// Scores are percentages. An out-of-range value is meaningless rather than
// merely odd, and rendering it would misreport report quality.
const percentage = z.number().min(0).max(100);

const sectionScoreSchema = z.object({
  score: percentage.catch(0),
  issues: z
    .preprocess(
      (value) => (value === null ? undefined : value),
      z.array(qaIssueSchema.catch((ctx) => salvageIssue(ctx.input))).optional()
    )
    .transform((issues) => issues ?? []),
  strengths: stringList,
});

const followUpSchema = z.object({
  section: z.string(),
  // Null when the gap spans the section rather than one paragraph; 0 names
  // no paragraph either.
  paragraph: z.preprocess(paragraphInput, z.number().int().nonnegative().nullable().optional()),
  question: z.string(),
});

/** A malformed follow-up keeps its question when it has one; one with none is dropped. */
function salvageFollowUp(input: unknown): z.infer<typeof followUpSchema> | null {
  if (!isRecord(input)) return null;
  const question = usableText(input.question);
  if (question === undefined) return null;
  const section =
    typeof input.section === "string" ? input.section : typeof input.section === "number" ? String(input.section) : "";
  return { section, paragraph: salvagedParagraph(input.paragraph), question };
}

export const qaScorecardSchema = z.object({
  overall_score: percentage,
  section_scores: z.record(z.string(), sectionScoreSchema).default({}),
  cra_compliance: z.record(z.string(), z.boolean()).default({}),
  hallucination_risks: stringList,
  ai_language_flags: stringList,
  superlative_flags: stringList,
  gaps_requiring_client_followup: z
    .preprocess(
      (value) => (value === null ? undefined : value),
      z.array(followUpSchema.nullable().catch((ctx) => salvageFollowUp(ctx.input))).optional()
    )
    .transform((rows) => (rows ?? []).filter((row): row is z.infer<typeof followUpSchema> => row !== null)),
  suggested_improvements: stringList,
});

export type QAScorecardParsed = z.infer<typeof qaScorecardSchema>;
