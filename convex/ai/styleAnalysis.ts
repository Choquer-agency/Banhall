/**
 * PSOS-50: save-time analysis of a writer's custom instructions.
 *
 * Classifies the free-text "Writing preferences" document against the five
 * waivable house-style categories (which does the document state its own
 * rules for → suggest that waiver) and quotes any parts that conflict with
 * the locked CRA tier (which can never apply). The settings page uses the
 * result to pre-tick override toggles and render a per-category report —
 * the Grammarly/Writer.com pattern: nothing silently ignored, nothing
 * silently overridden.
 */
import { action } from "../_generated/server";
import { v } from "convex/values";
import { z } from "zod";
import { MODEL } from "./model";
import { instrumentedAnthropic } from "./instrument";
import { generateStructured } from "./structured";
import {
  STYLE_OVERRIDE_KEYS,
  STYLE_OVERRIDE_META,
  type StyleOverrideKey,
} from "../../shared/styleOverrides";
import { HOUSE_RULE_TEXTS, LOCKED_RULES } from "../../shared/houseRules";
import { MAX_INSTRUCTIONS_CHARS } from "../../shared/writerProfileLimits";

// Same cap as the saved profile so no part of a saved document goes unread.
const MAX_INPUT_CHARS = MAX_INSTRUCTIONS_CHARS;

export interface StyleAnalysis {
  categories: Record<
    StyleOverrideKey,
    { addressed: boolean; evidence: string | null }
  >;
  lockedConflicts: Array<{ excerpt: string; rule: string }>;
}

const categorySchema = z.object({
  addressed: z.boolean(),
  evidence: z.string().nullable(),
});

export const styleAnalysisSchema: z.ZodType<StyleAnalysis> = z.object({
  categories: z.object({
    bannedWords: categorySchema,
    paragraphDensity: categorySchema,
    sentenceConstruction: categorySchema,
    repetitionCaps: categorySchema,
    openingClauses: categorySchema,
    reportSkeleton: categorySchema,
  }),
  lockedConflicts: z.array(z.object({ excerpt: z.string(), rule: z.string() })),
});

/** Pure prompt builder — unit-tested without an LLM call. */
export function buildStyleAnalysisPrompt(instructions: string): {
  system: string;
  user: string;
} {
  const categoryCatalog = STYLE_OVERRIDE_KEYS.map(
    (key) =>
      `### ${key} — ${STYLE_OVERRIDE_META[key].label}\nDefault house rule the writer may replace:\n${HOUSE_RULE_TEXTS[key]}`
  ).join("\n\n");
  const lockedCatalog = LOCKED_RULES.map(
    (rule) => `- ${rule.title}: ${rule.summary}`
  ).join("\n");
  return {
    system: `You classify a technical writer's personal style instructions for an SR&ED report-writing tool.

The tool has five WAIVABLE house-style categories and a LOCKED CRA-compliance tier. For each category, decide whether the writer's document states its own rules in that area — rules that would replace or conflict with the default house rule (addressed=true), or merely compatible additions/nothing on that topic (addressed=false). When addressed=true, quote the shortest decisive phrase from the document as evidence (verbatim substring); otherwise evidence is null.

Separately, list any parts of the document that conflict with the LOCKED tier — instructions the tool can never follow (e.g. a different section structure, skipping the hypothesis, allowing fabricated details, exceeding form length limits). For each, quote the conflicting excerpt verbatim and name the locked rule it collides with. Do not list waivable-category matter here.

Be conservative: only mark addressed=true when the document genuinely legislates that area; only report a locked conflict when the instruction cannot be honored at all.`,
    user: `## Waivable categories and their default house rules\n\n${categoryCatalog}\n\n## Locked CRA tier (never overridable)\n${lockedCatalog}\n\n## The writer's instruction document\n\n${instructions.slice(0, MAX_INPUT_CHARS)}`,
  };
}

const ANALYSIS_TOOL_SCHEMA = {
  type: "object" as const,
  properties: {
    categories: {
      type: "object",
      properties: Object.fromEntries(
        STYLE_OVERRIDE_KEYS.map((key) => [
          key,
          {
            type: "object",
            properties: {
              addressed: { type: "boolean" },
              evidence: { type: ["string", "null"] },
            },
            required: ["addressed", "evidence"],
          },
        ])
      ),
      required: [...STYLE_OVERRIDE_KEYS],
    },
    lockedConflicts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          excerpt: { type: "string" },
          rule: { type: "string" },
        },
        required: ["excerpt", "rule"],
      },
    },
  },
  required: ["categories", "lockedConflicts"],
};

export const analyzeMyInstructions = action({
  args: { text: v.string() },
  handler: async (ctx, args): Promise<StyleAnalysis> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication required");
    const text = args.text.trim();
    if (!text) {
      return {
        categories: Object.fromEntries(
          STYLE_OVERRIDE_KEYS.map((key) => [
            key,
            { addressed: false, evidence: null },
          ])
        ) as StyleAnalysis["categories"],
        lockedConflicts: [],
      };
    }
    const anthropic = instrumentedAnthropic(ctx, {
      callSite: "settings:style_analysis",
      capability: "generation",
      userId: identity.tokenIdentifier,
    });
    const { system, user } = buildStyleAnalysisPrompt(text);
    return await generateStructured<StyleAnalysis>(anthropic, {
      system,
      user,
      toolName: "submit_style_analysis",
      description:
        "Submit the classification of the writer's style instructions.",
      schema: ANALYSIS_TOOL_SCHEMA,
      maxTokens: 2048,
      model: MODEL,
      validate: styleAnalysisSchema,
    });
  },
});
