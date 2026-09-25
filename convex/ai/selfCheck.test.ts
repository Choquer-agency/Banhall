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
  SUMMARY_PLAN_SELF_CHECK_SCHEMA,
} from "./promptDefinitions";
import { SEQUENTIAL_CALLS_PER_GENERATE_CANDIDATE } from "./providers";
import { sectionMetrics } from "../lib/lineLimits";
import { assembleSectionNotes, runDeterministicSelfCheck } from "../lib/selfCheckRules";
import type { OrderedProfileContext } from "../lib/orderedChain";
import { planComplianceNoteDrafts } from "./orderedGeneration";
import { runModelSelfCheck, type SelfCheckPlanCheck } from "./selfCheck";
import { SELF_CHECK_SYSTEM_PROMPT } from "./prompts";
import {
  jsonEscapedUtf8Bytes,
  MAX_SUMMARY_SELF_CHECK_GUIDANCE_ESCAPED_UTF8_BYTES,
  MAX_SUMMARY_SELF_CHECK_REASON_ESCAPED_UTF8_BYTES,
  serializeFrozenSummaryPlanChecks,
} from "../lib/seedRevisions";

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
        content: [{ type: "text", text: user.split(COMPRESSION_REQUEST.userScaffold.targetToText)[1] ?? "" }],
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
  const generation = (await t.run((ctx) => ctx.db.get(generationId))) as Doc<"generations">;
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
    "advertises and enforces the Summary byte limit for $case text",
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
        input_schema: SUMMARY_PLAN_SELF_CHECK_SCHEMA,
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

      const rejected = await execute(aboveLimit);
      await expect(rejected.result).rejects.toThrow(
        "Summary Self-check returned an invalid ordinary verdict"
      );
      expect(rejected.create).toHaveBeenCalledTimes(1);
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

    const malformed: Array<[string, (response: typeof valid) => void]> = [
      ["omitted ordinary row", (response) => { response.verdicts.pop(); }],
      ["omitted ordinary reason", (response) => { Reflect.deleteProperty(response.verdicts[0], "reason"); }],
      ["omitted Skip merge array", (response) => { Reflect.deleteProperty(response.planVerdicts[2], "mergedItemIds"); }],
      ["duplicate ordinary row", (response) => { response.verdicts[4] = { ...response.verdicts[0] }; }],
      ["unknown ordinary label", (response) => { response.verdicts[0].instruction = "unknown"; }],
      ["omitted plan row", (response) => { response.planVerdicts.pop(); }],
      ["duplicate plan row", (response) => { response.planVerdicts[2] = { ...response.planVerdicts[0] }; }],
      ["unknown plan reference", (response) => { response.planVerdicts[0].itemId = "unknown-item"; }],
      ["incomplete merge ids", (response) => { response.planVerdicts[0].mergedItemIds = ["item-a"]; }],
      ["overlong escaped field", (response) => { response.verdicts[0].reason = "\n".repeat(33); }],
      ["overlong returned id", (response) => { response.planVerdicts[0].itemId = "x".repeat(65); }],
      ["ordinary paragraph numeric limit", (response) => { response.verdicts[0].paragraph = 10_000_000_000; }],
      ["plan paragraph numeric limit", (response) => { response.planVerdicts[0].paragraph = 10_000_000_000; }],
      ["Storyline numeric limit", (response) => { response.storylineQuestion.confidenceEntry = 10_000_000_000; }],
      ["negative Storyline entry", (response) => { response.storylineQuestion.confidenceEntry = -1; }],
      ["oversized negative Storyline entry", (response) => { response.storylineQuestion.confidenceEntry = -10_000_000_000; }],
      ["oversized unknown root property", (response) => { Object.assign(response, { unknownRoot: "x".repeat(4_097) }); }],
      ["oversized unknown nested property", (response) => { Object.assign(response.planVerdicts[0], { unknownNested: "x".repeat(4_097) }); }],
      ["unknown root property", (response) => { Object.assign(response, { unknownRoot: true }); }],
      ["unknown ordinary property", (response) => { Object.assign(response.verdicts[0], { unknownOrdinary: true }); }],
      ["unknown plan property", (response) => { Object.assign(response.planVerdicts[0], { unknownPlan: true }); }],
      ["unknown Storyline property", (response) => { Object.assign(response.storylineQuestion, { unknownQuestion: true }); }],
      ["both plan identities", (response) => { response.planVerdicts[0].skippedRoleId = "prior_year_status"; }],
    ];
    for (const [name, mutate] of malformed) {
      const response = structuredClone(valid);
      mutate(response);
      const rejected = await execute(response);
      await expect(rejected.result, name).rejects.toThrow();
      expect(rejected.create, name).toHaveBeenCalledTimes(1);
    }
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
    if (!accepted) {
      await expect(result).rejects.toThrow();
    } else {
      const value = await result;
      expect(value.verdicts[0]?.paragraphIndex).toBe(paragraph === 0 ? undefined : 0);
    }
    expect(create).toHaveBeenCalledTimes(1);
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

    const { selfCheck, slotCounts } = rowFor(sectionRows, "242");
    expect(selfCheck).toMatchObject({ status: "repair_failed", repairAttempted: true, remainingFailures: 1 });
    // The ordered section action's worst case: draft + two squeezes +
    // Self-check + one repair, exactly the five-slot bound.
    expect(slotCounts).toEqual({
      "section:242": 1,
      "compression:242": 2,
      "selfCheck:242": 1,
      "repair:242": 1,
    });
    expect(Object.values(slotCounts).reduce((sum, count) => sum + count, 0)).toBe(
      SEQUENTIAL_CALLS_PER_GENERATE_CANDIDATE
    );
    const budget = JSON.parse(generation.agentOutputs ?? "null").callBudget;
    expect(budget.counts).toMatchObject({ "compression:242": 2, "repair:242": 1 });
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

  it("writes one plan row per item and Skip, retains merges, and never repairs confirmed exclusions", () => {
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
    expect(rows[1]).toMatchObject({ outcome: "not_applied", tier: "conflict", repaired: false, planRef: { itemId: second, mergedItemIds: [first, second] } });
    expect(rows[1].paragraphIndex).toBeUndefined();
    expect(rows[2]).toMatchObject({ outcome: "applied", planRef: { skippedRoleId: "project_status", mergedItemIds: [] } });
  });
});

// Unused-import guard for the Id type in helper signatures.
export type _GenerationIdForTests = Id<"generations">;
