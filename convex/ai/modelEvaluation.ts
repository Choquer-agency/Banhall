"use node";

/**
 * Evaluates one catalog candidate against a role's current model on the
 * fixed eval set (modelEvalSet.ts), through the same structured paths
 * production uses:
 * - seed_batch: the seed prompt and tool schema, checked against the seed
 *   contract (convex/lib/seedContract.ts validateBatch);
 * - section_draft: one Line 242 draft through the section agent;
 * - qa_structured: the QA scorecard call and its runtime contract.
 * A judge call on the current writing model scores each prose output 1 to 10
 * against a fixed rubric. Candidate and incumbent run the same tasks in the
 * same action, so the comparison is like for like; convex/modelCatalog.ts
 * then applies the promotion gates.
 *
 * Every call is capped at EVAL_CALL_TIMEOUT_MS with no transport retry, and
 * the two models run in parallel, so the whole evaluation fits one action.
 */
import { v } from "convex/values";
import { internalAction, type ActionCtx } from "../_generated/server";
import { registerModelEntries } from "../../shared/generationModels";
import { isDashClean } from "../../shared/humanProse";
import type { EvalTaskKind, EvalTaskResult } from "../../shared/modelCatalog";
import {
  claimEvaluationRef,
  completeEvaluationRef,
  failEvaluationRef,
} from "../lib/modelCatalogRefs";
import { entryFromFrozen } from "../lib/modelRoles";
import type { FrozenModelEntry } from "../lib/modelCatalogValidators";
import { seedToolSchema, validateBatch, type FrozenSeedSource } from "../lib/seedContract";
import { instrumentedAnthropic, type UsageTap } from "./instrument";
import { instrumentedOpenRouter } from "./openrouter";
import type { GenerationClient } from "./openrouterCore";
import { SEED_PROMPT_PROGRAM } from "./promptDefinitions";
import { runQAAgent } from "./qaAgent";
import { runSection242Agent } from "./section242Agent";
import { buildSeedPrompt } from "./trustedContext";
import { PD_SUBSECTIONS } from "../../shared/pdSubsections";
import {
  EVAL_BRIEF,
  EVAL_SEED_ROLE,
  EVAL_SOURCE_ID,
  HELIOS_ANALYSIS,
  HELIOS_INTERVIEW,
  HELIOS_SECTIONS,
} from "./modelEvalSet";

export const EVAL_CALL_TIMEOUT_MS = 90_000;

/** A client plus the running cost of everything it answered. */
export type MeteredClient = { client: GenerationClient; meter: { costUsd: number } };

export type EvalOutput = { result: EvalTaskResult; judgeText?: string };

const errorText = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).slice(0, 300);

function hasSeedShape(value: unknown): value is { seeds: unknown[] } {
  if (!value || typeof value !== "object" || !("seeds" in value)) return false;
  const seeds = (value as { seeds: unknown }).seeds;
  return (
    Array.isArray(seeds) &&
    seeds.every(
      (seed) =>
        seed !== null &&
        typeof seed === "object" &&
        Array.isArray((seed as Record<string, unknown>).bullets) &&
        Array.isArray((seed as Record<string, unknown>).tags) &&
        Array.isArray((seed as Record<string, unknown>).provenance)
    )
  );
}

