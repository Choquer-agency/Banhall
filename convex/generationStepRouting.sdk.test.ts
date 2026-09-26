/// <reference types="vite/client" />
/**
 * Owner decision 43 (2026-09-25): the model a writer picks writes the
 * report; the helper steps run on the generation's frozen planning and
 * checking roles (convex/lib/generationSteps.ts).
 *
 * Every stage runs through the real entry actions, the real Anthropic SDK
 * and the production instrumented client, with only `fetch` stubbed. Each
 * stage's request bodies (ids masked) are hashed and compared with the
 * hashes this same fixture produced on 771af202, before step routing: a
 * Sonnet 5 pick and every generation frozen before step routing send what
 * they sent then, and only compression now turns thinking off.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FunctionArgs } from "convex/server";
import { makeFunctionReference } from "convex/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { assignRoleModelByHand, freezeModelsForGeneration } from "./lib/modelRoles";
import type { ModelFreeze } from "./lib/modelCatalogValidators";
import {
  CONSISTENCY_REQUEST,
  COMPRESSION_REQUEST,
  ORDERED_PROMPT_SCAFFOLDS,
  SEED_PROMPT_PROGRAM,
  SELF_CHECK_REQUEST,
} from "./ai/promptDefinitions";
import { ANALYZER_REQUEST } from "./ai/analyzerAgent";
import { BRIEF_REQUEST } from "./ai/brief";
import { describeBriefOutcome } from "./lib/briefRender";
import { QA_REQUEST } from "./ai/qaAgent";
import { CHRONOLOGY_REQUEST } from "./ai/chronologyAgent";
import {
  ANTHROPIC_TIMEOUT_MS,
  SEED_PROVIDER_TIMEOUT_MS,
  resetGenerationModelCache,
  resetGenerationPlaceholderCache,
  withStepRequest,
} from "./ai/providers";
import { GENERATION_CALL_SLOTS } from "./ai/instrument";
import type { GenerationClient, GenerationMessageParams } from "./ai/openrouterCore";
import {
  GENERATION_STEP_POLICY,
  GENERATION_STEP_POLICY_VERSION,
  GENERATION_STEPS,
  generationStepOf,
  resolveGenerationCall,
  resolveGenerationStep,
  type GenerationStep,
} from "./lib/generationSteps";
import { runSeedDraftingInputs } from "./seedStartup.fixture";

const modules = import.meta.glob("./**/*.ts");
type T = ReturnType<typeof convexTest<typeof schema.tables>>;

const SONNET = "claude-sonnet-5";
const OPUS = "claude-opus-5-5";
const HAIKU = "claude-haiku-4-5-20251001";

const generateBatchRef = makeFunctionReference<"action", { batchId: Id<"seedBatches"> }, unknown>(
  "ai/seeds:generateBatch"
);

