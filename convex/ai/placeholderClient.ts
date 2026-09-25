/**
 * Owner decision 26: every model, Claude included, reads placeholders
 * instead of the names on the project record, and every output is restored
 * before anything stores or shows it. This wraps any GenerationClient so
 * that holds at the provider boundary: the request's system prompt and
 * message text are pseudonymized, and the response's text blocks and tool
 * inputs are restored. Tool schemas are static and pass through untouched.
 *
 * A map is deterministic per generation (frozen on the generation), so the
 * pseudonymized prefix stays byte-stable and prompt caching is unaffected.
 */
import {
  pseudonymize,
  restorePlaceholders,
  restorePlaceholdersDeep,
  type PlaceholderMap,
} from "../lib/deidentify";
import type {
  GenerationClient,
  GenerationMessageContent,
  GenerationMessageParams,
  GenerationResponse,
} from "./openrouterCore";

function pseudonymizeContent(content: GenerationMessageContent, map: PlaceholderMap): GenerationMessageContent {
  return typeof content === "string"
    ? pseudonymize(content, map)
    : content.map((block) => ({ ...block, text: pseudonymize(block.text, map) }));
}

/** The request as the model sees it. */
export function pseudonymizeRequest(
  params: GenerationMessageParams,
  map: PlaceholderMap
): GenerationMessageParams {
  if (map.length === 0) return params;
  return {
    ...params,
    ...(typeof params.system === "string" ? { system: pseudonymize(params.system, map) } : {}),
    messages: params.messages.map((message) => ({
      ...message,
      content: pseudonymizeContent(message.content, map),
    })),
  };
}

/** The response as the app sees it. */
export function restoreResponse<R extends GenerationResponse>(response: R, map: PlaceholderMap): R {
  if (map.length === 0) return response;
  return {
    ...response,
    content: response.content.map((block) =>
      block.type === "text"
        ? { ...block, text: restorePlaceholders(block.text, map) }
        : block.type === "tool_use"
          ? { ...block, input: restorePlaceholdersDeep(block.input, map) }
          : block
    ),
  };
}

export function withPlaceholders(client: GenerationClient, map: PlaceholderMap): GenerationClient {
  if (map.length === 0) return client;
  return {
    messages: {
      create: async (params) =>
        restoreResponse(await client.messages.create(pseudonymizeRequest(params, map)), map),
    },
  };
}
