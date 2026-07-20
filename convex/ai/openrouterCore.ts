/**
 * Pure conversion + parsing layer for the OpenRouter gateway — no Convex
 * imports so it unit-tests without a deployment. The instrumented client
 * lives in convex/ai/openrouter.ts.
 *
 * Shape contract: the generation agents are written against Anthropic's
 * `{ messages: { create } }` client. This module converts that request shape
 * to OpenRouter chat-completions and the response back to Anthropic-shaped
 * content blocks, so the agents run unchanged on either gateway.
 */

export type GenerationContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown };

export interface GenerationResponse {
  content: GenerationContentBlock[];
}

/** JSON Schema for a tool input (matches Anthropic.Tool.InputSchema). */
export type ToolInputSchema = { type: "object"; [key: string]: unknown };

export interface GenerationMessageParams {
  model: string;
  max_tokens: number;
  system?: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  tools?: Array<{
    name: string;
    description?: string;
    input_schema: ToolInputSchema;
  }>;
  tool_choice?: { type: "tool"; name: string };
}

export interface GenerationClient {
  messages: {
    create(params: GenerationMessageParams): Promise<GenerationResponse>;
  };
}

export type ChatCompletionsBody = {
  model: string;
  max_tokens: number;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  usage: { include: true };
  tools?: Array<{
    type: "function";
    function: {
      name: string;
      description?: string;
      parameters: Record<string, unknown>;
    };
  }>;
  tool_choice?: { type: "function"; function: { name: string } };
};

export function toChatCompletions(
  params: GenerationMessageParams
): ChatCompletionsBody {
  const body: ChatCompletionsBody = {
    model: params.model,
    max_tokens: params.max_tokens,
    messages: [
      ...(params.system
        ? [{ role: "system" as const, content: params.system }]
        : []),
      ...params.messages,
    ],
    usage: { include: true },
  };
  if (params.tools?.length) {
    body.tools = params.tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        ...(tool.description ? { description: tool.description } : {}),
        parameters: tool.input_schema as Record<string, unknown>,
      },
    }));
  }
  if (params.tool_choice) {
    body.tool_choice = {
      type: "function",
      function: { name: params.tool_choice.name },
    };
  }
  return body;
}

export type ChatCompletionsResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cost?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
  error?: { message?: string; code?: number };
};

export function fromChatCompletions(
  body: ChatCompletionsResponse
): GenerationResponse {
  const choice = body.choices?.[0];
  if (!choice?.message) {
    throw new Error(
      body.error?.message ?? "OpenRouter returned no completion choice"
    );
  }
  // Anthropic tool-use guarantees parsed input; chat-completions returns a
  // model-generated JSON string. A truncated response would JSON.parse-fail
  // confusingly, so surface length truncation as its own error first.
  if (choice.finish_reason === "length") {
    throw new Error(
      "OpenRouter response was truncated at the max_tokens limit before completing"
    );
  }
  const content: GenerationContentBlock[] = [];
  for (const call of choice.message.tool_calls ?? []) {
    if (!call.function?.name) continue;
    let input: unknown;
    try {
      input = JSON.parse(call.function.arguments ?? "");
    } catch {
      throw new Error(
        `OpenRouter tool call "${call.function.name}" returned malformed JSON arguments`
      );
    }
    content.push({
      type: "tool_use",
      id: call.id ?? "toolcall",
      name: call.function.name,
      input,
    });
  }
  if (typeof choice.message.content === "string" && choice.message.content) {
    content.push({ type: "text", text: choice.message.content });
  }
  if (content.length === 0) {
    throw new Error("OpenRouter returned an empty completion");
  }
  return { content };
}

/**
 * Usage extraction. Semantics note: OpenRouter's prompt_tokens INCLUDES cached
 * tokens (Anthropic's input_tokens excludes cache reads), so we subtract to
 * keep token columns consistent across gateways. Cost accuracy does not depend
 * on this split — usage.cost is the provider's exact charge.
 */
export function openRouterUsage(body: ChatCompletionsResponse): {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  costUsd?: number;
} {
  const usage = body.usage;
  const count = (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value) && value >= 0
      ? value
      : 0;
  const promptTokens = count(usage?.prompt_tokens);
  const cached = Math.min(
    count(usage?.prompt_tokens_details?.cached_tokens),
    promptTokens
  );
  const cost = usage?.cost;
  return {
    inputTokens: promptTokens - cached,
    outputTokens: count(usage?.completion_tokens),
    cacheReadInputTokens: cached,
    ...(typeof cost === "number" && Number.isFinite(cost) && cost >= 0
      ? { costUsd: cost }
      : {}),
  };
}
