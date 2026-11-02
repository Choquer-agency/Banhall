"use node";

/**
 * The public background step before drafting (2026-11-02, proposed). Called
 * by `generateReport` (Single draft and Compare) and by
 * `prepareSeedDraftingInputs` (Step by step), beside the Brain retrieval
 * and the analysis. It never throws and never fails a draft: whatever goes
 * wrong, the draft continues without background and the generation records
 * why (`generations.webBackground`).
 *
 * Order: the writer's choice and the deployment setting; the cache for this
 * project and these sources; one small model call (the frozen retrieval
 * brief model, names hidden by the generation's placeholder wrapper) that
 * writes up to three general queries; the guard (`guardDraftWebQueries`);
 * the searches in parallel through the chat web search's request; the
 * block. The whole step is bounded by DRAFT_WEB_BUDGET_MS.
 */
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { makeFunctionReference, type FunctionReference, type RegisteredMutation, type RegisteredQuery } from "convex/server";
import type * as draftWebBackgrounds from "../draftWebBackgrounds";
import { z } from "zod";
import { openRouterChatCompletion } from "./openrouter";
import { parseOpenRouterResearchResponse } from "./research/core";
import { safeErrorDetails } from "../lib/safeErrorDetails";
import { generateStructured } from "./structured";
import type { GenerationClient } from "./openrouterCore";
import {
  CHAT_WEB_SEARCH_MODEL,
  buildChatWebSearchRequest,
  cleanWebSource,
  type CleanWebSource,
} from "./chatWebSearch";
import {
  DRAFT_WEB_BUDGET_MS,
  DRAFT_WEB_MAX_QUERIES,
  DRAFT_WEB_MAX_SOURCES_PER_QUERY,
  DRAFT_WEB_QUERIES_MAX_TOKENS,
  DRAFT_WEB_QUERIES_SYSTEM,
  DRAFT_WEB_QUERIES_TOOL,
  DRAFT_WEB_QUERIES_TOOL_SCHEMA,
  DRAFT_WEB_SEARCH_CALL_SITE,
  DRAFT_WEB_SEARCH_TIMEOUT_MS,
  draftWebAnswersText,
  draftWebFingerprint,
  draftWebQueriesUserMessage,
  draftWebSources,
  formatDraftWebBackgroundBlock,
  guardDraftWebQueries,
  numberDraftWebResults,
  type DraftWebBackgroundRecord,
  type DraftWebQuery,
  type DraftWebResult,
} from "./draftWebBackground";
import { deploymentDraftWebBackgroundOn } from "../lib/draftWebBackgroundSetting";

type QueryRef<Export> =
  Export extends RegisteredQuery<infer Visibility, infer Args, infer Return>
    ? FunctionReference<"query", Visibility, Args, Awaited<Return>>
    : never;
type MutationRef<Export> =
  Export extends RegisteredMutation<infer Visibility, infer Args, infer Return>
    ? FunctionReference<"mutation", Visibility, Args, Awaited<Return>>
    : never;

/**
 * convex/draftWebBackgrounds.ts is new, and `convex/_generated/api.d.ts`
 * lists a module only after codegen, which needs a deployment. Typed from
 * the registered exports, as chatWebSearch.ts does; interchangeable with
 * `draftWebBackgroundRefs.*` once codegen runs.
 */
export const draftWebBackgroundRefs = {
  webBackgroundContext: makeFunctionReference("draftWebBackgrounds:webBackgroundContext") as unknown as QueryRef<
    typeof draftWebBackgrounds.webBackgroundContext
  >,
  getCachedBackground: makeFunctionReference("draftWebBackgrounds:getCachedBackground") as unknown as QueryRef<
    typeof draftWebBackgrounds.getCachedBackground
  >,
  saveCachedBackground: makeFunctionReference("draftWebBackgrounds:saveCachedBackground") as unknown as MutationRef<
    typeof draftWebBackgrounds.saveCachedBackground
  >,
  recordWebBackground: makeFunctionReference("draftWebBackgrounds:recordWebBackground") as unknown as MutationRef<
    typeof draftWebBackgrounds.recordWebBackground
  >,
};

/** What the drafter gets: the block (empty when none), its answers for the Self-check, and the record. */
export type DraftWebBackgroundOutcome = {
  block: string;
  answers: string;
  record: DraftWebBackgroundRecord;
};

