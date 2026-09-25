/// <reference types="vite/client" />

// Story 3 (CAP-6/8, AD-26/27): the generation-entry writer-settings resolver,
// driven through the real entry actions and the real scheduled chain, with
// the provider stubbed at the Anthropic client boundary — the same harness as
// promptProgram.test.ts.

import Anthropic from "@anthropic-ai/sdk";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName, type FunctionArgs } from "convex/server";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import schema from "../schema";
import { allGenerationProgress } from "../lib/generationProgress";
import type { GenerationMessageParams } from "./openrouterCore";
import { SECTION_242_REQUEST } from "./section242Agent";
import { SECTION_244_REQUEST } from "./section244Agent";
import { SECTION_246_REQUEST } from "./section246Agent";
import { COMPRESSION_REQUEST } from "./promptDefinitions";
import {
  NO_STYLE_OVERRIDES,
  STYLE_OVERRIDE_KEYS,
  type StyleOverrideKey,
} from "../../shared/styleOverrides";
import {
  SETTINGS_CLASSIFIER_VERSION,
  resolveGenerationWriterSettings,
  settingsClassifierVersion,
  type SettingsClassifierInputs,
} from "./writerSettings";
import {
  ANALYSIS_TOOL_SCHEMA,
  STYLE_ANALYSIS_REQUEST,
  STYLE_ANALYSIS_SYSTEM_PROMPT,
  buildStyleAnalysisPrompt,
} from "./styleAnalysis";
import { MODEL } from "./model";
import { APPLYING_WRITER_STYLE_LOG, waivingHouseRulesLog } from "./writerStyle";
import type { OrderedProfileContext } from "../lib/orderedChain";
import { MAX_INSTRUCTIONS_CHARS } from "../../shared/writerProfileLimits";
import { HOUSE_STYLE_MODES_KEY } from "../houseStyle";

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
const DRAFTS: Record<Section, string> = {
  "242": "S242-DRAFT: The team could not predict the controller response under load.",
  "244": "S244-DRAFT: The team built three prototype controllers and measured each.",
  "246": "S246-DRAFT: The work established how the controller behaves under load.",
};

const AUTH_ID = "writer-settings-writer";
const FILE = "PD Writing Customized Settings.docx";
const SETTINGS_TEXT = [
  "PD Writing Customized Settings",
  "Use my own vocabulary rules and let paragraphs run as long as they need.",
  "Line 246: no more than 80 lines.",
  "Build order: 246, 242, 244",
].join("\n");
const ADDRESSED: StyleOverrideKey[] = ["bannedWords", "paragraphDensity"];
const TOGGLES = { bannedWords: true, paragraphDensity: true };

const classifier = { fail: false, noTool: false };

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
const styleAnalysis = {
  categories: Object.fromEntries(
    STYLE_OVERRIDE_KEYS.map((key) => [
      key,
      ADDRESSED.includes(key)
        ? { addressed: true, evidence: "Use my own vocabulary rules" }
        : { addressed: false, evidence: null },
    ])
  ),
  lockedConflicts: [],
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
function systemText(params: GenerationMessageParams): string {
  return blocksText((params as { system?: unknown }).system);
}
function draftSectionOf(user: string): Section | null {
  for (const section of ["242", "244", "246"] as const) {
    if (user.startsWith(SECTION_REQUESTS[section].userPrefix)) return section;
  }
  return null;
}

function install() {
  network.create.mockReset().mockImplementation(async (params: GenerationMessageParams) => {
    const name = params.tool_choice?.name;
    const usage = { input_tokens: 10, output_tokens: 5 };
    if (name === "submit_style_analysis" && classifier.fail) {
      throw new Error("classifier unavailable");
    }
    if (name === "submit_style_analysis" && classifier.noTool) {
      // A repairable failure: generateStructured would re-prompt it on a
      // second attempt, so this is what pins attempts: 1.
      return { content: [{ type: "text", text: "No tool call." }], usage };
    }
    if (name) {
      const input =
        name === "submit_transcript_analysis"
          ? analysisOutput
          : name === "submit_qa_scorecard"
            ? qa
            : name === "submit_self_check"
              ? { verdicts: [] }
              : name === "submit_consistency_findings"
                ? { findings: [] }
                : name === "submit_style_analysis"
                  ? styleAnalysis
                  : { entries: [] };
      return { content: [{ type: "tool_use", id: "tool-1", name, input }], usage };
    }
    const user = userText(params);
    if (systemText(params) === COMPRESSION_REQUEST.system) {
      return {
        content: [{ type: "text", text: user.split(COMPRESSION_REQUEST.userScaffold.targetToText)[1] ?? "" }],
        usage,
      };
    }
    const section = draftSectionOf(user);
    return { content: [{ type: "text", text: section ? DRAFTS[section] : "Unrouted text." }], usage };
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
  classifier.fail = false;
  classifier.noTool = false;
  install();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

type ProfileSeed = {
  customInstructions: string;
  enabled: boolean;
  styleOverrides?: Partial<Record<StyleOverrideKey, boolean>>;
};
type DocumentSeed = {
  category: "writer_notes" | "other";
  fileName: string;
  content: string;
  uploaderRole?: "writer";
};
type ProjectIds = {
  userId: Id<"users">;
  projectId: Id<"projects">;
  transcriptId: Id<"transcripts">;
};

async function project(t: ReturnType<typeof convexTest>, profile?: ProfileSeed): Promise<ProjectIds> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { authId: AUTH_ID, role: "admin" });
    // 2026-09-15 (second) amendment: openingClauses defaults to "off" with no
    // stored row. These fixtures assert settings-document precedence under an
    // explicit all-writer_choice catalog (the no-row default is covered in
    // convex/houseStyle.test.ts and convex/writerProfiles.test.ts).
    await ctx.db.insert("appSettings", {
      key: HOUSE_STYLE_MODES_KEY,
      value: JSON.stringify({
        bannedWords: "writer_choice",
        paragraphDensity: "writer_choice",
        sentenceConstruction: "writer_choice",
        repetitionCaps: "writer_choice",
        openingClauses: "writer_choice",
        reportSkeleton: "writer_choice",
      }),
      updatedBy: userId,
      updatedAt: now,
    });
    const projectId = await ctx.db.insert("projects", {
      title: "Control experiment",
      clientName: "Client",
      status: "draft",
      createdBy: userId,
      shareToken: `settings-token-${now}-${Math.random()}`,
      createdAt: now,
      updatedAt: now,
    });
    const transcriptId = await ctx.db.insert("transcripts", {
      projectId,
      content: "The team tested controller response through prototype trials.",
      createdAt: now,
    });
    if (profile) {
      await ctx.db.insert("writerProfiles", {
        userId,
        customInstructions: profile.customInstructions,
        enabled: profile.enabled,
        ...(profile.styleOverrides ? { styleOverrides: profile.styleOverrides } : {}),
        updatedBy: userId,
        createdAt: now,
        updatedAt: now,
      });
    }
    return { userId, projectId, transcriptId };
  });
}