// Outcome writes race a 2 s timer; load their module first.
beforeAll(async () => {
  await import("./modelCatalog");
});
beforeEach(() => {
  // Generation ids repeat across convex-test instances; forget cached freezes.
  resetGenerationModelCache();
  resetGenerationPlaceholderCache();
  vi.useFakeTimers({ now: new Date("2026-09-25T12:00:00Z"), toFake: ["Date"] });
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-anthropic-key");
  vi.stubEnv("OPENROUTER_API_KEY", "synthetic-openrouter-key");
  vi.stubEnv("VOYAGE_API_KEY", "");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// ─── The fixture's provider ─────────────────────────────────────────────────

const TRANSCRIPT =
  "Interviewer: What was uncertain?\nClient: The team tested a control loop and could not predict how it would respond at peak load. " +
  "They ran three load-band experiments and established a stable operating range.";

/** Over every line limit, so each Section is compressed. */
const LONG_DRAFT = Array.from({ length: 12 }, (_, index) =>
  `Paragraph ${index + 1}: the team measured the control loop response across load bands and recorded every trial result in the lab notebook, ` +
  "comparing each run against the predicted response and noting where the model and the plant disagreed under peak load conditions."
).join("\n\n");
const SHORT_TEXT = "The team measured the control loop response across load bands.";

const ANSWERS: Record<string, unknown> = {
  submit_transcript_analysis: {
    company_context: "Test company",
    project_goal: "Stabilize the control loop",
    business_problem: "Output was unstable",
    scientific_technical_problem: "The response at peak load was unknown",
    technological_objective: "A stable control response",
    work_performed: {},
    project_status: "completed",
  },
  submit_generation_brief: {
    storyline: "The team tested a control loop and established a stable operating range.",
    storylineClaims: [],
    claimExclusions: [],
    confidenceMap: [],
    glossaryTerms: [{ term: "control loop" }],
  },
  submit_retrieval_brief: {
    problem: "Unstable control loop output at peak load in an industrial controller.",
    uncertainty: "Whether the controller response at peak load could be predicted.",
    work: "Three load-band experiments on the control loop.",
    advancement: "A stable operating range for the control loop.",
  },
  submit_seed_batch: {
    seeds: [
      { bullets: ["The team could not predict the control loop response at peak load."], tags: ["technical"], provenance: [] },
      { bullets: ["Three load-band experiments established a stable operating range."], tags: ["detailed"], provenance: [] },
      { bullets: ["The operating range was new to the company."], tags: ["conservative"], provenance: [] },
    ],
  },
  submit_qa_scorecard: {
    overall_score: 88,
    section_scores: {},
    cra_compliance: {},
    hallucination_risks: [],
    ai_language_flags: [],
    superlative_flags: [],
    gaps_requiring_client_followup: [],
    suggested_improvements: [],
  },
  // One unmet verdict per Section, so every Section is repaired once.
  submit_self_check: {
    verdicts: [
      {
        paragraph: 1,
        check: "storyline",
        instruction: "Storyline",
        outcome: "not_applied",
        reason: "The paragraph drifts from the Storyline.",
        repairGuidance: "Tie the paragraph to the stable operating range.",
      },
    ],
  },
  submit_consistency_findings: { findings: [] },
  submit_chronology_table: { entries: [] },
};

type Sent = { body: string; json: Record<string, unknown> };
type Wire = { sent: Sent[]; events: string[] };

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((block: { text?: string }) => block.text ?? "").join("");
}
function userOf(json: Record<string, unknown>): string {
  const messages = (json.messages ?? []) as Array<{ role: string; content: unknown }>;
  return messages.filter((message) => message.role === "user").map((message) => textOf(message.content)).join("\n");
}
function toolOf(json: Record<string, unknown>): string | null {
  return (json.tools as Array<{ name: string }> | undefined)?.[0]?.name ?? null;
}

/** The stage a request belongs to, read from its body alone. */
function stageOf(json: Record<string, unknown>): string {
  const tool = toolOf(json);
  if (tool) return tool;
  if (textOf(json.system).startsWith(COMPRESSION_REQUEST.system.slice(0, 60))) return "compression";
  if (userOf(json).includes(ORDERED_PROMPT_SCAFFOLDS.repairGuidance.prefix)) return "repair";
  return "section";
}

/**
 * Stubs `fetch` with the Anthropic Messages API. `hold` delays one
 * stage's answer until its promise settles.
 */
function installFetch(options: { hold?: Partial<Record<string, () => Promise<void>>>; fail?: string[] } = {}): Wire {
  const wire: Wire = { sent: [], events: [] };
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      if (request.url !== "https://api.anthropic.com/v1/messages") {
        throw new Error(`Unexpected HTTP transport ${request.url}`);
      }
      const body = await request.text();
      const json = JSON.parse(body) as Record<string, unknown>;
      const stage = stageOf(json);
      wire.sent.push({ body, json });
      wire.events.push(`${stage}:request`);
      await options.hold?.[stage]?.();
      wire.events.push(`${stage}:answer`);
      const base = {
        id: "msg_synthetic",
        type: "message",
        role: "assistant",
        model: json.model,
        stop_sequence: null,
        usage: { input_tokens: 40, output_tokens: 8 },
      };
      if (options.fail?.includes(stage)) {
        return Response.json(
          { type: "error", error: { type: "invalid_request_error", message: "Synthetic refusal" } },
          { status: 400 }
        );
      }
      const tool = toolOf(json);
      if (tool) {
        if (!(tool in ANSWERS)) throw new Error(`Unexpected tool ${tool}`);
        return Response.json({
          ...base,
          content: [{ type: "tool_use", id: `toolu_${tool}`, name: tool, input: ANSWERS[tool] }],
          stop_reason: "tool_use",
        });
      }
      return Response.json({
        ...base,
        content: [{ type: "text", text: stage === "section" ? LONG_DRAFT : SHORT_TEXT }],
        stop_reason: "end_turn",
      });
    })
  );
  return wire;
}

/** Convex test ids depend on insertion order across tables; bodies are
 * compared with them masked. */
function maskIds(text: string): string {
  return text.replace(/\b\d{7,}[A-Za-z]+\b/g, "<id>");
}
async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

type Pin = { count: number; hash: string; models: string[] };
type Scenario = `${"seeds" | "single" | "compare"}:${typeof SONNET | typeof OPUS}`;

