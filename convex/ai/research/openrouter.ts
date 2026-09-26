"use node";

import type { ActionCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { openRouterChatCompletion } from "../openrouter";
import {
  buildOpenRouterRequest,
  parseOpenRouterResearchResponse,
  type OpenRouterResearchResult,
  type ResearchRunProvider,
} from "./core";

// Deep-research providers stream internally and can run for minutes. Two
// attempts of 270 s fit the action's request window (540 s, actionDeadline.ts);
// the deadline cuts a retry short or drops it when the first attempt ran long.
export const RESEARCH_TIMEOUT_MS = 270_000;
export const RESEARCH_MAX_RETRIES = 1;

/**
 * Thin adapter over the shared OpenRouter transport (convex/ai/openrouter.ts):
 * builds the research-specific request body, posts it through the common
 * auth/error/usage path, and parses citations + server-tool usage out of the
 * raw response.
 */
export async function callOpenRouterResearch(
  ctx: ActionCtx,
  input: {
    provider: ResearchRunProvider;
    model: string;
    system: string;
    prompt: string;
    sessionId: Id<"researchSessions">;
    projectId: Id<"projects">;
    userId: Id<"users">;
  }
): Promise<OpenRouterResearchResult> {
  const body = await openRouterChatCompletion(ctx, {
    body: buildOpenRouterRequest({
      provider: input.provider,
      model: input.model,
      system: input.system,
      prompt: input.prompt,
    }),
    model: input.model,
    callSite: `contextual_research:${input.provider}`,
    projectId: input.projectId,
    userId: input.userId,
    headers: {
      "X-Title": "Banhall Contextual Research",
      "X-Session-ID": input.sessionId,
    },
    timeoutMs: RESEARCH_TIMEOUT_MS,
    maxRetries: RESEARCH_MAX_RETRIES,
  });
  return parseOpenRouterResearchResponse(body);
}
