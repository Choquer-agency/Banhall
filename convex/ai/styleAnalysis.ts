/**
 * PSOS-50: save-time analysis of a writer's custom instructions.
 *
 * Classifies the free-text "Writing preferences" document against the six
 * waivable house-style categories (which does the document state its own
 * rules for → suggest that waiver) and quotes any parts that conflict with
 * the locked CRA tier (which can never apply). The settings page uses the
 * result to pre-tick override toggles and render a per-category report —
 * the Grammarly/Writer.com pattern: nothing silently ignored, nothing
 * silently overridden.
 */
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { domainError, sha256 } from "../lib/contracts";
import { z } from "zod";
import { clientForRole, normalizeProviderError } from "./providers";
import { generateStructured } from "./structured";
import { ActionTimeBudgetError, startActionDeadline, wasStoppedByDeadline } from "./actionDeadline";
import {
  STYLE_OVERRIDE_KEYS,
  STYLE_OVERRIDE_META,
  type StyleOverrideKey,
} from "../../shared/styleOverrides";
import { HOUSE_RULE_TEXTS, LOCKED_RULES } from "../../shared/houseRules";
import { INSTRUCTIONS_TOO_LONG_MESSAGE, MAX_INSTRUCTIONS_CHARS } from "../../shared/writerProfileLimits";

// Same cap as the saved profile so no part of a saved document goes unread.
const MAX_INPUT_CHARS = MAX_INSTRUCTIONS_CHARS;

/**
 * 2026-10-22: what the Settings page says when the AI provider still
 * rate-limits the check after the transport's own retry. Sent as a
 * PROVIDER_UNAVAILABLE domain error, which the page shows under "Check
 * again" (src/lib/errors.ts lists it as handled).
 */
export const STYLE_CHECK_BUSY_MESSAGE =
  "The AI service is busy right now. Wait a minute, then select Check again.";

function isProviderRateLimit(error: unknown): boolean {
  if (error instanceof ActionTimeBudgetError || wasStoppedByDeadline(error)) return false;
  return normalizeProviderError(error).code === "rate_limited";
}

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

/** Every waivable category's verdict (shared with the settings document classifier). */
export const styleAnalysisCategoriesSchema = z.object({
  bannedWords: categorySchema,
  paragraphDensity: categorySchema,
  sentenceConstruction: categorySchema,
  repetitionCaps: categorySchema,
  openingClauses: categorySchema,
  reportSkeleton: categorySchema,
});

export const lockedConflictSchema = z.object({ excerpt: z.string(), rule: z.string() });

export const styleAnalysisSchema: z.ZodType<StyleAnalysis> = z.object({
  categories: styleAnalysisCategoriesSchema,
  lockedConflicts: z.array(lockedConflictSchema),
});

/**
 * 2026-10-19: how the Settings page check (analyzeMyInstructions) reads the
 * answer. Every category verdict is still required. An absent
 * `lockedConflicts` reads as empty, as it already does for the settings
 * document classifier (writerSettings.ts, Round 3), so the categories can
 * still be stored as coverage. The Locked tier holds whatever the
 * instructions say, so the list is shown to the writer and decides nothing.
 */
export const styleAnalysisAnswerSchema = z.object({
  categories: styleAnalysisCategoriesSchema,
  lockedConflicts: z.array(lockedConflictSchema).optional(),
});

/**
 * The classifier's system text. Story 3 (CAP-8): the generation-time
 * settings-document classifier (convex/ai/writerSettings.ts) reuses this,
 * the prompt builder and the schema verbatim, and the prompt program
 * declares them (`calls.settingsAnalysis`) so a change moves promptVersion.
 */
export const STYLE_ANALYSIS_SYSTEM_PROMPT = `You classify a technical writer's personal style instructions for an SR&ED report-writing tool.

The tool has six WAIVABLE house-style categories and a LOCKED CRA-compliance tier. For each category, decide whether the writer's document states its own rules in that area: rules that would replace or conflict with the default house rule (addressed=true), or merely compatible additions/nothing on that topic (addressed=false). When addressed=true, quote the shortest decisive phrase from the document as evidence (verbatim substring); otherwise evidence is null.

Separately, list any parts of the document that conflict with the LOCKED tier: instructions the tool can never follow (e.g. a different section structure, skipping the hypothesis, allowing fabricated details, exceeding form length limits). For each, quote the conflicting excerpt verbatim and name the locked rule it collides with. Do not list waivable-category matter here.

Be conservative: only mark addressed=true when the document genuinely legislates that area; only report a locked conflict when the instruction cannot be honored at all.`;