/** Per stage: how many requests, the hash of their sorted bodies, and the models they named. */
async function stagesOf(sent: Sent[], edit: (json: Record<string, unknown>) => Record<string, unknown> = (json) => json): Promise<Record<string, Pin>> {
  const byStage = new Map<string, { bodies: string[]; models: Set<string> }>();
  for (const request of sent) {
    const stage = stageOf(request.json);
    const entry = byStage.get(stage) ?? { bodies: [], models: new Set<string>() };
    const edited = edit(request.json);
    entry.bodies.push(maskIds(edited === request.json ? request.body : JSON.stringify(edited)));
    entry.models.add(String(request.json.model));
    byStage.set(stage, entry);
  }
  const out: Record<string, Pin> = {};
  for (const [stage, entry] of [...byStage.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    out[stage] = {
      count: entry.bodies.length,
      hash: await sha256Hex(JSON.stringify([...entry.bodies].sort())),
      models: [...entry.models].sort(),
    };
  }
  return out;
}

/**
 * The same fixture on 771af202, before step routing: every stage's request
 * count, body hash and models. Captured with this file's fixture and
 * provider, at that commit, for a writer who picked Sonnet 5 or Opus 5.5.
 */
const PINNED_771AF202: Record<Scenario, Record<string, Pin>> = {
  "seeds:claude-sonnet-5": {
    submit_generation_brief: { count: 1, hash: "b18d420add5a2f2c3fb4ae64bfbdf2510ac42f8c21a171cbcb77fbd814d41ca2", models: ["claude-sonnet-5"] },
    submit_retrieval_brief: { count: 1, hash: "4b5d9539e38c3ae6b3a70cd0a909d21ce9e1f5142fc3c54d4e85ce5a9f64a284", models: ["claude-haiku-4-5-20251001"] },
    submit_seed_batch: { count: 1, hash: "1be1fad9e0b7b627782584fbd31aaccc49d912341e77a97d10db1d06aa6fc629", models: ["claude-sonnet-5"] },
    submit_transcript_analysis: { count: 1, hash: "d36da10c1e32c7eb4dc6b879f0a4407a2931a9d69ca4e6acb991f60c3a2debfb", models: ["claude-sonnet-5"] },
  },
  "single:claude-sonnet-5": {
    compression: { count: 2, hash: "72df39cb2d23c868dd742b63645a4241d845416b90a90e0e3128bc379e1a17c6", models: ["claude-sonnet-5"] },
    repair: { count: 3, hash: "06cbe1a68dc080f923a24142a219515b01e3fad42aaea12d1c2a4ceedd1235d3", models: ["claude-sonnet-5"] },
    section: { count: 3, hash: "6c3c5ed79e05c8d9bc2cb1647becc976b58cb78fe2de1f05fd4a9a9288e42e2a", models: ["claude-sonnet-5"] },
    submit_chronology_table: { count: 2, hash: "6535a345b0f54262ce1693fb217635446a64a756b243b8469bbcb7823ef91629", models: ["claude-sonnet-5"] },
    submit_consistency_findings: { count: 1, hash: "443b0104568c169382ab2f4fbb0dd597db37332959e7761f8fe55178d296a9ba", models: ["claude-sonnet-5"] },
    submit_generation_brief: { count: 1, hash: "b18d420add5a2f2c3fb4ae64bfbdf2510ac42f8c21a171cbcb77fbd814d41ca2", models: ["claude-sonnet-5"] },
    submit_qa_scorecard: { count: 2, hash: "a6b95dbd3873b3983de92a404defd29b073784daa9471607166c5fa870f7f8bb", models: ["claude-sonnet-5"] },
    submit_retrieval_brief: { count: 1, hash: "4b5d9539e38c3ae6b3a70cd0a909d21ce9e1f5142fc3c54d4e85ce5a9f64a284", models: ["claude-haiku-4-5-20251001"] },
    submit_self_check: { count: 3, hash: "0f0f0661964785b9c8b27fb52fc59f17b1dd4f1f12061458319fa26979514a88", models: ["claude-sonnet-5"] },
    submit_transcript_analysis: { count: 1, hash: "d36da10c1e32c7eb4dc6b879f0a4407a2931a9d69ca4e6acb991f60c3a2debfb", models: ["claude-sonnet-5"] },
  },
  "compare:claude-sonnet-5": {
    compression: { count: 4, hash: "04e8dcefb0677d152f39688318ebfa6b6b47db95dfe0bcaf0d075dd09835a9f2", models: ["claude-haiku-4-5-20251001", "claude-sonnet-5"] },
    repair: { count: 6, hash: "e210d439b71b15b040aa0c5aef8f9badfe51449aa4e0e9968abd65eb76215a8a", models: ["claude-haiku-4-5-20251001", "claude-sonnet-5"] },
    section: { count: 6, hash: "34114bc7a7f32ad8d92d3576304be3135ea1d4cd576ce22f1e2c2435056a5065", models: ["claude-haiku-4-5-20251001", "claude-sonnet-5"] },
    submit_chronology_table: { count: 2, hash: "1703e81119a84ba009430e622f65979e4110912ade144a7380befbf918a00173", models: ["claude-haiku-4-5-20251001", "claude-sonnet-5"] },
    submit_consistency_findings: { count: 2, hash: "fce6729d4962b693bb81bb452c31fc98858fe0124f3913e162642f60215fbd8d", models: ["claude-haiku-4-5-20251001", "claude-sonnet-5"] },
    submit_generation_brief: { count: 1, hash: "b18d420add5a2f2c3fb4ae64bfbdf2510ac42f8c21a171cbcb77fbd814d41ca2", models: ["claude-sonnet-5"] },
    submit_qa_scorecard: { count: 2, hash: "d182f2f62b16127840c9b4e1cfb48a4b22d77e7fe1ba3871f40c8b72fecb658f", models: ["claude-haiku-4-5-20251001", "claude-sonnet-5"] },
    submit_retrieval_brief: { count: 1, hash: "4b5d9539e38c3ae6b3a70cd0a909d21ce9e1f5142fc3c54d4e85ce5a9f64a284", models: ["claude-haiku-4-5-20251001"] },
    submit_self_check: { count: 6, hash: "a04a984cca9e0c54a8138c0afc9ebf410f7e4252a28d90b87c66e815057372af", models: ["claude-haiku-4-5-20251001", "claude-sonnet-5"] },
    submit_transcript_analysis: { count: 1, hash: "d36da10c1e32c7eb4dc6b879f0a4407a2931a9d69ca4e6acb991f60c3a2debfb", models: ["claude-sonnet-5"] },
  },
  "seeds:claude-opus-5-5": {
    submit_generation_brief: { count: 1, hash: "8cce97deab2604c75bb4a4257084c362836c7bb3fad7173680d2c78c549386fb", models: ["claude-opus-5-5"] },
    submit_retrieval_brief: { count: 1, hash: "4b5d9539e38c3ae6b3a70cd0a909d21ce9e1f5142fc3c54d4e85ce5a9f64a284", models: ["claude-haiku-4-5-20251001"] },
    submit_seed_batch: { count: 1, hash: "a4d42e878fc823f1ae9471cbc9b6d8ee5ebafb8ee856e6f601b472b42bd95e7b", models: ["claude-opus-5-5"] },
    submit_transcript_analysis: { count: 1, hash: "019ac766af5445583f98a6f87aa36d6e0778c39bacdd66fe3a31e1653bdac29f", models: ["claude-opus-5-5"] },
  },
  "single:claude-opus-5-5": {
    compression: { count: 2, hash: "89f2447fe104b802700cfae0e3300945bda3c18e49caf456d633a5ef0b3da50c", models: ["claude-opus-5-5"] },
    repair: { count: 3, hash: "dde6d01093d30e5905440e38fcb389557d79597270163b2eb5d941a6d8b73b1d", models: ["claude-opus-5-5"] },
    section: { count: 3, hash: "552b290479e7ee9a2b74fa62ce203f2a069c0b3888eb55508527c8ea9655b73e", models: ["claude-opus-5-5"] },
    submit_chronology_table: { count: 2, hash: "ec823b37cdaa3cf47175f8402807b52cd31117ac80b105aa2d97147037a849bb", models: ["claude-opus-5-5", "claude-sonnet-5"] },
    submit_consistency_findings: { count: 1, hash: "12ed6de35ba1bd47920f9088a61c27ba575b3950d90c7fd2cb5109a185b5661c", models: ["claude-opus-5-5"] },
    submit_generation_brief: { count: 1, hash: "8cce97deab2604c75bb4a4257084c362836c7bb3fad7173680d2c78c549386fb", models: ["claude-opus-5-5"] },
    submit_qa_scorecard: { count: 2, hash: "73c48953c52a6d76ab56160c63095657ac6e5a50525ff537134c1a0098539db3", models: ["claude-opus-5-5", "claude-sonnet-5"] },
    submit_retrieval_brief: { count: 1, hash: "4b5d9539e38c3ae6b3a70cd0a909d21ce9e1f5142fc3c54d4e85ce5a9f64a284", models: ["claude-haiku-4-5-20251001"] },
    submit_self_check: { count: 3, hash: "1449985a4a460c9b9f3cba9b02668e121ebae5d90a2cb15178f556a1372460ec", models: ["claude-opus-5-5"] },
    submit_transcript_analysis: { count: 1, hash: "019ac766af5445583f98a6f87aa36d6e0778c39bacdd66fe3a31e1653bdac29f", models: ["claude-opus-5-5"] },
  },
  "compare:claude-opus-5-5": {
    compression: { count: 4, hash: "91076332a51682a628e4d15cfdfaeba1dd73304eafa27c9d3905bce0516d8a59", models: ["claude-haiku-4-5-20251001", "claude-opus-5-5"] },
    repair: { count: 6, hash: "5a08e9b67f9c5f12309217552f836af102d8bd2c00b39768dd896bc0977fe273", models: ["claude-haiku-4-5-20251001", "claude-opus-5-5"] },
    section: { count: 6, hash: "7aa087916c95385565b333097a86ab15062a857a3b6a7292532b73459298005a", models: ["claude-haiku-4-5-20251001", "claude-opus-5-5"] },
    submit_chronology_table: { count: 2, hash: "9b4d4b1b417dc7c8fb6c6e8370556d4278d4879f5c94824eafa71e7252ae11b2", models: ["claude-haiku-4-5-20251001", "claude-opus-5-5"] },
    submit_consistency_findings: { count: 2, hash: "b1711fdfcd7c9d4ec2b64d38107eefcd6e5bbe79dbd69f7e49150f276fa1b87a", models: ["claude-haiku-4-5-20251001", "claude-opus-5-5"] },
    submit_generation_brief: { count: 1, hash: "b18d420add5a2f2c3fb4ae64bfbdf2510ac42f8c21a171cbcb77fbd814d41ca2", models: ["claude-sonnet-5"] },
    submit_qa_scorecard: { count: 2, hash: "b0b38ea61d0aee34e919800b811159c34c7b98c617e3612d9a5b22f2307866cb", models: ["claude-haiku-4-5-20251001", "claude-opus-5-5"] },
    submit_retrieval_brief: { count: 1, hash: "4b5d9539e38c3ae6b3a70cd0a909d21ce9e1f5142fc3c54d4e85ce5a9f64a284", models: ["claude-haiku-4-5-20251001"] },
    submit_self_check: { count: 6, hash: "558101e20f90725f45e6972b232f98ca245d45e172c09ea52cf00228db3065d8", models: ["claude-haiku-4-5-20251001", "claude-opus-5-5"] },
    submit_transcript_analysis: { count: 1, hash: "d36da10c1e32c7eb4dc6b879f0a4407a2931a9d69ca4e6acb991f60c3a2debfb", models: ["claude-sonnet-5"] },
  },
};

/** The helper stages owner decision 43 moves off the writer's model. */
const PLANNING_STAGES = ["submit_transcript_analysis", "submit_generation_brief", "submit_seed_batch"];
const CHECKING_STAGES = ["submit_self_check", "submit_consistency_findings", "submit_qa_scorecard", "submit_chronology_table"];
const WRITER_STAGES = ["section", "repair", "compression"];

// ─── Generations ────────────────────────────────────────────────────────────

type FreezeKind = "current" | "beforeStepRouting";

/** A freeze as 771af202 wrote it: four roles, no step routing. */
function beforeStepRouting(freeze: ModelFreeze): ModelFreeze {
  const { stepPolicyVersion: _version, roles, ...rest } = freeze;
  return {
    ...rest,
    roles: {
      writing: roles.writing,
      condense: roles.condense,
      retrieval_brief: roles.retrieval_brief,
      analysis: roles.analysis,
    },
  };
}

async function fixture(options: {
  mode: "single" | "compare" | "iterative";
  model: string;
  freeze?: FreezeKind;
  roles?: Partial<Record<"planning" | "checking", string>>;
}) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { authId: "routing-writer", role: "admin" });
    for (const [role, modelId] of Object.entries(options.roles ?? {}) as Array<["planning" | "checking", string]>) {
      await assignRoleModelByHand(ctx, role, modelId, userId);
    }
    const projectId = await ctx.db.insert("projects", {
      title: "Control loop",
      clientName: "Client",
      status: "generating",
      ownerId: userId,
      createdBy: userId,
      shareToken: "routing-token",
      createdAt: 1,
      updatedAt: 1,
    });
    const transcriptId = await ctx.db.insert("transcripts", { projectId, content: TRANSCRIPT, createdAt: 1 });
    const modelIds = options.mode === "compare" ? [options.model, HAIKU] : [options.model];
    const current = await freezeModelsForGeneration(ctx, modelIds, Date.now());
    const modelFreeze = options.freeze === "beforeStepRouting" ? beforeStepRouting(current) : current;
    const generationId = await ctx.db.insert("generations", {
      projectId,
      transcriptId,
      transcriptIds: [transcriptId],
      status: "reserved",
      candidateMode: options.mode,
      ...(options.mode === "iterative" ? { gatedWorkflow: "seeds" as const } : {}),
      requestedAt: 1,
      requestedBy: userId,
      startedAt: 1,
      previousProjectStatus: "draft",
      learningDigestIds: [],
      ...(options.mode === "compare" ? { compareModelIds: modelIds } : { singleModelId: options.model }),
      modelFreeze,
    });
    await ctx.db.patch(projectId, { activeGenerationId: generationId });
    await ctx.db.insert("generationSources", {
      projectId,
      generationId,
      kind: "transcript",
      transcriptId,
      label: "Frozen transcript",
      content: TRANSCRIPT,
      contentHash: "routing-source-hash",
      truncated: false,
      originalLength: TRANSCRIPT.length,
      capturedAt: 1,
    });
    return { userId, projectId, generationId };
  });
  return { t, ...ids, writer: t.withIdentity({ subject: "routing-writer" }) };
}

