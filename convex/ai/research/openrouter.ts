"use node";

import type { ActionCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { requireOpenRouterConfigured } from "../../lib/providerConfig";
import { scheduleUsage } from "../instrument";
import {
  buildOpenRouterRequest,
  parseOpenRouterResearchResponse,
  type OpenRouterResearchResult,
  type ResearchRunProvider,
} from "./core";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const RESEARCH_TIMEOUT_MS = 8 * 60 * 1_000;

export class ResearchOpenRouterError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ResearchOpenRouterError";
    this.status = status;
  }
}

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
  const apiKey = requireOpenRouterConfigured();
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://banhall.app",
      "X-Title": "Banhall Contextual Research",
      "X-Session-ID": input.sessionId,
    },
    body: JSON.stringify(
      buildOpenRouterRequest({
        provider: input.provider,
        model: input.model,
        system: input.system,
        prompt: input.prompt,
      })
    ),
    signal: AbortSignal.timeout(RESEARCH_TIMEOUT_MS),
  });
  const raw: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      raw && typeof raw === "object" && "error" in raw && raw.error &&
      typeof raw.error === "object" && "message" in raw.error &&
      typeof raw.error.message === "string"
        ? raw.error.message
        : `OpenRouter research request failed with status ${response.status}`;
    throw new ResearchOpenRouterError(message, response.status);
  }
  const result = parseOpenRouterResearchResponse(raw);
  await scheduleUsage(ctx, {
    projectId: input.projectId,
    userId: input.userId,
    callSite: `contextual_research:${input.provider}`,
    model: input.model,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    ...(result.usage.costUsd !== undefined ? { costUsd: result.usage.costUsd } : {}),
  });
  return result;
}