/** Reserve a generation with its frozen sources, as reserveGeneration does. */
async function reserve(
  t: ReturnType<typeof convexTest>,
  ids: ProjectIds,
  documents: DocumentSeed[],
  mode: "single" | "iterative" = "single"
): Promise<Id<"generations">> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const content = "The team tested controller response through prototype trials.";
    const generationId = await ctx.db.insert("generations", {
      projectId: ids.projectId,
      transcriptId: ids.transcriptId,
      transcriptIds: [ids.transcriptId],
      status: "reserved",
      requestedAt: now,
      requestedBy: ids.userId,
      startedAt: now,
      candidateMode: mode,
      singleModelId: "claude-opus-4-8",
      previousProjectStatus: "draft",
      learningDigestIds: [],
    });
    await ctx.db.patch(ids.projectId, { status: "generating", activeGenerationId: generationId });
    await ctx.db.insert("generationSources", {
      projectId: ids.projectId,
      generationId,
      kind: "transcript",
      transcriptId: ids.transcriptId,
      label: "Interview transcript",
      content,
      contentHash: "settings-frozen-hash",
      truncated: false,
      originalLength: content.length,
      capturedAt: now,
    });
    for (const document of documents) {
      await ctx.db.insert("generationSources", {
        projectId: ids.projectId,
        generationId,
        kind: "project_document",
        label: `${document.category}:${document.fileName}`,
        content: document.content,
        contentHash: `doc-hash-${document.fileName}`,
        truncated: false,
        originalLength: document.content.length,
        capturedAt: now,
        ...(document.uploaderRole ? { uploaderRole: document.uploaderRole } : {}),
      });
    }
    return generationId;
  });
}

const CANDIDATE_JOB = "ai/pipeline:generateCandidate";
const SECTION_JOB = "ai/orderedGeneration:generateOrderedSection";
const FINALIZE_JOB = "ai/orderedGeneration:finalizeOrderedCandidate";
const USAGE_JOB = "aiUsage:logUsage";

async function pending(t: ReturnType<typeof convexTest>, names: string[]) {
  return await t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect()).filter(
      (job) => job.state.kind === "pending" && names.includes(job.name)
    )
  );
}
type Job = Awaited<ReturnType<typeof pending>>[number];

async function runJob(t: ReturnType<typeof convexTest>, job: Job) {
  await t.run((ctx) => ctx.scheduler.cancel(job._id));
  const args = job.args[0];
  if (job.name === CANDIDATE_JOB) {
    await t.action(internal.ai.pipeline.generateCandidate, args as FunctionArgs<typeof internal.ai.pipeline.generateCandidate>);
  } else if (job.name === SECTION_JOB) {
    await t.action(internal.ai.orderedGeneration.generateOrderedSection, args as FunctionArgs<typeof internal.ai.orderedGeneration.generateOrderedSection>);
  } else if (job.name === FINALIZE_JOB) {
    await t.action(internal.ai.orderedGeneration.finalizeOrderedCandidate, args as FunctionArgs<typeof internal.ai.orderedGeneration.finalizeOrderedCandidate>);
  } else if (job.name === USAGE_JOB) {
    await t.mutation(internal.aiUsage.logUsage, args as FunctionArgs<typeof internal.aiUsage.logUsage>);
  } else {
    throw new Error(`Unexpected job ${job.name}`);
  }
}

/**
 * generateReport, then the candidate, then the chain, one job at a time.
 * Returns the frozen payload the candidate received.
 */
async function runSingle(t: ReturnType<typeof convexTest>, generationId: Id<"generations">) {
  await t.action(internal.ai.pipeline.generateReport, { generationId });
  const candidates = await pending(t, [CANDIDATE_JOB]);
  expect(candidates).toHaveLength(1);
  const args = candidates[0].args[0] as {
    writerFlavor?: string;
    styleOverrides?: Record<string, boolean>;
    orderedContext?: OrderedProfileContext;
  };
  // Only what the Writer Profile contributes; ids differ per run by design.
  const payload = {
    writerFlavor: args.writerFlavor,
    styleOverrides: args.styleOverrides,
    orderedContext: args.orderedContext,
  };
  for (const job of candidates) await runJob(t, job);
  for (let round = 0; round < 60; round += 1) {
    const [job] = await pending(t, [SECTION_JOB, FINALIZE_JOB]);
    if (!job) return payload;
    await runJob(t, job);
  }
  throw new Error("The ordered chain did not drain");
}

