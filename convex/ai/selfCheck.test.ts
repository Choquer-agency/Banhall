/// <reference types="vite/client" />

// Story 2 (CAP-9, AD-25): the per-section Self-check, its single repair and
// its Compliance Note rows, driven through the real ordered chain with the
// provider stubbed at the Anthropic client boundary. The model Self-check is
// scripted from what its prompt actually carries (the draft, the Confidence
// Map, the glossary candidates), so each test checks the wiring end to end;
// the deterministic rules are also unit-tested directly at the bottom.

import type Anthropic from "@anthropic-ai/sdk";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FunctionArgs } from "convex/server";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import schema from "../schema";
import type { GenerationClient, GenerationMessageParams } from "./openrouterCore";
import { SECTION_242_REQUEST } from "./section242Agent";
import { SECTION_244_REQUEST } from "./section244Agent";
import { SECTION_246_REQUEST } from "./section246Agent";
import {
  COMPRESSION_REQUEST,
  ORDERED_PROMPT_SCAFFOLDS,
  SELF_CHECK_REQUEST,
  SELF_CHECK_SCHEMA,
  SUMMARY_PLAN_SELF_CHECK_FACTS_FINDINGS_SCHEMA,
  SUMMARY_PLAN_SELF_CHECK_REQUEST,
  SUMMARY_PLAN_SELF_CHECK_TARGET_FINDINGS_SCHEMA,
  SUMMARY_PLAN_SELF_CHECK_SCHEMA,
} from "./promptDefinitions";
import { SEQUENTIAL_CALLS_PER_GENERATE_CANDIDATE } from "./providers";
import { sectionMetrics } from "../lib/lineLimits";
import {
  assembleSectionNotes,
  repairIssues,
  runDeterministicSelfCheck,
  SOURCE_TALK_KEY,
} from "../lib/selfCheckRules";
import { FACT_RULES, RULES_REPORT_FACTS, SOURCE_TALK, TARGET_MET_RULE, TARGET_RULES } from "../../shared/humanProse";
import type { OrderedProfileContext } from "../lib/orderedChain";
import {
  FACTS_INSTRUCTION,
  keptIdeaReason,
  leaveOutRepairIssue,
  planComplianceNoteDrafts,
  reportFactsBlock,
  reportFactsIssuePrefix,
  TARGETS_INSTRUCTION,
} from "./orderedGeneration";
import {
  buildSelfCheckUserMessage,
  FACTS_HELD_PREFIX,
  FACTS_NOTHING_SHOWN_REASON,
  factsFindingsReason,
  factsMatchSourcesInstruction,
  factsNotCheckedReason,
  MAX_QUOTE_GAP_CHARS,
  MIN_QUOTE_PART_CHARS,
  normalizeForQuote,
  NOT_CHECKED_REASON,
  PLAN_FACTS_NOT_CHECKED_REASON,
  PLAN_ITEM_NOT_CHECKED_REASON,
  PLAN_RULE_NOT_CHECKED_REASON,
  PLAN_SKIP_NOT_CHECKED_REASON,
  PLAN_TARGETS_NOT_CHECKED_REASON,
  runModelSelfCheck,
  TARGETS_BREAK_UNLOCATED_REASON,
  quoteFoundIn,
  selfCheckFailureDiagnostic,
  sourceFactsFor,
  verifyFactsFindings,
  verifyTargetFindings,
  TARGETS_NOTHING_SHOWN_REASON,
  summaryPlanSelfCheckSchemaFor,
  type SelfCheckPlanCheck,
} from "./selfCheck";
import {
  SELF_CHECK_SYSTEM_PROMPT,
  SUMMARY_PLAN_SELF_CHECK_SYSTEM_PROMPT,
} from "./prompts";
import {
  jsonEscapedUtf8Bytes,
  MAX_SUMMARY_SELF_CHECK_GUIDANCE_ESCAPED_UTF8_BYTES,
  MAX_SUMMARY_SELF_CHECK_QUESTION_ESCAPED_UTF8_BYTES,
  MAX_SUMMARY_SELF_CHECK_REASON_ESCAPED_UTF8_BYTES,
  MAX_SUMMARY_SELF_CHECK_RESPONSE_UTF8_BYTES,
  projectSummaryOrdinaryChecks,
  serializeFrozenSummaryPlanChecks,
} from "../lib/seedRevisions";
import { agentOutputsOf } from "../lib/generationOutputs";
import type { PdSubsectionRoleId } from "../../shared/pdSubsections";
import planCoverageReplayKit from "../../test-data/plan-coverage-replay.json?raw";

const network = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: network.create };
  },
}));
const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, load]) => [
    path.startsWith("./") ? `../ai/${path.slice(2)}` : path,
    load,
  ])
);

type Section = "242" | "244" | "246";
const SECTION_REQUESTS = {
  "242": SECTION_242_REQUEST,
  "244": SECTION_244_REQUEST,
  "246": SECTION_246_REQUEST,
} as const;
const AUTH_ID = "self-check-writer";

const TRANSCRIPT =
  "The team built a custom control loop to stabilize output. Marketing decided to redesign the logo, which is unrelated to engineering. Response time under load was not measured.";
const EXCLUDED = "Marketing decided to redesign the logo";
const briefOutput = {
  storyline: "The team pursued a custom control loop to stabilize output.",
  storylineClaims: [
    { text: "The team pursued a custom control loop.", quote: "The team built a custom control loop to stabilize output." },
  ],
  claimExclusions: [
    { text: "Logo redesign is out of scope.", quote: EXCLUDED, reason: "business_risk" },
  ],
  confidenceMap: [
    {
      text: "Response time under load is unreliable.",
      quote: "Response time under load was not measured.",
      confidence: "unreliable",
    },
  ],
  glossaryTerms: [{ term: "control loop" }],
};
const CLEAN: Record<Section, string> = {
  "242": "The team could not predict how the custom control loop would respond under load.",
  "244": "The team built three control loop prototypes and compared their stability.",
  "246": "The work showed which control loop structure keeps the output stable.",
};

const analysisOutput = {
  company_context: "Test company",
  project_goal: "Resolve the control uncertainty",
  business_problem: "Existing control fails",
  scientific_technical_problem: "Response under load is unknown",
  technological_objective: "A repeatable control",
  work_performed: {},
  project_status: "completed",
};
const qa = {
  overall_score: 88,
  section_scores: {},
  cra_compliance: {},
  hallucination_risks: [],
  ai_language_flags: [],
  superlative_flags: [],
  gaps_requiring_client_followup: [],
  suggested_improvements: [],
};

function blocksText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block: { type?: string; text?: string }) => (block.type === "text" ? block.text ?? "" : ""))
    .join("");
}
function userText(params: GenerationMessageParams | Anthropic.MessageCreateParamsNonStreaming): string {
  return params.messages
    .filter((message) => message.role === "user")
    .map((message) => blocksText(message.content))
    .join("\n");
}
function draftSectionOf(user: string): Section | null {
  for (const section of ["242", "244", "246"] as const) {
    // Since cost phase 1 the three lines share their opening block; the
    // line's own instructions open with its task marker.
    const request = SECTION_REQUESTS[section];
    if (user.startsWith(request.userPrefix) && user.includes(request.taskMarker)) return section;
  }
  return null;
}
const isRepair = (user: string) => user.includes(ORDERED_PROMPT_SCAFFOLDS.repairGuidance.prefix);
/** The drafted section as the Self-check prompt carries it. */
function selfCheckDraftBlock(user: string): string {
  const match = user.match(/--- BEGIN \[SECTION DRAFT: [^\]]+\] ---\n([\s\S]*?)\n--- END \[SECTION DRAFT/);
  return match?.[1] ?? "";
}

type Script = {
  drafts?: Partial<Record<Section, string>>;
  repairs?: Partial<Record<Section, string | Error>>;
  selfCheck?: (section: Section, user: string) => unknown;
};

function install(script: Script = {}) {
  const drafts = { ...CLEAN, ...script.drafts };
  network.create.mockReset().mockImplementation(async (params: GenerationMessageParams) => {
    const name = params.tool_choice?.name;
    const user = userText(params);
    const usage = { input_tokens: 10, output_tokens: 5 };
    if (name) {
      let input: unknown = { entries: [] };
      if (name === "submit_transcript_analysis") input = analysisOutput;
      else if (name === "submit_generation_brief") input = briefOutput;
      else if (name === "submit_qa_scorecard") input = qa;
      else if (name === "submit_consistency_findings") input = { findings: [] };
      else if (name === "submit_self_check") {
        const section = user.match(/SECTION DRAFT: Line (242|244|246)/)?.[1] as Section;
        input = script.selfCheck?.(section, user) ?? { verdicts: [] };
      }
      return { content: [{ type: "tool_use", id: "tool-1", name, input }], usage };
    }
    if (blocksText((params as { system?: unknown }).system) === COMPRESSION_REQUEST.system) {
      // Compression that cannot shrink the text: a breach survives it.
      return {
        content: [{ type: "text", text: user.split(COMPRESSION_REQUEST.userScaffold.percentToText)[1] ?? "" }],
        usage,
      };
    }
    const section = draftSectionOf(user);
    if (!section) return { content: [{ type: "text", text: "Unrouted text." }], usage };
    if (isRepair(user)) {
      const repaired = script.repairs?.[section] ?? drafts[section];
      if (repaired instanceof Error) throw repaired;
      return { content: [{ type: "text", text: repaired }], usage };
    }
    return { content: [{ type: "text", text: drafts[section] }], usage };
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("VOYAGE_API_KEY", "");
  vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
  vi.stubGlobal("fetch", vi.fn(() => {
    throw new Error("Network disabled in test");
  }));
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const CANDIDATE_JOB = "ai/pipeline:generateCandidate";
const SECTION_JOB = "ai/orderedGeneration:generateOrderedSection";
const FINALIZE_JOB = "ai/orderedGeneration:finalizeOrderedCandidate";

async function runAll(t: ReturnType<typeof convexTest>) {
  for (let round = 0; round < 60; round += 1) {
    const [job] = await t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).filter(
        (entry) =>
          entry.state.kind === "pending" &&
          [CANDIDATE_JOB, SECTION_JOB, FINALIZE_JOB].includes(entry.name)
      )
    );
    if (!job) return;
    await t.run((ctx) => ctx.scheduler.cancel(job._id));
    const args = job.args[0];
    if (job.name === CANDIDATE_JOB) {
      await t.action(internal.ai.pipeline.generateCandidate, args as FunctionArgs<typeof internal.ai.pipeline.generateCandidate>);
    } else if (job.name === SECTION_JOB) {
      await t.action(internal.ai.orderedGeneration.generateOrderedSection, args as FunctionArgs<typeof internal.ai.orderedGeneration.generateOrderedSection>);
    } else {
      await t.action(internal.ai.orderedGeneration.finalizeOrderedCandidate, args as FunctionArgs<typeof internal.ai.orderedGeneration.finalizeOrderedCandidate>);
    }
  }
  throw new Error("The chain did not drain");
}

async function generate(script: Script = {}) {
  install(script);
  const t = convexTest(schema, modules);
  const generationId = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { authId: AUTH_ID, role: "admin" });
    const projectId = await ctx.db.insert("projects", {
      title: "Control experiment",
      clientName: "Client",
      status: "draft",
      createdBy: userId,
      shareToken: `self-check-token-${now}-${Math.random()}`,
      createdAt: now,
      updatedAt: now,
    });
    const transcriptId = await ctx.db.insert("transcripts", { projectId, content: TRANSCRIPT, createdAt: now });
    const id = await ctx.db.insert("generations", {
      projectId,
      transcriptId,
      transcriptIds: [transcriptId],
      status: "reserved",
      requestedAt: now,
      requestedBy: userId,
      startedAt: now,
      candidateMode: "single",
      singleModelId: "claude-opus-4-8",
      previousProjectStatus: "draft",
      learningDigestIds: [],
    });
    await ctx.db.patch(projectId, { status: "generating", activeGenerationId: id });
    await ctx.db.insert("generationSources", {
      projectId,
      generationId: id,
      kind: "transcript",
      transcriptId,
      label: "Interview transcript",
      content: TRANSCRIPT,
      contentHash: "self-check-hash",
      truncated: false,
      originalLength: TRANSCRIPT.length,
      capturedAt: now,
    });
    return id;
  });
  await t.action(internal.ai.pipeline.generateReport, { generationId });
  await runAll(t);
  const asWriter = t.withIdentity({ subject: AUTH_ID });
  const notes = await asWriter.query(api.complianceNotes.listForGeneration, { generationId });
  const sectionRows = await t.run((ctx) =>
    ctx.db.query("generationSectionRuns").withIndex("by_generationId", (q) => q.eq("generationId", generationId)).collect()
  );
  // The row, with its agent outputs read the way readers read them (child
  // rows since 2026-09-25).
  const generation = (await t.run(async (ctx) => {
    const row = (await ctx.db.get(generationId)) as Doc<"generations">;
    return { ...row, agentOutputs: await agentOutputsOf(ctx, generationId) };
  }));
  // Surface a failed candidate's own error instead of a bare status mismatch.
  const runErrors = (await t.run((ctx) => ctx.db.query("generationCandidateRuns").collect()))
    .map((run) => run.error)
    .filter(Boolean);
  expect(runErrors).toEqual([]);
  return { t, generationId, asWriter, notes, sectionRows, generation };
}

function rowFor(rows: Doc<"generationSectionRuns">[], section: Section) {
  const row = rows.find((candidate) => candidate.section === `s${section}`);
  if (!row) throw new Error(`no row for ${section}`);
  return {
    row,
    selfCheck: JSON.parse(row.selfCheck ?? "null"),
    slotCounts: JSON.parse(row.slotCounts ?? "{}") as Record<string, number>,
  };
}
function callsFor(section: Section, kind: "draft" | "repair") {
  return network.create.mock.calls
    .map(([params]) => userText(params as GenerationMessageParams))
    .filter((user) => draftSectionOf(user) === section && isRepair(user) === (kind === "repair"));
}
function selfCheckPrompt(section: Section): string {
  const prompts = network.create.mock.calls
    .map(([params]) => params as GenerationMessageParams)
    .filter((params) => params.tool_choice?.name === "submit_self_check")
    .map((params) => userText(params))
    .filter((user) => user.includes(`SECTION DRAFT: Line ${section}`));
  expect(prompts).toHaveLength(1);
  return prompts[0];
}

async function completeSelfCheckRequestHash(
  params: GenerationMessageParams
): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(params));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