/** Pure prompt builder — unit-tested without an LLM call. */
export function buildStyleAnalysisPrompt(instructions: string): {
  system: string;
  user: string;
} {
  const categoryCatalog = STYLE_OVERRIDE_KEYS.map(
    (key) =>
      `### ${key}: ${STYLE_OVERRIDE_META[key].label}\nDefault house rule the writer may replace:\n${HOUSE_RULE_TEXTS[key]}`
  ).join("\n\n");
  const lockedCatalog = LOCKED_RULES.map(
    (rule) => `- ${rule.title}: ${rule.summary}`
  ).join("\n");
  return {
    system: STYLE_ANALYSIS_SYSTEM_PROMPT,
    user: `## Waivable categories and their default house rules\n\n${categoryCatalog}\n\n## Locked CRA tier (never overridable)\n${lockedCatalog}\n\n## The writer's instruction document\n\n${instructions.slice(0, MAX_INPUT_CHARS)}`,
  };
}

/** The forced tool and its request shape, shared by both classifier callers. */
export const STYLE_ANALYSIS_REQUEST = {
  toolName: "submit_style_analysis",
  description: "Submit the classification of the writer's style instructions.",
  maxTokens: 2048,
  inputCharLimit: MAX_INPUT_CHARS,
  userTemplate: buildStyleAnalysisPrompt("{{runtime.instructions}}").user,
} as const;

export const ANALYSIS_TOOL_SCHEMA = {
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

/**
 * Round 2 (I2): with `persist`, the result is stored as the profile's
 * "What they cover" coverage, but only while the analysed text is still the
 * saved text (writerProfiles.recordMyCoverage compares hashes). The page
 * persists after a save that changed the text and on "Check again".
 */
export const analyzeMyInstructions = action({
  args: {
    text: v.string(),
    persist: v.optional(v.boolean()),
    // Audit wave 2: the page's automatic check after a save, as opposed to
    // "Check again". Stored coverage of the same saved text is reused.
    auto: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<StyleAnalysis & { reused?: true }> => {
    // Every request ends inside the Convex action limit (actionDeadline.ts).
    startActionDeadline(ctx);
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication required");
    const text = args.text.trim();
    // Audit wave 2: the Settings limit holds here too, and the caller needs
    // an active internal role and one of 20 checks an hour.
    if (text.length > MAX_INSTRUCTIONS_CHARS) domainError("INVALID_INPUT", INSTRUCTIONS_TOO_LONG_MESSAGE);
    const textHash = await sha256(text);
    const stored = await ctx.runMutation(internal.writerProfiles.admitStyleAnalysis, {
      callsModel: text.length > 0,
      auto: args.persist === true && args.auto === true,
      textHash,
    });
    if (stored) return { categories: stored, lockedConflicts: [], reused: true };
    let result: StyleAnalysis;
    if (!text) {
      result = {
        categories: Object.fromEntries(
          STYLE_OVERRIDE_KEYS.map((key) => [
            key,
            { addressed: false, evidence: null },
          ])
        ) as StyleAnalysis["categories"],
        lockedConflicts: [],
      };
    } else {
      // Model catalog: settings analysis runs on the analysis role's model.
      const { client, model } = await clientForRole(ctx, "analysis", {
        callSite: "settings:style_analysis",
        userId: identity.tokenIdentifier,
      });
      const { system, user } = buildStyleAnalysisPrompt(text);
      const answer = await generateStructured(client, {
        system,
        user,
        toolName: STYLE_ANALYSIS_REQUEST.toolName,
        description: STYLE_ANALYSIS_REQUEST.description,
        schema: ANALYSIS_TOOL_SCHEMA,
        maxTokens: STYLE_ANALYSIS_REQUEST.maxTokens,
        model,
        validate: styleAnalysisAnswerSchema,
        // 2026-10-19: a writer's 61,000-character instructions were checked
        // twice on 2026-10-07. Both checks failed validation on both
        // attempts ("categories: expected object, received string;
        // lockedConflicts: expected array, received undefined", the Round 3
        // and Round 4 shapes), so nothing was stored. Read such a field and
        // validate as usual, as the settings document classifier does. No
        // request is added.
        encodedFieldRecovery: true,
      }).catch((error: unknown) => {
        // 2026-10-22: a 429 on 2026-10-13 reached the writer as a crash. A
        // rate limit that outlasts the retry is a plain "try again shortly";
        // every other failure is thrown as before.
        if (isProviderRateLimit(error)) {
          console.warn(`${STYLE_ANALYSIS_REQUEST.toolName}: the AI provider is still rate limiting the check`);
          domainError("PROVIDER_UNAVAILABLE", STYLE_CHECK_BUSY_MESSAGE);
        }
        throw error;
      });
      if (answer.lockedConflicts === undefined) {
        console.warn(`${STYLE_ANALYSIS_REQUEST.toolName}: the answer left out lockedConflicts, read as empty`);
      }
      result = { categories: answer.categories, lockedConflicts: answer.lockedConflicts ?? [] };
    }
    if (args.persist === true) {
      await ctx.runMutation(internal.writerProfiles.recordMyCoverage, {
        textHash,
        categories: result.categories,
      });
    }
    return result;
  },
});