/** Test seams: the model call and the search, replaced in tests. */
export type DraftWebBackgroundDeps = {
  writeQueries: (sources: string) => Promise<unknown[]>;
  search: (query: string, timeoutMs: number) => Promise<{ answer: string; sources: CleanWebSource[] } | null>;
  now: () => number;
  /** The whole step's budget; DRAFT_WEB_BUDGET_MS unless a test sets it. */
  budgetMs?: number;
};

const queriesSchema = z.object({
  queries: z
    .array(z.object({ query: z.string(), kind: z.string().optional() }))
    .max(10),
});

class TimedOut extends Error {}

function withBudget<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new TimedOut("budget")), Math.max(0, ms));
    }),
  ]).finally(() => clearTimeout(timer));
}

/** The production seams: the frozen retrieval brief model, and OpenRouter's native web search. */
export function draftWebBackgroundDeps(
  ctx: ActionCtx,
  input: {
    queriesClient: GenerationClient;
    queriesModel: string;
    projectId: Id<"projects">;
    generationId: Id<"generations">;
    userId?: Id<"users">;
  }
): DraftWebBackgroundDeps {
  return {
    writeQueries: async (sources) => {
      const answer = await generateStructured<{ queries: Array<{ query: string; kind?: string }> }>(
        input.queriesClient,
        {
          system: DRAFT_WEB_QUERIES_SYSTEM,
          user: draftWebQueriesUserMessage(sources),
          toolName: DRAFT_WEB_QUERIES_TOOL,
          description: DRAFT_WEB_QUERIES_TOOL_SCHEMA.description,
          schema: DRAFT_WEB_QUERIES_TOOL_SCHEMA.input_schema,
          maxTokens: DRAFT_WEB_QUERIES_MAX_TOKENS,
          model: input.queriesModel,
          validate: queriesSchema,
          attempts: 1,
        }
      );
      return answer.queries;
    },
    search: async (query, timeoutMs) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const body = await openRouterChatCompletion(ctx, {
          body: buildChatWebSearchRequest(query, new Date().toISOString().slice(0, 10)),
          model: CHAT_WEB_SEARCH_MODEL,
          callSite: DRAFT_WEB_SEARCH_CALL_SITE,
          projectId: input.projectId,
          ...(input.userId ? { userId: input.userId } : {}),
          attribution: { generationId: input.generationId },
          headers: { "X-Title": "Banhall Draft Background" },
          timeoutMs,
          maxRetries: 0,
          signal: controller.signal,
        });
        const parsed = parseOpenRouterResearchResponse(body);
        return {
          answer: parsed.text,
          sources: parsed.citations
            .flatMap((citation) => cleanWebSource({ url: citation.url, title: citation.title }) ?? [])
            .slice(0, DRAFT_WEB_MAX_SOURCES_PER_QUERY),
        };
      } catch (error) {
        console.error("draft web background search failed", safeErrorDetails(error));
        return null;
      } finally {
        clearTimeout(timer);
      }
    },
    now: () => Date.now(),
  };
}

function outcome(record: DraftWebBackgroundRecord, results: readonly DraftWebResult[] = []): DraftWebBackgroundOutcome {
  if (record.status !== "used") return { block: "", answers: "", record };
  return { block: formatDraftWebBackgroundBlock(results), answers: draftWebAnswersText(results), record };
}

function usedRecord(
  results: readonly DraftWebResult[],
  queries: readonly DraftWebQuery[],
  droppedQueries: number,
  cached: boolean
): DraftWebBackgroundRecord {
  return {
    status: "used",
    queries: queries.map((query) => ({
      query: query.query,
      kind: query.kind,
      status: results.find((result) => result.query === query.query)?.status ?? "failed",
    })),
    sources: draftWebSources(numberDraftWebResults(results)),
    droppedQueries,
    cached,
  };
}

/**
 * Runs the step and records it on the generation. `sources` is the raw
 * text the queries are written from (the analyzer's bounded input, built
 * from the frozen sources); the query client hides names in it, and its
 * hash is the cache key. Never throws.
 */
export async function runDraftWebBackground(
  ctx: ActionCtx,
  input: {
    generationId: Id<"generations">;
    projectId: Id<"projects">;
    sources: string;
    deps: DraftWebBackgroundDeps;
    log?: (line: string) => Promise<unknown>;
  }
): Promise<DraftWebBackgroundOutcome> {
  const result = await draftWebBackgroundOutcome(ctx, input);
  try {
    await ctx.runMutation(draftWebBackgroundRefs.recordWebBackground, {
      generationId: input.generationId,
      record: result.record,
    });
  } catch (error) {
    console.error("draft web background record failed", safeErrorDetails(error));
  }
  if (input.log) {
    const line =
      result.record.status === "used"
        ? `Using public background from ${result.record.sources.length} web source(s)${result.record.cached ? " saved from an earlier draft of these sources" : ""}.`
        : result.record.status === "off_for_run" || result.record.status === "off_for_deployment"
          ? null
          : "Drafting without public background: the web lookup did not return anything usable.";
    if (line) await input.log(line).catch(() => undefined);
  }
  return result;
}

