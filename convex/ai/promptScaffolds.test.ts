import { describe, expect, it } from "vitest";
import { buildTrustedContext, DEFAULT_CONTEXT_BUDGET } from "./trustedContext";
import { CONDENSE_SCHEMA, CONDENSE_SYSTEM_PROMPT } from "./condenseAgent";
import {
  BRIEF_INPUT_BUDGET,
  BRIEF_OMITTED_SOURCES_NOTICE,
  BRIEF_REQUEST,
  BRIEF_SCHEMA,
  BRIEF_SYSTEM_PROMPT,
  BRIEF_WRITER_WORDING,
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
  SELF_CHECK_SYSTEM_PROMPT,
  SUMMARY_PLAN_REPORT_FACTS_RULES,
  SUMMARY_PLAN_SELF_CHECK_SYSTEM_PROMPT,
  waivedCategoryLabels,
} from "./prompts";
import { RULES_REPORT_FACTS, SOURCE_TALK } from "../../shared/humanProse";
import { numberParagraphs } from "./qaAgent";
import { CHARS_PER_LINE, LINE_LIMITS, wordBudget } from "../lib/lineLimits";
import { NO_STYLE_OVERRIDES } from "../../shared/styleOverrides";
import {
  SEED_ADVANCEMENT_LINK_RULES,
  SEED_EXPERIMENT_LINK_RULES,
  SEED_LINK_RULES,
  SEED_PLAN_LINK_RULES,
  SEED_PROMPT_PROGRAM,
  SEED_RESULT_LINK_RULES,
  SUMMARY_PLAN_SELF_CHECK_EXTRA_REF_SCHEMAS,
  SUMMARY_PLAN_SELF_CHECK_FACTS_FINDINGS_SCHEMA,
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
import { seedToolSchemaForFacts } from "../lib/seedFacts";
import { linkedSeedSchemas, seedToolSchema } from "../lib/seedContract";
import { FACTS_SCHEMA, FACTS_SYSTEM_PROMPT } from "./transcriptFactsAgent";
import { FACTS_VERSION } from "../lib/transcriptFacts";

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
  it("declares the call with its frozen condense-role model, schema and single-attempt policy", () => {
    expect(generationPromptProgram.calls.condense).toEqual({
      kind: "structured",
      systemTemplate: CONDENSE_SYSTEM_PROMPT,
      request: generationPromptProgram.calls.condense.request,
      schema: CONDENSE_SCHEMA,
      model: {
        kind: "frozen-role",
        role: "condense",
        legacyModelId: generationPromptProgram.configuration.models.defaultModelId,
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
      // 2026-09-24 (transcript method): fact packs first, then digests.
      inputSelection: "fact-pack-else-digest-replaces-its-transcript",
      factModeCitations: "quote-located-in-a-verified-fact-span-on-the-transcript-row",
      contextBudget: BRIEF_INPUT_BUDGET,
      omittedSourcesNotice: BRIEF_OMITTED_SOURCES_NOTICE,
      // 2026-10-04 (first, round 2): the writer's wording rule, sent only
      // with a settings document an internal uploader supplied.
      writerWording: BRIEF_WRITER_WORDING,
      schema: BRIEF_SCHEMA,
      // Owner decision 43: the frozen planning model; the selected model before step routing.
      model: {
        kind: "generation-step",
        step: "brief",
        beforeStepRouting: { kind: "candidate", fallbackModelId: generationPromptProgram.calls.brief.model.beforeStepRouting.fallbackModelId },
      },
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
      "when the request has a FROZEN ADVANCEMENT LINKS block"
    );
    expect(SEED_PROMPT_PROGRAM.user.guidance).toContain(
      "When there is no FROZEN ADVANCEMENT LINKS block, omit both link fields."
    );
    expect(
      generationPromptProgram.templates.seeds.roles.find(
        (role) => role.roleId === "specific_advancements"
      )
    ).toMatchObject({ objective: expect.any(String) });
    // Cost phase 1: one provider schema for every role and both modes.
    expect(generationPromptProgram.calls.seeds.schema).toBe(
      generationPromptProgram.calls.seedFeedback.schema
    );
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
          schema: { type: "object", required: [] },
        },
      },
    });
    expect(changedObjective).not.toBe(current);
    expect(changedSchema).not.toBe(current);
  });

  it("declares the fact-mode Seed schema and guidance (2026-09-24, transcript method)", async () => {
    expect(generationPromptProgram.calls.seeds.factSchema).toEqual(seedToolSchemaForFacts());
    expect(generationPromptProgram.calls.seedFeedback.factSchema).toBe(
      generationPromptProgram.calls.seeds.factSchema
    );
    expect(SEED_PROMPT_PROGRAM.user.factGuidance).toContain("cite it by its factId");
    expect(SEED_PROMPT_PROGRAM.user.factGuidance).toContain(
      "Never cite a transcript by excerpt or by character offsets."
    );
    // The same link rules as the offsets guidance.
    expect(SEED_PROMPT_PROGRAM.user.factGuidance).toContain(
      "When there is no FROZEN ADVANCEMENT LINKS block, omit both link fields."
    );
    expect(generationPromptProgram.calls.transcriptFacts).toMatchObject({
      systemTemplate: FACTS_SYSTEM_PROMPT,
      adapters: { openrouter: { schema: FACTS_SCHEMA } },
      model: { kind: "frozen-role", role: "condense" },
      callSite: "generation:facts",
    });
    expect(generationPromptProgram.configuration.transcriptFacts.factsVersion).toBe(FACTS_VERSION);
    const current = await hashPromptProgram(generationPromptProgram);
    const changedGuidance = await hashPromptProgram({
      ...generationPromptProgram,
      templates: {
        ...generationPromptProgram.templates,
        seeds: {
          ...generationPromptProgram.templates.seeds,
          scaffolds: {
            ...SEED_PROMPT_PROGRAM,
            user: { ...SEED_PROMPT_PROGRAM.user, factGuidance: "Changed." },
          },
        },
      },
    });
    expect(changedGuidance).not.toBe(current);
  });

  it("versions the advancement link rules (2026-09-28, fourth amendment)", () => {
    expect(SEED_PROMPT_PROGRAM.user.blocks.advancementLinks).toBe("FROZEN ADVANCEMENT LINKS");
    expect(SEED_PROMPT_PROGRAM.user.order).toContain("{{runtime.advancementLinks}}");
    for (const guidance of [SEED_PROMPT_PROGRAM.user.guidance, SEED_PROMPT_PROGRAM.user.factGuidance]) {
      expect(guidance).toContain(SEED_ADVANCEMENT_LINK_RULES);
      expect(guidance).not.toMatch(/[\u2013\u2014]/);
    }
  });

  it("names each experiment's uncertainty and makes advancements follow it (2026-09-29, first amendment)", () => {
    expect(SEED_PROMPT_PROGRAM.version).toBe("seeds.2026-10-04.1");
    expect(SEED_PROMPT_PROGRAM.user.blocks.experimentLinks).toBe("FROZEN EXPERIMENT LINKS");
    // Run 7: the exact pairs in a repair have their own reserved bytes.
    expect(SEED_PROMPT_PROGRAM.request.repairLinkPairsMaxUtf8Bytes).toBe(768);
    // Targeted run 2 and its re-check: the fixed tools (the linked ones
    // require their links) and the repair that keeps them are part of the
    // hashed program. 2026-09-30 (fourth): a fourth, the result tool.
    expect(SEED_PROMPT_PROGRAM.request.linkedToolPolicy).toBe(
      "four-fixed-tools-in-every-seed-request-tool_choice-forces-the-linked-one-when-a-link-block-is-sent"
    );
    expect(SEED_PROMPT_PROGRAM.request.linkedTools.experiment.name).toBe("submit_experiment_seed_batch");
    expect(SEED_PROMPT_PROGRAM.request.linkedTools.advancement.name).toBe("submit_advancement_seed_batch");
    expect(generationPromptProgram.calls.seeds.linkedSchemas).toEqual(linkedSeedSchemas(seedToolSchema()));
    expect(generationPromptProgram.calls.seedFeedback.factLinkedSchemas).toEqual(linkedSeedSchemas(seedToolSchemaForFacts()));
    expect(SEED_PROMPT_PROGRAM.request.linkRepair.opening).toContain("Keep each Seed's link fields");
    expect(JSON.stringify(SEED_PROMPT_PROGRAM.request.linkRepair)).not.toMatch(/[\u2013\u2014]/);
    // The experiment block renders after the decisions, before the advancement block.
    const order: readonly string[] = SEED_PROMPT_PROGRAM.user.order;
    expect(order.indexOf("{{runtime.decisions}}")).toBeLessThan(order.indexOf("{{runtime.experimentLinks}}"));
    expect(order.indexOf("{{runtime.experimentLinks}}")).toBeLessThan(order.indexOf("{{runtime.advancementLinks}}"));
    expect(SEED_PROMPT_PROGRAM.user.runtimeSentinels).toContain("{{runtime.experimentLinks}}");
    expect(SEED_LINK_RULES.startsWith(SEED_EXPERIMENT_LINK_RULES + SEED_ADVANCEMENT_LINK_RULES + SEED_RESULT_LINK_RULES)).toBe(true);
    for (const guidance of [SEED_PROMPT_PROGRAM.user.guidance, SEED_PROMPT_PROGRAM.user.factGuidance]) {
      expect(guidance.endsWith(SEED_LINK_RULES)).toBe(true);
      expect(guidance).toContain(
        "every Seed must set uncertaintySeedId to the one id from that block's uncertaintySeedIds list that names the uncertainty the experiment tested"
      );
      expect(guidance).toContain("never name an uncertainty an experiment did not test");
      expect(guidance).toContain(
        "its links list holds the only allowed pairs: each entry is one uncertainty and the picked experiments that tested it. Every Seed uses exactly one listed pair: copy the uncertaintySeedId of one entry exactly and set experimentSeedIds to one or more ids from that same entry's experimentSeedIds list. Never mix experiments from different entries in one Seed. Several Seeds may use the same entry. In a fresh Batch, write 3 to 5 advancements even when the list holds only one or two entries: split the findings of one entry into distinct advancements. A feedback revision keeps to its one to three Seeds, each on one listed pair."
      );
      // Run 7: an uncertainty no picked experiment tested gets no advancement.
      expect(guidance).toContain("such as one in the block's uncertaintiesWithoutTestedExperiments list, has no picked experiment that tested it, so write no advancement for it.");
      // The run 5 sentence stays where it applied (lead decision 3).
      expect(guidance).toContain("Work that is not one of those experiments cannot be an advancement here, even when a source or another step's selection describes it, and an advancement never claims to resolve an uncertainty it does not link;");
      expect(guidance).not.toContain("as few Seeds");
      expect(guidance).toContain(
        "Each advancement states what was learned about the uncertainty it links, from the experiments it links."
      );
      expect(guidance).toContain("an advancement never claims to resolve an uncertainty it does not link");
      expect(guidance).not.toMatch(/[\u2013\u2014]/);
    }
  });

  it("asks Advancement to science and goal improvements for the uncertainties they answer (2026-09-30, fourth amendment)", () => {
    expect(SEED_PROMPT_PROGRAM.user.blocks.resultLinks).toBe("FROZEN RESULT LINKS");
    const order: readonly string[] = SEED_PROMPT_PROGRAM.user.order;
    expect(order.indexOf("{{runtime.advancementLinks}}")).toBeLessThan(order.indexOf("{{runtime.resultLinks}}"));
    expect(order.indexOf("{{runtime.resultLinks}}")).toBeLessThan(order.indexOf("{{runtime.feedback}}"));
    expect(SEED_PROMPT_PROGRAM.user.runtimeSentinels).toContain("{{runtime.resultLinks}}");
    expect(SEED_PROMPT_PROGRAM.request.linkedTools.result).toEqual({
      name: "submit_result_seed_batch",
      // 2026-09-30 (fifth): the description now names the plan steps too.
      description:
        "Submit the complete Seed Batch for the work plan, a hypothesis, the overall advancement or goal improvements when the request has a FROZEN RESULT LINKS block: every Seed lists the uncertainties it plans work for, tests or states a result of.",
    });
    expect(SEED_PROMPT_PROGRAM.request.linkRepair.resultOpening).toContain("Keep each Seed's answeredUncertaintySeedIds exactly as it was");
    expect(generationPromptProgram.calls.seeds.linkedSchemas.result).toEqual(linkedSeedSchemas(seedToolSchema()).result);
    expect(generationPromptProgram.calls.seedFeedback.factLinkedSchemas.result).toEqual(linkedSeedSchemas(seedToolSchemaForFacts()).result);
    expect(SEED_RESULT_LINK_RULES).toBe(
      " For the overall advancement and for goal improvements, when the request has a FROZEN RESULT LINKS block, every Seed must set answeredUncertaintySeedIds to the ids, copied exactly from that block's uncertaintySeedIds list, of the uncertainties whose result the Seed states, and omit uncertaintySeedId and experimentSeedIds. An overall advancement Seed states the result for at least one listed uncertainty, so its list holds one or more ids. A goal improvements Seed lists each uncertainty whose result it states, or has an empty list when it only restates the goal without stating a result. State a result only for a listed uncertainty, and never list one whose result the Seed does not state. When there is no FROZEN RESULT LINKS block, omit answeredUncertaintySeedIds."
    );
    for (const guidance of [SEED_PROMPT_PROGRAM.user.guidance, SEED_PROMPT_PROGRAM.user.factGuidance]) {
      // 2026-09-30 (fifth): the plan rules follow the result rules.
      expect(guidance.endsWith(SEED_RESULT_LINK_RULES + SEED_PLAN_LINK_RULES)).toBe(true);
      expect(guidance).not.toMatch(/[\u2013\u2014]/);
    }
    expect(JSON.stringify(SEED_PROMPT_PROGRAM.request)).not.toMatch(/[\u2013\u2014]/);
  });

  it("asks Hypothesis and Work plan for the uncertainties they test (2026-09-30, fifth amendment)", () => {
    expect(SEED_PLAN_LINK_RULES).toBe(
      " For a hypothesis and for the work plan, when the request has a FROZEN RESULT LINKS block, its uncertaintySeedIds list holds the only uncertainties these Seeds may name: every Seed must set answeredUncertaintySeedIds to the ids, copied exactly, of the uncertainties a hypothesis tests or a work plan plans work for, at least one, and omit uncertaintySeedId and experimentSeedIds. Write a hypothesis or a work plan only for listed uncertainties, and never list one the Seed does not test or plan work for."
    );
    expect(SEED_LINK_RULES).toBe(SEED_EXPERIMENT_LINK_RULES + SEED_ADVANCEMENT_LINK_RULES + SEED_RESULT_LINK_RULES + SEED_PLAN_LINK_RULES);
    // The same four tools, names and order: only the result tool's description moved.
    expect(Object.keys(SEED_PROMPT_PROGRAM.request.linkedTools)).toEqual(["experiment", "advancement", "result"]);
    expect(SEED_PLAN_LINK_RULES).not.toMatch(/[\u2013\u2014]/);
  });

  it("versions the Seed quote rules (2026-09-27, third amendment)", async () => {
    expect(SEED_PROMPT_PROGRAM.version).toBe("seeds.2026-10-04.1");
    expect(SEED_PROMPT_PROGRAM.request.quoteRepair.opening).toContain("Some quotes may not back their idea card.");
    expect(JSON.stringify(SEED_PROMPT_PROGRAM.request.quoteRepair)).not.toMatch(/[\u2013\u2014]/);
    expect(generationPromptProgram.templates.seeds.scaffolds.version).toBe(SEED_PROMPT_PROGRAM.version);
    for (const guidance of [SEED_PROMPT_PROGRAM.user.guidance, SEED_PROMPT_PROGRAM.user.factGuidance]) {
      expect(guidance).toContain("reuse a short phrase of four or more words from the cited");
      expect(guidance).toMatch(/Do not cite the same (fact or )?excerpt on two Seeds unless both claims come from it\./);
      expect(guidance).not.toMatch(/[\u2013\u2014]/);
      // Review P3-7: a reused phrase may change punctuation; the dash rule holds.
      expect(guidance).toContain(
        "A reused phrase may change its punctuation, and the dash rule still applies: a dash in the source becomes a comma, a colon or a plain hyphen."
      );
    }
    expect(generationPromptProgram.calls.seeds.schemaPolicy.quoteCheck).toMatchObject({
      onIssue: "one-soft-repair-within-the-two-attempts-then-keep-and-mark-needsQuoteCheck",
    });
    const current = await hashPromptProgram(generationPromptProgram);
    const changedVersion = await hashPromptProgram({
      ...generationPromptProgram,
      templates: {
        ...generationPromptProgram.templates,
        seeds: {
          ...generationPromptProgram.templates.seeds,
          scaffolds: { ...SEED_PROMPT_PROGRAM, version: "seeds.previous" },
        },
      },
    });
    expect(changedVersion).not.toBe(current);
  });

  it("declares the settings-document classifier with the PSOS-50 prompt, request and schema verbatim (story 3, AD-27)", async () => {
    expect(generationPromptProgram.calls.settingsAnalysis).toEqual({
      kind: "structured",
      systemTemplate: STYLE_ANALYSIS_SYSTEM_PROMPT,
      request: STYLE_ANALYSIS_REQUEST,
      schema: ANALYSIS_TOOL_SCHEMA,
      model: {
        kind: "frozen-role",
        role: "analysis",
        legacyModelId: generationPromptProgram.configuration.models.defaultModelId,
      },
      thinking: { kind: "omitted" },
      structuredPolicy: "single-attempt",
      answerDecode: "object-or-array-fields-sent-as-json-text-fenced-in-prose-or-with-trailing-commas-read-then-validated",
      lockedConflicts: "absent-read-as-empty-decides-no-waiver",
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
      structuredPolicy: "single-attempt-then-missing-labels-follow-up",
      encodedJsonRecovery: "disabled",
      finalCoverage: "full-self-check-on-the-final-text-after-a-used-repair",
      invalidVerdicts: "dropped-and-asked-for-unless-most-are-invalid",
      unreadableLists: "read-as-empty-and-asked-for-unless-neither-is-a-list",
      editedTerms: "allowed-word-for-word-invention-objections-set-aside",
      writerPrecedence: "kept-ideas-judged-for-coverage-feedback-governs-named-glossary-terms-by-label-even-in-unedited-signed-off-ideas",
      droppedUncertainties: "left-out-in-every-line-one-plan-check-each-by-dropped-seed-id-at-most-three",
      advancementsAnswer242: "line-246-plan-check-with-line-242-text-as-data-honoured-by-absence",
      workAnswers242: "line-244-plan-check-with-line-242-text-and-line-246-items-as-data-honoured-by-absence",
      coverItemsFirst: "leave-out-and-rule-checks-compare-every-cover-item-before-not-applied",
      leaveOutFigureBackstop: "not-applied-leave-out-with-no-dropped-figure-or-near-copy-in-the-line-citing-only-plan-figures-recorded-applied-no-repair",
      extraRefSchemas: SUMMARY_PLAN_SELF_CHECK_EXTRA_REF_SCHEMAS,
      resultsAgainstTargets: "lines-244-and-246-plan-check-honoured-by-absence-judged-again-on-final-text",
      targetsUnlocated: "located-by-the-one-paragraph-its-words-name-else-its-words-kept",
      hedgesSourcesGlossary: "hedge-states-the-range-never-a-source-glossary-replaces-another-name-only",
      factsMatchSources: "every-line-plan-check-with-source-facts-block-honoured-by-absence-judged-again-on-final-text",
      factsFindings: "verified-quotes-only-shown-and-repaired-unverified-not-checked-source-documents-within-budget",
      factsFindingsSchema: SUMMARY_PLAN_SELF_CHECK_FACTS_FINDINGS_SCHEMA,
      factsItems: "writer-wording-only-the-sentences-the-writer-changed-unbacked-wording-marked-never-stands-for-the-sources",
      factsCapacity: {
        maxFindings: 2,
        draftQuoteBytes: 128,
        sourceQuoteBytes: 160,
        correctionBytes: 120,
        sourceDocumentsBytes: 48_000,
      },
    });
    // 2026-09-30 (third): the Summary system prompt ends with the rules for
    // hedges, sources and Glossary candidates; the legacy one never has them.
    expect(SUMMARY_PLAN_SELF_CHECK_SYSTEM_PROMPT.endsWith(`\n\n${SUMMARY_PLAN_REPORT_FACTS_RULES}`)).toBe(true);
    expect(SELF_CHECK_SYSTEM_PROMPT).not.toContain(SUMMARY_PLAN_REPORT_FACTS_RULES);
    for (const section of ["section242", "section244", "section246"] as const) {
      expect(generationPromptProgram.calls[section].reportFacts)
        .toBe("results-and-sources-rules-after-the-brief-in-signed-off-plan-runs");
    }
    expect(generationPromptProgram.calls.repair.signedOffPlan)
      .toBe("source-talk-found-deterministically-hedge-and-glossary-fixes-get-a-fixed-start");
    // 2026-10-04 (second): the facts fix and its scaffolds are in the program.
    // 2026-10-04 (first), Round 5: the writer's measured wording rules.
    expect(generationPromptProgram.calls.repair.writerWording)
      .toBe("terms-banned-words-and-openings-measured-in-code-exact-repair-issues-shortening-guarded-settings-and-glossary-verdicts-settled");
    expect(generationPromptProgram.calls.repair.factsFix)
      .toBe("whole-section-never-must-keep-cover-rollback");
    expect(generationPromptProgram.calls.selfCheck.summaryPlan.requestScaffold.factsMatchSources)
      .toBe(SUMMARY_PLAN_SELF_CHECK_REQUEST.factsMatchSources);
    // Round 2: changing the findings schema or a facts capacity moves the hash.
    const changedFindings = await hashPromptProgram({
      ...generationPromptProgram,
      calls: {
        ...generationPromptProgram.calls,
        selfCheck: {
          ...generationPromptProgram.calls.selfCheck,
          summaryPlan: {
            ...generationPromptProgram.calls.selfCheck.summaryPlan,
            factsCapacity: { ...generationPromptProgram.calls.selfCheck.summaryPlan.factsCapacity, sourceDocumentsBytes: 1 },
          },
        },
      },
    });
    expect(changedFindings).not.toBe(await hashPromptProgram(generationPromptProgram));
    expect(generationPromptProgram.templates.ordered.scaffolds.reportFacts.rules).toBe(RULES_REPORT_FACTS);
    expect(generationPromptProgram.templates.ordered.scaffolds.repairGuidance.sourceTalk).toBe(SOURCE_TALK);
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
            structuredPolicy: "changed-policy" as "single-attempt-then-missing-labels-follow-up",
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
            serializerVersion: "summary-plan-jsonl-v6",
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
            ordinaryLabelProjectionVersion: "summary-ordinary-labels-v3",
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
    expect(SUMMARY_PLAN_SELF_CHECK_REQUEST.maxTokens).toBe(
      MAX_SUMMARY_SELF_CHECK_RESPONSE_UTF8_BYTES
    );
    const changedAllowanceProgram = structuredClone(generationPromptProgram);
    Object.assign(
      changedAllowanceProgram.calls.selfCheck.summaryPlan.requestScaffold,
      { maxTokens: 4096 }
    );
    const changedSummaryAllowance = await hashPromptProgram(changedAllowanceProgram);
    const changedCapacityProgram = structuredClone(generationPromptProgram);
    Object.assign(
      changedCapacityProgram.templates.seeds.summaryPlan.capacity,
      { maxResponseUtf8Bytes: 4_096 }
    );
    const changedResponseCapacity = await hashPromptProgram(changedCapacityProgram);
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
    expect(changedSummaryAllowance).not.toBe(current);
    expect(changedResponseCapacity).not.toBe(current);
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
