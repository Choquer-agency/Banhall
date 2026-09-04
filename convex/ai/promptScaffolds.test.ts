import { describe, expect, it } from "vitest";
import { buildContextBlock } from "./analyzerAgent";
import { CONDENSE_SCHEMA, CONDENSE_SYSTEM_PROMPT } from "./condenseAgent";
import { generationPromptProgram, hashPromptProgram } from "./promptProgram";
import {
  CONDENSE_VERSION,
  CONDENSE_WINDOW_CHARS,
  DIGEST_TARGET_CHARS,
  TRANSCRIPT_BUDGET_CHARS,
} from "../lib/transcripts";
import { priorSectionsBlock } from "./iterative";
import { buildStyleGuidance, lengthBudgetBlock } from "./pipeline";
import { CONTEXT_INPUTS_GUIDANCE, waivedCategoryLabels } from "./prompts";
import { numberParagraphs } from "./qaAgent";
import { CHARS_PER_LINE, LINE_LIMITS, wordBudget } from "../lib/lineLimits";
import { NO_STYLE_OVERRIDES } from "../../shared/styleOverrides";

/**
 * Story 10 split the inline prompt templates into fragment tables that both
 * runtime assembly and the prompt-program manifest read. These tests pin the
 * composed bytes to the pre-split literals so a changed joiner, a lost blank
 * line, or a reordered fragment fails here instead of silently changing what
 * providers receive. Expected strings are the original template literals,
 * not re-derived from the fragment tables.
 */
describe("prompt scaffold composition", () => {
  it("renders the length budget block exactly", () => {
    const words = wordBudget("s244", "standard");
    const lines = LINE_LIMITS.s244;
    expect(lengthBudgetBlock("s244", "standard")).toBe(
      `\n\n# LENGTH BUDGET (CRA form constraint — hard requirement)\nThe CRA form field for this section holds at most ${lines} lines of ${CHARS_PER_LINE} characters, and EVERY blank line between paragraphs also costs one full line. Write AT MOST ${words} words total. Prefer fewer, denser paragraphs (each blank line spent on a paragraph break is a line of content lost). Do NOT pad. If the material exceeds the budget, keep the most technically load-bearing content and cut the rest.`,
    );
  });

  it("renders learned style guidance and each writer-preference branch exactly", () => {
    expect(buildStyleGuidance(undefined, undefined)).toBe("");
    expect(buildStyleGuidance("   ", "\n")).toBe("");

    expect(buildStyleGuidance("  Learned style.  ", undefined)).toBe(
      "\n\n## Style guidance learned from writer feedback on past drafts\nApply where it does not conflict with the required structure, CRA phrasing, or banned-word rules:\nLearned style.",
    );

    expect(buildStyleGuidance(undefined, " Writer flavor. ")).toBe(
      "\n\n## Writer's personal style preferences (lowest priority)\nThe requesting writer recorded these personal preferences. Apply them ONLY where\nthey do not conflict with: (1) the required CRA section structure and paragraph\nmandates, (2) CRA phrasing and banned-word rules, (3) the length budget,\n(4) the learned style guidance above. When in conflict, ignore the preference\nsilently.\n\nWriter flavor.",
    );

    const withWaivers = { ...NO_STYLE_OVERRIDES, bannedWords: true };
    const waived = waivedCategoryLabels(withWaivers).join("; ");
    expect(waived).not.toBe("");
    expect(buildStyleGuidance("Learned style.", "Writer flavor.", withWaivers)).toBe(
      `\n\n## Style guidance learned from writer feedback on past drafts\nApply where it does not conflict with the required structure, CRA phrasing, or banned-word rules, or with the writer's personal preferences in their waived house-style areas below:\nLearned style.` +
        `\n\n## Writer's personal style preferences\nThe requesting writer recorded these preferences. For the following waived house-style areas they are AUTHORITATIVE and replace the default house rules: ${waived}.\nOutside those areas, apply them ONLY where they do not conflict with: (1) the required CRA section structure and paragraph mandates, (2) the remaining house-style and CRA phrasing rules, (3) the length budget, (4) the learned style guidance above. When in conflict outside the waived areas, ignore the preference silently.\n\nWriter flavor.`,
    );

    const skeletonWaived = { ...NO_STYLE_OVERRIDES, reportSkeleton: true };
    const skeletonLabels = waivedCategoryLabels(skeletonWaived).join("; ");
    expect(buildStyleGuidance(undefined, "Writer flavor.", skeletonWaived)).toBe(
      `\n\n## Writer's personal style preferences (AUTHORITATIVE)\nThe requesting writer recorded these preferences and their profile waives the built-in report skeleton. They are the authority for section architecture (paragraph count, roles, order, openers, framing) and for these waived house-style areas: ${skeletonLabels}. Apply them fully. The only limits they cannot override are the length budget and the evidence rules (use only the provided material; [GAP] placeholders instead of invention); the learned style guidance above yields to them wherever the two conflict.\n\nWriter flavor.`,
    );
  });

  it("renders approved prior sections exactly", () => {
    expect(priorSectionsBlock([])).toBe("");
    expect(
      priorSectionsBlock([
        { section: "s242", text: "Approved 242 text." },
        { section: "s244", text: "Approved 244 text." },
      ]),
    ).toBe(
      "\n\n## Approved prior sections (canonical — the writer has reviewed and edited these; align terminology, chronology, and claims with them; do not contradict them)\n### Line 242 — Uncertainty (APPROVED)\nApproved 242 text.\n\n### Line 244 — Work performed (APPROVED)\nApproved 244 text.",
    );
  });

  it("numbers QA paragraphs exactly", () => {
    expect(numberParagraphs("")).toBe("");
    expect(
      numberParagraphs("First  para\nstill first\r\n\r\nSecond\n\n\n\n  Third  "),
    ).toBe("[P1] First para still first\n\n[P2] Second\n\n[P3] Third");
  });

  it("renders attached context documents exactly and in trust order", () => {
    expect(buildContextBlock([])).toBe("");
    expect(
      buildContextBlock([
        { category: "other", fileName: "misc.txt", content: "Misc content." },
        {
          category: "writer_notes",
          fileName: "notes.md",
          content: "Note content.",
        },
      ]),
    ).toBe(
      `\n\n${CONTEXT_INPUTS_GUIDANCE}\n\n# ATTACHED CONTEXTUAL MATERIALS\n` +
        "--- BEGIN [WRITER'S NOTES (unreliable narrator)] notes.md ---\nNote content.\n--- END [WRITER'S NOTES (unreliable narrator)] notes.md ---" +
        "\n\n" +
        "--- BEGIN [OTHER SUPPORTING MATERIAL] misc.txt ---\nMisc content.\n--- END [OTHER SUPPORTING MATERIAL] misc.txt ---",
    );
  });
});