/** One seed batch on the first attempt: no repair, as an honest measure. */
export async function runSeedBatchTask(
  metered: MeteredClient,
  model: string
): Promise<EvalOutput> {
  const before = metered.meter.costUsd;
  const objective =
    PD_SUBSECTIONS.find((role) => role.roleId === EVAL_SEED_ROLE)?.objective ?? EVAL_SEED_ROLE;
  const contentHash = "eval-helios";
  const request = buildSeedPrompt({
    mode: "batch",
    objective,
    brief: EVAL_BRIEF,
    sources: [
      { sourceId: EVAL_SOURCE_ID, label: "Interview", kind: "transcript", content: HELIOS_INTERVIEW, contentHash },
    ],
    projection: { decisions: "(none)", feedback: "(none)" },
    writerSettings: { styleOverrides: {} },
    lengthTarget: "standard",
  });
  try {
    const response = await metered.client.messages.create({
      model,
      max_tokens: SEED_PROMPT_PROGRAM.request.maxTokens,
      system: request.system,
      tools: [
        {
          name: SEED_PROMPT_PROGRAM.request.toolName,
          description: SEED_PROMPT_PROGRAM.request.description,
          input_schema: seedToolSchema(),
        },
      ],
      tool_choice: { type: "tool", name: SEED_PROMPT_PROGRAM.request.toolName },
      messages: [{ role: "user", content: request.userBlocks }],
    });
    const block = response.content.find((item) => item.type === "tool_use");
    const input = block?.type === "tool_use" ? block.input : undefined;
    const schemaValid = hasSeedShape(input);
    const sources: FrozenSeedSource[] = [
      { sourceId: EVAL_SOURCE_ID, content: HELIOS_INTERVIEW, contentHash },
    ];
    const contract = schemaValid
      ? validateBatch({ roleId: EVAL_SEED_ROLE, mode: "batch", seeds: input.seeds, frozenSources: sources })
      : null;
    return {
      result: {
        task: "seed_batch",
        structured: true,
        schemaValid,
        contractPassed: contract?.ok ?? false,
        costUsd: metered.meter.costUsd - before,
      },
      ...(contract && contract.seeds.length > 0
        ? { judgeText: contract.seeds.map((seed) => `- ${seed.bullets.join(" ")}`).join("\n") }
        : {}),
    };
  } catch (error) {
    return {
      result: {
        task: "seed_batch",
        structured: true,
        schemaValid: false,
        contractPassed: false,
        costUsd: metered.meter.costUsd - before,
        error: errorText(error),
      },
    };
  }
}

/** One Line 242 draft through the section agent, from the fixed analysis. */
export async function runSectionDraftTask(
  metered: MeteredClient,
  model: string
): Promise<EvalOutput> {
  const before = metered.meter.costUsd;
  try {
    const text = await runSection242Agent(metered.client, HELIOS_ANALYSIS, model);
    return {
      result: {
        task: "section_draft",
        structured: false,
        schemaValid: true,
        contractPassed: text.trim().length > 0 && isDashClean(text),
        costUsd: metered.meter.costUsd - before,
      },
      judgeText: text,
    };
  } catch (error) {
    return {
      result: {
        task: "section_draft",
        structured: false,
        schemaValid: false,
        contractPassed: false,
        costUsd: metered.meter.costUsd - before,
        error: errorText(error),
      },
    };
  }
}

/**
 * The QA scorecard call on fixed sections. `runQAAgent` allows one repair,
 * so a request count above one means the first attempt was invalid.
 */
export async function runQaStructuredTask(
  metered: MeteredClient,
  model: string
): Promise<EvalOutput> {
  const before = metered.meter.costUsd;
  let requests = 0;
  const counted: GenerationClient = {
    messages: {
      create: async (params) => {
        requests += 1;
        return await metered.client.messages.create(params);
      },
    },
  };
  try {
    await runQAAgent(
      counted,
      HELIOS_ANALYSIS,
      HELIOS_SECTIONS["242"],
      HELIOS_SECTIONS["244"],
      HELIOS_SECTIONS["246"],
      model
    );
    return {
      result: {
        task: "qa_structured",
        structured: true,
        schemaValid: requests === 1,
        contractPassed: true,
        costUsd: metered.meter.costUsd - before,
      },
    };
  } catch (error) {
    return {
      result: {
        task: "qa_structured",
        structured: true,
        schemaValid: false,
        contractPassed: false,
        costUsd: metered.meter.costUsd - before,
        error: errorText(error),
      },
    };
  }
}

export const JUDGE_TOOL = "record_grade";

export const JUDGE_SYSTEM = [
  "You grade drafts written for Canadian SR&ED technical reports (CRA form T661).",
  "Grade strictly and the same way every time. Score from 1 (unusable) to 10 (ready to file).",
  "Criteria, equal weight:",
  "1. Every statement is supported by the interview. Anything invented scores low.",
  "2. It frames technological uncertainty, the work done and its results the way a CRA reviewer expects.",
  "3. It is specific: iterations, figures and outcomes, not generic claims.",
  "4. The language is plain and professional, with no marketing tone.",
].join("\n");

const JUDGE_TASK_LABEL: Record<EvalTaskKind, string> = {
  seed_batch: "Idea seeds for the technological uncertainties subsection",
  section_draft: "Line 242 draft",
  qa_structured: "QA scorecard",
};

