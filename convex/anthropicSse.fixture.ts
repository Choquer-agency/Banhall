/**
 * Test fixture: an Anthropic Messages API server-sent event stream for a
 * tool answer, as the API sends it with `stream: true` (message_start, the
 * tool_use block, its input as `input_json_delta` pieces, message_delta with
 * the stop reason and output tokens, message_stop). Used by the SDK-boundary
 * suites with `fetch` stubbed. No Convex functions here.
 */
export function anthropicToolSse(options: {
  model: string;
  tool: string;
  input: unknown;
  /** Characters per input_json_delta piece. */
  chunk?: number;
  usage?: { input_tokens: number; output_tokens: number };
  stopReason?: string;
}): string {
  const json = JSON.stringify(options.input);
  const chunk = options.chunk ?? 24;
  const usage = options.usage ?? { input_tokens: 40, output_tokens: 8 };
  const events: Array<[string, unknown]> = [
    [
      "message_start",
      {
        type: "message_start",
        message: {
          id: "msg_synthetic_stream",
          type: "message",
          role: "assistant",
          model: options.model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: usage.input_tokens, output_tokens: 1 },
        },
      },
    ],
    [
      "content_block_start",
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: `toolu_${options.tool}`, name: options.tool, input: {} },
      },
    ],
  ];
  for (let at = 0; at < json.length; at += chunk) {
    events.push([
      "content_block_delta",
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: json.slice(at, at + chunk) },
      },
    ]);
  }
  events.push(
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    [
      "message_delta",
      {
        type: "message_delta",
        delta: { stop_reason: options.stopReason ?? "tool_use", stop_sequence: null },
        usage: { output_tokens: usage.output_tokens },
      },
    ],
    ["message_stop", { type: "message_stop" }]
  );
  return events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join("");
}

export function sseResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

type MessageBlock = { type: string; [key: string]: unknown };

/**
 * 2026-10-26: the server-sent events of a whole Messages API answer, as the
 * API streams it: message_start, each content block (text as text_delta and
 * one citations_delta per citation, tool input as input_json_delta,
 * thinking as thinking_delta and signature_delta), then message_delta with
 * the stop reason and output tokens, and message_stop.
 */
export function anthropicMessageSse(message: {
  id?: string;
  model?: string;
  content?: MessageBlock[];
  stop_reason?: string | null;
  stop_sequence?: string | null;
  usage?: Record<string, unknown>;
  [key: string]: unknown;
}): string {
  const usage = message.usage ?? { input_tokens: 40, output_tokens: 8 };
  const { content = [], stop_reason, stop_sequence, ...rest } = message;
  const events: Array<[string, unknown]> = [
    [
      "message_start",
      {
        type: "message_start",
        message: {
          id: "msg_synthetic_stream",
          type: "message",
          role: "assistant",
          ...rest,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { ...usage, output_tokens: 1 },
        },
      },
    ],
  ];
  content.forEach((block, index) => {
    if (block.type === "tool_use") {
      events.push(["content_block_start", { type: "content_block_start", index, content_block: { ...block, input: {} } }]);
      const json = JSON.stringify(block.input ?? {});
      for (let at = 0; at < json.length; at += 512) {
        events.push([
          "content_block_delta",
          { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: json.slice(at, at + 512) } },
        ]);
      }
    } else if (block.type === "text") {
      const { text = "", citations, ...head } = block as { text?: string; citations?: unknown };
      events.push(["content_block_start", { type: "content_block_start", index, content_block: { ...head, text: "" } }]);
      if (typeof text === "string" && text) {
        events.push(["content_block_delta", { type: "content_block_delta", index, delta: { type: "text_delta", text } }]);
      }
      for (const citation of Array.isArray(citations) ? citations : []) {
        events.push(["content_block_delta", { type: "content_block_delta", index, delta: { type: "citations_delta", citation } }]);
      }
    } else if (block.type === "thinking") {
      const { thinking = "", signature, ...head } = block as { thinking?: string; signature?: unknown };
      events.push(["content_block_start", { type: "content_block_start", index, content_block: { ...head, thinking: "" } }]);
      if (typeof thinking === "string" && thinking) {
        events.push(["content_block_delta", { type: "content_block_delta", index, delta: { type: "thinking_delta", thinking } }]);
      }
      if (typeof signature === "string") {
        events.push(["content_block_delta", { type: "content_block_delta", index, delta: { type: "signature_delta", signature } }]);
      }
    } else {
      events.push(["content_block_start", { type: "content_block_start", index, content_block: block }]);
    }
    events.push(["content_block_stop", { type: "content_block_stop", index }]);
  });
  events.push(
    [
      "message_delta",
      {
        type: "message_delta",
        delta: { stop_reason: stop_reason ?? "end_turn", stop_sequence: stop_sequence ?? null },
        usage: { output_tokens: (usage as { output_tokens?: number }).output_tokens ?? 8 },
      },
    ],
    ["message_stop", { type: "message_stop" }]
  );
  return events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join("");
}

/** Whether a stubbed fetch call sent a request with `stream: true`. */
function asksToStream(init: unknown): boolean {
  const body = (init as { body?: unknown } | undefined)?.body;
  if (typeof body !== "string") return false;
  try {
    return (JSON.parse(body) as { stream?: unknown }).stream === true;
  } catch {
    return false;
  }
}

/**
 * 2026-10-26: wraps a fetch stub so a request sent with `stream: true` (a
 * request for a large answer streams, instrument.ts sendsLargeAnswer) gets
 * the stub's JSON message as a server-sent event stream; every other
 * response passes through unchanged.
 */
export function streamWhenAsked<F extends (...args: never[]) => Promise<Response>>(stub: F): F {
  return (async (...args: Parameters<F>) => {
    const response = await stub(...args);
    if (!asksToStream(args[1]) || !response.ok) return response;
    if (!(response.headers.get("content-type") ?? "").includes("json")) return response;
    const message = (await response.clone().json()) as { type?: string };
    if (message?.type !== "message") return response;
    return sseResponse(anthropicMessageSse(message as Parameters<typeof anthropicMessageSse>[0]));
  }) as F;
}

/**
 * 2026-10-26: `vi.stubGlobal("fetch", stub)` with `stub` wrapped in
 * streamWhenAsked, for suites whose stubs answer requests that now stream
 * for their size. Takes `vi` so this fixture does not import vitest.
 */
export function stubFetchStreaming(
  vi: { stubGlobal(name: string, value: unknown): unknown },
  stub: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> | Response
): unknown {
  return vi.stubGlobal(
    "fetch",
    streamWhenAsked(async (input: RequestInfo | URL, init?: RequestInit) => await stub(input, init))
  );
}
