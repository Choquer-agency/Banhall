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