/** 1 to 10 from the judge, or undefined when it did not return a grade. */
export async function judgeOutput(
  judge: MeteredClient,
  judgeModel: string,
  task: EvalTaskKind,
  output: string
): Promise<number | undefined> {
  try {
    const response = await judge.client.messages.create({
      model: judgeModel,
      max_tokens: 1024,
      system: JUDGE_SYSTEM,
      tools: [
        {
          name: JUDGE_TOOL,
          description: "Record the grade for the draft.",
          input_schema: {
            type: "object",
            additionalProperties: false,
            required: ["score", "reason"],
            properties: {
              score: { type: "integer", minimum: 1, maximum: 10 },
              reason: { type: "string" },
            },
          },
        },
      ],
      tool_choice: { type: "tool", name: JUDGE_TOOL },
      messages: [
        {
          role: "user",
          content: `INTERVIEW\n${HELIOS_INTERVIEW}\n\n${JUDGE_TASK_LABEL[task].toUpperCase()}\n${output}`,
        },
      ],
    });
    const block = response.content.find((item) => item.type === "tool_use");
    const score =
      block?.type === "tool_use" && block.input && typeof block.input === "object"
        ? (block.input as { score?: unknown }).score
        : undefined;
    return typeof score === "number" && Number.isFinite(score) && score >= 1 && score <= 10
      ? score
      : undefined;
  } catch (error) {
    console.warn(`Judge failed on ${task}: ${errorText(error)}`);
    return undefined;
  }
}

const TASK_RUNNERS: Record<
  EvalTaskKind,
  (metered: MeteredClient, model: string) => Promise<EvalOutput>
> = {
  seed_batch: runSeedBatchTask,
  section_draft: runSectionDraftTask,
  qa_structured: runQaStructuredTask,
};

/** Run `tasks` for one model in parallel and have the judge grade the prose. */
export async function runEvalSet(args: {
  tasks: readonly EvalTaskKind[];
  model: string;
  makeClient: (task: EvalTaskKind) => MeteredClient;
  judge: MeteredClient;
  judgeModel: string;
}): Promise<EvalTaskResult[]> {
  const outputs = await Promise.all(
    args.tasks.map((task) => TASK_RUNNERS[task](args.makeClient(task), args.model))
  );
  return await Promise.all(
    outputs.map(async ({ result, judgeText }) =>
      judgeText
        ? {
            ...result,
            ...(await judgeOutput(args.judge, args.judgeModel, result.task, judgeText).then(
              (score) => (score === undefined ? {} : { rubricScore: score })
            )),
          }
        : result
    )
  );
}

/** An unattributed, metered client for one eval call site. */
export function evalClient(
  ctx: ActionCtx,
  entry: FrozenModelEntry,
  callSite: string
): MeteredClient {
  const meter = { costUsd: 0 };
  const onUsage: UsageTap = ({ costUsd }) => {
    meter.costUsd += Number.isFinite(costUsd) ? costUsd : 0;
  };
  const client =
    entry.gateway === "openrouter"
      ? instrumentedOpenRouter(
          ctx,
          { callSite, onUsage },
          { timeoutMs: EVAL_CALL_TIMEOUT_MS, maxRetries: 0 }
        )
      : (instrumentedAnthropic(ctx, {
          callSite,
          onUsage,
          capability: "generation",
          clientOptions: { maxRetries: 0, timeout: EVAL_CALL_TIMEOUT_MS },
        }) as unknown as GenerationClient);
  return { client, meter };
}

export const runEvaluation = internalAction({
  args: { evaluationId: v.id("modelEvaluations") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const claim = await ctx.runMutation(claimEvaluationRef, { evaluationId: args.evaluationId });
    if (!claim) return null;
    registerModelEntries([claim.candidate, claim.incumbent, claim.judge].map(entryFromFrozen));
    const meters: MeteredClient[] = [];
    const metered = (entry: FrozenModelEntry, callSite: string) => {
      const client = evalClient(ctx, entry, callSite);
      meters.push(client);
      return client;
    };
    const spent = () => meters.reduce((sum, client) => sum + client.meter.costUsd, 0);
    try {
      const judge = metered(claim.judge, "model_eval:judge");
      const [candidateResults, incumbentResults] = await Promise.all(
        [claim.candidate, claim.incumbent].map((entry) =>
          runEvalSet({
            tasks: claim.tasks,
            model: entry.id,
            makeClient: (task) => metered(entry, `model_eval:${task}`),
            judge,
            judgeModel: claim.judge.id,
          })
        )
      );
      await ctx.runMutation(completeEvaluationRef, {
        evaluationId: claim.evaluationId,
        candidateResults,
        incumbentResults,
        evalCostUsd: spent(),
      });
    } catch (error) {
      await ctx.runMutation(failEvaluationRef, {
        evaluationId: claim.evaluationId,
        error: errorText(error),
        evalCostUsd: spent(),
      });
    }
    return null;
  },
});
