"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { instrumentedAnthropic } from "./instrument";
import { generateStructured } from "./structured";
import { MODEL } from "./model";
import type Anthropic from "@anthropic-ai/sdk";

/**
 * Learning loop digest generators. Each distills raw human feedback into a
 * short prompt block that an agent reads on every future generation:
 *
 * - QA calibration: per-item votes and severity reclassifications tune what
 *   the QA reviewer flags and how it classifies severity.
 * - Draft style: writers' 1-10 scores and comments on blind candidate drafts
 *   tune the section drafting agents' style.
 *
 * Guardrails, in order of importance:
 * - Never auto-change scoring math, CRA structural rules, or the Brain. A
 *   digest only tunes agent prompts.
 * - Every digest is persisted verbatim (learningDigests) so admins can audit
 *   exactly what changed agent behaviour and when (learning.getDigestHistory).
 * - Regeneration is skipped when there is no new feedback, so digests are
 *   stable between real signal, not drifting on every cron tick.
 */

/** Minimum signal rows before the system starts learning at all. */
const MIN_FEEDBACK_ROWS = 5;
/** Most recent feedback considered per digest (matches admin analytics cap). */
const FEEDBACK_WINDOW = 500;
/** Hard cap on rules so a block stays a focused prompt, not a second rubric. */
const MAX_RULES = 10;

const rulesSchema = (description: string): Anthropic.Tool.InputSchema => ({
  type: "object",
  properties: {
    rules: {
      type: "array",
      maxItems: MAX_RULES,
      items: { type: "string" },
      description,
    },
  },
  required: ["rules"],
});

interface RulesDigest {
  rules: string[];
}

/** Distill feedback into rules; returns null when the model finds no pattern. */
async function distillRules(
  client: Anthropic,
  system: string,
  user: string
): Promise<string[] | null> {
  const digest = await generateStructured<RulesDigest>(client, {
    system,
    user,
    toolName: "submit_learned_rules",
    description: "Submit rules distilled from human feedback.",
    schema: rulesSchema(
      "Rules supported by the feedback. Empty when the feedback shows no consistent pattern."
    ),
    maxTokens: 2048,
  });
  const rules = digest.rules
    .map((rule) => rule.trim())
    .filter(Boolean)
    .slice(0, MAX_RULES);
  return rules.length > 0 ? rules : null;
}

function formatDigestBlock(rules: string[], sourceCount: number): string {
  return [
    `Learned from ${sourceCount} human feedback events:`,
    ...rules.map((rule) => `- ${rule}`),
  ].join("\n");
}

// ─── QA calibration ──────────────────────────────────────────────────────────

const QA_DIGEST_SYSTEM_PROMPT = `You are calibrating an AI QA reviewer for SR&ED (Canadian R&D tax credit) report drafts, using feedback from the firm's professional writers.

You will receive feedback events on individual QA findings. Each event has:
- section: which report section the finding was about (242, 244, 246, or a global check)
- itemKind: "issue" (a flagged problem) or "strength"
- itemText: the QA finding's text
- vote: 1 = the writer found it useful/correct, -1 = the writer found it wrong or noise
- originalSeverity/overrideSeverity: writers can reclassify a finding between "deduction" (scores against the report) and "warning" (advisory only). A downgrade to warning means the finding was overly harsh; an upgrade to deduction means it was under-weighted.

Distill this into at most ${MAX_RULES} short calibration rules for the QA reviewer. Rules must:
- Generalize a PATTERN across multiple events. Never restate a single event as a rule.
- Be actionable instructions like "Do not flag X as a deduction; writers consistently reclassify it as a warning" or "Keep flagging Y; writers consistently confirm it".
- Only cover what the feedback supports. If the evidence for a pattern is thin (fewer than 2 consistent events), leave it out. Returning fewer rules, or zero rules, is correct when the data is weak.
- Never tell the reviewer to relax CRA structural requirements, keyword checks, or scoring arithmetic. Calibration is about which observations to raise and their severity, not about the rubric itself.
- Be plain text, one sentence each, no numbering, no em dashes.`;

