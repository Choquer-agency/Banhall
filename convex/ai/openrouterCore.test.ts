import { describe, expect, it } from "vitest";
import {
  toChatCompletions,
  fromChatCompletions,
  requireTextResponse,
  openRouterUsage,
} from "./openrouterCore";
import {
  CANDIDATE_MODELS,
  PROVIDER_LOGOS,
  gatewayForModel,
  comparePairFromSlots,
  maxTokensWithReasoningHeadroom,
  sectionAnswerTokenBudget,
} from "../../shared/generationModels";

describe("toChatCompletions", () => {
  it("prepends system as a system message and passes tokens through", () => {
    const body = toChatCompletions({
      model: "claude-sonnet-5",
      max_tokens: 4096,
      system: "You are an SR&ED writer.",
      messages: [{ role: "user", content: "Draft section 242." }],
    });
    expect(body.messages[0]).toEqual({
      role: "system",
      content: "You are an SR&ED writer.",
    });
    expect(body.messages[1].role).toBe("user");
    expect(body.max_tokens).toBe(4096);
    expect(body.usage).toEqual({ include: true });
    expect(body.tools).toBeUndefined();
  });

  it("converts Anthropic tools + tool_choice to function calling", () => {
    const schema = { type: "object" as const, properties: { score: { type: "number" } } };
    const body = toChatCompletions({
      model: "google/gemini-3.1-pro-preview",
      max_tokens: 8192,
      messages: [{ role: "user", content: "Analyze." }],
      tools: [{ name: "submit_analysis", description: "Submit it", input_schema: schema }],
      tool_choice: { type: "tool", name: "submit_analysis" },
    });
    expect(body.tools).toEqual([
      {
        type: "function",
        function: { name: "submit_analysis", description: "Submit it", parameters: schema },
      },
    ]);
    expect(body.tool_choice).toEqual({
      type: "function",
      function: { name: "submit_analysis" },
    });
  });

  it("scales max_tokens for mandatory-reasoning models and leaves others alone", () => {
    // Gemini's reasoning tokens share the output budget, so 4096 answer tokens
    // must be sent as 16384 or the model truncates before answering.
    for (const id of ["google/gemini-3.5-flash", "google/gemini-3.1-pro-preview"]) {
      expect(toChatCompletions({
        model: id,
        max_tokens: 4096,
        messages: [{ role: "user", content: "Draft." }],
      }).max_tokens).toBe(16384);
    }
    // GPT-5.6 also reasons against the output budget — it must be scaled too,
    // or its section agents truncate exactly like Gemini did.
    expect(toChatCompletions({
      model: "openai/gpt-5.6-sol",
      max_tokens: 4096,
      messages: [{ role: "user", content: "Draft." }],
    }).max_tokens).toBe(16384);
    // Anthropic-gateway models pass through untouched.
    expect(toChatCompletions({
      model: "claude-sonnet-5",
      max_tokens: 8192,
      messages: [{ role: "user", content: "Draft." }],
    }).max_tokens).toBe(8192);
  });
});

describe("sectionAnswerTokenBudget", () => {
  it("gives direct Anthropic sections more room without double-inflating OpenRouter", () => {
    expect(sectionAnswerTokenBudget("claude-sonnet-5")).toBe(8192);
    expect(sectionAnswerTokenBudget("claude-opus-4-8")).toBe(8192);
    expect(sectionAnswerTokenBudget("google/gemini-3.1-pro-preview")).toBe(4096);
  });
});

describe("maxTokensWithReasoningHeadroom", () => {
  it("clamps the scaled budget to the model's completion cap", () => {
    expect(maxTokensWithReasoningHeadroom("google/gemini-3.5-flash", 8192)).toBe(32768);
    expect(maxTokensWithReasoningHeadroom("google/gemini-3.5-flash", 20000)).toBe(65536);
  });

  it("passes through unknown ids unchanged", () => {
    expect(maxTokensWithReasoningHeadroom("some-legacy-model", 4096)).toBe(4096);
  });

  it("scales every OpenRouter model, since all current ones reason", () => {
    // Seven consecutive generations failed because a reasoning model's budget
    // was not scaled. Any OpenRouter entry missing the fields is now a compile
    // error; this asserts the runtime behaviour matches.
    expect(maxTokensWithReasoningHeadroom("openai/gpt-5.6-luna", 4096)).toBe(16384);
    expect(maxTokensWithReasoningHeadroom("openai/gpt-5.6-sol", 4096)).toBe(16384);
    expect(maxTokensWithReasoningHeadroom("google/gemini-3.1-pro-preview", 4096)).toBe(16384);
  });
});