/** The step without its record, for tests. Never throws. */
export async function draftWebBackgroundOutcome(
  ctx: Pick<ActionCtx, "runQuery" | "runMutation">,
  input: {
    generationId: Id<"generations">;
    projectId: Id<"projects">;
    sources: string;
    deps: DraftWebBackgroundDeps;
    deploymentOn?: boolean;
  }
): Promise<DraftWebBackgroundOutcome> {
  const empty = { queries: [], sources: [], droppedQueries: 0, cached: false };
  const started = input.deps.now();
  const budget = input.deps.budgetMs ?? DRAFT_WEB_BUDGET_MS;
  const left = () => budget - (input.deps.now() - started);
  try {
    const context = await ctx.runQuery(draftWebBackgroundRefs.webBackgroundContext, {
      generationId: input.generationId,
    });
    if (!context) return outcome({ status: "failed", ...empty, reason: "The project could not be read." });
    if (!context.requested) return outcome({ status: "off_for_run", ...empty });
    if (!(input.deploymentOn ?? deploymentDraftWebBackgroundOn())) {
      return outcome({ status: "off_for_deployment", ...empty });
    }

    const fingerprint = await draftWebFingerprint(input.sources);
    const cached = await ctx.runQuery(draftWebBackgroundRefs.getCachedBackground, {
      projectId: input.projectId,
      fingerprint,
    });
    if (cached && numberDraftWebResults(cached.results).length > 0) {
      const queries: DraftWebQuery[] = cached.results.map((result: DraftWebResult) => ({
        query: result.query,
        kind: result.kind,
      }));
      return outcome(usedRecord(cached.results, queries, cached.droppedQueries, true), cached.results);
    }

    let raw: unknown[];
    try {
      raw = await withBudget(input.deps.writeQueries(input.sources), left());
    } catch (error) {
      if (error instanceof TimedOut) {
        return outcome({ status: "timed_out", ...empty, reason: "Writing the searches took too long." });
      }
      console.error("draft web background queries failed", safeErrorDetails(error));
      return outcome({ status: "failed", ...empty, reason: "The searches could not be written." });
    }
    const guarded = guardDraftWebQueries(
      raw.filter((item): item is { query: unknown; kind?: unknown } => Boolean(item) && typeof item === "object"),
      context.identity
    );
    const queries = guarded.kept.slice(0, DRAFT_WEB_MAX_QUERIES);
    const droppedQueries = guarded.dropped.length;
    if (queries.length === 0) return outcome({ status: "no_queries", ...empty, droppedQueries });

    const timeoutMs = Math.min(DRAFT_WEB_SEARCH_TIMEOUT_MS, left());
    if (timeoutMs < Math.min(5_000, budget / 4)) {
      return outcome({ status: "timed_out", ...empty, droppedQueries, reason: "No time was left for the searches." });
    }
    const settled = await Promise.all(
      queries.map(async (query): Promise<DraftWebResult> => {
        const found = await withBudget(input.deps.search(query.query, timeoutMs), timeoutMs + 1_000).catch(() => null);
        return found && found.answer.trim()
          ? { ...query, status: "ok", answer: found.answer, sources: found.sources }
          : { ...query, status: "failed", answer: "", sources: [] };
      })
    );
    if (numberDraftWebResults(settled).length === 0) {
      return outcome({
        status: "failed",
        queries: queries.map(({ query, kind }) => ({ query, kind, status: "failed" as const })),
        sources: [],
        droppedQueries,
        cached: false,
        reason: "No search returned a usable answer with a source.",
      });
    }
    try {
      await ctx.runMutation(draftWebBackgroundRefs.saveCachedBackground, {
        projectId: input.projectId,
        fingerprint,
        results: settled,
        droppedQueries,
      });
    } catch (error) {
      console.error("draft web background cache save failed", safeErrorDetails(error));
    }
    return outcome(usedRecord(settled, queries, droppedQueries, false), settled);
  } catch (error) {
    console.error("draft web background failed", safeErrorDetails(error));
    return outcome({ status: "failed", ...empty, reason: "The web lookup hit an error." });
  }
}