const CANDIDATE_JOB = "ai/pipeline:generateCandidate";
const SECTION_JOB = "ai/orderedGeneration:generateOrderedSection";
const FINALIZE_JOB = "ai/orderedGeneration:finalizeOrderedCandidate";
const POST_QA_JOB = "ai/postQa:runReportQa";

async function pendingJobs(t: T, names: string[]) {
  return await t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect()).filter(
      (job) => job.state.kind === "pending" && names.includes(job.name)
    )
  );
}

/** Runs every scheduled candidate, Section, finalize and post-QA job, one at a time. */
async function drain(t: T) {
  for (let round = 0; round < 80; round += 1) {
    const [job] = await pendingJobs(t, [CANDIDATE_JOB, SECTION_JOB, FINALIZE_JOB, POST_QA_JOB]);
    if (!job) return;
    await t.run((ctx) => ctx.scheduler.cancel(job._id));
    const args = job.args[0];
    if (job.name === CANDIDATE_JOB) {
      await t.action(internal.ai.pipeline.generateCandidate, args as FunctionArgs<typeof internal.ai.pipeline.generateCandidate>);
    } else if (job.name === SECTION_JOB) {
      await t.action(internal.ai.orderedGeneration.generateOrderedSection, args as FunctionArgs<typeof internal.ai.orderedGeneration.generateOrderedSection>);
    } else if (job.name === FINALIZE_JOB) {
      await t.action(internal.ai.orderedGeneration.finalizeOrderedCandidate, args as FunctionArgs<typeof internal.ai.orderedGeneration.finalizeOrderedCandidate>);
    } else {
      await t.action(internal.ai.postQa.runReportQa, args as FunctionArgs<typeof internal.ai.postQa.runReportQa>);
    }
  }
  throw new Error("The scheduled work did not drain");
}