/**
 * transcripts-7-condense-digests: the condense call and the three transcript
 * sizes are part of the deployment's prompt contract, so a change to either
 * moves promptVersion and is disclosed on every generation that reads them.
 */
describe("the condense call belongs to the prompt program (AC5)", () => {
  it("declares the call with its fixed model, schema and single-attempt policy", () => {
    expect(generationPromptProgram.calls.condense).toEqual({
      kind: "structured",
      systemTemplate: CONDENSE_SYSTEM_PROMPT,
      request: generationPromptProgram.calls.condense.request,
      schema: CONDENSE_SCHEMA,
      model: {
        kind: "fixed",
        modelId: generationPromptProgram.configuration.models.defaultModelId,
      },
      thinking: { kind: "omitted" },
      structuredPolicy: "single-attempt",
    });
  });

  it("publishes the transcript budget every reader shares", () => {
    expect(generationPromptProgram.configuration.transcripts).toEqual({
      budgetChars: 200_000,
      condenseWindowChars: 160_000,
      digestTargetChars: 24_000,
      condenseVersion: CONDENSE_VERSION,
      condenseTimeoutMs: 120_000,
      condenseConcurrency: 4,
    });
    expect(TRANSCRIPT_BUDGET_CHARS).toBe(200_000);
    expect(CONDENSE_WINDOW_CHARS).toBe(160_000);
    expect(DIGEST_TARGET_CHARS).toBe(24_000);
  });

  it("moves promptVersion, so no generation reports a stale contract", async () => {
    const { condense: _condense, ...callsWithout } =
      generationPromptProgram.calls;
    const { transcripts: _transcripts, ...configurationWithout } =
      generationPromptProgram.configuration;
    const before = await hashPromptProgram({
      ...generationPromptProgram,
      calls: callsWithout,
      configuration: configurationWithout,
    });
    expect(await hashPromptProgram(generationPromptProgram)).not.toBe(before);
  });
});