export const generateQaCalibrationDigest = internalAction({
  args: {},
  handler: async (ctx) => {
    const feedback = await ctx.runQuery(
      internal.learning.getFeedbackForDigest,
      { limit: FEEDBACK_WINDOW }
    );
    // Only meaningful events calibrate: a row with neither a vote nor a
    // severity override carries no signal (e.g. feedback that was cleared).
    const signal = feedback.filter(
      (row) =>
        row.vote !== null ||
        (row.overrideSeverity !== null &&
          row.overrideSeverity !== row.originalSeverity)
    );
    if (signal.length < MIN_FEEDBACK_ROWS) return;

    const active = await ctx.runQuery(internal.learning.getActiveDigest, {
      kind: "qa_calibration",
    });
    const newestFeedbackAt = Math.max(...signal.map((row) => row.updatedAt));
    // No new signal since the active digest: keep it stable, skip the LLM call.
    if (active && newestFeedbackAt <= active.feedbackCutoff) return;

    const client = instrumentedAnthropic(ctx, {
      callSite: "learning:qa-calibration",
      capability: "generation",
    });
    const rules = await distillRules(
      client,
      QA_DIGEST_SYSTEM_PROMPT,
      `Feedback events, newest first:\n\n${JSON.stringify(
        signal.map(({ updatedAt: _updatedAt, ...row }) => row),
        null,
        2
      )}`
    );
    if (!rules) return;

    await ctx.runMutation(internal.learning.saveDigest, {
      kind: "qa_calibration",
      content: formatDigestBlock(rules, signal.length),
      sourceCount: signal.length,
      feedbackCutoff: newestFeedbackAt,
      model: MODEL,
    });
  },
});

// ─── Draft style (from blind candidate scoring) ───────────────────────────────

const STYLE_DIGEST_SYSTEM_PROMPT = `You are improving the drafting agents that write SR&ED (Canadian R&D tax credit) report drafts, using feedback the firm's professional writers gave on blind candidate drafts.

You will receive scoring events. Each event has:
- score: the writer's 1-10 quality rating of a draft (blind: the writer did not know which model wrote it)
- comment: the writer's free-text critique, when they left one
- aiQaScore: the AI QA score of the same draft, for context

Distill the comments into at most ${MAX_RULES} short style rules for the drafting agents. Rules must:
- Generalize a RECURRING critique across multiple comments. Never restate a single comment as a rule.
- Be actionable drafting instructions like "State the specific metrics tested instead of summarizing outcomes" or "Keep company background to two sentences".
- Only cover what the comments support. If a critique appears in fewer than 2 comments, leave it out. Returning fewer rules, or zero rules, is correct when the data is weak.
- Never contradict CRA requirements: required paragraph structures, required CRA phrasing, if/then hypothesis format, and banned-word rules all take precedence over these style rules.
- Be plain text, one sentence each, no numbering, no em dashes.`;

export const generateDraftStyleDigest = internalAction({
  args: {},
  handler: async (ctx) => {
    const feedback = await ctx.runQuery(
      internal.learning.getCandidateFeedbackForDigest,
      { limit: FEEDBACK_WINDOW }
    );
    // Comments carry the actionable critique; bare 1-10 scores don't say WHAT
    // to change, so they only ride along as context on commented rows.
    const signal = feedback.filter((row) => row.comment);
    if (signal.length < MIN_FEEDBACK_ROWS) return;

    const active = await ctx.runQuery(internal.learning.getActiveDigest, {
      kind: "draft_style",
    });
    const newestFeedbackAt = Math.max(...signal.map((row) => row.updatedAt));
    if (active && newestFeedbackAt <= active.feedbackCutoff) return;

    const client = instrumentedAnthropic(ctx, {
      callSite: "learning:draft-style",
      capability: "generation",
    });
    const rules = await distillRules(
      client,
      STYLE_DIGEST_SYSTEM_PROMPT,
      `Scoring events, newest first:\n\n${JSON.stringify(
        signal.map(({ updatedAt: _updatedAt, ...row }) => row),
        null,
        2
      )}`
    );
    if (!rules) return;

    await ctx.runMutation(internal.learning.saveDigest, {
      kind: "draft_style",
      content: formatDigestBlock(rules, signal.length),
      sourceCount: signal.length,
      feedbackCutoff: newestFeedbackAt,
      model: MODEL,
    });
  },
});