/** Every aiUsage row the generation's calls recorded. */
async function usageCallSites(t: ReturnType<typeof convexTest>, generationId: Id<"generations">) {
  for (const job of await pending(t, [USAGE_JOB])) await runJob(t, job);
  const rows = (await t.run((ctx) => ctx.db.query("aiUsage").collect())) as Doc<"aiUsage">[];
  return rows.filter((row) => row.generationId === generationId).map((row) => row.callSite);
}

function classifierCalls() {
  return network.create.mock.calls.filter(
    ([params]) => (params as GenerationMessageParams).tool_choice?.name === "submit_style_analysis"
  );
}

/** The generation row, with its progress lines read the way the queries read
 * them (child rows since 2026-09-25, legacy array first). */
async function generationOf(t: ReturnType<typeof convexTest>, generationId: Id<"generations">) {
  return await t.run(async (ctx) => {
    const generation = (await ctx.db.get(generationId)) as Doc<"generations">;
    return { ...generation, progressLog: await allGenerationProgress(ctx, generationId) };
  });
}

const NOTE_FIELDS = [
  "section",
  "paragraphIndex",
  "source",
  "instruction",
  "outcome",
  "tier",
  "reason",
  "repaired",
] as const;

async function notesOf(t: ReturnType<typeof convexTest>, generationId: Id<"generations">) {
  const notes = await t
    .withIdentity({ subject: AUTH_ID })
    .query(api.complianceNotes.listForGeneration, { generationId });
  return notes
    .map((note) =>
      Object.fromEntries(
        NOTE_FIELDS.map((field) => [field, (note as Record<string, unknown>)[field] ?? null])
      )
    )
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

async function frozenStyle(t: ReturnType<typeof convexTest>, generationId: Id<"generations">) {
  const artifacts = (await t.run((ctx) =>
    ctx.db.query("generationArtifacts").collect()
  )) as Doc<"generationArtifacts">[];
  const artifact = artifacts.find(
    (row) => row.generationId === generationId && row.kind === "brain_blocks"
  );
  const parsed = JSON.parse(artifact?.content ?? "{}") as {
    styleGuidance?: string;
    styleOverrides?: Record<string, boolean>;
  };
  return { styleGuidance: parsed.styleGuidance, styleOverrides: parsed.styleOverrides };
}

describe("three supply paths, one Writer Profile (CAP-8)", () => {
  it("the same settings as an enabled profile, internal Writer's Notes and an internal attachment produce identical Compliance Note rows", async () => {
    const results: Array<{
      path: string;
      notes: Awaited<ReturnType<typeof notesOf>>;
      payload: Awaited<ReturnType<typeof runSingle>>;
      frozen: Awaited<ReturnType<typeof frozenStyle>>;
      generation: Doc<"generations">;
      classifierCalls: number;
    }> = [];
    for (const path of ["profile", "writer_notes", "attachment"] as const) {
      network.create.mockClear();
      const t = convexTest(schema, modules);
      const ids = await project(
        t,
        path === "profile"
          ? { customInstructions: SETTINGS_TEXT, enabled: true, styleOverrides: TOGGLES }
          : undefined
      );
      const generationId = await reserve(
        t,
        ids,
        path === "profile"
          ? []
          : [
              {
                category: path === "writer_notes" ? "writer_notes" : "other",
                fileName: FILE,
                content: SETTINGS_TEXT,
                uploaderRole: "writer",
              },
            ]
      );
      const payload = await runSingle(t, generationId);
      const generation = await generationOf(t, generationId);
      expect(generation.status, path).toBe("completed");
      results.push({
        path,
        notes: await notesOf(t, generationId),
        payload,
        frozen: await frozenStyle(t, generationId),
        generation,
        classifierCalls: classifierCalls().length,
      });
    }
    const [profile, notes, attachment] = results;

    // Identical rows in every field the contract names.
    expect(profile.notes.length).toBeGreaterThan(0);
    expect(notes.notes).toEqual(profile.notes);
    expect(attachment.notes).toEqual(profile.notes);
    // Identical OrderedProfileContext, writerFlavor and styleOverrides.
    expect(notes.payload).toEqual(profile.payload);
    expect(attachment.payload).toEqual(profile.payload);
    expect(notes.frozen).toEqual(profile.frozen);
    expect(attachment.frozen).toEqual(profile.frozen);
    expect(profile.payload.writerFlavor).toBe(SETTINGS_TEXT);
    expect(profile.payload.styleOverrides).toEqual({ ...NO_STYLE_OVERRIDES, ...TOGGLES });

    // Extraction ran on the text in every path: the Build Order and the cap.
    for (const result of results) {
      expect(result.generation.productionOrder, result.path).toEqual(["246", "242", "244"]);
    }
    const capRow = profile.notes.find((note) => note.instruction === "Line 246: no more than 80 lines.");
    expect(capRow).toMatchObject({ section: "246", tier: "conflict", outcome: "applied" });
    expect(capRow?.reason).toMatch(/^cap met at \d+\/50 lines \(rule asked 80; the Locked cap applies\)$/);
    const profileRows = profile.notes.filter((note) => note.instruction === "Writer Profile");
    expect(profileRows).toHaveLength(3);
    expect(profileRows.every((row) => row.reason === "Writer Profile applied")).toBe(true);
    const bannedWords = profile.notes.filter((note) => note.instruction === "House Rule category: banned words");
    expect(bannedWords.every((row) => String(row.reason).startsWith("instruction waived via override"))).toBe(true);

    // The record, and the one classifier call per document path.
    expect(profile.generation.writerSettings).toEqual({
      profileState: "applied",
      source: "profile",
      matchesProfile: false,
      savedProfileSuperseded: false,
      waiverAnalysis: "profile",
      truncated: false,
    });
    expect(notes.generation.writerSettings).toMatchObject({
      profileState: "applied",
      source: "writer_notes",
      fileName: FILE,
      matchesProfile: false,
      savedProfileSuperseded: false,
      waiverAnalysis: "analyzed",
      truncated: false,
      addressedCategories: ADDRESSED,
    });
    expect(attachment.generation.writerSettings).toMatchObject({
      source: "attachment",
      waiverAnalysis: "analyzed",
      addressedCategories: ADDRESSED,
    });
    expect(results.map((result) => result.classifierCalls)).toEqual([0, 1, 1]);
    expect(notes.generation.progressLog).toContain(
      `Applying the settings document ${FILE} in Writer's Notes as the Writer Profile for this generation.`
    );
    expect(attachment.generation.progressLog).toContain(
      `Applying the settings document ${FILE} in an attachment as the Writer Profile for this generation.`
    );
    // The applied-style and waiver lines are the shared constants, the same
    // in every supply path.
    for (const result of results) {
      expect(result.generation.progressLog, result.path).toContain(APPLYING_WRITER_STYLE_LOG);
      expect(result.generation.progressLog, result.path).toContain(
        waivingHouseRulesLog({ ...NO_STYLE_OVERRIDES, ...TOGGLES })
      );
    }
  });
});

describe("classifier caching (AD-27)", () => {
  it("records exactly one generation:settings call, then none for a second generation with the same document", async () => {
    const t = convexTest(schema, modules);
    const ids = await project(t);
    const document: DocumentSeed = {
      category: "writer_notes",
      fileName: FILE,
      content: SETTINGS_TEXT,
      uploaderRole: "writer",
    };
    const first = await reserve(t, ids, [document]);
    await runSingle(t, first);
    expect((await usageCallSites(t, first)).filter((site) => site === "generation:settings")).toHaveLength(1);

    const second = await reserve(t, ids, [document]);
    await runSingle(t, second);
    const secondSites = await usageCallSites(t, second);
    expect(secondSites.length).toBeGreaterThan(0);
    expect(secondSites.filter((site) => site === "generation:settings")).toHaveLength(0);
    expect(classifierCalls()).toHaveLength(1);

    expect((await generationOf(t, first)).writerSettings?.waiverAnalysis).toBe("analyzed");
    expect((await generationOf(t, second)).writerSettings?.waiverAnalysis).toBe("cached");
    const cache = await t.run((ctx) => ctx.db.query("settingsDocumentAnalyses").collect());
    expect(cache).toHaveLength(1);
    expect(cache[0]).toMatchObject({
      projectId: ids.projectId,
      classifierVersion: SETTINGS_CLASSIFIER_VERSION,
      addressedCategories: ADDRESSED,
    });
    expect(SETTINGS_CLASSIFIER_VERSION).toMatch(/^style-classifier-[0-9a-f]{16}$/);
    // Both generations ran under the same waivers.
    expect((await frozenStyle(t, second)).styleOverrides).toEqual((await frozenStyle(t, first)).styleOverrides);
  });

  it("settingsClassifierVersion moves with every classifier input, and the constant is it applied to the real inputs", () => {
    const real: SettingsClassifierInputs = {
      systemText: STYLE_ANALYSIS_SYSTEM_PROMPT,
      userTemplate: buildStyleAnalysisPrompt("").user,
      toolSchema: ANALYSIS_TOOL_SCHEMA,
      toolName: STYLE_ANALYSIS_REQUEST.toolName,
      toolDescription: STYLE_ANALYSIS_REQUEST.description,
      maxTokens: STYLE_ANALYSIS_REQUEST.maxTokens,
      inputCharLimit: STYLE_ANALYSIS_REQUEST.inputCharLimit,
      model: MODEL,
    };
    const base = settingsClassifierVersion(real);
    expect(SETTINGS_CLASSIFIER_VERSION).toBe(base);
    expect(settingsClassifierVersion({ ...real })).toBe(base);
    const variants: Array<[keyof SettingsClassifierInputs, SettingsClassifierInputs]> = [
      ["systemText", { ...real, systemText: `${real.systemText} Be brief.` }],
      ["userTemplate", { ...real, userTemplate: `${real.userTemplate}\n- extra locked rule` }],
      ["toolSchema", { ...real, toolSchema: { ...ANALYSIS_TOOL_SCHEMA, required: ["categories"] } }],
      ["toolName", { ...real, toolName: "submit_style_analysis_v2" }],
      ["toolDescription", { ...real, toolDescription: `${real.toolDescription} Quote evidence.` }],
      ["maxTokens", { ...real, maxTokens: real.maxTokens + 1 }],
      ["inputCharLimit", { ...real, inputCharLimit: real.inputCharLimit + 1 }],
      ["model", { ...real, model: `${real.model}-next` }],
    ];
    expect(variants.map(([key]) => key).sort()).toEqual(Object.keys(real).sort());
    for (const [key, variant] of variants) {
      expect(settingsClassifierVersion(variant), key).not.toBe(base);
    }
  });

  it("a repairable classifier failure (no tool call) is not re-prompted: one call, one generation:settings row", async () => {
    classifier.noTool = true;
    const quiet = vi.spyOn(console, "warn").mockImplementation(() => {});
    const quietError = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = convexTest(schema, modules);
    const ids = await project(t);
    const generationId = await reserve(t, ids, [
      { category: "writer_notes", fileName: FILE, content: SETTINGS_TEXT, uploaderRole: "writer" },
    ]);
    const payload = await runSingle(t, generationId);
    quiet.mockRestore();
    quietError.mockRestore();

    const generation = await generationOf(t, generationId);
    expect(generation.status).toBe("completed");
    expect(classifierCalls()).toHaveLength(1);
    expect((await usageCallSites(t, generationId)).filter((site) => site === "generation:settings")).toHaveLength(1);
    expect(generation.writerSettings).toMatchObject({ source: "writer_notes", waiverAnalysis: "failed" });
    expect(payload.writerFlavor).toBe(SETTINGS_TEXT);
    expect(payload.styleOverrides).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.query("settingsDocumentAnalyses").collect())).toHaveLength(0);
  });

  it("a classifier failure still completes: the text applies with no waivers and every section says why", async () => {
    classifier.fail = true;
    const quiet = vi.spyOn(console, "warn").mockImplementation(() => {});
    const quietError = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = convexTest(schema, modules);
    const ids = await project(t);
    const generationId = await reserve(t, ids, [
      { category: "writer_notes", fileName: FILE, content: SETTINGS_TEXT, uploaderRole: "writer" },
    ]);
    const payload = await runSingle(t, generationId);
    const errorCalls = quietError.mock.calls.map((call) => [...call]);
    quiet.mockRestore();
    quietError.mockRestore();
    // The server log keeps the raw error beside its reason code.
    const classifyCall = errorCalls.find((call) =>
      String(call[0]).startsWith("settings document classification failed")
    );
    expect(classifyCall?.[2]).toBeInstanceOf(Error);

    const generation = await generationOf(t, generationId);
    expect(generation.status).toBe("completed");
    // One attempt, no repair pass (the 600 s action budget).
    expect(classifierCalls()).toHaveLength(1);
    expect(generation.writerSettings).toMatchObject({
      profileState: "applied",
      source: "writer_notes",
      waiverAnalysis: "failed",
    });
    expect(payload.writerFlavor).toBe(SETTINGS_TEXT);
    expect(payload.styleOverrides).toBeUndefined();
    expect(payload.orderedContext?.waiverAnalysisFailed).toBe(true);
    expect(await t.run((ctx) => ctx.db.query("settingsDocumentAnalyses").collect())).toHaveLength(0);
    // The writer-facing line: the document waives nothing, and it never
    // claims every House Rule is in force (an org `off` category stays
    // waived).
    const failureLines = (generation.progressLog ?? []).filter((line) =>
      line.startsWith(`The settings document ${FILE} could not be analysed for House Rule waivers`)
    );
    expect(failureLines).toHaveLength(1);
    expect(failureLines[0]).toMatch(
      new RegExp(
        `^The settings document ${FILE.replace(/\./g, "\\.")} could not be analysed for House Rule waivers \\([a-z_]+\\); its instructions apply with no Writer Profile waivers\\.$`
      )
    );
    expect(failureLines[0]).not.toMatch(/every House Rule/i);
    expect(generation.progressLog).toContain(APPLYING_WRITER_STYLE_LOG);
    expect(generation.progressLog?.some((line) => line.startsWith("Waiving default house-style rules"))).toBe(
      false
    );

    const notes = await notesOf(t, generationId);
    const categoryRows = notes.filter((note) => String(note.instruction).startsWith("House Rule category:"));
    expect(categoryRows).toHaveLength(18);
    expect(
      categoryRows.every(
        (row) =>
          row.outcome === "applied" &&
          row.reason === "House Rule applied: the settings document could not be analysed for waivers"
      )
    ).toBe(true);
    expect(notes.filter((note) => note.instruction === "Writer Profile").every((row) => row.outcome === "applied")).toBe(true);
  });
});