/** Step by step to its first seed batch: Brief, retrieval, analysis, seeds. */
async function runStepByStep(model: string, freeze: FreezeKind = "current", roles?: Partial<Record<"planning" | "checking", string>>) {
  const wire = installFetch();
  const f = await fixture({ mode: "iterative", model, freeze, ...(roles ? { roles } : {}) });
  await f.t.action(internal.ai.iterative.startIterativeGeneration, { generationId: f.generationId });
  await runSeedDraftingInputs(f.t);
  await f.writer.mutation(api.seeds.open, {
    generationId: f.generationId,
    roleId: "company_context",
    expectedSeedStageVersion: 0,
    commandId: "open-company-context",
  });
  const batch = await f.t.run(async (ctx) => {
    for (const job of await ctx.db.system.query("_scheduled_functions").collect()) {
      if (job.name.includes("generateBatch") && job.state.kind === "pending") await ctx.scheduler.cancel(job._id);
    }
    return await ctx.db.query("seedBatches").first();
  });
  if (!batch) throw new Error("Opening the first role dispatched no batch");
  await f.t.action(generateBatchRef, { batchId: batch._id });
  return { ...f, wire, batch };
}

/** Single draft (then its QA rerun) or Compare, from start to finished drafts. */
async function runOneShot(
  mode: "single" | "compare",
  model: string,
  freeze: FreezeKind = "current",
  roles?: Partial<Record<"planning" | "checking", string>>
) {
  const wire = installFetch();
  const f = await fixture({ mode, model, freeze, ...(roles ? { roles } : {}) });
  await f.t.action(internal.ai.pipeline.generateReport, { generationId: f.generationId });
  await drain(f.t);
  if (mode === "single") {
    expect((await f.t.run((ctx) => ctx.db.get(f.generationId)))?.status).toBe("completed");
    await f.writer.mutation(api.generations.requestReportQa, { generationId: f.generationId });
    await drain(f.t);
  }
  return { ...f, wire };
}

async function run(scenario: Scenario, freeze: FreezeKind) {
  const [mode, model] = scenario.split(":") as ["seeds" | "single" | "compare", string];
  return mode === "seeds" ? await runStepByStep(model, freeze) : await runOneShot(mode, model, freeze);
}

