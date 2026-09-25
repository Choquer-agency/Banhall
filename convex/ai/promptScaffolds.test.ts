import { describe, expect, it } from "vitest";
import { buildTrustedContext, DEFAULT_CONTEXT_BUDGET } from "./trustedContext";
import { CONDENSE_SCHEMA, CONDENSE_SYSTEM_PROMPT } from "./condenseAgent";
import {
  BRIEF_INPUT_BUDGET,
  BRIEF_OMITTED_SOURCES_NOTICE,
  BRIEF_REQUEST,
  BRIEF_SCHEMA,
  BRIEF_SYSTEM_PROMPT,
} from "./brief";
import {
  ANALYSIS_TOOL_SCHEMA,
  STYLE_ANALYSIS_REQUEST,
  STYLE_ANALYSIS_SYSTEM_PROMPT,
  buildStyleAnalysisPrompt,
} from "./styleAnalysis";
import { HOUSE_RULE_TEXTS } from "../../shared/houseRules";
import { generationPromptProgram, hashPromptProgram } from "./promptProgram";
import {
  CONDENSE_VERSION,
  CONDENSE_WINDOW_CHARS,
  DIGEST_TARGET_CHARS,
  TRANSCRIPT_BUDGET_CHARS,
} from "../lib/transcripts";
import { priorSectionsBlock } from "./iterative";
import { buildStyleGuidance, lengthBudgetBlock, toContextDocs } from "./pipeline";
import {
  CONTEXT_INPUTS_GUIDANCE,
  SUMMARY_PLAN_SELF_CHECK_SYSTEM_PROMPT,
  waivedCategoryLabels,
} from "./prompts";
import { numberParagraphs } from "./qaAgent";
import { CHARS_PER_LINE, LINE_LIMITS, wordBudget } from "../lib/lineLimits";
import { NO_STYLE_OVERRIDES } from "../../shared/styleOverrides";
import {
  SEED_PROMPT_PROGRAM,
  SUMMARY_PLAN_SELF_CHECK_REQUEST,
  SUMMARY_PLAN_SELF_CHECK_SCHEMA,
} from "./promptDefinitions";
import {
  FROZEN_SUMMARY_PLAN_CHECKS_SCAFFOLD,
  FROZEN_SUMMARY_PLAN_SCAFFOLD,
  MAX_SUMMARY_ORDINARY_VERDICTS,
  MAX_SUMMARY_PLAN_CHECK_INPUT_UTF8_BYTES,
  MAX_SUMMARY_PLAN_VERDICTS,
  MAX_SUMMARY_SELF_CHECK_RESPONSE_UTF8_BYTES,
  SUMMARY_ORDINARY_LABEL_PROJECTION_VERSION,
  SUMMARY_PLAN_SERIALIZER_VERSION,
} from "../lib/seedRevisions";

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
      `\n\n# LENGTH BUDGET (CRA form constraint, hard requirement)\nThe CRA form field for this section holds at most ${lines} lines of ${CHARS_PER_LINE} characters, and EVERY blank line between paragraphs also costs one full line. Write AT MOST ${words} words total. Prefer fewer, denser paragraphs (each blank line spent on a paragraph break is a line of content lost). Do NOT pad. If the material exceeds the budget, keep the most technically load-bearing content and cut the rest.`,
    );
  });

  it("renders learned style guidance and each writer-preference branch exactly", () => {
    expect(buildStyleGuidance(undefined, undefined)).toBe("");
    expect(buildStyleGuidance("   ", "\n")).toBe("");

    expect(buildStyleGuidance("  Learned style.  ", undefined)).toBe(
      "\n\n## Style guidance learned from writer feedback on past drafts\nApply where it does not conflict with the required structure, CRA phrasing, or banned-word rules:\nLearned style.",
    );

    expect(buildStyleGuidance(undefined, " Writer flavor. ")).toBe(
      "\n\n## Writer's personal style preferences (lowest priority)\nThe requesting writer recorded these personal preferences. Apply them ONLY where\nthey do not conflict with: (1) the required CRA section structure and required-content\nmandates, (2) CRA phrasing and banned-word rules, (3) the length budget,\n(4) the learned style guidance above. When in conflict, ignore the preference\nsilently.\n\nWriter flavor.",
    );

    const withWaivers = { ...NO_STYLE_OVERRIDES, bannedWords: true };
    const waived = waivedCategoryLabels(withWaivers).join("; ");
    expect(waived).not.toBe("");
    expect(buildStyleGuidance("Learned style.", "Writer flavor.", withWaivers)).toBe(
      `\n\n## Style guidance learned from writer feedback on past drafts\nApply where it does not conflict with the required structure, CRA phrasing, or banned-word rules, or with the writer's personal preferences in their waived house-style areas below:\nLearned style.` +
        `\n\n## Writer's personal style preferences\nThe requesting writer recorded these preferences. For the following waived house-style areas they are AUTHORITATIVE and replace the default house rules: ${waived}.\nOutside those areas, apply them ONLY where they do not conflict with: (1) the required CRA section structure and required-content mandates, (2) the remaining house-style and CRA phrasing rules, (3) the length budget, (4) the learned style guidance above. When in conflict outside the waived areas, ignore the preference silently.\n\nWriter flavor.`,
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
      "\n\n## Approved prior sections (canonical: the writer has reviewed and edited these; align terminology, chronology, and claims with them; do not contradict them)\n### Line 242 (Uncertainty) (APPROVED)\nApproved 242 text.\n\n### Line 244 (Work performed) (APPROVED)\nApproved 244 text.",
    );
  });

  it("numbers QA paragraphs exactly", () => {
    expect(numberParagraphs("")).toBe("");
    expect(
      numberParagraphs("First  para\nstill first\r\n\r\nSecond\n\n\n\n  Third  "),
    ).toBe("[P1] First para still first\n\n[P2] Second\n\n[P3] Third");
  });

  it("renders the transcript and attached documents exactly and in trust order", () => {
    // Zero documents still emits the guidance, and the transcript itself is
    // wrapped in the same BEGIN/END markers the guidance promises.
    expect(
      buildTrustedContext({
        transcriptParts: [{ label: "Interview transcript", content: "Interview body" }],
      }).userMessage,
    ).toBe(
      "Here is the interview transcript to analyze:\n\n" +
        "--- BEGIN [INTERVIEW TRANSCRIPT] ---\nInterview body\n--- END [INTERVIEW TRANSCRIPT] ---" +
        `\n\n${CONTEXT_INPUTS_GUIDANCE}`,
    );

    expect(
      buildTrustedContext({
        transcriptParts: [{ label: "Interview transcript", content: "Interview body" }],
        documents: [
          { category: "other", fileName: "misc.txt", content: "Misc content." },
          {
            category: "writer_notes",
            fileName: "notes.md",
            content: "Note content.",
            // CAP-3: only an internal uploader keeps the notes label.
            uploaderRole: "writer",
          },
        ],
      }).userMessage,
    ).toBe(
      "Here is the interview transcript to analyze:\n\n" +
        "--- BEGIN [INTERVIEW TRANSCRIPT] ---\nInterview body\n--- END [INTERVIEW TRANSCRIPT] ---" +
        `\n\n${CONTEXT_INPUTS_GUIDANCE}` +
        "\n\n# ATTACHED CONTEXTUAL MATERIALS\n" +
        "--- BEGIN [WRITER'S NOTES (unreliable narrator)] notes.md ---\nNote content.\n--- END [WRITER'S NOTES (unreliable narrator)] notes.md ---" +
        "\n\n" +
        "--- BEGIN [OTHER SUPPORTING MATERIAL] misc.txt ---\nMisc content.\n--- END [OTHER SUPPORTING MATERIAL] misc.txt ---",
    );
  });

  it("hands a legacy frozen source to the analyzer as client evidence (CAP-3)", () => {
    // The whole seam a legacy row travels: a `generationSources` row frozen
    // before CAP-3 carries no uploaderRole, `getGenerationInput` surfaces that
    // absence, `toContextDocs` narrows it away, and the assembled message must
    // label the document OTHER SUPPORTING MATERIAL — never as the authoritative
    // direction the guidance grants WRITER'S NOTES.
    const legacyContextDocs = [
      // Hand-built pre-narrowing input. `getGenerationInput` omits the key
      // entirely (generationInput.test.ts pins that); an explicit `undefined`
      // is the widest shape `toContextDocs` accepts and must narrow the same.
      {
        category: "writer_notes",
        fileName: "legacy.md",
        content: "Unattributed direction.",
        uploaderRole: undefined,
      },
    ];
    const docs = toContextDocs(legacyContextDocs);
    expect("uploaderRole" in docs[0]).toBe(false);

    const { userMessage, report } = buildTrustedContext({ documents: docs });
    expect(userMessage).toContain(
      "--- BEGIN [OTHER SUPPORTING MATERIAL] legacy.md ---\nUnattributed direction.\n--- END [OTHER SUPPORTING MATERIAL] legacy.md ---",
    );
    expect(userMessage).not.toContain("[WRITER'S NOTES");
    expect(report.sources[0].trust).toBe("client");
    expect(report.sources[0].category).toBe("other");
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

  it("discloses the analyzer context budget defaults", () => {
    // The budget decides how much of each frozen source reaches the model, so
    // retuning the defaults must move promptVersion.
    expect(generationPromptProgram.calls.analyzer.contextBudget).toEqual(
      DEFAULT_CONTEXT_BUDGET
    );
    expect(DEFAULT_CONTEXT_BUDGET).toEqual({
      totalTokens: 150_000,
      transcriptTokens: 100_000,
      perDocumentTokens: 10_000,
      maxDocuments: 12,
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

  it("declares the brief call with the real Brief prompt, request and schema (story 1, AD-27)", () => {
    // Story 1 wired calls.brief to BRIEF_SYSTEM_PROMPT/BRIEF_REQUEST/BRIEF_SCHEMA
    // in place of the original placeholder. Unlike calls.condense/calls.analyzer,
    // nothing pinned this wiring against drift — a future edit to those constants
    // (or to calls.brief itself) without this assertion could silently diverge
    // without moving promptVersion the way the sibling calls do.
    expect(generationPromptProgram.calls.brief).toEqual({
      kind: "structured",
      systemTemplate: BRIEF_SYSTEM_PROMPT,
      request: BRIEF_REQUEST,
      // Cost phase 1: the Brief's input selection and budget are disclosed.
      inputSelection: "digest-replaces-its-transcript",
      contextBudget: BRIEF_INPUT_BUDGET,
      omittedSourcesNotice: BRIEF_OMITTED_SOURCES_NOTICE,
      schema: BRIEF_SCHEMA,
      model: { kind: "candidate", fallbackModelId: generationPromptProgram.calls.brief.model.fallbackModelId },
      thinking: { kind: "omitted" },
      structuredPolicy: "two-attempt-repair",
      callSite: "generation:brief",
    });
  });

  it("declares both seed modes from the hashed scaffold with a two-request repair envelope", async () => {
    expect(generationPromptProgram.templates.seeds.scaffolds).toBe(
      SEED_PROMPT_PROGRAM
    );
    expect(generationPromptProgram.templates.seeds.roles).toHaveLength(13);
    expect(SEED_PROMPT_PROGRAM.user.guidance).toContain(
      "when the frozen predecessor decisions include experimentation selections"
    );
    expect(SEED_PROMPT_PROGRAM.user.guidance).toContain(
      "When there are no frozen experiment selections, omit both link fields."
    );
    expect(
      generationPromptProgram.templates.seeds.roles.find(
        (role) => role.roleId === "specific_advancements"
      )
    ).toMatchObject({
      objective: expect.any(String),
      schemas: {
        batch: expect.objectContaining({ type: "object" }),
        feedback: expect.objectContaining({ type: "object" }),
      },
    });
    expect(generationPromptProgram.calls.seeds).toMatchObject({
      systemTemplate: SEED_PROMPT_PROGRAM.systemPolicy,
      userScaffold: SEED_PROMPT_PROGRAM.user,
      request: SEED_PROMPT_PROGRAM.request,
      structuredPolicy: "two-attempt-repair",
      callSite: "generation:seeds:<roleId>",
    });
    expect(generationPromptProgram.calls.seedFeedback).toMatchObject({
      systemTemplate: SEED_PROMPT_PROGRAM.systemPolicy,
      userScaffold: SEED_PROMPT_PROGRAM.user,
      request: SEED_PROMPT_PROGRAM.request,
      structuredPolicy: "two-attempt-repair",
      callSite: "generation:seedFeedback:<roleId>",
    });
    const current = await hashPromptProgram(generationPromptProgram);
    const changedObjective = await hashPromptProgram({
      ...generationPromptProgram,
      templates: {
        ...generationPromptProgram.templates,
        seeds: {
          ...generationPromptProgram.templates.seeds,
          roles: generationPromptProgram.templates.seeds.roles.map((role) =>
            role.roleId === "active_uncertainties"
              ? { ...role, objective: `${role.objective} Changed.` }
              : role
          ),
        },
      },
    });
    const changedSchema = await hashPromptProgram({
      ...generationPromptProgram,
      calls: {
        ...generationPromptProgram.calls,
        seeds: {
          ...generationPromptProgram.calls.seeds,
          schemaByRole: {
            ...generationPromptProgram.calls.seeds.schemaByRole,
            active_uncertainties: { type: "object", required: [] },
          },
        },
      },
    });
    expect(changedObjective).not.toBe(current);
    expect(changedSchema).not.toBe(current);
  });

  it("declares the settings-document classifier with the PSOS-50 prompt, request and schema verbatim (story 3, AD-27)", async () => {
    expect(generationPromptProgram.calls.settingsAnalysis).toEqual({
      kind: "structured",
      systemTemplate: STYLE_ANALYSIS_SYSTEM_PROMPT,
      request: STYLE_ANALYSIS_REQUEST,
      schema: ANALYSIS_TOOL_SCHEMA,
      model: {
        kind: "fixed",
        modelId: generationPromptProgram.configuration.models.defaultModelId,
      },
      thinking: { kind: "omitted" },
      structuredPolicy: "single-attempt",
      callSite: "generation:settings",
      cache: "per-projectId-and-contentHash-and-classifierVersion",
    });
    // The declared system text and user template are exactly what the
    // classifier sends (the settings page and the generation path share them).
    const built = buildStyleAnalysisPrompt("{{runtime.instructions}}");
    expect(built.system).toBe(STYLE_ANALYSIS_SYSTEM_PROMPT);
    expect(STYLE_ANALYSIS_REQUEST.userTemplate).toBe(built.user);
    expect(STYLE_ANALYSIS_REQUEST.userTemplate).toContain(HOUSE_RULE_TEXTS.reportSkeleton);
    expect(STYLE_ANALYSIS_REQUEST.toolName).toBe("submit_style_analysis");
  });

  it("editing the classifier system text changes the computed promptVersion (story 3)", async () => {
    const current = await hashPromptProgram(generationPromptProgram);
    const edited = await hashPromptProgram({
      ...generationPromptProgram,
      calls: {
        ...generationPromptProgram.calls,
        settingsAnalysis: {
          ...generationPromptProgram.calls.settingsAnalysis,
          systemTemplate: `${STYLE_ANALYSIS_SYSTEM_PROMPT}\nAlso mark addressed=true for any mention of tone.`,
        },
      },
    });
    expect(edited).not.toBe(current);
    // The unedited program hashes stably.
    expect(await hashPromptProgram({ ...generationPromptProgram })).toBe(current);
  });

  it("fingerprints the executable Summary plan and its conditional Self-check contract", async () => {
    expect(SUMMARY_PLAN_SELF_CHECK_SCHEMA.additionalProperties).toBe(false);
    expect(SUMMARY_PLAN_SELF_CHECK_SCHEMA.properties.verdicts.items.additionalProperties)
      .toBe(false);
    expect(SUMMARY_PLAN_SELF_CHECK_SCHEMA.properties.storylineQuestion.additionalProperties)
      .toBe(false);
    const planSchema = SUMMARY_PLAN_SELF_CHECK_SCHEMA.properties.planVerdicts.items;
    expect(planSchema.additionalProperties).toBe(false);
    expect(planSchema.oneOf).toEqual([
      { required: ["itemId"] },
      { required: ["skippedRoleId"] },
    ]);
    expect(planSchema.required).not.toContain("paragraph");
    expect(generationPromptProgram.calls.selfCheck.summaryPlan).toEqual({
      systemTemplate: SUMMARY_PLAN_SELF_CHECK_SYSTEM_PROMPT,
      requestScaffold: SUMMARY_PLAN_SELF_CHECK_REQUEST,
      schema: SUMMARY_PLAN_SELF_CHECK_SCHEMA,
      structuredPolicy: "single-attempt-no-repair",
      encodedJsonRecovery: "disabled",
    });
    expect(generationPromptProgram.templates.seeds.summaryPlan).toEqual({
      drafting: FROZEN_SUMMARY_PLAN_SCAFFOLD,
      checks: FROZEN_SUMMARY_PLAN_CHECKS_SCAFFOLD,
      serializerVersion: SUMMARY_PLAN_SERIALIZER_VERSION,
      ordinaryLabelProjectionVersion:
        SUMMARY_ORDINARY_LABEL_PROJECTION_VERSION,
      capacity: {
        maxOrdinaryVerdicts: MAX_SUMMARY_ORDINARY_VERDICTS,
        maxPlanVerdicts: MAX_SUMMARY_PLAN_VERDICTS,
        maxCheckInputUtf8Bytes: MAX_SUMMARY_PLAN_CHECK_INPUT_UTF8_BYTES,
        maxResponseUtf8Bytes: MAX_SUMMARY_SELF_CHECK_RESPONSE_UTF8_BYTES,
      },
    });
    const current = await hashPromptProgram(generationPromptProgram);
    const changedSelfCheck = await hashPromptProgram({
      ...generationPromptProgram,
      calls: {
        ...generationPromptProgram.calls,
        selfCheck: {
          ...generationPromptProgram.calls.selfCheck,
          summaryPlan: {
            ...generationPromptProgram.calls.selfCheck.summaryPlan,
            systemTemplate: `${SUMMARY_PLAN_SELF_CHECK_SYSTEM_PROMPT}\nChanged.`,
          },
        },
      },
    });
    const changedPlanScaffold = await hashPromptProgram({
      ...generationPromptProgram,
      templates: {
        ...generationPromptProgram.templates,
        seeds: {
          ...generationPromptProgram.templates.seeds,
          summaryPlan: {
            ...generationPromptProgram.templates.seeds.summaryPlan,
            drafting: {
              ...generationPromptProgram.templates.seeds.summaryPlan.drafting,
              precedence: `${FROZEN_SUMMARY_PLAN_SCAFFOLD.precedence} Changed.`,
            },
          },
        },
      },
    });
    const changedStructuredPolicy = await hashPromptProgram({
      ...generationPromptProgram,
      calls: {
        ...generationPromptProgram.calls,
        selfCheck: {
          ...generationPromptProgram.calls.selfCheck,
          summaryPlan: {
            ...generationPromptProgram.calls.selfCheck.summaryPlan,
            structuredPolicy: "changed-policy" as "single-attempt-no-repair",
          },
        },
      },
    });
    const changedSerializerVersion = await hashPromptProgram({
      ...generationPromptProgram,
      templates: {
        ...generationPromptProgram.templates,
        seeds: {
          ...generationPromptProgram.templates.seeds,
          summaryPlan: {
            ...generationPromptProgram.templates.seeds.summaryPlan,
            serializerVersion: "summary-plan-jsonl-v2",
          },
        },
      },
    });
    const changedOrdinaryProjectionVersion = await hashPromptProgram({
      ...generationPromptProgram,
      templates: {
        ...generationPromptProgram.templates,
        seeds: {
          ...generationPromptProgram.templates.seeds,
          summaryPlan: {
            ...generationPromptProgram.templates.seeds.summaryPlan,
            ordinaryLabelProjectionVersion: "summary-ordinary-labels-v2",
          },
        },
      },
    });
    const changedEncodedJsonPolicy = await hashPromptProgram({
      ...generationPromptProgram,
      calls: {
        ...generationPromptProgram.calls,
        selfCheck: {
          ...generationPromptProgram.calls.selfCheck,
          summaryPlan: {
            ...generationPromptProgram.calls.selfCheck.summaryPlan,
            encodedJsonRecovery: "enabled" as "disabled",
          },
        },
      },
    });
    const changedSchemaProgram = structuredClone(generationPromptProgram);
    Object.assign(
      changedSchemaProgram.calls.selfCheck.summaryPlan.schema,
      { additionalProperties: true }
    );
    const changedSummarySchema = await hashPromptProgram(changedSchemaProgram);
    expect(changedSelfCheck).not.toBe(current);
    expect(changedPlanScaffold).not.toBe(current);
    expect(changedSerializerVersion).not.toBe(current);
    expect(changedOrdinaryProjectionVersion).not.toBe(current);
    expect(changedStructuredPolicy).not.toBe(current);
    expect(changedEncodedJsonPolicy).not.toBe(current);
    expect(changedSummarySchema).not.toBe(current);
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