describe("trust floor and the no-profile line", () => {
  it("a client-uploaded settings document is never applied: no profile is reported, with no classifier call", async () => {
    const t = convexTest(schema, modules);
    const ids = await project(t);
    const generationId = await reserve(t, ids, [
      { category: "writer_notes", fileName: FILE, content: SETTINGS_TEXT },
    ]);
    const payload = await runSingle(t, generationId);
    expect(classifierCalls()).toHaveLength(0);
    expect(payload.writerFlavor).toBeUndefined();
    const generation = await generationOf(t, generationId);
    expect(generation.writerSettings).toEqual({
      profileState: "missing",
      source: "none",
      matchesProfile: false,
      savedProfileSuperseded: false,
      waiverAnalysis: "none",
      truncated: false,
    });
    const notes = await notesOf(t, generationId);
    const profileRows = notes.filter((note) => note.instruction === "Writer Profile");
    expect(profileRows).toHaveLength(3);
    expect(profileRows.every((row) => row.reason === "no Writer Profile applied (missing)")).toBe(true);
    const settings = await t
      .withIdentity({ subject: AUTH_ID })
      .query(api.writerProfiles.getGenerationWriterSettings, { generationId });
    expect(settings).toMatchObject({
      profileState: "missing",
      source: "none",
      noProfileLine: "No Writer Profile applied — House Rules in full.",
      offer: null,
    });
  });

  it("a client-uploaded settings document beside an enabled saved profile: the saved profile rules as before, with no classifier call", async () => {
    const saved = "Old saved preferences.";
    const t = convexTest(schema, modules);
    const ids = await project(t, { customInstructions: saved, enabled: true, styleOverrides: TOGGLES });
    const generationId = await reserve(t, ids, [
      { category: "writer_notes", fileName: FILE, content: SETTINGS_TEXT },
    ]);
    const payload = await runSingle(t, generationId);
    expect(classifierCalls()).toHaveLength(0);
    expect(payload.writerFlavor).toBe(saved);
    expect(payload.styleOverrides).toEqual({ ...NO_STYLE_OVERRIDES, ...TOGGLES });
    const generation = await generationOf(t, generationId);
    expect(generation.status).toBe("completed");
    expect(generation.writerSettings).toEqual({
      profileState: "applied",
      source: "profile",
      matchesProfile: false,
      savedProfileSuperseded: false,
      waiverAnalysis: "profile",
      truncated: false,
    });
    // The document's Build Order never reached the chain.
    expect(generation.productionOrder).toEqual(["242", "244", "246"]);
    expect(await t.run((ctx) => ctx.db.query("settingsDocumentAnalyses").collect())).toHaveLength(0);
    const notes = await notesOf(t, generationId);
    expect(
      notes.filter((note) => note.instruction === "Writer Profile").map((row) => row.reason)
    ).toEqual(Array(3).fill("Writer Profile applied"));
    expect(notes.some((note) => note.instruction === "Line 246: no more than 80 lines.")).toBe(false);
    const settings = await t
      .withIdentity({ subject: AUTH_ID })
      .query(api.writerProfiles.getGenerationWriterSettings, { generationId });
    expect(settings).toMatchObject({ source: "profile", savedProfileSuperseded: false, offer: null });
  });

  it("a disabled profile with no document is reported disabled on every section", async () => {
    const t = convexTest(schema, modules);
    const ids = await project(t, { customInstructions: SETTINGS_TEXT, enabled: false, styleOverrides: TOGGLES });
    const generationId = await reserve(t, ids, []);
    await runSingle(t, generationId);
    const notes = await notesOf(t, generationId);
    expect(
      notes.filter((note) => note.instruction === "Writer Profile").map((row) => row.reason)
    ).toEqual(Array(3).fill("no Writer Profile applied (disabled)"));
    const settings = await t
      .withIdentity({ subject: AUTH_ID })
      .query(api.writerProfiles.getGenerationWriterSettings, { generationId });
    expect(settings?.noProfileLine).toBe("No Writer Profile applied — House Rules in full.");
  });

  it("a document that differs from the enabled profile supersedes it and offers itself for saving", async () => {
    const t = convexTest(schema, modules);
    const ids = await project(t, { customInstructions: "Old saved preferences.", enabled: true });
    const generationId = await reserve(t, ids, [
      { category: "writer_notes", fileName: FILE, content: SETTINGS_TEXT, uploaderRole: "writer" },
    ]);
    await runSingle(t, generationId);
    const notes = await notesOf(t, generationId);
    expect(notes.filter((note) => note.instruction === "Writer Profile").map((row) => row.reason)).toEqual(
      Array(3).fill(
        `Writer Profile applied from the settings document ${FILE} in Writer's Notes; the saved Writer Profile was superseded for this generation`
      )
    );
    const { progressLog } = await generationOf(t, generationId);
    expect(progressLog).toContain(
      `Applying the settings document ${FILE} in Writer's Notes as the Writer Profile for this generation; it supersedes the saved Writer Profile.`
    );
    expect(progressLog).toContain(APPLYING_WRITER_STYLE_LOG);
    expect(progressLog).toContain(waivingHouseRulesLog({ ...NO_STYLE_OVERRIDES, ...TOGGLES }));
    const settings = await t
      .withIdentity({ subject: AUTH_ID })
      .query(api.writerProfiles.getGenerationWriterSettings, { generationId });
    expect(settings).toEqual({
      profileState: "applied",
      source: "writer_notes",
      fileName: FILE,
      matchesProfile: false,
      savedProfileSuperseded: true,
      waiverAnalysis: "analyzed",
      noProfileLine: null,
      offer: {
        supplyPath: "writer_notes",
        fileName: FILE,
        text: SETTINGS_TEXT,
        truncated: false,
        addressedCategories: ADDRESSED,
      },
    });
    // The offer is a prefill only: the saved profile is untouched.
    const profile = await t.run((ctx) => ctx.db.query("writerProfiles").first());
    expect(profile?.customInstructions).toBe("Old saved preferences.");
  });
});