const withoutThinking = (json: Record<string, unknown>) => {
  const { thinking: _thinking, ...rest } = json;
  return rest;
};

// ─── The step table and its resolver ────────────────────────────────────────

describe("the step table and its resolver (owner decision 43)", () => {
  const freeze = (roles: Partial<ModelFreeze["roles"]>, entries: ModelFreeze["entries"] = []): ModelFreeze => ({
    entries,
    roles: { writing: SONNET, condense: SONNET, retrieval_brief: HAIKU, analysis: SONNET, planning: SONNET, checking: SONNET, ...roles },
    frozenAt: 1,
    stepPolicyVersion: GENERATION_STEP_POLICY_VERSION,
  });

  it("routes every generation call site to its step, and leaves the ones with their own role alone", () => {
    const routed = Object.fromEntries(GENERATION_CALL_SLOTS.map((slot) => [slot, generationStepOf(`generation:${slot}`)]));
    expect(routed).toMatchObject({
      analyzer: "analyzer",
      brief: "brief",
      "seeds:company_context": "seeds",
      "seedFeedback:company_context": "seedFeedback",
      "section:242": "section",
      "repair:244": "repair",
      "compression:246": "compression",
      "selfCheck:242": "selfCheck",
      consistency: "consistency",
      qa: "qa",
      chronology: "chronology",
      post_qa: "postQa",
      post_chronology: "postChronology",
      retrieval_brief: null,
      condense: null,
      facts: null,
      settings: null,
    });
    // Every other slot is a seed, Section, repair, compression or Self-check slot.
    for (const [slot, step] of Object.entries(routed)) {
      if (["retrieval_brief", "condense", "facts", "settings"].includes(slot)) continue;
      expect(step, slot).not.toBeNull();
    }
    expect(generationStepOf("chat")).toBeNull();
    expect(() => resolveGenerationCall({ freeze: freeze({}), callSite: "generation:retrieval_brief", writerModel: OPUS })).toThrow(
      /No generation step routes generation:retrieval_brief/
    );
  });

  it("sends the planning steps to the planning model, the checks to the checking model and the writing to the writer's pick", () => {
    const routes = Object.fromEntries(
      GENERATION_STEPS.map((step) => {
        const route = resolveGenerationStep({ freeze: freeze({ planning: SONNET, checking: HAIKU }), step, writerModel: OPUS });
        return [step, [route.source, route.model, route.request]];
      })
    );
    expect(routes).toEqual({
      analyzer: ["planning", SONNET, {}],
      brief: ["planning", SONNET, {}],
      seeds: ["planning", SONNET, {}],
      seedFeedback: ["planning", SONNET, {}],
      section: ["writer", OPUS, {}],
      repair: ["writer", OPUS, {}],
      // a1 finding 2: compression no longer thinks.
      compression: ["writer", OPUS, { thinking: { type: "disabled" } }],
      selfCheck: ["checking", HAIKU, {}],
      consistency: ["checking", HAIKU, {}],
      qa: ["checking", HAIKU, {}],
      chronology: ["checking", HAIKU, {}],
      postQa: ["checking", HAIKU, {}],
      postChronology: ["checking", HAIKU, {}],
    } satisfies Record<GenerationStep, unknown>);
  });

  it("asks an always-thinking helper model for low effort, the way the unforced path does, and nothing else of any other model", () => {
    const opusEntry = { id: OPUS, label: "Opus 5.5", provider: "Anthropic", gateway: "anthropic" as const, reasoning: false, forcedToolChoice: false };
    const opusHelpers = freeze({ planning: OPUS, checking: OPUS }, [opusEntry]);
    for (const step of GENERATION_STEPS) {
      const route = resolveGenerationStep({ freeze: opusHelpers, step, writerModel: SONNET });
      const off = GENERATION_STEP_POLICY[step].source !== "writer" || step === "compression";
      expect([step, route.request], step).toEqual([step, off ? { thinking: { type: "disabled" } } : {}]);
    }
    // The same model id, known only from its seed entry, is recognised too.
    expect(resolveGenerationStep({ freeze: freeze({ planning: OPUS }), step: "brief", writerModel: SONNET }).request).toEqual({
      thinking: { type: "disabled" },
    });
    // Sonnet 5 and Haiku 4.5 helpers keep their request exactly.
    expect(resolveGenerationStep({ freeze: freeze({ checking: HAIKU }), step: "qa", writerModel: OPUS }).request).toEqual({});
  });

  it("resolves a generation frozen before step routing to the model it used before, with its request unchanged", () => {
    const old = beforeStepRouting(freeze({ planning: HAIKU, checking: HAIKU }));
    for (const step of GENERATION_STEPS) {
      expect(resolveGenerationStep({ freeze: old, step, writerModel: OPUS, legacyModel: "legacy-model" })).toEqual({
        step,
        source: "legacy",
        model: "legacy-model",
        policyVersion: null,
        request: {},
      });
      expect(resolveGenerationStep({ freeze: null, step, writerModel: OPUS }).model).toBe(OPUS);
    }
  });

  it("declares each step's answer budget and timeout as its request sends them", () => {
    const declared = Object.fromEntries(
      GENERATION_STEPS.map((step) => [step, [GENERATION_STEP_POLICY[step].maxTokens, GENERATION_STEP_POLICY[step].timeoutMs]])
    );
    expect(declared).toEqual({
      analyzer: [ANALYZER_REQUEST.maxTokens, ANTHROPIC_TIMEOUT_MS],
      brief: [BRIEF_REQUEST.maxTokens, ANTHROPIC_TIMEOUT_MS],
      seeds: [SEED_PROMPT_PROGRAM.request.maxTokens, SEED_PROVIDER_TIMEOUT_MS],
      seedFeedback: [SEED_PROMPT_PROGRAM.request.maxTokens, SEED_PROVIDER_TIMEOUT_MS],
      section: ["section-answer-token-budget", ANTHROPIC_TIMEOUT_MS],
      repair: ["section-answer-token-budget", ANTHROPIC_TIMEOUT_MS],
      compression: [COMPRESSION_REQUEST.maxTokens, ANTHROPIC_TIMEOUT_MS],
      selfCheck: [SELF_CHECK_REQUEST.maxTokens, ANTHROPIC_TIMEOUT_MS],
      consistency: [CONSISTENCY_REQUEST.maxTokens, ANTHROPIC_TIMEOUT_MS],
      qa: [QA_REQUEST.maxTokens, ANTHROPIC_TIMEOUT_MS],
      chronology: [CHRONOLOGY_REQUEST.maxTokens, ANTHROPIC_TIMEOUT_MS],
      postQa: [QA_REQUEST.maxTokens, ANTHROPIC_TIMEOUT_MS],
      postChronology: [CHRONOLOGY_REQUEST.maxTokens, ANTHROPIC_TIMEOUT_MS],
    });
    expect(SEED_PROMPT_PROGRAM.request.transport.timeoutMs).toBe(SEED_PROVIDER_TIMEOUT_MS);
  });

  it("refuses a request that names another model than its step's, before anything is sent", async () => {
    const create = vi.fn(async () => ({ content: [], usage: { input_tokens: 1, output_tokens: 1 } }));
    const client = { messages: { create } } as unknown as GenerationClient;
    const route = resolveGenerationStep({ freeze: freeze({ checking: HAIKU }), step: "qa", writerModel: OPUS });
    const params = { model: OPUS, max_tokens: 10, messages: [] } satisfies GenerationMessageParams;
    await expect(withStepRequest(client, route).messages.create(params)).rejects.toThrow(
      `The qa step is routed to ${HAIKU} but its request names ${OPUS}`
    );
    expect(create).not.toHaveBeenCalled();
    // A generation frozen before step routing gets its client back untouched.
    const legacy = resolveGenerationStep({ freeze: null, step: "qa", writerModel: OPUS });
    expect(withStepRequest(client, legacy)).toBe(client);
  });
});