describe("fromChatCompletions", () => {
  it("maps text content to an Anthropic-shaped text block", () => {
    const res = fromChatCompletions({
      choices: [{ message: { content: "The draft text." }, finish_reason: "stop" }],
    });
    expect(res.content).toEqual([{ type: "text", text: "The draft text." }]);
  });

  it("parses tool_calls arguments into tool_use blocks", () => {
    const res = fromChatCompletions({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: "call_1",
                function: { name: "submit_analysis", arguments: '{"score": 9}' },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    });
    expect(res.content).toEqual([
      { type: "tool_use", id: "call_1", name: "submit_analysis", input: { score: 9 } },
    ]);
  });

  it("throws a descriptive error on malformed tool arguments", () => {
    expect(() =>
      fromChatCompletions({
        choices: [
          {
            message: {
              tool_calls: [{ function: { name: "submit", arguments: "{broken" } }],
            },
          },
        ],
      })
    ).toThrow(/malformed JSON/);
  });

  it("throws on length truncation before attempting JSON.parse", () => {
    expect(() =>
      fromChatCompletions({
        choices: [
          {
            message: {
              tool_calls: [{ function: { name: "submit", arguments: '{"a":' } }],
            },
            finish_reason: "length",
          },
        ],
      })
    ).toThrow(/truncated/);
  });

  it("reads text after a leading non-text block and reports the stop reason", () => {
    expect(
      requireTextResponse(
        {
          content: [
            { type: "tool_use", id: "thinking", name: "reasoning", input: {} },
            { type: "text", text: "  usable answer  " },
          ],
          stop_reason: "end_turn",
        },
        "Section 244 agent"
      )
    ).toBe("usable answer");

    expect(() =>
      requireTextResponse(
        { content: [], stop_reason: "max_tokens" },
        "Section 244 agent"
      )
    ).toThrow(/stop reason: max_tokens/);
  });

  it("throws on empty responses with the provider message when present", () => {
    expect(() => fromChatCompletions({ error: { message: "moderation flagged" } })).toThrow(
      /moderation flagged/
    );
    expect(() =>
      fromChatCompletions({ choices: [{ message: { content: "" } }] })
    ).toThrow(/empty completion/);
  });
});

describe("openRouterUsage", () => {
  it("subtracts cached tokens from prompt tokens and passes native cost", () => {
    const usage = openRouterUsage({
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 400,
        cost: 0.0123,
        prompt_tokens_details: { cached_tokens: 300 },
      },
    });
    expect(usage).toEqual({
      inputTokens: 700,
      outputTokens: 400,
      cacheReadInputTokens: 300,
      costUsd: 0.0123,
    });
  });

  it("omits costUsd when absent or invalid and tolerates garbage", () => {
    expect(openRouterUsage({ usage: { prompt_tokens: 10, completion_tokens: 5 } })).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      cacheReadInputTokens: 0,
    });
    expect(openRouterUsage({})).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
    });
    expect(
      openRouterUsage({
        usage: { prompt_tokens: -5, completion_tokens: NaN, cost: -1 },
      })
    ).toEqual({ inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0 });
  });

  it("never reports cached tokens above prompt tokens", () => {
    const usage = openRouterUsage({
      usage: {
        prompt_tokens: 100,
        completion_tokens: 1,
        prompt_tokens_details: { cached_tokens: 500 },
      },
    });
    expect(usage.inputTokens).toBe(0);
    expect(usage.cacheReadInputTokens).toBe(100);
  });
});

describe("model registry invariants", () => {
  it("has unique ids and a logo for every provider", () => {
    const ids = CANDIDATE_MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of CANDIDATE_MODELS) {
      expect(PROVIDER_LOGOS[m.provider], `missing logo for ${m.provider}`).toBeTruthy();
    }
  });

  it("routes gateways correctly, defaulting unknown ids to anthropic", () => {
    expect(gatewayForModel("claude-sonnet-4-6")).toBe("anthropic");
    expect(gatewayForModel("openai/gpt-5.6-sol")).toBe("openrouter");
    expect(gatewayForModel("google/gemini-3.5-flash")).toBe("openrouter");
    expect(gatewayForModel("some-legacy-model")).toBe("anthropic");
  });

  it("random compare fill draws Anthropic models only", () => {
    for (let i = 0; i < 25; i++) {
      const pair = comparePairFromSlots("openai/gpt-5.6-sol", "");
      expect(pair).toHaveLength(2);
      expect(gatewayForModel(pair![1])).toBe("anthropic");
    }
  });
});