describe("iterative uses the same resolver", () => {
  it("freezes the settings document's instructions and waivers into the iterative artifacts", async () => {
    const t = convexTest(schema, modules);
    const ids = await project(t);
    const generationId = await reserve(
      t,
      ids,
      [{ category: "other", fileName: FILE, content: SETTINGS_TEXT, uploaderRole: "writer" }],
      "iterative"
    );
    await t.action(internal.ai.iterative.startIterativeGeneration, { generationId });
    const frozen = await frozenStyle(t, generationId);
    expect(frozen.styleGuidance).toContain("Use my own vocabulary rules");
    expect(frozen.styleOverrides).toEqual({ ...NO_STYLE_OVERRIDES, ...TOGGLES });
    expect((await generationOf(t, generationId)).writerSettings).toMatchObject({
      source: "attachment",
      waiverAnalysis: "analyzed",
    });
    expect(classifierCalls()).toHaveLength(1);
  });
});

/** Drive the resolver directly against a convex-test deployment. */
async function resolveDirect(
  t: ReturnType<typeof convexTest>,
  ids: ProjectIds,
  generationId: Id<"generations">,
  options: { failCacheWrite?: boolean } = {}
) {
  const lines: string[] = [];
  const backend = t as unknown as {
    query: (reference: unknown, args: unknown) => Promise<unknown>;
    mutation: (reference: unknown, args: unknown) => Promise<unknown>;
  };
  const ctx = {
    runQuery: (reference: unknown, args: unknown) => backend.query(reference, args),
    runMutation: async (reference: unknown, args: unknown) => {
      if (
        options.failCacheWrite &&
        getFunctionName(reference as never) === "writerProfiles:recordSettingsAnalysis"
      ) {
        throw new Error("cache write failed");
      }
      return await backend.mutation(reference, args);
    },
  } as unknown as Parameters<typeof resolveGenerationWriterSettings>[0];
  const result = await resolveGenerationWriterSettings(ctx, {
    generationId,
    projectId: ids.projectId,
    requestedBy: ids.userId,
    clientFor: () => new Anthropic({ apiKey: "test-key" }),
    log: async (line) => {
      lines.push(line);
    },
  });
  return { result, lines };
}

