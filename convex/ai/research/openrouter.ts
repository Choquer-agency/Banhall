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

// Deep-research providers stream internally and can run for minutes.
const RESEARCH_TIMEOUT_MS = 8 * 60 * 1_000;

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
  });
  return parseOpenRouterResearchResponse(body);
}