// ─── On the wire ────────────────────────────────────────────────────────────

describe("requests on the wire (real SDK, fetch stubbed)", () => {
  it.each(["seeds", "single"] as const)(
    "a Sonnet 5 pick sends every %s request byte for byte as on 771af202, except that compression turns thinking off",
    async (mode) => {
      const { wire } = await run(`${mode}:${SONNET}`, "current");
      const pinned = PINNED_771AF202[`${mode}:${SONNET}`];
      const now = await stagesOf(wire.sent);
      const { compression: pinnedCompression, ...pinnedRest } = pinned;
      const { compression, ...rest } = now;
      expect(rest).toEqual(pinnedRest);
      if (mode === "single") {
        // The compression bodies are the pinned ones plus `thinking: {type: "disabled"}`.
        expect(compression.hash).not.toBe(pinnedCompression.hash);
        expect(await stagesOf(wire.sent.filter((request) => stageOf(request.json) === "compression"), withoutThinking)).toEqual({
          compression: pinnedCompression,
        });
        for (const request of wire.sent.filter((item) => stageOf(item.json) === "compression")) {
          expect(request.json.thinking).toEqual({ type: "disabled" });
        }
      }
    }
  );

  it.each(["seeds", "single"] as const)(
    "an Opus 5.5 pick runs the %s helpers on Sonnet 5 exactly as a Sonnet 5 pick does, and writes on Opus 5.5",
    async (mode) => {
      const { wire } = await run(`${mode}:${OPUS}`, "current");
      const now = await stagesOf(wire.sent);
      const sonnet = PINNED_771AF202[`${mode}:${SONNET}`];
      const before = PINNED_771AF202[`${mode}:${OPUS}`];
      for (const stage of [...PLANNING_STAGES, ...CHECKING_STAGES].filter((name) => name in sonnet)) {
        // On 771af202 the writer's Opus 5.5 ran it; now it is the Sonnet 5 request.
        expect(before[stage].models, stage).toContain(OPUS);
        expect(now[stage], stage).toEqual(sonnet[stage]);
      }
      for (const stage of WRITER_STAGES.filter((name) => name in sonnet)) {
        expect(now[stage].models, stage).toEqual([OPUS]);
      }
      expect(now.submit_retrieval_brief.models).toEqual([HAIKU]);
      if (mode === "single") {
        expect(now.section).toEqual(before.section);
        expect(now.repair).toEqual(before.repair);
        // Opus 5.5 always thinks: compression runs at low effort instead of its default.
        for (const request of wire.sent.filter((item) => stageOf(item.json) === "compression")) {
          expect(request.json.thinking).toBeUndefined();
          expect(request.json.output_config).toEqual({ effort: "low" });
        }
      }
    }
  );

  it("an Opus 5.5 pick in Compare checks both drafts on Sonnet 5 and writes each on its own model", async () => {
    const { wire } = await runOneShot("compare", OPUS);
    const now = await stagesOf(wire.sent);
    for (const stage of [...PLANNING_STAGES, ...CHECKING_STAGES].filter((name) => name in now)) {
      expect([stage, now[stage].models]).toEqual([stage, [SONNET]]);
    }
    for (const stage of WRITER_STAGES) expect([stage, now[stage].models]).toEqual([stage, [HAIKU, OPUS]]);
  });

  it.each(Object.keys(PINNED_771AF202) as Scenario[])(
    "a generation frozen before step routing sends every %s request as on 771af202",
    async (scenario) => {
      const { wire } = await run(scenario, "beforeStepRouting");
      expect(await stagesOf(wire.sent)).toEqual(PINNED_771AF202[scenario]);
    }
  );

  it("an always-thinking planning or checking model an admin assigned runs at low effort; the writer's Sonnet 5 is untouched", async () => {
    const { wire } = await runOneShot("single", SONNET, "current", { planning: OPUS, checking: OPUS });
    const now = await stagesOf(wire.sent);
    const pinned = PINNED_771AF202[`single:${SONNET}`];
    for (const stage of [...PLANNING_STAGES, ...CHECKING_STAGES].filter((name) => name in now)) {
      expect([stage, now[stage].models]).toEqual([stage, [OPUS]]);
    }
    for (const request of wire.sent.filter((item) => [...PLANNING_STAGES, ...CHECKING_STAGES].includes(stageOf(item.json)))) {
      expect(request.json.output_config).toEqual({ effort: "low" });
      expect(request.json.thinking).toBeUndefined();
      expect(request.json.tool_choice).toEqual({ type: "auto", disable_parallel_tool_use: true });
    }
    expect(now.section).toEqual(pinned.section);
    expect(now.repair).toEqual(pinned.repair);
  });

  it("seed feedback and later seed batches keep the planning model on the batch row", async () => {
    const f = await runStepByStep(OPUS);
    expect(f.batch.model).toBe(SONNET);
    resetGenerationModelCache();
    const old = await runStepByStep(OPUS, "beforeStepRouting");
    expect(old.batch.model).toBe(OPUS);
  });
});