describe("the resolver's match, truncation and cache-write cases", () => {
  it("a document equal to the enabled profile: the profile applies, no classifier call, no cache row, no offer", async () => {
    const t = convexTest(schema, modules);
    const ids = await project(t, { customInstructions: SETTINGS_TEXT, enabled: true, styleOverrides: TOGGLES });
    const generationId = await reserve(t, ids, [
      { category: "writer_notes", fileName: FILE, content: `  ${SETTINGS_TEXT}\n`, uploaderRole: "writer" },
    ]);
    const { result, lines } = await resolveDirect(t, ids, generationId);
    expect(classifierCalls()).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("settingsDocumentAnalyses").collect())).toHaveLength(0);
    expect(result.writerFlavor).toBe(SETTINGS_TEXT);
    expect(result.styleOverrides).toEqual({ ...NO_STYLE_OVERRIDES, ...TOGGLES });
    expect((await generationOf(t, generationId)).writerSettings).toMatchObject({
      profileState: "applied",
      source: "profile",
      fileName: FILE,
      matchesProfile: true,
      savedProfileSuperseded: false,
      waiverAnalysis: "profile",
      truncated: false,
    });
    expect(lines).toContain(
      `The settings document ${FILE} matches the saved Writer Profile, which applies unchanged.`
    );
    const settings = await t
      .withIdentity({ subject: AUTH_ID })
      .query(api.writerProfiles.getGenerationWriterSettings, { generationId });
    expect(settings).toMatchObject({ source: "profile", matchesProfile: true, offer: null });
  });

  it("an over-length document applies its first MAX_INSTRUCTIONS_CHARS, records truncated and logs it", async () => {
    const t = convexTest(schema, modules);
    const ids = await project(t);
    const long = `${SETTINGS_TEXT}\n${"z".repeat(MAX_INSTRUCTIONS_CHARS)}`;
    const generationId = await reserve(t, ids, [
      { category: "writer_notes", fileName: FILE, content: long, uploaderRole: "writer" },
    ]);
    const { result, lines } = await resolveDirect(t, ids, generationId);
    expect(result.writerFlavor).toBe(long.slice(0, MAX_INSTRUCTIONS_CHARS));
    expect((await generationOf(t, generationId)).writerSettings).toMatchObject({
      source: "writer_notes",
      waiverAnalysis: "analyzed",
      truncated: true,
    });
    expect(lines).toContain(
      `Applying the settings document ${FILE} in Writer's Notes as the Writer Profile for this generation; only its first 75,000 characters apply.`
    );
    const settings = await t
      .withIdentity({ subject: AUTH_ID })
      .query(api.writerProfiles.getGenerationWriterSettings, { generationId });
    expect(settings?.offer).toMatchObject({
      text: long.slice(0, MAX_INSTRUCTIONS_CHARS),
      truncated: true,
      addressedCategories: ADDRESSED,
    });
  });

  it("recordSettingsAnalysis throwing still applies the classified document's flavor and waivers", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = convexTest(schema, modules);
    const ids = await project(t);
    const generationId = await reserve(t, ids, [
      { category: "other", fileName: FILE, content: SETTINGS_TEXT, uploaderRole: "writer" },
    ]);
    const { result } = await resolveDirect(t, ids, generationId, { failCacheWrite: true });
    const errorCalls = quiet.mock.calls.map((call) => [...call]);
    quiet.mockRestore();
    // The server log keeps the raw error beside its reason code, even though
    // only the cache write failed and the classification itself succeeded.
    const cacheWriteCall = errorCalls.find((call) =>
      String(call[0]).startsWith("settings analysis cache write failed")
    );
    expect(cacheWriteCall?.[2]).toBeInstanceOf(Error);
    expect(classifierCalls()).toHaveLength(1);
    expect(result.writerFlavor).toBe(SETTINGS_TEXT);
    expect(result.styleOverrides).toEqual({ ...NO_STYLE_OVERRIDES, ...TOGGLES });
    expect(result.orderedContext.waiverAnalysisFailed).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.query("settingsDocumentAnalyses").collect())).toHaveLength(0);
    expect((await generationOf(t, generationId)).writerSettings).toMatchObject({
      source: "attachment",
      waiverAnalysis: "analyzed",
      addressedCategories: ADDRESSED,
    });
    // The offer keeps the waivers this generation applied, with no cache row.
    const settings = await t
      .withIdentity({ subject: AUTH_ID })
      .query(api.writerProfiles.getGenerationWriterSettings, { generationId });
    expect(settings?.offer).toMatchObject({ text: SETTINGS_TEXT, addressedCategories: ADDRESSED });
  });
});

