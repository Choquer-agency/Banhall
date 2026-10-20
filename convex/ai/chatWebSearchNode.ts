"use node";

/**
 * The report chat's web search request (owner decision 2026-10-19). The tool
 * body (convex/ai/chatWebSearch.ts, default runtime) removes every name from
 * the query first; this action only sends it, through the shared OpenRouter
 * transport, which logs the call's usage and cost under
 * CHAT_WEB_SEARCH_CALL_SITE. One attempt, bounded by the caller's timeout.
 */
import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { openRouterChatCompletion } from "./openrouter";
import { parseOpenRouterResearchResponse } from "./research/core";
import {
  CHAT_WEB_SEARCH_CALL_SITE,
  CHAT_WEB_SEARCH_MAX_QUERY_CHARS,
  CHAT_WEB_SEARCH_MIN_TIMEOUT_MS,
  CHAT_WEB_SEARCH_MODEL,
  CHAT_WEB_SEARCH_TIMEOUT_MS,
  MAX_WEB_SEARCH_SOURCES,
  buildChatWebSearchRequest,
  cleanWebSource,
} from "./chatWebSearch";

export const searchWebForChat = internalAction({
  args: {
    /** Already stripped of names by `prepareWebSearchQuery`. */
    query: v.string(),
    projectId: v.id("projects"),
    userId: v.id("users"),
    timeoutMs: v.number(),
  },
  returns: v.object({
    answer: v.string(),
    // Phase B: only http and https links, credentials removed, a plain
    // title and the link's host (`cleanWebSource`).
    sources: v.array(v.object({ url: v.string(), title: v.string(), domain: v.string() })),
  }),
  handler: async (ctx, args) => {
    const query = args.query.trim();
    if (!query || query.length > CHAT_WEB_SEARCH_MAX_QUERY_CHARS) {
      throw new Error("Web search query is empty or too long");
    }
    const body = await openRouterChatCompletion(ctx, {
      body: buildChatWebSearchRequest(query, new Date().toISOString().slice(0, 10)),
      model: CHAT_WEB_SEARCH_MODEL,
      callSite: CHAT_WEB_SEARCH_CALL_SITE,
      projectId: args.projectId,
      userId: args.userId,
      headers: { "X-Title": "Banhall Chat Web Search" },
      timeoutMs: Math.min(
        CHAT_WEB_SEARCH_TIMEOUT_MS,
        Math.max(CHAT_WEB_SEARCH_MIN_TIMEOUT_MS, args.timeoutMs)
      ),
      maxRetries: 0,
    });
    const parsed = parseOpenRouterResearchResponse(body);
    return {
      answer: parsed.text,
      sources: parsed.citations
        .flatMap((citation) => cleanWebSource({ url: citation.url, title: citation.title }) ?? [])
        .slice(0, MAX_WEB_SEARCH_SOURCES),
    };
  },
});
