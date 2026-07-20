import type Anthropic from "@anthropic-ai/sdk";
import { MODEL } from "./model";
import type { GenerationClient } from "./openrouterCore";

/**
 * Get structured JSON from the model via tool-use. On Anthropic the API
 * returns the tool input already parsed and schema-valid. On OpenRouter the
 * adapter parses function-call arguments and throws a clean provider error on
 * malformed/truncated JSON (surfaces as a failed candidate run).
 */
export async function generateStructured<T>(
  // Anthropic's client matches GenerationClient on everything we use, but its
  // response type carries extra block variants (thinking etc.) that break
  // strict structural assignability — accept both and narrow at runtime.
  rawClient: GenerationClient | Anthropic,
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
  const client = rawClient as GenerationClient;
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