describe("four-tier precedence through a generation run (AC 2)", () => {
  it("a profile waiving all six categories, one of them enforced: frozen styleOverrides, category rows and the waiver row", async () => {
    const t = convexTest(schema, modules);
    const allWaived = Object.fromEntries(STYLE_OVERRIDE_KEYS.map((key) => [key, true])) as Record<
      StyleOverrideKey,
      boolean
    >;
    const ids = await project(t, {
      customInstructions: [
        "Use whatever vocabulary fits, including words the house list bans.",
        "Let paragraphs run as long as the evidence needs.",
        "Vary sentence construction freely.",
        "Repeat key terms as often as needed.",
        "Open sentences with any clause.",
        "Use my own report architecture.",
      ].join("\n"),
      enabled: true,
      styleOverrides: allWaived,
    });
    const enforced: StyleOverrideKey = "sentenceConstruction";
    await t.withIdentity({ subject: AUTH_ID }).mutation(api.houseStyle.setModes, {
      modes: {
        ...(Object.fromEntries(STYLE_OVERRIDE_KEYS.map((key) => [key, "writer_choice"])) as Record<
          StyleOverrideKey,
          "writer_choice"
        >),
        [enforced]: "enforced",
      },
    });
    const generationId = await reserve(t, ids, []);
    const payload = await runSingle(t, generationId);
    expect((await generationOf(t, generationId)).status).toBe("completed");

    // Frozen into the chain payload and the generation artifacts: five
    // waivers, the enforced category's House Rule back in force.
    const expected = { ...allWaived, [enforced]: false };
    expect(payload.styleOverrides).toEqual(expected);
    expect((await frozenStyle(t, generationId)).styleOverrides).toEqual(expected);
    expect(
      payload.orderedContext?.categoryOutcomes.map((outcome) => [outcome.category, outcome.effective, outcome.tier])
    ).toEqual(
      STYLE_OVERRIDE_KEYS.map((key) => [key, key !== enforced, key === enforced ? "org_enforced" : "none"])
    );

    const notes = await notesOf(t, generationId);
    const categoryRows = notes.filter((note) => String(note.instruction).startsWith("House Rule category:"));
    expect(categoryRows).toHaveLength(18);
    const enforcedRows = categoryRows.filter((row) => row.tier === "org_enforced");
    expect(enforcedRows).toHaveLength(3);
    expect(new Set(enforcedRows.map((row) => row.instruction)).size).toBe(1);
    expect(
      enforcedRows.every(
        (row) =>
          row.outcome === "applied" &&
          row.reason === "House Rule applied: org-enforced (writer waivers are ignored)"
      )
    ).toBe(true);
    const waivedRows = categoryRows.filter((row) => row.tier !== "org_enforced");
    expect(waivedRows).toHaveLength(15);
    expect(
      waivedRows.every(
        (row) =>
          row.tier === "none" &&
          row.reason === "instruction waived via override: the Writer Profile waives this House Rule"
      )
    ).toBe(true);

    // The requested waiver the org ignored gets its own row, once per section.
    const waiverRows = notes.filter((note) => String(note.instruction).startsWith("Writer Profile waiver:"));
    expect(waiverRows.map((row) => row.section).sort()).toEqual(["242", "244", "246"]);
    expect(
      waiverRows.every(
        (row) =>
          row.instruction ===
            String(enforcedRows[0].instruction).replace("House Rule category:", "Writer Profile waiver:") &&
          row.outcome === "not_applied" &&
          row.tier === "org_enforced" &&
          row.reason === "org-enforced: this House Rule applies regardless of the Writer Profile"
      )
    ).toBe(true);
  });
});