describe("Self-check before display (CAP-9)", () => {
  it("keeps the legacy Self-check provider request unchanged when no Summary plan exists", async () => {
    const create = vi.fn(async (params: GenerationMessageParams) => ({
      content: [{
        type: "tool_use" as const,
        id: "legacy-self-check",
        name: params.tool_choice?.name ?? "submit_self_check",
        input: { verdicts: [] },
      }],
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
    const result = await runModelSelfCheck({ messages: { create } } as GenerationClient, {
      section: "242",
      text: "One legacy paragraph.",
      storylineText: "Legacy storyline.",
      confidenceMap: [{ text: "Legacy confidence.", confidence: "partial" }],
      glossaryCandidates: ["control loop"],
      writerInstructions: "Use the saved writer voice.",
      rules: [{ instruction: "Keep the uncertainty explicit.", paragraphIndex: 0 }],
      model: "claude-opus-4-8",
    });
    expect(result.planVerdicts).toEqual([]);
    expect(create).toHaveBeenCalledTimes(1);
    const [request] = create.mock.calls[0];
    expect(request).toEqual({
      model: "claude-opus-4-8",
      max_tokens: SELF_CHECK_REQUEST.maxTokens,
      system: SELF_CHECK_SYSTEM_PROMPT,
      tools: [{
        name: SELF_CHECK_REQUEST.toolName,
        description: SELF_CHECK_REQUEST.toolDescription,
        input_schema: SELF_CHECK_SCHEMA,
      }],
      tool_choice: { type: "tool", name: SELF_CHECK_REQUEST.toolName },
      messages: [{
        role: "user",
        content:
          "Run the Self-check on the drafted section below. Paragraphs are numbered [P1], [P2], ...; name the paragraph each verdict concerns (0 for the whole section).\n\n" +
          "--- BEGIN [SECTION DRAFT: Line 242 (Uncertainty)] ---\n" +
          "[P1] One legacy paragraph.\n" +
          "--- END [SECTION DRAFT: Line 242 (Uncertainty)] ---\n\n" +
          "--- BEGIN [STORYLINE] ---\nLegacy storyline.\n--- END [STORYLINE] ---\n\n" +
          "--- BEGIN [CONFIDENCE MAP] ---\n[C1] (partial) Legacy confidence.\n--- END [CONFIDENCE MAP] ---\n\n" +
          "--- BEGIN [GLOSSARY CANDIDATES (Glossary Terms not found verbatim in the section)] ---\n" +
          "- control loop\n" +
          "--- END [GLOSSARY CANDIDATES (Glossary Terms not found verbatim in the section)] ---\n\n" +
          "--- BEGIN [WRITER INSTRUCTIONS] ---\n" +
          "Use the saved writer voice.\n\n" +
          "[R1] (paragraph 1) Keep the uncertainty explicit.\n" +
          "--- END [WRITER INSTRUCTIONS] ---",
      }],
    });
    // Captured from baseline 20ab25e627657e716476b393fa463e828ea978c1
    // with this nonempty Storyline/confidence/glossary/profile/rule fixture,
    // then recaptured 2026-09-23 for the owner-directed copy-skills change
    // (shared human-prose rules on the Self-check prompt; section titles
    // without an em dash). This literal hash is independent of current
    // prompt/schema exports.
    expect(await completeSelfCheckRequestHash(request)).toBe(
      "4fa5d7184a93e08a953f2c5a5fdd9a7f94a667a1da247059d7dd2b1b69f478c1"
    );
  });

  it("gives only the Summary-plan Self-check an output allowance that covers its admitted response bytes", async () => {
    // A byte-level tokenizer never needs more tokens than bytes, so an
    // allowance at least as large as the admitted response always fits it.
    expect(MAX_SUMMARY_SELF_CHECK_RESPONSE_UTF8_BYTES).toBe(16_384);
    expect(SUMMARY_PLAN_SELF_CHECK_REQUEST.maxTokens).toBe(16_384);
    expect(SUMMARY_PLAN_SELF_CHECK_REQUEST.maxTokens).toBeGreaterThanOrEqual(
      MAX_SUMMARY_SELF_CHECK_RESPONSE_UTF8_BYTES
    );
    // The legacy Self-check allowance is unchanged.
    expect(SELF_CHECK_REQUEST.maxTokens).toBe(4096);
    const check: SelfCheckPlanCheck = {
      itemId: "item-1",
      roleId: "company_context",
      mergedItemIds: ["item-1"],
      instruction: "cover",
      confirmedExclusion: false,
      wording: ["Frozen wording."],
      relationshipReferences: [],
      sourceReferences: [],
    };
    const create = vi.fn(async (params: GenerationMessageParams) => ({
      content: [{
        type: "tool_use" as const,
        id: "summary-allowance",
        name: params.tool_choice?.name ?? "submit_self_check",
        input: {
          verdicts: [],
          planVerdicts: [{
            itemId: "item-1",
            mergedItemIds: ["item-1"],
            paragraph: 1,
            outcome: "applied",
            reason: "Covered.",
          }],
        },
      }],
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
    await runModelSelfCheck({ messages: { create } } as GenerationClient, {
      section: "242",
      text: "One paragraph.",
      storylineText: "",
      confidenceMap: [],
      glossaryCandidates: [],
      rules: [],
      model: "claude-opus-4-8",
      planChecks: [check],
      planChecksBlock: serializeFrozenSummaryPlanChecks([check]),
    });
    expect(create).toHaveBeenCalledTimes(1);
    const [request] = create.mock.calls[0];
    expect(request.system).toBe(SUMMARY_PLAN_SELF_CHECK_SYSTEM_PROMPT);
    expect(request.max_tokens).toBe(16_384);
  });

  it.each(["missing tool output", "malformed adapter output", "invalid field type"] as const)(
    "uses one Summary attempt for %s",
    async (failure) => {
      const check: SelfCheckPlanCheck = {
        itemId: "item-1",
        roleId: "company_context",
        mergedItemIds: ["item-1"],
        instruction: "cover",
        confirmedExclusion: false,
        wording: ["Frozen wording."],
        relationshipReferences: [],
        sourceReferences: [],
      };
      const create = vi.fn(async (params: GenerationMessageParams) => {
        if (failure === "missing tool output") {
          return {
            content: [{ type: "text" as const, text: "No tool." }],
            usage: { input_tokens: 1, output_tokens: 1 },
          };
        }
        if (failure === "malformed adapter output") {
          const { MalformedOutputError } = await import("./openrouterCore");
          throw new MalformedOutputError("malformed tool JSON");
        }
        return {
          content: [{
            type: "tool_use" as const,
            id: "invalid-summary-shape",
            name: params.tool_choice?.name ?? "submit_self_check",
            input: {
              verdicts: [],
              planVerdicts: [{
                itemId: "item-1",
                mergedItemIds: ["item-1"],
                paragraph: 1,
                outcome: 7,
                reason: "Invalid outcome type.",
              }],
            },
          }],
          usage: { input_tokens: 1, output_tokens: 1 },
        };
      });
      const result = runModelSelfCheck({ messages: { create } } as GenerationClient, {
        section: "242",
        text: "One paragraph.",
        storylineText: "",
        confidenceMap: [],
        glossaryCandidates: [],
        rules: [],
        model: "claude-opus-4-8",
        planChecks: [check],
        planChecksBlock: serializeFrozenSummaryPlanChecks([check]),
      });
      await expect(result).rejects.toThrow();
      expect(create).toHaveBeenCalledTimes(1);
    }
  );

  it.each([
    {
      case: "multibyte reason",
      field: "reason",
      maximum: MAX_SUMMARY_SELF_CHECK_REASON_ESCAPED_UTF8_BYTES,
      atLimit: "é".repeat(32),
      aboveLimit: `${"é".repeat(32)}x`,
    },
    {
      case: "JSON-escaped reason",
      field: "reason",
      maximum: MAX_SUMMARY_SELF_CHECK_REASON_ESCAPED_UTF8_BYTES,
      atLimit: "\n".repeat(32),
      aboveLimit: `${"\n".repeat(32)}x`,
    },
    {
      case: "multibyte repair guidance",
      field: "repairGuidance",
      maximum: MAX_SUMMARY_SELF_CHECK_GUIDANCE_ESCAPED_UTF8_BYTES,
      atLimit: "é".repeat(48),
      aboveLimit: `${"é".repeat(48)}x`,
    },
    {
      case: "JSON-escaped repair guidance",
      field: "repairGuidance",
      maximum: MAX_SUMMARY_SELF_CHECK_GUIDANCE_ESCAPED_UTF8_BYTES,
      atLimit: "\n".repeat(48),
      aboveLimit: `${"\n".repeat(48)}x`,
    },
  ] as const)(
    "advertises the Summary byte limit for $case text and clips text above it",
    async ({ field, maximum, atLimit, aboveLimit }) => {
      expect(jsonEscapedUtf8Bytes(atLimit)).toBe(maximum);
      expect(jsonEscapedUtf8Bytes(aboveLimit)).toBe(maximum + 1);
      const fieldSchema = field === "reason"
        ? SUMMARY_PLAN_SELF_CHECK_SCHEMA.properties.verdicts.items.properties.reason
        : SUMMARY_PLAN_SELF_CHECK_SCHEMA.properties.verdicts.items.properties.repairGuidance;
      expect(aboveLimit.length).toBeLessThanOrEqual(
        fieldSchema.maxLength
      );

      const check: SelfCheckPlanCheck = {
        itemId: "item-1",
        roleId: "company_context",
        mergedItemIds: ["item-1"],
        instruction: "cover",
        confirmedExclusion: false,
        wording: ["Frozen wording."],
        relationshipReferences: [],
        sourceReferences: [],
      };
      const execute = async (boundedValue: string) => {
        const create = vi.fn(async (params: GenerationMessageParams) => ({
          content: [{
            type: "tool_use" as const,
            id: "summary-byte-boundary",
            name: params.tool_choice?.name ?? "submit_self_check",
            input: {
              verdicts: [{
                paragraph: 1,
                check: "storyline",
                instruction: "storyline",
                outcome: "applied",
                reason: field === "reason" ? boundedValue : "Applied.",
                ...(field === "repairGuidance"
                  ? { repairGuidance: boundedValue }
                  : {}),
              }],
              planVerdicts: [{
                itemId: "item-1",
                mergedItemIds: ["item-1"],
                paragraph: 1,
                outcome: "applied",
                reason: "Covered.",
              }],
            },
          }],
          usage: { input_tokens: 1, output_tokens: 1 },
        }));
        const result = runModelSelfCheck(
          { messages: { create } } as GenerationClient,
          {
            section: "242",
            text: "One paragraph.",
            storylineText: "Frozen storyline.",
            confidenceMap: [],
            glossaryCandidates: [],
            rules: [],
            model: "claude-opus-4-8",
            planChecks: [check],
            planChecksBlock: serializeFrozenSummaryPlanChecks([check]),
          }
        );
        return { create, result };
      };

      const accepted = await execute(atLimit);
      await expect(accepted.result).resolves.toMatchObject({
        verdicts: [{ outcome: "applied" }],
      });
      expect(accepted.create).toHaveBeenCalledTimes(1);
      const [request] = accepted.create.mock.calls[0];
      expect(request.tools?.[0]).toMatchObject({
        input_schema: summaryPlanSelfCheckSchemaFor([{ label: "storyline" }], [check]),
      });
      const properties = SUMMARY_PLAN_SELF_CHECK_SCHEMA.properties;
      const boundedProviderFields = [
        properties.verdicts.items.properties.instruction,
        properties.verdicts.items.properties.reason,
        properties.verdicts.items.properties.repairGuidance,
        properties.storylineQuestion.properties.question,
        properties.storylineQuestion.properties.sectionClaim,
        properties.storylineQuestion.properties.storylineAlternative,
        properties.planVerdicts.items.properties.itemId,
        properties.planVerdicts.items.properties.skippedRoleId,
        properties.planVerdicts.items.properties.mergedItemIds.items,
        properties.planVerdicts.items.properties.reason,
        properties.planVerdicts.items.properties.repairGuidance,
      ];
      for (const field of boundedProviderFields) {
        expect(field.description).toContain(
          `Return at most ${field.maxLength} JSON-escaped UTF-8 bytes`
        );
        expect(field.description).toContain(
          "measured after JSON string escaping and excluding the surrounding quotes"
        );
        expect(field.description).toContain(
          `maxLength=${field.maxLength} is a conservative character bound; ` +
          "the escaped-byte limit is authoritative"
        );
      }

      // Over-long free text used to reject the whole check (2026-09-25:
      // real reasons run 90 to 280 bytes). It is now clipped to the limit
      // and the check is accepted with the clipped text.
      const clipped = await execute(aboveLimit);
      const value = await clipped.result;
      expect(clipped.create).toHaveBeenCalledTimes(1);
      expect(value.verdicts).toHaveLength(1);
      expect(value.planVerdicts[0]).toMatchObject({ outcome: "applied", paragraphIndex: 0 });
      const kept = field === "reason"
        ? value.verdicts[0]?.reason
        : value.verdicts[0]?.repairGuidance;
      expect(kept).toBeDefined();
      expect(jsonEscapedUtf8Bytes(kept ?? "")).toBeLessThanOrEqual(maximum);
      expect(kept?.endsWith("…")).toBe(true);
    }
  );

  it("accepts only finite integer plan paragraphs inside the actual Section", async () => {
    const check: SelfCheckPlanCheck = {
      itemId: "item-1",
      roleId: "company_context",
      mergedItemIds: ["item-1"],
      instruction: "cover" as const,
      confirmedExclusion: false,
      wording: ["Frozen wording."],
      relationshipReferences: [],
      sourceReferences: [],
    };
    for (const paragraph of [-1, 0, 1.5, undefined, 3]) {
      const create = vi.fn(async (params: GenerationMessageParams) => ({
        content: [{
          type: "tool_use" as const,
          id: "plan-paragraph",
          name: params.tool_choice?.name ?? "submit_self_check",
          input: {
            verdicts: [],
            planVerdicts: [{
              itemId: "item-1",
              mergedItemIds: ["item-1"],
              ...(paragraph === undefined ? {} : { paragraph }),
              outcome: "applied",
              reason: "Covered.",
            }],
          },
        }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }));
      const result = await runModelSelfCheck({ messages: { create } } as GenerationClient, {
        section: "242",
        text: "Paragraph one.\n\nParagraph two.",
        storylineText: "",
        confidenceMap: [],
        glossaryCandidates: [],
        rules: [],
        model: "claude-opus-4-8",
        planChecks: [check],
        planChecksBlock: serializeFrozenSummaryPlanChecks([check]),
      });
      expect(result.planVerdicts[0], String(paragraph)).toMatchObject({
        outcome: "not_applied",
        reason: "Applied plan verdict did not identify valid paragraph evidence.",
        actionableRepair: false,
      });
      expect(result.planVerdicts[0]?.paragraphIndex, String(paragraph)).toBeUndefined();
    }
    const create = vi.fn(async (params: GenerationMessageParams) => ({
      content: [{
        type: "tool_use" as const,
        id: "valid-plan-paragraph",
        name: params.tool_choice?.name ?? "submit_self_check",
        input: {
          verdicts: [],
          planVerdicts: [{
            itemId: "item-1",
            mergedItemIds: ["item-1"],
            paragraph: 2,
            outcome: "applied",
            reason: "Covered.",
          }],
        },
      }],
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
    const accepted = await runModelSelfCheck({ messages: { create } } as GenerationClient, {
      section: "242",
      text: "Paragraph one.\n\nParagraph two.",
      storylineText: "",
      confidenceMap: [],
      glossaryCandidates: [],
      rules: [],
      model: "claude-opus-4-8",
      planChecks: [check],
      planChecksBlock: serializeFrozenSummaryPlanChecks([check]),
    });
    expect(accepted.planVerdicts[0]).toMatchObject({
      outcome: "applied",
      paragraphIndex: 1,
    });
  });

  it.each([null, "1"])(
    "downgrades nonnumeric plan paragraph %j without rejecting valid siblings",
    async (paragraph) => {
      const checks: SelfCheckPlanCheck[] = ["item-1", "item-2"].map((itemId) => ({
        itemId,
        roleId: "company_context",
        mergedItemIds: [itemId],
        instruction: "cover",
        confirmedExclusion: false,
        wording: [`Frozen ${itemId}.`],
        relationshipReferences: [],
        sourceReferences: [],
      }));
      const create = vi.fn(async (params: GenerationMessageParams) => ({
        content: [{
          type: "tool_use" as const,
          id: "nonnumeric-plan-paragraph",
          name: params.tool_choice?.name ?? "submit_self_check",
          input: {
            verdicts: [],
            planVerdicts: [
              {
                itemId: "item-1",
                mergedItemIds: ["item-1"],
                paragraph,
                outcome: "applied",
                reason: "Invalid evidence scope.",
              },
              {
                itemId: "item-2",
                mergedItemIds: ["item-2"],
                paragraph: 1,
                outcome: "applied",
                reason: "Covered.",
              },
            ],
          },
        }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }));
      const result = await runModelSelfCheck(
        { messages: { create } } as GenerationClient,
        {
          section: "242",
          text: "Paragraph one.",
          storylineText: "",
          confidenceMap: [],
          glossaryCandidates: [],
          rules: [],
          model: "claude-opus-4-8",
          planChecks: checks,
          planChecksBlock: serializeFrozenSummaryPlanChecks(checks),
        }
      );
      expect(result.planVerdicts).toEqual([
        expect.objectContaining({ itemId: "item-1", outcome: "not_applied" }),
        expect.objectContaining({ itemId: "item-2", outcome: "applied", paragraphIndex: 0 }),
      ]);
      expect(result.planVerdicts[0]?.paragraphIndex).toBeUndefined();
      expect(create).toHaveBeenCalledTimes(1);
    }
  );

  it("rejects encoded Summary roots without unwrapping", async () => {
    const check: SelfCheckPlanCheck = {
      itemId: "item-1",
      roleId: "company_context",
      mergedItemIds: ["item-1"],
      instruction: "cover",
      confirmedExclusion: false,
      wording: ["Frozen wording."],
      relationshipReferences: [],
      sourceReferences: [],
    };
    const create = vi.fn(async (params: GenerationMessageParams) => ({
      content: [{
        type: "tool_use" as const,
        id: "encoded-summary-root",
        name: params.tool_choice?.name ?? "submit_self_check",
        input: JSON.stringify({
          verdicts: [],
          planVerdicts: [{
            itemId: "item-1",
            mergedItemIds: ["item-1"],
            paragraph: 1,
            outcome: "applied",
            reason: "Covered.",
          }],
        }),
      }],
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
    await expect(runModelSelfCheck(
      { messages: { create } } as GenerationClient,
      {
        section: "242",
        text: "Paragraph one.",
        storylineText: "",
        confidenceMap: [],
        glossaryCandidates: [],
        rules: [],
        model: "claude-opus-4-8",
        planChecks: [check],
        planChecksBlock: serializeFrozenSummaryPlanChecks([check]),
      }
    )).rejects.toThrow("unexpected shape");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["mismatched", "Frozen Summary plan-check serialization mismatch", "tampered", ""],
    ["oversized", "Expanded Summary plan checks exceed", "unused", "x".repeat(64_000)],
  ] as const)("refuses a %s Summary plan-check block before any provider call", async (
    _case,
    message,
    planChecksBlock,
    exactExcerpt
  ) => {
    const check: SelfCheckPlanCheck = {
      itemId: "item-1",
      roleId: "company_context",
      mergedItemIds: ["item-1"],
      instruction: "cover" as const,
      confirmedExclusion: false,
      wording: ["Frozen wording."],
      relationshipReferences: [],
      sourceReferences: [{
        originatingItemId: "item-1",
        sourceId: "source-1",
        exactExcerpt,
      }],
    };
    const create = vi.fn();
    const result = runModelSelfCheck({ messages: { create } } as GenerationClient, {
      section: "242",
      text: "One paragraph.",
      storylineText: "",
      confidenceMap: [],
      glossaryCandidates: [],
      rules: [],
      model: "claude-opus-4-8",
      planChecks: [check],
      planChecksBlock,
    });
    await expect(result).rejects.toThrow(message);
    expect(create).not.toHaveBeenCalled();
  });

  it("accepts one complete mixed ordinary/plan response and rejects every malformed whole response", async () => {
    const checks: SelfCheckPlanCheck[] = [
      {
        itemId: "item-a",
        roleId: "specific_advancements",
        mergedItemIds: ["item-a", "item-b"],
        instruction: "cover",
        confirmedExclusion: false,
        support: "source_supported",
        wording: ["Advancement A."],
        relationshipReferences: [],
        sourceReferences: [],
      },
      {
        itemId: "item-b",
        roleId: "specific_advancements",
        mergedItemIds: ["item-a", "item-b"],
        instruction: "cover",
        confirmedExclusion: false,
        support: "writer_asserted",
        wording: ["Advancement B."],
        relationshipReferences: [],
        sourceReferences: [],
      },
      {
        skippedRoleId: "prior_year_status",
        roleId: "prior_year_status",
        mergedItemIds: [],
        instruction: "skip",
        confirmedExclusion: false,
        wording: [],
        relationshipReferences: [],
        sourceReferences: [],
      },
    ];
    const valid = {
      verdicts: [
        { paragraph: 1, check: "storyline", instruction: "storyline", outcome: "applied", reason: "Applied." },
        { paragraph: 1, check: "confidence", instruction: "confidence:C1", outcome: "applied", reason: "Applied." },
        { paragraph: 1, check: "glossary", instruction: "glossary:G1", outcome: "applied", reason: "Applied." },
        { paragraph: 1, check: "instruction", instruction: "writer:profile", outcome: "applied", reason: "Applied." },
        { paragraph: 1, check: "instruction", instruction: "rule:R1", outcome: "applied", reason: "Applied." },
      ],
      planVerdicts: checks.map((check) => ({
        ...(check.itemId ? { itemId: check.itemId } : {}),
        ...(check.skippedRoleId ? { skippedRoleId: check.skippedRoleId } : {}),
        mergedItemIds: [...check.mergedItemIds],
        paragraph: 1,
        outcome: "applied",
        reason: "Applied.",
      })),
      storylineQuestion: {
        question: "Which result is supported?",
        sectionClaim: "The result was stable.",
        confidenceEntry: 1,
        storylineAlternative: "The result may be stable.",
      },
    };
    const input = {
      section: "242" as const,
      text: "One paragraph covers the plan.",
      storylineText: "Frozen storyline.",
      confidenceMap: [{ text: "Confidence entry.", confidence: "partial" }],
      glossaryCandidates: ["control loop"],
      writerInstructions: "Use direct language.",
      rules: [{ instruction: "State the result." }],
      model: "claude-opus-4-8",
      planChecks: checks,
      planChecksBlock: serializeFrozenSummaryPlanChecks(checks),
    };
    const execute = async (response: typeof valid) => {
      const create = vi.fn(async (params: GenerationMessageParams) => ({
        content: [{
          type: "tool_use" as const,
          id: "summary-output-validation",
          name: params.tool_choice?.name ?? "submit_self_check",
          input: response,
        }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }));
      const result = runModelSelfCheck(
        { messages: { create } } as GenerationClient,
        input
      );
      return { create, result };
    };

    const accepted = await execute(structuredClone(valid));
    await expect(accepted.result).resolves.toMatchObject({
      verdicts: [
        { instruction: "Storyline" },
        { instruction: "Confidence Map: Confidence entry." },
        { instruction: "Glossary Term: control loop" },
        { instruction: "Use direct language." },
        { instruction: "State the result." },
      ],
      planVerdicts: [
        { itemId: "item-a", mergedItemIds: ["item-a", "item-b"] },
        { itemId: "item-b", mergedItemIds: ["item-a", "item-b"] },
        { skippedRoleId: "prior_year_status", mergedItemIds: [] },
      ],
    });
    expect(accepted.create).toHaveBeenCalledTimes(1);

    // Only an answer whose root is malformed or over the byte budget is
    // unreadable and rejects the whole check (2026-09-28, run 4).
    const malformed: Array<[string, (response: typeof valid) => void]> = [
      ["oversized unknown root property", (response) => { Object.assign(response, { unknownRoot: "x".repeat(MAX_SUMMARY_SELF_CHECK_RESPONSE_UTF8_BYTES + 1) }); }],
      ["oversized unknown nested property", (response) => { Object.assign(response.planVerdicts[0], { unknownNested: "x".repeat(MAX_SUMMARY_SELF_CHECK_RESPONSE_UTF8_BYTES + 1) }); }],
      ["unknown root property", (response) => { Object.assign(response, { unknownRoot: true }); }],
    ];
    for (const [name, mutate] of malformed) {
      const response = structuredClone(valid);
      mutate(response);
      const rejected = await execute(response);
      await expect(rejected.result, name).rejects.toThrow();
      expect(rejected.create, name).toHaveBeenCalledTimes(1);
    }

    // One invalid or malformed verdict is dropped; its label or plan check
    // counts as missing and goes to the one follow-up. Here the follow-up
    // repeats the whole answer, so the row stays missing and is recorded as
    // not checked, while every other row is kept.
    const invalidRows: Array<[string, (response: typeof valid) => void]> = [
      ["omitted ordinary reason", (response) => { Reflect.deleteProperty(response.verdicts[0], "reason"); }],
      ["omitted Skip merge array", (response) => { Reflect.deleteProperty(response.planVerdicts[2], "mergedItemIds"); }],
      ["duplicate ordinary row", (response) => { response.verdicts[4] = { ...response.verdicts[0] }; }],
      ["unknown ordinary label", (response) => { response.verdicts[0].instruction = "unknown"; }],
      ["duplicate plan row", (response) => { response.planVerdicts[2] = { ...response.planVerdicts[0] }; }],
      ["unknown plan reference", (response) => { response.planVerdicts[0].itemId = "unknown-item"; }],
      ["incomplete merge ids", (response) => { response.planVerdicts[0].mergedItemIds = ["item-a"]; }],
      ["overlong returned id", (response) => { response.planVerdicts[0].itemId = "x".repeat(65); }],
      ["ordinary paragraph numeric limit", (response) => { response.verdicts[0].paragraph = 10_000_000_000; }],
      ["plan paragraph numeric limit", (response) => { response.planVerdicts[0].paragraph = 10_000_000_000; }],
      ["unknown ordinary property", (response) => { Object.assign(response.verdicts[0], { unknownOrdinary: true }); }],
      ["unknown plan property", (response) => { Object.assign(response.planVerdicts[0], { unknownPlan: true }); }],
      ["both plan identities", (response) => { response.planVerdicts[0].skippedRoleId = "prior_year_status"; }],
    ];
    for (const [name, mutate] of invalidRows) {
      const response = structuredClone(valid);
      mutate(response);
      const dropped = await execute(response);
      const value = await dropped.result;
      expect(dropped.create, name).toHaveBeenCalledTimes(2);
      expect(value.verdicts, name).toHaveLength(valid.verdicts.length);
      expect(value.planVerdicts, name).toHaveLength(valid.planVerdicts.length);
      const notChecked = [
        ...value.verdicts.filter((verdict) => verdict.notChecked),
        ...value.planVerdicts.filter((verdict) => verdict.reason.startsWith("Not checked")),
      ];
      expect(notChecked, name).toHaveLength(1);
      expect(notChecked[0]?.outcome, name).toBe("not_applied");
      expect(value.storylineQuestion?.question, name).toBe("Which result is supported?");
    }

    // An invalid Storyline question is dropped; every verdict stands and
    // nothing is missing, so no follow-up is sent.
    const invalidQuestions: Array<[string, (response: typeof valid) => void]> = [
      ["Storyline numeric limit", (response) => { response.storylineQuestion.confidenceEntry = 10_000_000_000; }],
      ["negative Storyline entry", (response) => { response.storylineQuestion.confidenceEntry = -1; }],
      ["oversized negative Storyline entry", (response) => { response.storylineQuestion.confidenceEntry = -10_000_000_000; }],
      ["unknown Storyline property", (response) => { Object.assign(response.storylineQuestion, { unknownQuestion: true }); }],
    ];
    for (const [name, mutate] of invalidQuestions) {
      const response = structuredClone(valid);
      mutate(response);
      const dropped = await execute(response);
      const value = await dropped.result;
      expect(dropped.create, name).toHaveBeenCalledTimes(1);
      expect(value.storylineQuestion, name).toBeNull();
      expect(value.verdicts.some((verdict) => verdict.notChecked), name).toBe(false);
      expect(value.planVerdicts.map((verdict) => verdict.outcome), name)
        .toEqual(["applied", "applied", "applied"]);
    }

    // An omitted row no longer rejects the whole response (2026-09-28): one
    // follow-up asks for it. Here the follow-up repeats the whole answer:
    // the repeats of rows already answered are dropped, the omitted row is
    // still missing and is recorded as not checked.
    for (const [name, mutate] of [
      ["omitted ordinary row", (response: typeof valid) => { response.verdicts.pop(); }],
      ["omitted plan row", (response: typeof valid) => { response.planVerdicts.pop(); }],
    ] as const) {
      const response = structuredClone(valid);
      mutate(response);
      const omitted = await execute(response);
      const value = await omitted.result;
      expect(omitted.create, name).toHaveBeenCalledTimes(2);
      expect(value.verdicts, name).toHaveLength(valid.verdicts.length);
      expect(value.planVerdicts, name).toHaveLength(valid.planVerdicts.length);
      const notChecked = [
        ...value.verdicts.filter((verdict) => verdict.notChecked),
        ...value.planVerdicts.filter((verdict) => verdict.reason.startsWith("Not checked")),
      ];
      expect(notChecked, name).toHaveLength(1);
      expect(notChecked[0]?.outcome, name).toBe("not_applied");
    }

    // An overlong escaped free-text field no longer rejects the whole
    // response: it is clipped to its limit and the rest is kept as returned.
    const overlong = structuredClone(valid);
    overlong.verdicts[0].reason = "\n".repeat(33);
    const clipped = await execute(overlong);
    const value = await clipped.result;
    expect(clipped.create).toHaveBeenCalledTimes(1);
    expect(value.verdicts).toHaveLength(valid.verdicts.length);
    expect(value.planVerdicts.map((verdict) => verdict.outcome))
      .toEqual(["applied", "applied", "applied"]);
    expect(value.storylineQuestion?.question).toBe("Which result is supported?");
  });

  it.each([
    [-1, false],
    [1.5, false],
    [0, true],
    [1, true],
    [2, false],
  ] as const)("validates Summary ordinary paragraph %s", async (paragraph, accepted) => {
    const check: SelfCheckPlanCheck = {
      itemId: "item-1",
      roleId: "company_context",
      mergedItemIds: ["item-1"],
      instruction: "cover",
      confirmedExclusion: false,
      wording: ["Frozen wording."],
      relationshipReferences: [],
      sourceReferences: [],
    };
    const create = vi.fn(async (params: GenerationMessageParams) => ({
      content: [{
        type: "tool_use" as const,
        id: "ordinary-paragraph",
        name: params.tool_choice?.name ?? "submit_self_check",
        input: {
          verdicts: [{
            paragraph,
            check: "storyline",
            instruction: "storyline",
            outcome: "applied",
            reason: "Applied.",
          }],
          planVerdicts: [{
            itemId: "item-1",
            mergedItemIds: ["item-1"],
            paragraph: 1,
            outcome: "applied",
            reason: "Applied.",
          }],
        },
      }],
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
    const result = runModelSelfCheck({ messages: { create } } as GenerationClient, {
      section: "242",
      text: "One paragraph.",
      storylineText: "Frozen storyline.",
      confidenceMap: [],
      glossaryCandidates: [],
      rules: [],
      model: "claude-opus-4-8",
      planChecks: [check],
      planChecksBlock: serializeFrozenSummaryPlanChecks([check]),
    });
    const value = await result;
    if (!accepted) {
      // The invalid verdict is dropped and asked for once (2026-09-28,
      // run 4); the follow-up repeats it, so the label is not checked.
      expect(value.verdicts[0]).toMatchObject({ notChecked: true, outcome: "not_applied" });
      expect(value.planVerdicts[0]?.outcome).toBe("applied");
      expect(create).toHaveBeenCalledTimes(2);
    } else {
      expect(value.verdicts[0]?.paragraphIndex).toBe(paragraph === 0 ? undefined : 0);
      expect(create).toHaveBeenCalledTimes(1);
    }
  });

  it("an excluded claim triggers exactly one repair and the row records repaired: true", async () => {
    const drafted = `${CLEAN["242"]}\n\n${EXCLUDED} to reflect the new product.`;
    const { notes, sectionRows, generation, t, generationId } = await generate({
      drafts: { "242": drafted },
      repairs: { "242": CLEAN["242"] },
    });
    expect(generation.status).toBe("completed");
    expect(callsFor("242", "repair")).toHaveLength(1);
    const repairPrompt = callsFor("242", "repair")[0];
    expect(repairPrompt).toContain('remove the excluded claim "Logo redesign is out of scope."');
    expect(repairPrompt).toContain(`${ORDERED_PROMPT_SCAFFOLDS.repairGuidance.draftPrefix}${drafted}`);
    expect(callsFor("244", "repair")).toHaveLength(0);
    expect(callsFor("246", "repair")).toHaveLength(0);

    const exclusion = notes.filter(
      (note) => note.section === "242" && note.instruction === "Claim Exclusion: Logo redesign is out of scope."
    );
    expect(exclusion).toEqual([
      expect.objectContaining({ source: "deterministic", outcome: "applied", tier: "none", repaired: true }),
    ]);
    expect(exclusion[0].reason).toContain("excluded claim absent (business risk); repaired");

    const { row, selfCheck } = rowFor(sectionRows, "242");
    expect(row.draftText).toBe(CLEAN["242"]);
    expect(selfCheck).toMatchObject({ status: "repair_attempted", repairAttempted: true, remainingFailures: 0 });

    // Every repair is its own metered model interaction.
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const usage = await t.run((ctx) =>
      ctx.db.query("aiUsage").withIndex("by_generationId", (q) => q.eq("generationId", generationId)).collect()
    );
    expect(usage.filter((entry) => entry.callSite === "generation:repair:242")).toHaveLength(1);
    expect(usage.filter((entry) => entry.callSite.startsWith("generation:repair:"))).toHaveLength(1);
  });

  it("an off-glossary synonym is repaired to the Glossary Term", async () => {
    const synonym = "The work showed which feedback regulator structure keeps the output stable.";
    const { notes, sectionRows } = await generate({
      drafts: { "246": synonym },
      repairs: { "246": CLEAN["246"] },
      selfCheck: (section, user) =>
        section === "246" && selfCheckDraftBlock(user).includes("feedback regulator")
          ? {
              verdicts: [
                {
                  paragraph: 1,
                  check: "glossary",
                  instruction: "control loop",
                  outcome: "not_applied",
                  reason: "uses 'feedback regulator' for the Glossary Term 'control loop'",
                  repairGuidance: "Replace 'feedback regulator' with 'control loop'.",
                },
              ],
            }
          : { verdicts: [] },
    });
    // The rule-based matcher found no verbatim use, so the term was handed to
    // the model as a candidate.
    expect(selfCheckPrompt("246")).toContain("GLOSSARY CANDIDATES");
    expect(selfCheckPrompt("246")).toContain("- control loop");
    expect(selfCheckPrompt("242")).not.toContain("GLOSSARY CANDIDATES");
    expect(callsFor("246", "repair")).toHaveLength(1);
    expect(callsFor("246", "repair")[0]).toContain("Paragraph 1: Replace 'feedback regulator' with 'control loop'.");

    const glossary = notes.filter((note) => note.section === "246" && note.source === "model");
    expect(glossary).toEqual([
      expect.objectContaining({
        instruction: "control loop",
        outcome: "applied",
        repaired: true,
        tier: "none",
        paragraphIndex: 0,
      }),
    ]);
    expect(glossary[0].reason).toContain("repaired to the Glossary Term");
    expect(rowFor(sectionRows, "246").row.draftText).toBe(CLEAN["246"]);
  });

  it("a whole-section verdict (paragraph 0) is not confused with a paragraph-1 verdict", async () => {
    const { notes } = await generate({
      selfCheck: (section) =>
        section === "244"
          ? {
              verdicts: [
                {
                  paragraph: 0,
                  check: "instruction",
                  instruction: "Whole-section rule",
                  outcome: "applied",
                  reason: "satisfied across the section",
                },
                {
                  paragraph: 1,
                  check: "instruction",
                  instruction: "Paragraph-one rule",
                  outcome: "applied",
                  reason: "satisfied in the first paragraph",
                },
              ],
            }
          : { verdicts: [] },
    });
    const rows = notes.filter((note) => note.section === "244" && note.source === "model");
    const whole = rows.find((note) => note.instruction === "Whole-section rule");
    const paragraphOne = rows.find((note) => note.instruction === "Paragraph-one rule");
    expect(whole?.paragraphIndex).toBeUndefined();
    expect(paragraphOne?.paragraphIndex).toBe(0);
  });

  it("an s242 cap breach gets one repair; a repair that still breaches is recorded not_applied with the word count", async () => {
    // Over the 350-word cap across several paragraphs, as a real over-long
    // draft is (one giant paragraph would exceed a provenance claim's limit).
    const long = [
      CLEAN["242"],
      ...Array.from({ length: 10 }, (_, paragraph) =>
        Array.from({ length: 38 }, (_, index) => `measurement${(paragraph + index) % 7}`).join(" ")
      ),
    ].join("\n\n");
    const words = sectionMetrics(long, "s242").words;
    expect(words).toBeGreaterThan(350);
    const { notes, sectionRows, generation } = await generate({
      drafts: { "242": long },
      repairs: { "242": long },
    });
    expect(generation.status).toBe("completed");
    expect(callsFor("242", "repair")).toHaveLength(1);

    const locked = notes.filter((note) => note.section === "242" && note.tier === "locked");
    expect(locked).toEqual([
      expect.objectContaining({ source: "deterministic", outcome: "not_applied", repaired: true }),
    ]);
    expect(locked[0].reason).toContain(`cap breach at ${words}/350 words`);
    expect(locked[0].reason).toContain("repair failed");
    // 2026-09-28 (second): the breach says the text was kept whole and
    // what the writer must do; it counts the passes on the kept repair.
    expect(locked[0].reason).toContain(
      "still over after 2 shortening passes. The text was not cut to fit: shorten Line 242 to 350 words and 50 lines before filing"
    );

    const { selfCheck, slotCounts } = rowFor(sectionRows, "242");
    expect(selfCheck).toMatchObject({ status: "repair_failed", repairAttempted: true, remainingFailures: 1 });
    // Draft + two squeezes + Self-check + one repair + two squeezes on the
    // repair (the Self-check's structured retry makes 8 the worst case).
    expect(slotCounts).toEqual({
      "section:242": 1,
      "compression:242": 4,
      "selfCheck:242": 1,
      "repair:242": 1,
    });
    expect(Object.values(slotCounts).reduce((sum, count) => sum + count, 0)).toBe(
      SEQUENTIAL_CALLS_PER_GENERATE_CANDIDATE + COMPRESSION_REQUEST.squeezes.length
    );
    const budget = JSON.parse(generation.agentOutputs ?? "null").callBudget;
    expect(budget.counts).toMatchObject({ "compression:242": 4, "repair:242": 1 });
    expect(budget.overrun).toEqual([]);
  });

  it.each([
    [
      "flat",
      "The team built three control loop prototypes.\n\nResponse time under load was 12 ms.",
      true,
    ],
    [
      "hedged",
      "The team built three control loop prototypes.\n\nResponse time under load was not measured, so it remains unconfirmed.",
      false,
    ],
  ] as const)("an unreliable fact stated %s: flat fails as missing_fact and the repair hedges it", async (_label, draft, fails) => {
    const hedged =
      "The team built three control loop prototypes.\n\nResponse time under load was not measured, so it remains unconfirmed.";
    const { notes, sectionRows } = await generate({
      drafts: { "244": draft },
      repairs: { "244": hedged },
      selfCheck: (section, user) => {
        if (section !== "244") return { verdicts: [] };
        const block = selfCheckDraftBlock(user);
        return {
          verdicts: [
            block.includes("was 12 ms")
              ? {
                  paragraph: 2,
                  check: "confidence",
                  instruction: "Response time under load is unreliable.",
                  outcome: "not_applied",
                  reason: "states an unreliable fact without hedging",
                  repairGuidance: "Hedge the response-time figure: it was not measured.",
                }
              : {
                  paragraph: 2,
                  check: "confidence",
                  instruction: "Response time under load is unreliable.",
                  outcome: "applied",
                  reason: "hedged",
                },
          ],
        };
      },
    });
    // The Self-check sees the Confidence Map entry with its level.
    expect(selfCheckPrompt("244")).toContain("[C1] (unreliable) Response time under load is unreliable.");
    const rows = notes.filter((note) => note.section === "244" && note.source === "model");
    expect(rows).toHaveLength(1);
    const { row, selfCheck } = rowFor(sectionRows, "244");
    if (fails) {
      expect(rows[0]).toMatchObject({ outcome: "not_applied", tier: "missing_fact", repaired: true, paragraphIndex: 1 });
      expect(callsFor("244", "repair")).toHaveLength(1);
      expect(callsFor("244", "repair")[0]).toContain("Paragraph 2: Hedge the response-time figure: it was not measured.");
      expect(row.draftText).toBe(hedged);
      expect(selfCheck.status).toBe("repair_attempted");
    } else {
      expect(rows[0]).toMatchObject({ outcome: "applied", tier: "none", repaired: false, paragraphIndex: 1 });
      expect(callsFor("244", "repair")).toHaveLength(0);
      expect(row.draftText).toBe(draft);
      expect(selfCheck.status).toBe("pass");
    }
  });

  it("a failed repair leaves the paragraph-scoped row with its paragraphIndex and never repairs twice", async () => {
    const drafted = `${CLEAN["242"]}\n\n${EXCLUDED} for the launch.`;
    const { notes, sectionRows } = await generate({
      drafts: { "242": drafted },
      repairs: { "242": drafted },
    });
    expect(callsFor("242", "repair")).toHaveLength(1);
    const exclusion = notes.filter((note) => note.section === "242" && note.instruction.startsWith("Claim Exclusion"));
    expect(exclusion).toEqual([
      expect.objectContaining({ outcome: "not_applied", paragraphIndex: 1, repaired: true }),
    ]);
    expect(exclusion[0].reason).toContain("excluded claim appears in paragraph 2");
    expect(exclusion[0].reason).toContain("repair failed");
    expect(rowFor(sectionRows, "242").selfCheck.status).toBe("repair_failed");
  });

  it("a Storyline contradiction with stronger evidence raises one storylineQuestion and is never repaired", async () => {
    const { t, generation, notes, sectionRows } = await generate({
      selfCheck: (section) =>
        section === "246"
          ? {
              verdicts: [],
              storylineQuestion: {
                question: "The Storyline says the loop stabilized output, but response under load was not measured. Which should the PD follow?",
                sectionClaim: "Response under load was never measured.",
                confidenceEntry: 1,
                storylineAlternative: "The team pursued a control loop whose load response remains unmeasured.",
              },
            }
          : { verdicts: [] },
    });
    expect(generation.status).toBe("completed");
    expect(callsFor("246", "repair")).toHaveLength(0);
    expect(rowFor(sectionRows, "246").selfCheck.status).toBe("pass");

    const questions = await t.run((ctx) =>
      ctx.db.query("generationBriefEntries").collect()
    ).then((entries) => entries.filter((entry) => entry.group === "storylineQuestion"));
    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({
      briefId: generation.briefId,
      text: "Response under load was never measured.",
      exactExcerpt: "Response time under load was not measured.",
      question: {
        questionText: expect.stringContaining("Which should the PD follow?"),
        alternativeText: "The team pursued a control loop whose load response remains unmeasured.",
      },
    });
    const storyline = notes.filter((note) => note.section === "246" && note.instruction === "Storyline");
    expect(storyline).toEqual([expect.objectContaining({ source: "model", outcome: "not_applied", repaired: false })]);
  });

  it("every section failing its repair still completes the generation with all three sections flagged", async () => {
    const tainted = (section: Section) => `${CLEAN[section]}\n\n${EXCLUDED} this quarter.`;
    const { generation, sectionRows, asWriter, generationId } = await generate({
      drafts: { "242": tainted("242"), "244": tainted("244"), "246": tainted("246") },
      repairs: { "242": tainted("242"), "244": new Error("provider overloaded"), "246": tainted("246") },
    });
    expect(generation.status).toBe("completed");
    for (const section of ["242", "244", "246"] as const) {
      expect(callsFor(section, "repair")).toHaveLength(1);
      expect(rowFor(sectionRows, section).selfCheck.status).toBe("repair_failed");
    }
    const drafts = await asWriter.query(api.generations.getOrderedSectionDrafts, { generationId });
    expect((drafts ?? []).map((draft) => [draft.section, draft.selfCheckStatus])).toEqual([
      ["242", "repair_failed"],
      ["244", "repair_failed"],
      ["246", "repair_failed"],
    ]);
    // A repair call that fails keeps the original draft on display.
    expect(rowFor(sectionRows, "244").row.draftText).toBe(tainted("244"));
    const reports = await asWriter.query(api.complianceNotes.listForGeneration, { generationId });
    const failedCall = reports.filter((note) => note.section === "244" && note.instruction.startsWith("Claim Exclusion"));
    expect(failedCall[0].reason).toContain("repair call failed");
    expect(failedCall[0].repaired).toBe(false);
  });
});

// ─── Deterministic rules (convex/lib/selfCheckRules.ts) ─────────────────────

const PROFILE: OrderedProfileContext = {
  profileState: "applied",
  categoryOutcomes: [],
  buildOrder: ["242", "244", "246"],
  selfCheckRules: [],
};
const words = (count: number) => Array.from({ length: count }, (_, index) => `w${index % 9}`).join(" ");

describe("deterministic Self-check rules", () => {
  it("applies a profile cap above the Locked cap up to the cap and reports tier conflict with the actual values", () => {
    const check = runDeterministicSelfCheck({
      section: "242",
      text: words(300),
      brief: null,
      profile: { ...PROFILE, selfCheckRules: [{ section: "242", instruction: "Keep Line 242 under 500 words.", maxWords: 500 }] },
      isFirstInOrder: false,
    });
    const rule = check.entries.find((entry) => entry.key === "rule:0");
    expect(rule?.row).toMatchObject({
      instruction: "Keep Line 242 under 500 words.",
      outcome: "applied",
      tier: "conflict",
      reason: "cap met at 300/350 words (rule asked 500; the Locked cap applies)",
    });
    expect(rule?.repairable).toBe(false);
  });

  it("a paragraph rule is paragraph-scoped, and a rule tighter than the Locked cap needs repair when exceeded", () => {
    const check = runDeterministicSelfCheck({
      section: "244",
      text: `${words(20)}\n\n${words(60)}`,
      brief: null,
      profile: {
        ...PROFILE,
        selfCheckRules: [
          { section: "244", paragraphIndex: 1, instruction: "Second paragraph at most 40 words.", maxWords: 40 },
          { section: "244", paragraphIndex: 4, instruction: "Fifth paragraph states the result.", maxLines: 5 },
          { section: "246", instruction: "Not for this section.", maxWords: 10 },
          { instruction: "Lead with the uncertainty." },
        ],
      },
      isFirstInOrder: false,
    });
    expect(check.entries.find((entry) => entry.key === "rule:0")).toMatchObject({
      repairable: true,
      row: { paragraphIndex: 1, outcome: "not_applied", tier: "none", reason: "exceeds: 60/40 words" },
    });
    expect(check.entries.find((entry) => entry.key === "rule:1")?.row).toMatchObject({
      paragraphIndex: 4,
      outcome: "not_applied",
      reason: "paragraph 5 is not present in Line 244",
    });
    expect(check.entries.find((entry) => entry.key === "rule:2")).toBeUndefined();
    // An uncapped rule is the model's to judge, quoted verbatim.
    expect(check.modelRules).toEqual([{ instruction: "Lead with the uncertainty." }]);
  });

  it("skips an empty Claim Exclusion instead of matching every draft", () => {
    const check = runDeterministicSelfCheck({
      section: "246",
      text: "Anything at all.",
      brief: {
        storylineText: "",
        claimExclusions: [{ text: "   ", exactExcerpt: "" }],
        confidenceMap: [],
        glossaryTerms: [],
      },
      profile: PROFILE,
      isFirstInOrder: false,
    });
    expect(check.entries.some((entry) => entry.key.startsWith("exclusion:"))).toBe(false);
  });

  it("puts the Build Order row on the first section only, unless the order fell back", () => {
    const keys = (profile: OrderedProfileContext, isFirstInOrder: boolean) =>
      runDeterministicSelfCheck({ section: "244", text: "Text.", brief: null, profile, isFirstInOrder }).entries.map(
        (entry) => entry.key
      );
    expect(keys(PROFILE, true)).toContain("buildOrder");
    expect(keys(PROFILE, false)).not.toContain("buildOrder");
    expect(keys({ ...PROFILE, buildOrderFallbackReason: "invalid section in Build Order: 245" }, false)).toContain(
      "buildOrder"
    );
  });

  it("words the Storyline row by whether the question actually reached the Brief", () => {
    const before = runDeterministicSelfCheck({
      section: "242",
      text: "Text.",
      brief: null,
      profile: PROFILE,
      isFirstInOrder: false,
    });
    const reasonFor = (recorded: boolean) =>
      assembleSectionNotes({
        section: "242",
        before,
        after: null,
        verdicts: [],
        modelCheck: { ok: true },
        storylineQuestion: { question: "Which result holds?", recorded },
        repair: { attempted: false, succeeded: false },
        finalText: "Text.",
      })
        .rows.filter((row) => row.instruction === "Storyline")
        .at(-1)?.reason;
    expect(reasonFor(true)).toContain("Storyline question raised in the Brief: Which result holds?");
    expect(reasonFor(false)).toContain("Storyline question not recorded in the Brief");
    expect(reasonFor(false)).not.toContain("raised in the Brief");
  });

  it("records a label or plan check with no verdict as not checked, never repaired and never covered", () => {
    const before = runDeterministicSelfCheck({
      section: "244",
      text: "Text.",
      brief: null,
      profile: PROFILE,
      isFirstInOrder: false,
    });
    const verdicts = [
      {
        check: "confidence" as const,
        instruction: "Confidence Map: The Tessel drift figure is partial.",
        outcome: "not_applied" as const,
        reason: NOT_CHECKED_REASON,
        notChecked: true as const,
      },
      {
        paragraphIndex: 0,
        check: "glossary" as const,
        instruction: "Glossary Term: fouling rig",
        outcome: "not_applied" as const,
        reason: "P1 says test tank.",
        repairGuidance: "Say fouling rig in paragraph 1.",
      },
    ];
    // Only the real finding goes to the repair.
    expect(repairIssues(before, verdicts)).toEqual(["Paragraph 1: Say fouling rig in paragraph 1."]);
    const { rows } = assembleSectionNotes({
      section: "244",
      before,
      after: before,
      verdicts,
      modelCheck: { ok: true },
      storylineQuestion: null,
      repair: { attempted: true, succeeded: true },
      finalText: "Text.",
    });
    const notChecked = rows.find((row) => row.instruction.startsWith("Confidence Map:"));
    expect(notChecked).toMatchObject({
      outcome: "not_applied",
      tier: "none",
      reason: NOT_CHECKED_REASON,
      repaired: false,
    });
    expect(notChecked).not.toHaveProperty("paragraphIndex");

    const summaryVersionId = "summary" as Id<"summaryVersions">;
    const planRows = planComplianceNoteDrafts({
      section: "244",
      summaryVersionId,
      checks: [{
        skippedRoleId: "prior_year_status",
        roleId: "prior_year_status",
        mergedItemIds: [],
        instruction: "skip",
        confirmedExclusion: false,
        wording: [],
        relationshipReferences: [],
        sourceReferences: [],
      }],
      verdicts: [{
        skippedRoleId: "prior_year_status",
        mergedItemIds: [],
        outcome: "not_applied",
        reason: PLAN_SKIP_NOT_CHECKED_REASON,
        actionableRepair: false,
      }],
      repairSucceeded: true,
      coverageCheckSucceeded: true,
    });
    expect(planRows).toEqual([expect.objectContaining({
      instruction: "Omit signed-off role prior_year_status",
      outcome: "not_applied",
      reason: PLAN_SKIP_NOT_CHECKED_REASON,
      repaired: false,
    })]);
  });

  it("writes one plan row per item and Skip, retains merges, and records a kept idea from its verdict, never as repaired", () => {
    const summaryVersionId = "summary" as Id<"summaryVersions">;
    const first = "item-1" as Id<"summaryItems">;
    const second = "item-2" as Id<"summaryItems">;
    const rows = planComplianceNoteDrafts({
      section: "246",
      summaryVersionId,
      checks: [
        {
          itemId: first,
          roleId: "specific_advancements",
          mergedItemIds: [first, second],
          instruction: "cover",
          confirmedExclusion: false,
          wording: ["First advancement."],
          relationshipReferences: [],
          sourceReferences: [],
        },
        {
          itemId: second,
          roleId: "specific_advancements",
          mergedItemIds: [first, second],
          instruction: "cover",
          confirmedExclusion: true,
          wording: ["Excluded advancement."],
          relationshipReferences: [],
          sourceReferences: [],
        },
        {
          skippedRoleId: "project_status",
          roleId: "project_status",
          mergedItemIds: [],
          instruction: "skip",
          confirmedExclusion: false,
          wording: [],
          relationshipReferences: [],
          sourceReferences: [],
        },
      ],
      verdicts: [
        { itemId: first, mergedItemIds: [first, second], paragraphIndex: 1, outcome: "applied", reason: "Covered." },
        { itemId: second, mergedItemIds: [first, second], paragraphIndex: 1, outcome: "applied", reason: "Covered." },
        { skippedRoleId: "project_status", mergedItemIds: [], paragraphIndex: 2, outcome: "applied", reason: "Absent." },
      ],
    });
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ outcome: "applied", paragraphIndex: 1, planRef: { itemId: first, mergedItemIds: [first, second] } });
    // CAP-13 rule 4 (2026-09-29, second): the idea the writer kept despite a
    // Claim Exclusion is drafted; its row says so, tier conflict, never repaired.
    expect(rows[1]).toMatchObject({
      outcome: "applied",
      tier: "conflict",
      repaired: false,
      paragraphIndex: 1,
      reason: keptIdeaReason("drafted", "Excluded advancement."),
      planRef: { itemId: second, mergedItemIds: [first, second] },
    });
    expect(rows[1].reason).toBe(
      "Drafted despite a Claim Exclusion: the writer kept the idea \"Excluded advancement.\" at sign-off, so it stays in the report as work the project did and is not repaired away."
    );
    expect(rows[2]).toMatchObject({ outcome: "applied", planRef: { skippedRoleId: "project_status", mergedItemIds: [] } });
  });

  it("records a kept idea from its coverage verdict: not drafted, over the limit or not checked, never from its words alone", () => {
    const summaryVersionId = "summary" as Id<"summaryVersions">;
    const item = "item-kept" as Id<"summaryItems">;
    const check = {
      itemId: item,
      roleId: "experimentation" as const,
      mergedItemIds: [item],
      instruction: "cover" as const,
      confirmedExclusion: true,
      wording: ["The work also covered the billing portal move."],
      relationshipReferences: [],
      sourceReferences: [],
    };
    const exclusion = "Migration of the customer billing portal was routine IT work.";
    const confirmed = (extra: { paragraphIndex?: number; droppedForLimit?: boolean } = {}) =>
      new Map([[item as string, {
        exclusions: [exclusion],
        words: "The work also covered the billing portal move.",
        ...extra,
      }]]);
    const notCovered = [{ itemId: item, mergedItemIds: [item], outcome: "not_applied" as const, reason: "Only a disclaimer." }];
    const missing = planComplianceNoteDrafts({
      section: "244",
      summaryVersionId,
      checks: [check],
      verdicts: notCovered,
      coverageCheckSucceeded: true,
      confirmed: confirmed(),
    });
    expect(missing[0]).toMatchObject({ outcome: "not_applied", tier: "conflict", repaired: false });
    expect(missing[0].reason).toBe(
      "Not drafted: the writer kept the idea \"The work also covered the billing portal move.\" at sign-off despite the Claim Exclusion \"Migration of the customer billing portal was routine IT work.\", but the final text does not state it as work the project did. Add it before filing, or confirm with the writer that it should go."
    );
    // Review P2-1: its excluded words standing in the text (a disclaimer
    // holds them too) never overrule a not-covered verdict.
    const inText = planComplianceNoteDrafts({
      section: "244",
      summaryVersionId,
      checks: [check],
      verdicts: notCovered,
      coverageCheckSucceeded: true,
      confirmed: confirmed({ paragraphIndex: 3 }),
    });
    expect(inText[0]).toMatchObject({ outcome: "not_applied", tier: "conflict" });
    expect(inText[0].reason.startsWith("Not drafted:")).toBe(true);
    // With no usable verdict the row is not checked, and says where the
    // words stand without calling it drafted.
    const unchecked = planComplianceNoteDrafts({
      section: "244",
      summaryVersionId,
      checks: [check],
      verdicts: [{ itemId: item, mergedItemIds: [item], outcome: "not_applied", reason: "The plan coverage Self-check did not complete." }],
      coverageCheckSucceeded: false,
      confirmed: confirmed({ paragraphIndex: 3 }),
    });
    expect(unchecked[0]).toMatchObject({ outcome: "not_applied", tier: "conflict" });
    expect(unchecked[0].reason).toBe(
      "Not checked: the Self-check gave no usable verdict for the idea the writer kept despite the Claim Exclusion \"Migration of the customer billing portal was routine IT work.\" (\"The work also covered the billing portal move.\"); its excluded words appear in paragraph 4 as written, which alone does not show it is stated as work the project did."
    );
    // Review P3-6: left out for the Locked limit.
    const overLimit = planComplianceNoteDrafts({
      section: "244",
      summaryVersionId,
      checks: [check],
      verdicts: [{ itemId: item, mergedItemIds: [item], outcome: "applied", paragraphIndex: 1, reason: "Covered." }],
      repairSucceeded: true,
      coverageCheckSucceeded: true,
      finalCoverage: { ok: true, verdicts: notCovered },
      confirmed: confirmed({ droppedForLimit: true }),
    });
    expect(overLimit[0]).toMatchObject({ outcome: "not_applied", tier: "conflict", repaired: false });
    expect(overLimit[0].reason).toContain("the draft that held it is further over the Line 244 limit and the Locked Rules come first");
    // The final coverage check decides after a used repair.
    const final = planComplianceNoteDrafts({
      section: "244",
      summaryVersionId,
      checks: [check],
      verdicts: notCovered,
      repairSucceeded: true,
      coverageCheckSucceeded: true,
      finalCoverage: { ok: true, verdicts: [{ itemId: item, mergedItemIds: [item], paragraphIndex: 4, outcome: "applied", reason: "P5 covers it." }] },
      confirmed: confirmed(),
    });
    expect(final[0]).toMatchObject({ outcome: "applied", tier: "conflict", paragraphIndex: 4, repaired: false });
    // Review P3-7: every matched exclusion is named.
    expect(keptIdeaReason("drafted", "Both.", ["A.", "B."])).toBe(
      'Drafted despite the Claim Exclusions "A." and "B.": the writer kept the idea "Both." at sign-off, so it stays in the report as work the project did and is not repaired away.'
    );
  });

  it("marks plan and model rows not re-verified when compression changed an accepted repair (review P2-1)", () => {
    const summaryVersionId = "summary" as Id<"summaryVersions">;
    const item = "item-1" as Id<"summaryItems">;
    const planRows = (repairShortened: boolean) =>
      planComplianceNoteDrafts({
        section: "246",
        summaryVersionId,
        checks: [{
          itemId: item,
          roleId: "specific_advancements",
          mergedItemIds: [item],
          instruction: "cover",
          confirmedExclusion: false,
          wording: ["The coating held 87 percent transmission after 38 days."],
          relationshipReferences: [],
          sourceReferences: [],
        }],
        verdicts: [{ itemId: item, mergedItemIds: [item], paragraphIndex: 1, outcome: "not_applied", reason: "Missing the 38-day result." }],
        repairSucceeded: true,
        repairShortened,
        coverageCheckSucceeded: true,
      });
    expect(planRows(false)[0]).toMatchObject({ outcome: "not_applied", repaired: true, reason: "Missing the 38-day result." });
    expect(planRows(true)[0]).toMatchObject({
      outcome: "not_applied",
      repaired: false,
      reason: "Missing the 38-day result.; repaired, then shortened to fit the Line limit, so not re-verified",
    });

    const before = runDeterministicSelfCheck({
      section: "246",
      text: "The coating held its transmission.",
      brief: null,
      profile: PROFILE,
      isFirstInOrder: false,
    });
    const modelRow = (shortened: boolean) =>
      assembleSectionNotes({
        section: "246",
        before,
        after: before,
        verdicts: [{ check: "storyline", instruction: "Storyline", outcome: "not_applied", reason: "Drifts.", paragraphIndex: 0 }],
        modelCheck: { ok: true },
        storylineQuestion: null,
        repair: { attempted: true, succeeded: true, shortened },
        finalText: "The coating held its transmission.",
      }).rows.find((row) => row.instruction === "Storyline");
    expect(modelRow(false)).toMatchObject({ repaired: true });
    // "Not checked" rows (2026-09-28) are never repaired, so never shortened.
    const notCheckedRow = assembleSectionNotes({
      section: "246",
      before,
      after: before,
      verdicts: [{ check: "storyline", instruction: "Storyline", outcome: "not_applied", reason: "Not checked.", notChecked: true }],
      modelCheck: { ok: true },
      storylineQuestion: null,
      repair: { attempted: true, succeeded: true, shortened: true },
      finalText: "The coating held its transmission.",
    }).rows.find((row) => row.instruction === "Storyline");
    expect(notCheckedRow).toMatchObject({ reason: "Not checked.", repaired: false });
    const notCheckedPlan = planComplianceNoteDrafts({
      section: "246",
      summaryVersionId,
      checks: [{
        itemId: item,
        roleId: "specific_advancements",
        mergedItemIds: [item],
        instruction: "cover",
        confirmedExclusion: false,
        wording: ["The coating held 87 percent transmission after 38 days."],
        relationshipReferences: [],
        sourceReferences: [],
      }],
      verdicts: [{ itemId: item, mergedItemIds: [item], outcome: "not_applied", reason: "Not checked.", actionableRepair: false }],
      repairSucceeded: true,
      repairShortened: true,
      coverageCheckSucceeded: true,
    });
    expect(notCheckedPlan[0]).toMatchObject({ reason: "Not checked.", repaired: false });
    expect(modelRow(true)).toMatchObject({
      repaired: false,
      reason: "Drifts.; repaired, then shortened to fit the Line limit, so not re-verified",
    });
  });
});

// ─── Summary plan coverage replay (2026-09-25) ──────────────────────────────
//
// Every real Step-by-step run reported "plan coverage unavailable": the
// Summary Self-check passed its schema, then the completeness check rejected
// the whole response because real reasons run 90 to 280 bytes against a
// 64-byte reservation. This replays the saved Line 244 input of a real Opus
// run (fictional demo data) answered with 33 reasons Sonnet 5 really wrote.

type PlanCoverageReplayKit = {
  case: {
    model: string;
    section: "244";
    text: string;
    storylineText: string;
    confidenceMap: Array<{ text: string; confidence?: string }>;
    items: Array<{
      itemId: string;
      roleId: PdSubsectionRoleId;
      support: "source_supported" | "writer_asserted";
      bullets: string[];
    }>;
  };
  recordedReasons: string[];
};
const planCoverageReplay = JSON.parse(planCoverageReplayKit) as PlanCoverageReplayKit;

function replayPlanChecks(): SelfCheckPlanCheck[] {
  return planCoverageReplay.case.items.map((item) => ({
    itemId: item.itemId,
    roleId: item.roleId,
    mergedItemIds: [item.itemId],
    instruction: "cover" as const,
    confirmedExclusion: false,
    support: item.support,
    wording: item.bullets,
    relationshipReferences: [],
    sourceReferences: [],
  }));
}

function replayInput() {
  const planChecks = replayPlanChecks();
  return {
    section: planCoverageReplay.case.section,
    text: planCoverageReplay.case.text,
    storylineText: planCoverageReplay.case.storylineText,
    confidenceMap: planCoverageReplay.case.confidenceMap,
    glossaryCandidates: [] as string[],
    rules: [] as Array<{ instruction: string }>,
    model: planCoverageReplay.case.model,
    planChecks,
    planChecksBlock: serializeFrozenSummaryPlanChecks(planChecks),
  };
}

/** The evidence paragraph (1-based) for each ordinary label and plan item. */
const REPLAY_ORDINARY_PARAGRAPHS = [0, 3, 3, 1, 1, 4, 4, 5, 5, 5];
const REPLAY_PLAN_PARAGRAPHS = [1, 1, 2, 3];

function replayResponse() {
  const input = replayInput();
  const reasons = planCoverageReplay.recordedReasons;
  let next = 0;
  const reason = () => reasons[next++ % reasons.length];
  const ordinary = projectSummaryOrdinaryChecks({
    storylineText: input.storylineText,
    confidenceMap: input.confidenceMap,
    glossaryTerms: input.glossaryCandidates,
    rules: input.rules,
  });
  return {
    verdicts: ordinary.map((check, index) => ({
      paragraph: REPLAY_ORDINARY_PARAGRAPHS[index] ?? 0,
      check: check.check,
      instruction: check.label,
      outcome: "applied",
      reason: reason(),
    })),
    planVerdicts: input.planChecks.map((check, index) => ({
      itemId: check.itemId,
      mergedItemIds: [...check.mergedItemIds],
      paragraph: REPLAY_PLAN_PARAGRAPHS[index],
      outcome: "applied",
      reason: reason(),
    })),
    storylineQuestion: null,
  };
}

function replayClient(response: unknown) {
  return {
    messages: {
      create: vi.fn(async (params: GenerationMessageParams) => ({
        content: [{
          type: "tool_use" as const,
          id: "plan-coverage-replay",
          name: params.tool_choice?.name ?? "submit_self_check",
          input: response,
        }],
        usage: { input_tokens: 1, output_tokens: 1 },
      })),
    },
  };
}

describe("Summary plan coverage replay (recorded Opus 244 case)", () => {
  it("accepts real-length reasons by clipping them, with every plan item applied on its paragraph", async () => {
    const response = replayResponse();
    const input = replayInput();
    // The recorded shape: 5 paragraphs, 10 labels, 4 plan items.
    expect(input.text.split(/\n\s*\n/)).toHaveLength(5);
    expect(response.verdicts).toHaveLength(10);
    expect(response.planVerdicts).toHaveLength(4);
    const sentReasons = [
      ...response.verdicts.map((verdict) => verdict.reason),
      ...response.planVerdicts.map((verdict) => verdict.reason),
    ];
    // Real reasons, most of them over the 64-byte reservation.
    expect(sentReasons.filter((reason) =>
      jsonEscapedUtf8Bytes(reason) > MAX_SUMMARY_SELF_CHECK_REASON_ESCAPED_UTF8_BYTES
    ).length).toBeGreaterThanOrEqual(10);
    // The whole response still fits the 16,384-byte limit.
    expect(new TextEncoder().encode(JSON.stringify(response)).byteLength)
      .toBeLessThanOrEqual(MAX_SUMMARY_SELF_CHECK_RESPONSE_UTF8_BYTES);

    const client = replayClient(response);
    const result = await runModelSelfCheck(client as GenerationClient, input);

    expect(client.messages.create).toHaveBeenCalledTimes(1);
    expect(result.planVerdicts).toHaveLength(4);
    expect(result.planVerdicts.map((verdict) => verdict.outcome))
      .toEqual(["applied", "applied", "applied", "applied"]);
    expect(result.planVerdicts.map((verdict) => verdict.paragraphIndex))
      .toEqual([0, 0, 1, 2]);
    expect(result.planVerdicts.map((verdict) => verdict.itemId))
      .toEqual(planCoverageReplay.case.items.map((item) => item.itemId));
    expect(result.verdicts).toHaveLength(10);
    expect(result.verdicts.every((verdict) => verdict.outcome === "applied")).toBe(true);
    const keptReasons = [
      ...result.verdicts.map((verdict) => verdict.reason),
      ...result.planVerdicts.map((verdict) => verdict.reason),
    ];
    keptReasons.forEach((kept, index) => {
      const sent = sentReasons[index] ?? "";
      expect(jsonEscapedUtf8Bytes(kept)).toBeLessThanOrEqual(
        MAX_SUMMARY_SELF_CHECK_REASON_ESCAPED_UTF8_BYTES
      );
      if (jsonEscapedUtf8Bytes(sent) <= MAX_SUMMARY_SELF_CHECK_REASON_ESCAPED_UTF8_BYTES) {
        expect(kept).toBe(sent.trim());
      } else {
        expect(kept.endsWith("…")).toBe(true);
        expect(sent.startsWith(kept.slice(0, -1))).toBe(true);
      }
    });
  });

  const REPLAY_QUESTION = {
    question: "Should the Storyline name the primer and cure hold?",
    sectionClaim: "The primer and the 40°C hold removed primer-layer failure.",
    storylineAlternative: "Low-temperature bonds held their strength once a primer and cure hold were added.",
    confidenceEntry: 1,
  };
  const LONG_QUESTION_TEXT =
    "The section shows that bonds cured at 60°C kept their lap shear strength through 200 cycles only after the silane primer and the 2-hour 40°C hold were added, which the Storyline never says.";

  it.each(["question", "sectionClaim", "storylineAlternative"] as const)(
    "withholds the Storyline question when its %s needed clipping, and keeps full coverage",
    async (field) => {
      const response = {
        ...replayResponse(),
        storylineQuestion: { ...REPLAY_QUESTION, [field]: LONG_QUESTION_TEXT },
      };
      const sentBytes = jsonEscapedUtf8Bytes(LONG_QUESTION_TEXT);
      expect(sentBytes).toBeGreaterThan(MAX_SUMMARY_SELF_CHECK_QUESTION_ESCAPED_UTF8_BYTES);
      expect(new TextEncoder().encode(JSON.stringify(response)).byteLength)
        .toBeLessThanOrEqual(MAX_SUMMARY_SELF_CHECK_RESPONSE_UTF8_BYTES);
      const client = replayClient(response);
      const result = await runModelSelfCheck(client as GenerationClient, replayInput());

      expect(client.messages.create).toHaveBeenCalledTimes(1);
      // Coverage is complete and unchanged: only the optional question goes.
      expect(result.planVerdicts.map((verdict) => verdict.outcome))
        .toEqual(["applied", "applied", "applied", "applied"]);
      expect(result.planVerdicts.map((verdict) => verdict.paragraphIndex))
        .toEqual([0, 0, 1, 2]);
      expect(result.verdicts).toHaveLength(10);
      expect(result.storylineQuestion).toBeNull();
      expect(result.storylineQuestionWithheld).toBe(
        `${field} is ${sentBytes} escaped bytes, limit ${MAX_SUMMARY_SELF_CHECK_QUESTION_ESCAPED_UTF8_BYTES}`
      );
      // The recorded reason never carries the model's own words.
      expect(result.storylineQuestionWithheld).not.toContain(LONG_QUESTION_TEXT.slice(0, 20));
    }
  );

  it("keeps clipped repair text in memory for the repair and stores only the clipped text", async () => {
    const longGuidance =
      "Add one sentence to paragraph 2 that names the silane primer and the 2-hour 40°C hold, and keep the rest of the paragraph as it is.";
    const shortGuidance = "Name the primer in paragraph 2.";
    const response = replayResponse();
    const recorded = planCoverageReplay.recordedReasons;
    const longReason = recorded.find((reason) =>
      jsonEscapedUtf8Bytes(reason) > MAX_SUMMARY_SELF_CHECK_REASON_ESCAPED_UTF8_BYTES) ?? "";
    expect(jsonEscapedUtf8Bytes(longGuidance))
      .toBeGreaterThan(MAX_SUMMARY_SELF_CHECK_GUIDANCE_ESCAPED_UTF8_BYTES);
    Object.assign(response.planVerdicts[0], {
      outcome: "not_applied",
      reason: longReason,
      repairGuidance: longGuidance,
    });
    Object.assign(response.planVerdicts[1], {
      outcome: "not_applied",
      reason: longReason,
      repairGuidance: shortGuidance,
    });
    Object.assign(response.verdicts[1], { outcome: "not_applied", reason: longReason });
    const result = await runModelSelfCheck(
      replayClient(response) as GenerationClient,
      replayInput()
    );

    const [clipped, inLimit, applied] = result.planVerdicts;
    expect(clipped?.repairGuidance?.endsWith("…")).toBe(true);
    expect(jsonEscapedUtf8Bytes(clipped?.repairGuidance ?? ""))
      .toBeLessThanOrEqual(MAX_SUMMARY_SELF_CHECK_GUIDANCE_ESCAPED_UTF8_BYTES);
    expect(clipped?.repairText).toBe(longGuidance);
    // In-limit guidance is what the repair uses, so no copy is kept.
    expect(inLimit?.repairGuidance).toBe(shortGuidance);
    expect(inLimit).not.toHaveProperty("repairText");
    expect(applied?.outcome).toBe("applied");
    expect(applied).not.toHaveProperty("repairText");
    // An ordinary verdict without guidance repairs from its whole reason.
    expect(result.verdicts[1]?.reason.endsWith("…")).toBe(true);
    expect(result.verdicts[1]?.repairText).toBe(longReason.trim());
    expect(result.verdicts[0]).not.toHaveProperty("repairText");
  });

  it("keeps an in-limit Storyline question exactly as the model wrote it", async () => {
    const response = { ...replayResponse(), storylineQuestion: REPLAY_QUESTION };
    const client = replayClient(response);
    const result = await runModelSelfCheck(client as GenerationClient, replayInput());
    expect(result.storylineQuestion).toEqual({
      question: REPLAY_QUESTION.question,
      sectionClaim: REPLAY_QUESTION.sectionClaim,
      storylineAlternative: REPLAY_QUESTION.storylineAlternative,
      confidenceEntryIndex: 0,
    });
    expect(result).not.toHaveProperty("storylineQuestionWithheld");
    expect(result.planVerdicts.every((verdict) => verdict.outcome === "applied")).toBe(true);
  });

  // 2026-09-28, run 4: one invalid verdict is dropped and logged by its
  // position, never its text; its label or plan check counts as missing, goes
  // to the one follow-up and, still missing there, is not checked.
  it.each([
    {
      name: "a wrong item id",
      mutate: (response: ReturnType<typeof replayResponse>) => {
        response.planVerdicts[1].itemId = "not-a-signed-off-item";
      },
      detail: "plan verdict 2: itemId of 21 escaped bytes matches no plan check",
      missing: { plan: 1 },
    },
    {
      // Neither reference: no unrelated item may be named in the reason.
      name: "a plan verdict with no reference",
      mutate: (response: ReturnType<typeof replayResponse>) => {
        Reflect.deleteProperty(response.planVerdicts[1], "itemId");
      },
      detail: "plan verdict 2: needs exactly one non-empty itemId, skippedRoleId, droppedSeedId or ruleId",
      missing: { plan: 1 },
    },
    {
      name: "a plan verdict with an empty itemId",
      mutate: (response: ReturnType<typeof replayResponse>) => {
        response.planVerdicts[2].itemId = "";
      },
      detail: "plan verdict 3: needs exactly one non-empty itemId, skippedRoleId, droppedSeedId or ruleId",
      missing: { plan: 2 },
    },
    {
      name: "empty mergedItemIds",
      mutate: (response: ReturnType<typeof replayResponse>) => {
        response.planVerdicts[0].mergedItemIds = [];
      },
      detail: `plan verdict 1 (item ${planCoverageReplay.case.items[0]?.itemId}): mergedItemIds has 0 ids, expected [${planCoverageReplay.case.items[0]?.itemId}] in that order`,
      missing: { plan: 0 },
    },
    {
      name: "a duplicate label",
      mutate: (response: ReturnType<typeof replayResponse>) => {
        response.verdicts[2] = { ...response.verdicts[1] };
      },
      detail: "ordinary verdict 3 (confidence:C1): label repeats",
      missing: { label: 2 },
    },
    {
      name: "an out-of-range paragraph",
      mutate: (response: ReturnType<typeof replayResponse>) => {
        response.verdicts[4].paragraph = 6;
      },
      detail: "ordinary verdict 5 (confidence:C4): paragraph 6 is not a whole number from 0 to 5",
      missing: { label: 4 },
    },
    {
      // The release suite's shape (run 4): the short marker, not the label.
      name: "a label copied without its prefix",
      mutate: (response: ReturnType<typeof replayResponse>) => {
        response.verdicts[3].instruction = "C3";
      },
      detail: "ordinary verdict 4: label of 2 escaped bytes matches no supplied label",
      missing: { label: 3 },
    },
  ])("drops only $name, asks once for it and records it as not checked", async ({ mutate, detail, missing }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const response = replayResponse();
      const labels = response.verdicts.map((verdict) => verdict.instruction);
      mutate(response);
      // The same answer again: the follow-up repeats the invalid verdict.
      const client = replayClient(response);
      const result = await runModelSelfCheck(client as GenerationClient, replayInput());
      expect(client.messages.create).toHaveBeenCalledTimes(2);
      const logged = warn.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(logged).toContain(detail);
      // The log never carries the model's own words.
      for (const reason of planCoverageReplay.recordedReasons) {
        expect(logged).not.toContain(reason.slice(0, 24));
      }
      expect(logged).not.toContain("not-a-signed-off-item");
      if ("plan" in missing) {
        result.planVerdicts.forEach((verdict, index) => {
          if (index === missing.plan) {
            expect(verdict).toMatchObject({
              outcome: "not_applied",
              reason: PLAN_ITEM_NOT_CHECKED_REASON,
              actionableRepair: false,
            });
          } else {
            expect(verdict.outcome).toBe("applied");
          }
        });
        expect(result.verdicts.some((verdict) => verdict.notChecked)).toBe(false);
      } else {
        const input = replayInput();
        const ordinary = projectSummaryOrdinaryChecks({
          storylineText: input.storylineText,
          confidenceMap: input.confidenceMap,
          glossaryTerms: input.glossaryCandidates,
          rules: input.rules,
        });
        const notChecked = result.verdicts.filter((verdict) => verdict.notChecked);
        expect(notChecked).toEqual([expect.objectContaining({
          instruction: ordinary.find((check) => check.label === labels[missing.label])?.instruction,
          outcome: "not_applied",
          reason: NOT_CHECKED_REASON,
        })]);
        expect(result.verdicts).toHaveLength(labels.length);
        expect(result.planVerdicts.every((verdict) => verdict.outcome === "applied")).toBe(true);
      }
    } finally {
      warn.mockRestore();
    }
  });

  it("keeps a follow-up's valid verdict when the first answer's was dropped", async () => {
    const response = replayResponse();
    const good = structuredClone(response.planVerdicts[1]);
    response.planVerdicts[1].mergedItemIds = [];
    const client = {
      messages: {
        create: vi.fn()
          .mockResolvedValueOnce({
            content: [{ type: "tool_use" as const, id: "first", name: "submit_self_check", input: response }],
            usage: { input_tokens: 1, output_tokens: 1 },
          })
          .mockResolvedValueOnce({
            content: [{
              type: "tool_use" as const,
              id: "follow-up",
              name: "submit_self_check",
              input: { verdicts: [], planVerdicts: [good] },
            }],
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
      },
    };
    const result = await runModelSelfCheck(client as unknown as GenerationClient, replayInput());
    expect(client.messages.create).toHaveBeenCalledTimes(2);
    expect(result.planVerdicts.every((verdict) => verdict.outcome === "applied")).toBe(true);
  });

  it.each([
    {
      name: "more invalid verdicts than valid ones",
      mutate: (response: ReturnType<typeof replayResponse>) => {
        response.verdicts.forEach((verdict) => { verdict.instruction = "not-a-label"; });
      },
      detail: "10 of 14 verdicts invalid; first ordinary verdict 1: label of 11 escaped bytes matches no supplied label",
    },
    {
      name: "a response over 16,384 bytes",
      mutate: (response: ReturnType<typeof replayResponse>) => {
        response.verdicts[0].reason = "The section matches the Storyline. ".repeat(480);
      },
      detail: "response failed validation: (root) Summary Self-check response exceeds its UTF-8 byte budget",
    },
  ])("still rejects the whole check for $name and names why", async ({ mutate, detail }) => {
    const response = replayResponse();
    mutate(response);
    const client = replayClient(response);
    const error = await runModelSelfCheck(client as GenerationClient, replayInput())
      .then(() => null, (caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(client.messages.create).toHaveBeenCalledTimes(1);
    const diagnostic = selfCheckFailureDiagnostic(error);
    expect(diagnostic).toContain(detail);
    // The diagnostic never carries the model's own words.
    for (const reason of planCoverageReplay.recordedReasons) {
      expect(diagnostic).not.toContain(reason.slice(0, 24));
    }
    expect(diagnostic).not.toContain("not-a-label");
  });

  it("names an answer cut off at the output limit as that, not as invalid JSON", async () => {
    const response = replayResponse();
    const client = {
      messages: {
        create: vi.fn(async (params: GenerationMessageParams) => ({
          content: [{
            type: "tool_use" as const,
            id: "plan-coverage-cut-off",
            name: params.tool_choice?.name ?? "submit_self_check",
            input: response,
          }],
          stop_reason: "max_tokens",
          usage: { input_tokens: 1, output_tokens: 1 },
        })),
      },
    };
    const error = await runModelSelfCheck(client as GenerationClient, replayInput())
      .then(() => null, (caught: unknown) => caught);
    // One call: the Summary Self-check has no repair attempt.
    expect(client.messages.create).toHaveBeenCalledTimes(1);
    const { OutputLimitError } = await import("./openrouterCore");
    expect(error).toBeInstanceOf(OutputLimitError);
    expect(selfCheckFailureDiagnostic(error)).toBe("answer was cut off at the output limit");
  });

  it("describes failures without a checked response by their kind only", async () => {
    expect(selfCheckFailureDiagnostic(new Error("provider said: secret client text")))
      .toBe("no response to check");
    expect(selfCheckFailureDiagnostic(
      new Error("submit_self_check: model did not return structured output")
    )).toBe("no tool output");
    const { MalformedOutputError } = await import("./openrouterCore");
    expect(selfCheckFailureDiagnostic(new MalformedOutputError("{\"reason\": \"model text\"")))
      .toBe("tool output was not valid JSON");
  });
});

// Unused-import guard for the Id type in helper signatures.
export type _GenerationIdForTests = Id<"generations">;

describe("LEAVE OUT and Line 246 advancement verdicts (2026-09-30, first)", () => {
  const leaveOut: SelfCheckPlanCheck = {
    droppedSeedId: "u-seed-fraction",
    roleId: "active_uncertainties",
    mergedItemIds: [],
    instruction: "leave_out",
    confirmedExclusion: false,
    wording: ["It was unclear what seed fraction would be needed at 6 degrees C."],
    relationshipReferences: [],
    sourceReferences: [],
  };
  const rule: SelfCheckPlanCheck = {
    ruleId: "advancements_answer_242",
    roleId: "specific_advancements",
    mergedItemIds: [],
    instruction: "answer_242",
    confirmedExclusion: false,
    wording: ["Line 242 as drafted."],
    relationshipReferences: [],
    sourceReferences: [],
  };

  it("drops a verdict naming two references or an unknown rule, asks once for them, and keeps each key on its verdict", async () => {
    const base = replayInput();
    const planChecks = [...base.planChecks, leaveOut, rule];
    const input = { ...base, planChecks, planChecksBlock: serializeFrozenSummaryPlanChecks(planChecks) };
    const first = replayResponse();
    const answers = [
      {
        ...first,
        planVerdicts: [
          ...first.planVerdicts,
          // Two references in one verdict, and a rule nobody supplied.
          { droppedSeedId: "u-seed-fraction", itemId: base.planChecks[0]!.itemId, mergedItemIds: [], paragraph: 0, outcome: "applied", reason: "Absent." },
          { ruleId: "some_other_rule", mergedItemIds: [], paragraph: 0, outcome: "applied", reason: "Fine." },
        ],
      },
      {
        verdicts: [],
        planVerdicts: [{ droppedSeedId: "u-seed-fraction", mergedItemIds: [], paragraph: 0, outcome: "applied", reason: "No seed fraction content." }],
      },
    ];
    const client = {
      messages: {
        create: vi.fn(async (params: GenerationMessageParams) => ({
          content: [{
            type: "tool_use" as const,
            id: "leave-out-replay",
            name: params.tool_choice?.name ?? "submit_self_check",
            input: answers.shift(),
          }],
          usage: { input_tokens: 1, output_tokens: 1 },
        })),
      },
    };
    const result = await runModelSelfCheck(client as GenerationClient, input);
    expect(client.messages.create).toHaveBeenCalledTimes(2);
    const followUp = userText(client.messages.create.mock.calls[1]![0]);
    expect(followUp).toContain("Return exactly 2 planVerdicts, one for each plan check below:\n- droppedSeedId u-seed-fraction\n- ruleId advancements_answer_242");
    expect(followUp).toContain(SUMMARY_PLAN_SELF_CHECK_REQUEST.leaveOut.instruction);
    expect(followUp).toContain(SUMMARY_PLAN_SELF_CHECK_REQUEST.answers242.instruction);
    expect(result.planVerdicts.slice(-2)).toEqual([
      { droppedSeedId: "u-seed-fraction", mergedItemIds: [], outcome: "applied", reason: "No seed fraction content." },
      {
        ruleId: "advancements_answer_242",
        mergedItemIds: [],
        outcome: "not_applied",
        reason: PLAN_RULE_NOT_CHECKED_REASON,
        actionableRepair: false,
      },
    ]);
  });

  it("adds the verdict fields and oneOf branches to a request's schema only when it has such a check", () => {
    const item = replayPlanChecks()[0]!;
    const without = summaryPlanSelfCheckSchemaFor([], [item]);
    expect(without.properties.planVerdicts.items.properties).not.toHaveProperty("droppedSeedId");
    expect(without.properties.planVerdicts.items.properties).not.toHaveProperty("ruleId");
    expect(without.properties.planVerdicts.items.oneOf).toEqual([{ required: ["itemId"] }, { required: ["skippedRoleId"] }]);
    const withBoth = summaryPlanSelfCheckSchemaFor([], [item, leaveOut, rule]);
    const properties = withBoth.properties.planVerdicts.items.properties as unknown as Record<string, { enum?: readonly string[] }>;
    expect(properties.droppedSeedId?.enum).toEqual(["u-seed-fraction"]);
    expect(properties.ruleId?.enum).toEqual(["advancements_answer_242"]);
    expect(withBoth.properties.planVerdicts.items.oneOf).toEqual([
      { required: ["itemId"] },
      { required: ["skippedRoleId"] },
      { required: ["droppedSeedId"] },
      { required: ["ruleId"] },
    ]);
  });
});

describe("results against targets, no talk about sources and Glossary repairs (2026-09-30, third)", () => {
  // Fictional Tessrow-like text: a met target called close, a memo named.
  const TEXT = [
    "The team tested two-angle imaging on 400 edges.",
    "Over 240 brackets, the test memo indicates reject rate held at 2.4 percent.",
    "The two interviewees describe the goal differently, and the flow was 7 to 8 percent lower depending on the measurement source.",
  ].join("\n\n");
  const deterministic = (text: string, sourceTalk?: { subjectText: readonly string[] }) =>
    runDeterministicSelfCheck({
      section: "244",
      text,
      brief: null,
      profile: PROFILE,
      isFirstInOrder: false,
      ...(sourceTalk ? { sourceTalk } : {}),
    });

  it("finds talk about sources only in a signed-off plan run, names each paragraph and phrase, and sends a fixed fix to the repair", () => {
    // Single draft and Compare: no such check, no row.
    expect(deterministic(TEXT).entries.some((entry) => entry.key === SOURCE_TALK_KEY)).toBe(false);
    const found = deterministic(TEXT, { subjectText: [] }).entries.find((entry) => entry.key === SOURCE_TALK_KEY);
    expect(found).toEqual({
      key: SOURCE_TALK_KEY,
      repairable: true,
      guidance:
        `Paragraphs 2 and 3: ${SOURCE_TALK.fix} ("the test memo indicates", "interviewees", "depending on the measurement source"). ${SOURCE_TALK.rule}`,
      row: {
        section: "244",
        paragraphIndex: 1,
        source: "deterministic",
        instruction: SOURCE_TALK.instruction,
        outcome: "not_applied",
        tier: "none",
        reason: 'names a source in paragraph 2 ("the test memo indicates") and paragraph 3 ("interviewees", "depending on the measurement source")',
        repaired: false,
      },
    });
    const before = deterministic(TEXT, { subjectText: [] });
    expect(repairIssues(before, [])).toEqual([found!.guidance]);
  });

  it("records clean text as applied and never fires on technical uses of source or on the project's own subject", () => {
    const technical = [
      "A light source and a heat source were compared; the sources of error were stray reflection and drift.",
      "The open-source solver read the source code, and the power source held 24 V.",
      "A stereo confidence map rated each depth pixel, and the brief exposure lasted 3 s.",
      "Two light sources were used. The sources gave 5 W each.",
    ].join("\n\n");
    expect(deterministic(technical, { subjectText: [] }).entries.find((entry) => entry.key === SOURCE_TALK_KEY)?.row)
      .toMatchObject({ outcome: "applied", reason: SOURCE_TALK.applied });
    // An interview scheduling product: a plain mention whose noun phrase the
    // plan's own words hold is its subject (Greptile round, lead decision).
    const product = "The engine ranked each interview by length.";
    expect(deterministic(product, { subjectText: ["Each interview is booked into a free slot."] })
      .entries.find((entry) => entry.key === SOURCE_TALK_KEY)?.row.outcome).toBe("applied");
    expect(deterministic(product, { subjectText: [] })
      .entries.find((entry) => entry.key === SOURCE_TALK_KEY)?.row.outcome).toBe("not_applied");
    // An interviewee is a reporting form: it always counts.
    expect(deterministic("The engine ranked each interviewee by availability.", { subjectText: ["The engine schedules each interviewee."] })
      .entries.find((entry) => entry.key === SOURCE_TALK_KEY)?.row.outcome).toBe("not_applied");
  });

  it("marks the row repaired when the repair took the source talk out", () => {
    const before = deterministic(TEXT, { subjectText: [] });
    const after = deterministic("The team tested two-angle imaging on 400 edges.", { subjectText: [] });
    const { rows } = assembleSectionNotes({
      section: "244",
      before,
      after,
      verdicts: [],
      modelCheck: { ok: true },
      storylineQuestion: null,
      repair: { attempted: true, succeeded: true },
      finalText: "The team tested two-angle imaging on 400 edges.",
    });
    expect(rows.find((row) => row.instruction === SOURCE_TALK.instruction)).toMatchObject({
      outcome: "applied",
      repaired: true,
      reason: `${SOURCE_TALK.applied}; repaired`,
    });
  });

  it("gives a signed-off plan run's hedge and Glossary fixes a fixed start, and leaves every other fix as before", () => {
    const before = deterministic("Text.", undefined);
    const verdicts = [
      { paragraphIndex: 1, check: "confidence" as const, instruction: "Confidence Map: Wear drift given only in the memo.", outcome: "not_applied" as const, reason: "P2 states wear flatly.", repairGuidance: "Hedge the wear figure." },
      { paragraphIndex: 0, check: "storyline" as const, instruction: "Storyline", outcome: "not_applied" as const, reason: "P1 drifts.", repairGuidance: "Follow the Storyline." },
      { paragraphIndex: 3, check: "glossary" as const, instruction: "Glossary Term: fine inclusion capture", outcome: "not_applied" as const, reason: "P4 says capture.", repairGuidance: "Replace capture." },
      { paragraphIndex: 2, check: "instruction" as const, instruction: "Lead with the result.", outcome: "not_applied" as const, reason: "P3 buries it.", repairGuidance: "Lead with it." },
    ];
    expect(repairIssues(before, verdicts)).toEqual([
      "Paragraph 2: Hedge the wear figure.",
      "Paragraph 1: Follow the Storyline.",
      "Paragraph 4: Replace capture.",
      "Paragraph 3: Lead with it.",
    ]);
    const scaffold = ORDERED_PROMPT_SCAFFOLDS.repairGuidance;
    expect(repairIssues(before, verdicts, [], {
      verdictPrefix: (verdict) => reportFactsIssuePrefix(verdict, ["fine inclusion capture"]),
    })).toEqual([
      `Paragraph 2: ${scaffold.hedgeIssue}Hedge the wear figure.`,
      `Paragraph 1: ${scaffold.hedgeIssue}Follow the Storyline.`,
      `Paragraph 4: ${scaffold.glossaryIssuePrefix}"fine inclusion capture"${scaffold.glossaryIssueSuffix}Replace capture.`,
      "Paragraph 3: Lead with it.",
    ]);
  });

  const targets: SelfCheckPlanCheck = {
    ruleId: "results_against_targets",
    roleId: "overall_advancement",
    mergedItemIds: [],
    instruction: "match_targets",
    confirmedExclusion: false,
    wording: [],
    relationshipReferences: [],
    sourceReferences: [],
  };

  it("sends the targets check with its own rule, never Rule B's, and reads a verdict with no paragraph as not located", async () => {
    const base = replayInput();
    const planChecks = [...base.planChecks, targets];
    const input = { ...base, planChecks, planChecksBlock: serializeFrozenSummaryPlanChecks(planChecks) };
    const first = replayResponse();
    const answers = [{
      ...first,
      planVerdicts: [
        ...first.planVerdicts,
        { ruleId: "results_against_targets", mergedItemIds: [], paragraph: 0, outcome: "not_applied", reason: "Calls a met target close.", repairGuidance: "Say 97.8% met the 97% target." },
      ],
    }];
    const client = {
      messages: {
        create: vi.fn(async (params: GenerationMessageParams) => ({
          content: [{ type: "tool_use" as const, id: "targets", name: params.tool_choice?.name ?? "submit_self_check", input: answers.shift() }],
          usage: { input_tokens: 1, output_tokens: 1 },
        })),
      },
    };
    const result = await runModelSelfCheck(client as GenerationClient, input);
    const request = client.messages.create.mock.calls[0]![0];
    const user = userText(request);
    expect(user).toContain(SUMMARY_PLAN_SELF_CHECK_REQUEST.resultsAgainstTargets.instruction);
    expect(user).not.toContain(SUMMARY_PLAN_SELF_CHECK_REQUEST.answers242.instruction);
    expect(user).toContain("- ruleId results_against_targets");
    expect(request.system).toBe(SUMMARY_PLAN_SELF_CHECK_SYSTEM_PROMPT);
    // A not applied verdict must name the paragraph; this one did not.
    expect(result.planVerdicts.at(-1)).toEqual({
      ruleId: "results_against_targets",
      mergedItemIds: [],
      outcome: "not_applied",
      reason: TARGETS_BREAK_UNLOCATED_REASON,
      actionableRepair: false,
    });
  });

  it("records a missing targets verdict as not checked, and a row by its own instruction and rule id", async () => {
    const base = replayInput();
    const planChecks = [...base.planChecks, targets];
    const input = { ...base, planChecks, planChecksBlock: serializeFrozenSummaryPlanChecks(planChecks) };
    const answers = [replayResponse(), { verdicts: [], planVerdicts: [] }];
    const client = {
      messages: {
        create: vi.fn(async (params: GenerationMessageParams) => ({
          content: [{ type: "tool_use" as const, id: "targets-missing", name: params.tool_choice?.name ?? "submit_self_check", input: answers.shift() }],
          usage: { input_tokens: 1, output_tokens: 1 },
        })),
      },
    };
    const result = await runModelSelfCheck(client as GenerationClient, input);
    expect(client.messages.create).toHaveBeenCalledTimes(2);
    expect(result.planVerdicts.at(-1)).toMatchObject({ outcome: "not_applied", reason: PLAN_TARGETS_NOT_CHECKED_REASON, actionableRepair: false });
    const rows = planComplianceNoteDrafts({
      section: "246",
      summaryVersionId: "summary-version" as Id<"summaryVersions">,
      checks: [targets as never],
      verdicts: [{ ruleId: "results_against_targets", mergedItemIds: [], paragraphIndex: 0, outcome: "not_applied", reason: "P1 calls a met target close.", repairGuidance: "Say it met the target.", actionableRepair: true }],
      repairSucceeded: true,
      finalCoverage: { ok: true, verdicts: [{ ruleId: "results_against_targets", mergedItemIds: [], outcome: "applied", reason: "Every comparison matches." }] },
    });
    expect(rows).toEqual([expect.objectContaining({
      instruction: TARGETS_INSTRUCTION,
      outcome: "applied",
      repaired: true,
      // 2026-10-04 (second, round 4): a targets row a repair fixed still says what was wrong.
      // Review P2-4: what was wrong comes first. The final verdict here is
      // given straight to the row builder, so its words stand.
      reason: "Fixed by the repair: P1 calls a met target close. Every comparison matches.",
      planRef: { summaryVersionId: "summary-version", ruleId: "results_against_targets", mergedItemIds: [] },
    })]);
  });
});

describe("the targets rule in the same words everywhere (review P2-3)", () => {
  it("sends the drafting rule, the Self-check rule and the repair fix split by direction, from one list", () => {
    for (const text of [
      RULES_REPORT_FACTS,
      SUMMARY_PLAN_SELF_CHECK_REQUEST.resultsAgainstTargets.instruction,
      ORDERED_PROMPT_SCAFFOLDS.repairGuidance.targetsIssue,
    ]) {
      expect(text).toContain(TARGET_RULES.reach);
      expect(text).toContain(TARGET_RULES.limit);
      // No sentence forbids "below" or "not exceeding" outside the reach rule.
      expect(text.replace(TARGET_RULES.reach, "")).not.toMatch(/never call a met (?:target|one)[^.]*\bbelow\b/);
      expect(text).not.toContain("not exceeding");
    }
    // A direction that is unclear is judged applied, and the repair changes nothing.
    expect(SUMMARY_PLAN_SELF_CHECK_REQUEST.resultsAgainstTargets.instruction)
      .toContain("Judge it applied, with paragraph 0, when every such comparison matches the numbers, when the section compares no result with a target, or when you cannot tell which way a target runs.");
    expect(ORDERED_PROMPT_SCAFFOLDS.repairGuidance.targetsIssue).toContain("Where the direction is unclear, change nothing.");
  });
});

describe("figures and details as the sources give them (2026-10-04, second)", () => {
  const facts: SelfCheckPlanCheck = {
    ruleId: "facts_match_sources",
    roleId: "experimentation",
    mergedItemIds: [],
    instruction: "match_sources",
    confirmedExclusion: false,
    wording: [],
    relationshipReferences: [],
    sourceReferences: [],
  };
  // Fictional Velloway sources (the release suite fixture's facts).
  const ANALYSIS = { work_performed: { results: "4 percent of all 600 panels fell below 60 microns, every one a deep cove panel; 13 percent of the 180 deep cove panels did." } };
  const SOURCES = sourceFactsFor({
    analysis: ANALYSIS,
    storylineText: "The deep cove profile did not fully meet edge coverage.",
    confidenceMap: [{ text: "A shielding effect of the cove is suspected.", confidence: "partial" }, { text: "No confidence level given." }],
  });
  const product = SUMMARY_PLAN_SELF_CHECK_REQUEST.factsMatchSources.productHeading;
  const budget = 48_000;

  it("renders the source documents, then the product's own wording, each item marked and with its quotes (round 2 and its review)", () => {
    expect(SOURCES.body).toBe([
      product,
      `Transcript analysis:\n${JSON.stringify(ANALYSIS)}`,
      "Storyline:\nThe deep cove profile did not fully meet edge coverage.",
      "Confidence Map:\n- (partial) A shielding effect of the cove is suspected.\n- (unresolved) No confidence level given.",
    ].join("\n\n"));
    expect(SOURCES.documentsComplete).toBe(false);
    const withDocuments = sourceFactsFor({
      analysis: { a: 1 },
      storylineText: "The writer's own Storyline.",
      storylineByWriter: true,
      documents: { documents: [{ label: "INTERVIEW TRANSCRIPT: Interview", content: "We nudged the air up 2 C, to 127 C.\n" }, { label: "SCOPING NOTES: summary.md", content: "Deep cove: 13 percent." }], leftOut: [], budget },
      planItems: [
        { wording: ["A sealer trial cut the shortfall to 7 percent.", "Second bullet."], writer: true },
        { wording: ["Datasheets cover flat panels."], quotes: ["the datasheet number is for flat panels", " "] },
        { wording: [" "] },
      ],
      writerInstructions: ["Third person.", " ", "No banned words."],
    });
    expect(withDocuments.documentsComplete).toBe(true);
    expect(withDocuments.body).toBe([
      "Source documents:\n[INTERVIEW TRANSCRIPT: Interview]\nWe nudged the air up 2 C, to 127 C.\n\n[SCOPING NOTES: summary.md]\nDeep cove: 13 percent.",
      product,
      'Transcript analysis:\n{"a":1}',
      "Storyline (the writer's wording):\nThe writer's own Storyline.",
      'Signed-off plan items, every Line:\n- [the writer\'s wording] A sealer trial cut the shortfall to 7 percent. Second bullet. Quotes: none.\n- [the product\'s wording] Datasheets cover flat panels. Quotes: "the datasheet number is for flat panels"',
      "Writer instructions (the writer's wording):\n- Third person.\n- No banned words.",
    ].join("\n\n"));
    // Round 2 review, P2-3: source wording and the writer's wording are evidence; the product's wording is apart.
    expect(withDocuments.evidence).toEqual([
      "We nudged the air up 2 C, to 127 C.\n",
      "Deep cove: 13 percent.",
      "the datasheet number is for flat panels",
      "A sealer trial cut the shortfall to 7 percent. Second bullet.",
      "The writer's own Storyline.",
      "Third person.",
      "No banned words.",
    ]);
    expect(withDocuments.product).toEqual(["Datasheets cover flat panels."]);
    // Some left out: named, with their size; not complete.
    const partial = sourceFactsFor({ analysis: {}, documents: { documents: [{ label: "A", content: "Text." }], leftOut: [{ label: "INTERVIEW TRANSCRIPT: Long", bytes: 61_234 }, { label: "B", bytes: 9 }], budget } });
    expect(partial.documentsComplete).toBe(false);
    expect(partial.body).toContain("Source documents left out, over this check's 48000-byte budget: INTERVIEW TRANSCRIPT: Long (61234 bytes); B (9 bytes).");
    // Round 2 review, P3-3: none at all is not complete, and says so.
    const none = sourceFactsFor({ analysis: {}, documents: { documents: [], leftOut: [], budget } });
    expect(none.documentsComplete).toBe(false);
    expect(none.body.startsWith("Source documents: none.")).toBe(true);
  });

  it("gives the facts verdict its findings field only in a request with the facts check (round 2)", () => {
    const base = replayInput();
    const ordinary = projectSummaryOrdinaryChecks({
      storylineText: base.storylineText,
      confidenceMap: base.confidenceMap,
      glossaryTerms: base.glossaryCandidates,
      rules: base.rules,
    });
    const propertiesOf = (planChecks: SelfCheckPlanCheck[]) =>
      summaryPlanSelfCheckSchemaFor(ordinary, planChecks).properties.planVerdicts.items.properties as Record<string, unknown>;
    expect(propertiesOf(base.planChecks)).not.toHaveProperty("findings");
    const withFacts = propertiesOf([...base.planChecks, facts]);
    expect(withFacts.findings).toBe(SUMMARY_PLAN_SELF_CHECK_FACTS_FINDINGS_SCHEMA);
    expect(withFacts.repairGuidance).toEqual(SUMMARY_PLAN_SELF_CHECK_SCHEMA.properties.planVerdicts.items.properties.repairGuidance);
    // Round 2 review, P3-1: two findings, no paragraph of their own.
    expect(SUMMARY_PLAN_SELF_CHECK_FACTS_FINDINGS_SCHEMA.maxItems).toBe(2);
    expect(SUMMARY_PLAN_SELF_CHECK_FACTS_FINDINGS_SCHEMA.items.required).toEqual(["draftQuote", "sourceQuote", "correction"]);
  });

  it("sends the SOURCE FACTS block right after the plan checks, and the facts rule last, only with the facts check", () => {
    const base = replayInput();
    const planChecks = [...base.planChecks, facts];
    const user = buildSelfCheckUserMessage({
      ...base,
      planChecks,
      planChecksBlock: serializeFrozenSummaryPlanChecks(planChecks),
      sourceFacts: SOURCES,
    });
    const block = `--- BEGIN [SOURCE FACTS] ---\n${SOURCES.body}\n--- END [SOURCE FACTS] ---`;
    expect(user.split(block)).toHaveLength(2);
    expect(user).toContain(`--- END [CONTENT PLAN CHECKS] ---\n\n${block}`);
    expect(user.split(factsMatchSourcesInstruction(false))).toHaveLength(2);
    expect(user).toContain(`${factsMatchSourcesInstruction(false)}\n\nReturn exactly`);
    expect(user).toContain("- ruleId facts_match_sources");
    const complete = buildSelfCheckUserMessage({
      ...base,
      planChecks,
      planChecksBlock: serializeFrozenSummaryPlanChecks(planChecks),
      sourceFacts: { ...SOURCES, documentsComplete: true },
    });
    expect(complete).toContain(factsMatchSourcesInstruction(true));
    expect(factsMatchSourcesInstruction(true)).toContain("The SOURCE FACTS block holds every source document");
    expect(factsMatchSourcesInstruction(true)).toContain("The product's own wording can point to a fact but cannot by itself support a specific detail");
    expect(factsMatchSourcesInstruction(false)).toContain("the transcript analysis and every signed-off item stand for the sources here");
    expect(factsMatchSourcesInstruction(false)).toContain("Flag only what a source document or a quote you have contradicts.");
    expect(buildSelfCheckUserMessage({ ...base, sourceFacts: SOURCES })).toBe(buildSelfCheckUserMessage(base));
    expect(buildSelfCheckUserMessage(base)).not.toContain("[SOURCE FACTS]");
    expect(buildSelfCheckUserMessage({ ...base, planChecks, planChecksBlock: serializeFrozenSummaryPlanChecks(planChecks) }))
      .toContain("--- BEGIN [SOURCE FACTS] ---\n(none)\n--- END [SOURCE FACTS] ---");
  });

  it("states the rule in the same words in the drafting rule, the Self-check rule and the repair fix", () => {
    for (const text of [
      RULES_REPORT_FACTS,
      factsMatchSourcesInstruction(true),
      ORDERED_PROMPT_SCAFFOLDS.repairGuidance.factsIssue,
    ]) {
      expect(text).toContain(FACT_RULES.scope);
      expect(text).toContain(FACT_RULES.detail);
      expect(text).toContain(FACT_RULES.cause);
      expect(text).toContain(FACT_RULES.hedge);
      expect(text).toContain(FACT_RULES.proportion);
    }
    const rule = factsMatchSourcesInstruction(true);
    expect(rule).toContain("or states a proportion stronger or weaker than the sources give it");
    expect(rule).toContain('the same fact in other words is not a finding (warming "by 5 C" and warming "5 C, to 65 C" agree)');
    // Round 2 review, P2-2: the quote rules the code checks.
    expect(rule).toContain('Quote a whole clause of at least 8 characters on each side, never a short figure or word alone ("127 C", "most"); use "..." only to skip words inside one sentence of one source, never to join two places.');
    expect(rule).toContain("A finding whose quotes cannot be found in the section and in what you were given is never shown and never repaired.");
    expect(RULES_REPORT_FACTS).toContain(FACT_RULES.allowed);
    expect(rule).toContain(FACT_RULES.allowed);
    expect(rule).toContain("Judge it applied, with paragraph 0 and no findings, when every figure and detail matches the sources.");
    expect(rule).toContain("Never fail a figure or detail only because the sources word it another way.");
    expect(leaveOutRepairIssue(facts, { paragraphIndex: 4 }, "Paragraph 5: the section says ..."))
      .toBe(`Whole section: ${ORDERED_PROMPT_SCAFFOLDS.repairGuidance.factsIssue}Paragraph 5: the section says ...`);
  });

  it("finds a quote after normalizing, with each part at least 8 characters, in one entry, and each ellipsis gap at most 200 characters (round 2 review, P2-2)", () => {
    expect(MIN_QUOTE_PART_CHARS).toBe(8);
    expect(MAX_QUOTE_GAP_CHARS).toBe(200);
    expect(quoteFoundIn("The  Datasheet number", "That the datasheet number is for flat panels.")).toBe(true);
    expect(quoteFoundIn("“nudged the air up 2 C”", "we nudged the air up 2 C, to 127 C")).toBe(true);
    expect(quoteFoundIn("edge-only nozzle", "an edge‐only nozzle")).toBe(true);
    expect(quoteFoundIn("the datasheet number ... flat panels", "That the datasheet number is for flat panels.")).toBe(true);
    expect(quoteFoundIn("flat panels ... the datasheet number", "That the datasheet number is for flat panels.")).toBe(false);
    expect(quoteFoundIn("steel panels", "That the datasheet number is for flat panels.")).toBe(false);
    // Too short to count, as the rule tells the model.
    expect(quoteFoundIn("127 C", "to 127 C")).toBe(false);
    expect(quoteFoundIn("most", "most panels met it")).toBe(false);
    // An ellipsis never joins two entries, and never skips more than 200 characters.
    expect(quoteFoundIn("the datasheet number ... steel substrates", ["the datasheet number is for flat panels", "steel substrates cure hot"])).toBe(false);
    const far = `the datasheet number ${"x".repeat(201)} flat panels`;
    expect(quoteFoundIn("the datasheet number ... flat panels", far)).toBe(false);
    const near = `the datasheet number ${"x".repeat(150)} flat panels`;
    expect(quoteFoundIn("the datasheet number ... flat panels", near)).toBe(true);
    // A later start that does chain is still found.
    expect(quoteFoundIn("the datasheet number ... flat panels", `the datasheet number ${"x".repeat(300)} and the datasheet number is for flat panels`)).toBe(true);
    expect(normalizeForQuote("A\u2019s  \u201cB\u201d \u2013 C")).toBe("a's \"b\" - c");
  });

  it("shows and repairs only findings whose quotes verify, and records an unverified verdict as not checked in its own words (round 2)", async () => {
    const base = replayInput();
    const planChecks = [...base.planChecks, facts];
    // The replay's own paragraphs first, so its recorded verdicts stay valid.
    const text = [
      base.text,
      "Trial 1 showed the datasheet values, developed for flat steel-style panels, did not transfer.",
      "Raising air temperature by 2 C pushed defects back up to 9 per square metre.",
    ].join("\n\n");
    const n = base.text.split(/\n\s*\n/).filter((paragraph) => paragraph.trim()).length;
    const sources = sourceFactsFor({
      analysis: { results: "Defects rose to 9 per square metre." },
      documents: { documents: [{ label: "Interview", content: "That the datasheet number is for flat panels. Then we nudged the air up 2 C, to 127 C." }], leftOut: [], budget },
    });
    const input = { ...base, text, planChecks, planChecksBlock: serializeFrozenSummaryPlanChecks(planChecks), sourceFacts: sources };
    const first = replayResponse();
    const facts1 = (verdict: Record<string, unknown>) => ({ ...first, planVerdicts: [...first.planVerdicts, verdict] });
    const steel = { draftQuote: "developed for flat steel-style panels", sourceQuote: "the datasheet number is for flat panels", correction: "for flat panels" };
    const invented = { draftQuote: "pushed defects back up", sourceQuote: "the air went up 2 C and stayed at 125 C", correction: "x" };
    const answers: unknown[] = [
      // The verdict names the wrong paragraph: the finding is located from its draft quote.
      facts1({ ruleId: "facts_match_sources", mergedItemIds: [], paragraph: n + 2, outcome: "not_applied", reason: "P1 adds steel", findings: [steel, invented] }),
      facts1({ ruleId: "facts_match_sources", mergedItemIds: [], paragraph: n + 2, outcome: "not_applied", reason: "P3 attributes defect rise to 2 C increase, sources say to 127 C." }),
      facts1({ ruleId: "facts_match_sources", mergedItemIds: [], paragraph: 0, outcome: "not_applied", reason: "A figure does not match." }),
    ];
    const client = {
      messages: {
        create: vi.fn(async (params: GenerationMessageParams) => ({
          content: [{ type: "tool_use" as const, id: "facts", name: params.tool_choice?.name ?? "submit_self_check", input: answers.shift() }],
          usage: { input_tokens: 1, output_tokens: 1 },
        })),
      },
    };
    const verified = await runModelSelfCheck(client as GenerationClient, input);
    expect(verified.planVerdicts.at(-1)).toEqual({
      ruleId: "facts_match_sources",
      mergedItemIds: [],
      paragraphIndex: n,
      outcome: "not_applied",
      reason: `P${n + 1} says "developed for flat steel-style panels", but the sources say "the datasheet number is for flat panels". 1 more finding was not shown: its quotes could not be shown from the sources.`,
      actionableRepair: true,
      repairText: `Paragraph ${n + 1}: the section says "developed for flat steel-style panels", but the sources say "the datasheet number is for flat panels". Write it as the sources give it: for flat panels`,
    });
    for (const reason of ["P3 attributes defect rise to 2 C increase, sources say to 127 C.", "A figure does not match."]) {
      const result = await runModelSelfCheck(client as GenerationClient, input);
      expect(result.planVerdicts.at(-1)).toEqual({
        ruleId: "facts_match_sources",
        mergedItemIds: [],
        outcome: "not_applied",
        reason: factsNotCheckedReason(reason),
        actionableRepair: false,
      });
    }
    // Round 2 review, P3-7: the model's words are cut like other stored text.
    expect(factsNotCheckedReason("w".repeat(400)).length).toBeLessThan(260);
  });

  it("verifies a source quote only in source wording while every document is in, and also in the product's wording while not (round 2 review, P2-3)", () => {
    const paragraphs = ["The datasheets were developed for flat panels."];
    const merged = { draftQuote: "developed for flat panels", sourceQuote: "flat steel/thin flat panel substrates", correction: "steel" };
    const complete = sourceFactsFor({
      analysis: { conclusions: "Datasheet parameters were developed for flat steel/thin flat panel substrates." },
      documents: { documents: [{ label: "Interview", content: "That the datasheet number is for flat panels." }], leftOut: [], budget },
    });
    const sourcesOf = (facts: typeof complete) => [...facts.evidence, ...(facts.documentsComplete ? [] : facts.product)];
    // The analysis's merged words cannot correct a right sentence while the documents are all here.
    expect(verifyFactsFindings({ findings: [merged], paragraphs, sources: sourcesOf(complete) }).verified).toEqual([]);
    const partial = sourceFactsFor({
      analysis: { conclusions: "Datasheet parameters were developed for flat steel/thin flat panel substrates." },
      documents: { documents: [], leftOut: [{ label: "Interview", bytes: 60_000 }], budget },
    });
    expect(verifyFactsFindings({ findings: [merged], paragraphs, sources: sourcesOf(partial) }).verified).toHaveLength(1);
  });

  it("Greptile on PR #26 at 17d3d1a8: verifies a finding on a wrong group rate when the paragraph also states the right overall rate", () => {
    const paragraphs = [
      "In the 600-door pilot, 4 percent of panels had edge DFT below 60 microns. The deep cove profile fell short on 4 percent of its panels.",
    ];
    const sources = ["4 percent of panels had edge DFT below 60 microns, and every one of them was a deep cove profile."];
    const finding = {
      draftQuote: "The deep cove profile fell short on 4 percent of its panels",
      sourceQuote: "4 percent of panels had edge DFT below 60 microns",
      correction: "13 percent of the 180 deep cove panels",
    };
    expect(verifyFactsFindings({ findings: [finding], paragraphs, sources })).toEqual({
      verified: [{ paragraphIndex: 0, ...finding }],
      held: [],
      unverified: 0,
    });
  });

  const holdingSources = ["4 percent of panels fell below 60 microns. 4 percent of panels fell short across all 600 doors."];
  it("Greptile on PR #26 at 7e3964cc: verifies a finding whose draft quote adds a group to its source quote", () => {
    const sources = holdingSources;
    const addedGroup = { draftQuote: "In the deep cove group, 4 percent of panels fell below 60 microns", sourceQuote: "4 percent of panels fell below 60 microns", correction: "13 percent of the deep cove panels" };
    expect(verifyFactsFindings({ findings: [addedGroup], paragraphs: ["In the deep cove group, 4 percent of panels fell below 60 microns."], sources }))
      .toEqual({ verified: [{ paragraphIndex: 0, ...addedGroup }], held: [], unverified: 0 });
  });

  it("Greptile on PR #26 at 7e3964cc: verifies a finding whose draft quote drops a qualifier its source quote holds", () => {
    const sources = holdingSources;
    const droppedQualifier = { draftQuote: "4 percent of panels fell short", sourceQuote: "4 percent of panels fell short across all 600 doors", correction: "4 percent of all 600 doors" };
    expect(verifyFactsFindings({ findings: [droppedQualifier], paragraphs: ["On the deep cove profile, 4 percent of panels fell short."], sources }))
      .toEqual({ verified: [{ paragraphIndex: 0, ...droppedQualifier }], held: [], unverified: 0 });
  });

  it("never verifies a source quote that is the draft quote itself, after normalizing", () => {
    const paragraphs = ["The sealer cut preheat to 85 C on the routed edges."];
    const sources = ["The sealer cut preheat to 85 C on the routed edges, as planned."];
    expect(verifyFactsFindings({
      findings: [{ draftQuote: "cut preheat to 85 C on the routed edges", sourceQuote: "\u201cCut  preheat to 85 C on the routed edges.\u201d", correction: "" }],
      paragraphs,
      sources,
    })).toEqual({ verified: [], held: [], unverified: 1 });
  });

  it("never verifies a source quote that is the draft quote, or a draft quote no paragraph holds, and holds a finding on a signed-off item's words while documents are missing (round 2 review, P2-4)", () => {
    const paragraphs = ["The sealer cut preheat to 85 C on the routed edges.", "Defects fell to 1.8 per square metre."];
    const sources = ["Preheat came down to 85 C on the routed edges. Defects fell to 1.8 per square metre."];
    expect(verifyFactsFindings({
      findings: [
        { draftQuote: "Defects fell to 1.8 per square metre", sourceQuote: "Defects fell to 1.8 per square metre", correction: "" },
        { draftQuote: "cut preheat to 95 C", sourceQuote: "came down to 85 C on the routed edges", correction: "" },
        { draftQuote: "cut preheat to 85 C", sourceQuote: "Preheat came down to 85 C", correction: "85 C" },
      ],
      paragraphs,
      sources,
    })).toEqual({
      verified: [{ paragraphIndex: 0, draftQuote: "cut preheat to 85 C", sourceQuote: "Preheat came down to 85 C", correction: "85 C" }],
      held: [],
      unverified: 2,
    });
    // While documents are missing, a finding against a signed-off item's own words is held, not repaired.
    const held = verifyFactsFindings({
      findings: [{ draftQuote: "cut preheat to 85 C", sourceQuote: "Preheat came down to 85 C", correction: "85 C" }],
      paragraphs,
      sources,
      items: ["The sealer cut preheat to 85 C on the routed edges."],
    });
    expect(held).toEqual({ verified: [], held: [{ paragraphIndex: 0, draftQuote: "cut preheat to 85 C", sourceQuote: "Preheat came down to 85 C", correction: "85 C" }], unverified: 0 });
    expect(factsFindingsReason([], 0, held.held)).toBe(
      `${FACTS_HELD_PREFIX}P1 says "cut preheat to 85 C", but the sources say "Preheat came down to 85 C".`
    );
  });

  it("reads a missing facts verdict as not checked, with the sources in the follow-up", async () => {
    const base = replayInput();
    const planChecks = [...base.planChecks, facts];
    const input = { ...base, planChecks, planChecksBlock: serializeFrozenSummaryPlanChecks(planChecks), sourceFacts: SOURCES };
    const answers: unknown[] = [replayResponse(), { verdicts: [], planVerdicts: [] }];
    const client = {
      messages: {
        create: vi.fn(async (params: GenerationMessageParams) => ({
          content: [{ type: "tool_use" as const, id: "facts", name: params.tool_choice?.name ?? "submit_self_check", input: answers.shift() }],
          usage: { input_tokens: 1, output_tokens: 1 },
        })),
      },
    };
    const missing = await runModelSelfCheck(client as GenerationClient, input);
    expect(client.messages.create).toHaveBeenCalledTimes(2);
    expect(userText(client.messages.create.mock.calls[1]![0])).toContain("[SOURCE FACTS]");
    expect(missing.planVerdicts.at(-1)).toMatchObject({ outcome: "not_applied", reason: PLAN_FACTS_NOT_CHECKED_REASON, actionableRepair: false });
  });

  it("round 3: records an applied facts verdict in fixed words, never the model's, so it never reads as a guarantee", async () => {
    const base = replayInput();
    const planChecks = [...base.planChecks, facts];
    const input = { ...base, planChecks, planChecksBlock: serializeFrozenSummaryPlanChecks(planChecks), sourceFacts: SOURCES };
    const response = replayResponse();
    for (const words of ["Figures and details match the sources.", "All figures and details match sources."]) {
      const client = replayClient({
        ...response,
        planVerdicts: [...response.planVerdicts, { ruleId: "facts_match_sources", mergedItemIds: [], paragraph: 0, outcome: "applied", reason: words }],
      });
      const result = await runModelSelfCheck(client as unknown as GenerationClient, input);
      expect(result.planVerdicts.at(-1)).toEqual({
        ruleId: "facts_match_sources",
        mergedItemIds: [],
        outcome: "applied",
        reason: FACTS_NOTHING_SHOWN_REASON,
      });
    }
    expect(FACTS_NOTHING_SHOWN_REASON).toBe("The facts check found no figure or detail it could show differs from the sources.");
  });

  it("round 3: marks the wording an item's own quotes do not back, and that wording never stands for the sources", () => {
    const limitation = [
      "Standard datasheet powder processes are built for flat steel-like panels, not thick routed MDF.",
      "No prior process showed whether MDF could reach conductivity without heat that triggers outgassing defects.",
    ];
    const facts = sourceFactsFor({
      analysis: {},
      planItems: [
        { wording: limitation, writer: false, quotes: ["The moisture that gives you conductivity is the same moisture that outgasses."], unbacked: [limitation[0]] },
        // The writer's own wording is never marked.
        { wording: ["The writer's steel line."], writer: true, quotes: [], unbacked: ["The writer's steel line."] },
      ],
      documents: { documents: [], leftOut: [{ label: "INTERVIEW TRANSCRIPT: Long", bytes: 61_234 }], budget: 48_000 },
    });
    expect(facts.body).toContain(
      `- [the product's wording] ${limitation.join(" ")} Quotes: "The moisture that gives you conductivity is the same moisture that outgasses." Its own quotes do not back: ${JSON.stringify(limitation[0])}`
    );
    expect(facts.body).toContain("- [the writer's wording] The writer's steel line. Quotes: none.");
    expect(facts.body).not.toContain(`Its own quotes do not back: "The writer's steel line."`);
    expect(facts.documentsComplete).toBe(false);
    // While documents are left out the product's wording stands for the
    // sources, but never the wording its own quotes do not back.
    expect(facts.product).toContain(limitation[1]);
    expect(facts.product.some((entry) => entry.includes("steel-like"))).toBe(false);
    expect(facts.items).toEqual([limitation[1], "The writer's steel line."]);
    // So a finding on that wording verifies only against a source, and is repaired, not held.
    const found = verifyFactsFindings({
      findings: [{ draftQuote: "built for flat steel-like panels", sourceQuote: "built for flat steel-like panels, not thick", correction: "" }],
      paragraphs: ["Datasheet processes are built for flat steel-like panels, not thick routed MDF."],
      sources: facts.product,
      items: facts.items,
    });
    expect(found).toEqual({ verified: [], held: [], unverified: 1 });
  });

  it("round 3: tells the check a product-written item is not settled fact, in both variants", () => {
    for (const complete of [true, false]) {
      const rule = factsMatchSourcesInstruction(complete);
      expect(rule).toContain("A signed-off item the product wrote is not settled fact: the writer signed off the idea, not each detail of its wording, so it can still state a detail the sources do not give.");
      expect(rule).toContain("Where an item says its own quotes do not back some of its wording, a specific detail in that wording (a material, a cause, a group) is supported only where a source document or the writer's wording gives it.");
    }
    expect(factsMatchSourcesInstruction(false)).toContain("every signed-off item stand for the sources here, except wording an item's own quotes do not back");
  });

  it("writes the row by its own instruction and rule id, and a repaired row still says what was wrong", () => {
    const first = { ruleId: "facts_match_sources", mergedItemIds: [], paragraphIndex: 1, outcome: "not_applied" as const, reason: "P2 gives the all-panel 4% as deep cove's", repairGuidance: "Say 13% of 180.", actionableRepair: true };
    const args = {
      section: "244" as const,
      summaryVersionId: "summary-version" as Id<"summaryVersions">,
      checks: [facts as never],
      verdicts: [first],
    };
    const planRef = { summaryVersionId: "summary-version", ruleId: "facts_match_sources", mergedItemIds: [] };
    expect(planComplianceNoteDrafts({
      ...args,
      repairSucceeded: true,
      finalCoverage: { ok: true, verdicts: [{ ruleId: "facts_match_sources", mergedItemIds: [], outcome: "applied", reason: "Figures match the sources." }] },
    })).toEqual([expect.objectContaining({
      instruction: FACTS_INSTRUCTION,
      outcome: "applied",
      repaired: true,
      reason: "Figures match the sources. Fixed by the repair: P2 gives the all-panel 4% as deep cove's",
      planRef,
    })]);
    expect(planComplianceNoteDrafts({
      ...args,
      repairSucceeded: true,
      finalCoverage: { ok: true, verdicts: [{ ruleId: "facts_match_sources", mergedItemIds: [], paragraphIndex: 1, outcome: "not_applied", reason: "P2 still gives 4%." }] },
    })).toEqual([expect.objectContaining({ outcome: "not_applied", repaired: false, reason: "P2 still gives 4%.", paragraphIndex: 1 })]);
    expect(planComplianceNoteDrafts({ ...args, repairSucceeded: false, repairNotUsedReason: "the repaired text dropped the writer's edited term \"film build\", so the checked draft was kept" }))
      .toEqual([expect.objectContaining({
        outcome: "not_applied",
        repaired: false,
        reason: "P2 gives the all-panel 4% as deep cove's; repair not used (the repaired text dropped the writer's edited term \"film build\", so the checked draft was kept)",
      })]);
  });
});

describe("a target is met only as the sources state it (2026-10-04, second, round 4)", () => {
  it("Greptile on PR #26 at 12d67e49 (lead decision): an applied targets verdict's row is fixed text, whatever the model wrote", async () => {
    const base = replayInput();
    const targetsCheck: SelfCheckPlanCheck = { ruleId: "results_against_targets", roleId: "overall_advancement", mergedItemIds: [], instruction: "match_targets", confirmedExclusion: false, wording: [], relationshipReferences: [], sourceReferences: [] };
    const planChecks = [...base.planChecks, targetsCheck];
    const input = { ...base, planChecks, planChecksBlock: serializeFrozenSummaryPlanChecks(planChecks) };
    const response = replayResponse();
    for (const words of ["Targets and results stated per the numbers shown", "Every comparison matches."]) {
      const client = replayClient({
        ...response,
        planVerdicts: [...response.planVerdicts, { ruleId: "results_against_targets", mergedItemIds: [], paragraph: 0, outcome: "applied", reason: words }],
      });
      const result = await runModelSelfCheck(client as unknown as GenerationClient, input);
      expect(result.planVerdicts.at(-1)).toEqual({ ruleId: "results_against_targets", mergedItemIds: [], outcome: "applied", reason: TARGETS_NOTHING_SHOWN_REASON });
    }
    expect(TARGETS_NOTHING_SHOWN_REASON).toBe("The targets check found no result it could show is stated against its target differently from the sources.");
  });

  it("verifies an entry's target quote in the sources too, and drops an entry that quotes the draft back", () => {
    const paragraphs = ["The edges met the 60-micron target on every panel."];
    const sources = ["Edge DFT averaged 64 microns, minimum 52.", "DFT of 70 to 90 microns on the faces and at least 60 microns on the routed edges."];
    const average = { draftQuote: "The edges met the 60-micron target on every panel", sourceQuote: "Edge DFT averaged 64 microns, minimum 52", correction: "64 average, 52 minimum" };
    expect(verifyTargetFindings({ findings: [{ ...average, targetQuote: "at least 60 microns on the routed edges" }], paragraphs, sources })).toEqual({
      verified: [{ paragraphIndex: 0, ...average, targetQuote: "at least 60 microns on the routed edges" }],
      held: [],
      unverified: 0,
    });
    expect(verifyTargetFindings({ findings: [{ ...average, targetQuote: "at least 50 microns on the routed edges" }], paragraphs, sources }).unverified).toBe(1);
    expect(verifyTargetFindings({ findings: [{ ...average, sourceQuote: average.draftQuote }], paragraphs, sources: [...sources, paragraphs[0]!] }).unverified).toBe(1);
  });

  it("adds the entries' field and the drafting rule only where the targets check is, so other requests keep their bytes", () => {
    const facts = { ruleId: "facts_match_sources" };
    const targets = { ruleId: "results_against_targets" };
    const without = summaryPlanSelfCheckSchemaFor([], [facts]);
    const withTargets = summaryPlanSelfCheckSchemaFor([], [facts, targets]);
    expect(Object.keys(without.properties.planVerdicts.items.properties)).not.toContain("targetFindings");
    expect((withTargets.properties.planVerdicts.items.properties as Record<string, unknown>).targetFindings).toEqual(SUMMARY_PLAN_SELF_CHECK_TARGET_FINDINGS_SCHEMA);
    expect(reportFactsBlock()).not.toContain(TARGET_MET_RULE);
    expect(reportFactsBlock(true)).toContain(TARGET_MET_RULE);
    expect(SUMMARY_PLAN_SELF_CHECK_REQUEST.resultsAgainstTargets.instruction).toContain(TARGET_MET_RULE);
    expect(ORDERED_PROMPT_SCAFFOLDS.repairGuidance.targetsIssue).toContain(TARGET_MET_RULE);
    expect(TARGET_MET_RULE).toBe("Say a target was met only as the sources state it, and name the same targets the sources name. An average is not every item: where a minimum or a share falls short of the target, say so.");
  });
});