// ─── The Brief beside the analysis in Single draft and Compare ──────────────

describe("Single draft and Compare start the Brief beside the analysis (a1 finding 4)", () => {
  /** The analysis answers only once the Brief request was sent, or after 3 s. */
  function analysisWaitsForBrief() {
    let briefSent: () => void = () => {};
    const sent = new Promise<void>((resolve) => {
      briefSent = resolve;
    });
    return {
      hold: {
        submit_generation_brief: async () => briefSent(),
        submit_transcript_analysis: () =>
          Promise.race([sent, new Promise<void>((resolve) => setTimeout(resolve, 3_000))]),
      },
    };
  }

  it.each(["single", "compare"] as const)("%s sends the Brief before the analysis answers and joins it before any draft", async (mode) => {
    const { hold } = analysisWaitsForBrief();
    const wire = installFetch({ hold });
    const f = await fixture({ mode, model: SONNET });
    await f.t.action(internal.ai.pipeline.generateReport, { generationId: f.generationId });
    const briefRequest = wire.events.indexOf("submit_generation_brief:request");
    const analysisAnswer = wire.events.indexOf("submit_transcript_analysis:answer");
    expect(briefRequest).toBeGreaterThanOrEqual(0);
    expect(briefRequest).toBeLessThan(analysisAnswer);
    // Joined before the candidates: the Brief is stored when the first one is created.
    const generation = await f.t.run((ctx) => ctx.db.get(f.generationId));
    expect(generation?.briefId).toBeDefined();
    expect(generation?.briefOutcome?.kind).toBe("derived");
    expect(await pendingJobs(f.t, [CANDIDATE_JOB])).toHaveLength(mode === "compare" ? 2 : 1);
    expect(wire.events.filter((event) => event.startsWith("section"))).toEqual([]);
  });

  it("a failed analysis fails the generation after the Brief it started has finished", async () => {
    const wire = installFetch({ fail: ["submit_transcript_analysis"] });
    const f = await fixture({ mode: "single", model: SONNET });
    await f.t.action(internal.ai.pipeline.generateReport, { generationId: f.generationId });
    const generation = await f.t.run((ctx) => ctx.db.get(f.generationId));
    expect(generation?.status).toBe("failed");
    // The Brief ran to its end and stays reusable by its inputs.
    expect(wire.events).toContain("submit_generation_brief:answer");
    expect(generation?.briefOutcome?.kind).toBe("derived");
    expect(await pendingJobs(f.t, [CANDIDATE_JOB])).toHaveLength(0);
  });

  // Review r2 P3 (2026-09-25): a Brief that finished after the failure added
  // a progress line to the failed generation.
  it("a Brief that finishes after the failure adds no progress line to the failed generation", async () => {
    let f: Awaited<ReturnType<typeof fixture>> | undefined;
    installFetch({
      fail: ["submit_transcript_analysis"],
      hold: {
        // Answer only once the generation has failed.
        submit_generation_brief: async () => {
          for (let i = 0; i < 300; i += 1) {
            const generation = f ? await f.t.run((ctx) => ctx.db.get(f!.generationId)) : null;
            if (generation?.status === "failed") return;
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          throw new Error("The generation never failed");
        },
      },
    });
    f = await fixture({ mode: "single", model: SONNET });
    await f.t.action(internal.ai.pipeline.generateReport, { generationId: f.generationId });
    const generation = await f.t.run((ctx) => ctx.db.get(f!.generationId));
    expect(generation?.status).toBe("failed");
    // Still recorded, so a retry can reuse it.
    expect(generation?.briefOutcome?.kind).toBe("derived");
    const lines = await f.t.run((ctx) =>
      ctx.db
        .query("generationProgress")
        .withIndex("by_generationId_and_at", (q) => q.eq("generationId", f!.generationId))
        .collect()
    );
    expect(lines.map((row) => row.message)).not.toContain(describeBriefOutcome({ kind: "derived" }));
  });
});