describe("a resolver failure never fails generation", () => {
  it("degrades to the saved-profile read and logs the reason", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const context: OrderedProfileContext = {
      profileState: "applied",
      categoryOutcomes: [],
      buildOrder: ["242", "244", "246"],
      selfCheckRules: [],
    };
    const mutations: Array<[string, unknown]> = [];
    const lines: string[] = [];
    const candidateFailure = new Error("candidate read failed");
    const ctx = {
      runQuery: async (reference: unknown) => {
        const name = getFunctionName(reference as never);
        if (name === "writerProfiles:getSettingsDocumentCandidate") {
          throw candidateFailure;
        }
        if (name === "writerProfiles:getProfileForGeneration") {
          return {
            customInstructions: "Saved flavor.",
            styleOverrides: { ...NO_STYLE_OVERRIDES, bannedWords: true },
          };
        }
        if (name === "writerProfiles:getGenerationProfileContext") return context;
        throw new Error(`unexpected query ${name}`);
      },
      runMutation: async (reference: unknown, args: unknown) => {
        mutations.push([getFunctionName(reference as never), args]);
        return null;
      },
    } as unknown as Parameters<typeof resolveGenerationWriterSettings>[0];
    const result = await resolveGenerationWriterSettings(ctx, {
      generationId: "generations-id" as Id<"generations">,
      projectId: "projects-id" as Id<"projects">,
      requestedBy: undefined,
      clientFor: () => {
        throw new Error("no model call on the degrade path");
      },
      log: async (line) => {
        lines.push(line);
      },
    });
    const errorCalls = quiet.mock.calls.map((call) => [...call]);
    quiet.mockRestore();
    // The server log keeps the raw error object (message and stack) beside
    // the reason code; the writer-facing line carries the reason only.
    const resolutionCall = errorCalls.find((call) =>
      String(call[0]).startsWith("writer settings resolution failed")
    );
    expect(resolutionCall?.[2]).toBe(candidateFailure);
    expect(lines[0]).not.toContain("candidate read failed");
    expect(result).toEqual({
      writerFlavor: "Saved flavor.",
      styleOverrides: { ...NO_STYLE_OVERRIDES, bannedWords: true },
      orderedContext: context,
    });
    expect(lines[0]).toMatch(/^Writer settings could not be resolved \(.+\); the saved Writer Profile applies/);
    expect(mutations).toEqual([
      [
        "generations:recordWriterSettings",
        {
          generationId: "generations-id",
          writerSettings: {
            profileState: "applied",
            source: "profile",
            matchesProfile: false,
            savedProfileSuperseded: false,
            waiverAnalysis: "profile",
            truncated: false,
          },
        },
      ],
    ]);
  });
});
