import type Anthropic from "@anthropic-ai/sdk";
import { MODEL } from "./model";

/**
 * Get structured JSON from the model via tool-use. The Anthropic API returns
 * the tool input already parsed and schema-valid, so there is no fragile
 * `JSON.parse` of free text (which was throwing on large/edge-case outputs).
 */
export async function generateStructured<T>(
  client: Anthropic,
  opts: {
    system: string;
    user: string;
    toolName: string;
    description: string;
    schema?: Anthropic.Tool.InputSchema;
    maxTokens?: number;
    model?: string;
  }
): Promise<T> {
  const res = await client.messages.create({
    model: opts.model ?? MODEL,
    max_tokens: opts.maxTokens ?? 8192,
    system: opts.system,
    tools: [
      {
        name: opts.toolName,
        description: opts.description,
        input_schema: opts.schema ?? { type: "object" },
      },
    ],
    tool_choice: { type: "tool", name: opts.toolName },
    messages: [{ role: "user", content: opts.user }],
  });

  for (const block of res.content) {
    if (block.type === "tool_use") return block.input as T;
  }
  throw new Error(`${opts.toolName}: model did not return structured output`);
}
