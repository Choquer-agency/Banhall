import type Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { MODEL } from "./model";
import type { GenerationClient } from "./openrouterCore";

/**
 * Models sometimes wrap their tool output in a JSON string — occasionally more
 * than once. A chronology table came back as `{ entries: "{\"entries\":[…]}" }`,
 * which the UI then called `.filter()` on and took the whole report page down.
 * Unwrap before validating so a cosmetically-encoded but otherwise correct
 * result is accepted rather than discarded.
 */
function unwrapEncodedJson(value: unknown, depth = 0): unknown {
  if (typeof value !== "string" || depth >= 3) return value;
  const trimmed = value.trim();
  // `"` covers the doubly-encoded case, where the outer parse yields another
  // JSON string rather than an object.
  const looksEncoded =
    trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed.startsWith('"');
  if (!looksEncoded) return value;
  try {
    return unwrapEncodedJson(JSON.parse(trimmed), depth + 1);
  } catch {
    return value;
  }
}

/**
 * Get structured JSON from the model via tool-use. On Anthropic the API
 * returns the tool input already parsed and schema-valid. On OpenRouter the
 * adapter parses function-call arguments and throws a clean provider error on
 * malformed/truncated JSON (surfaces as a failed candidate run).
 *
 * Pass `validate` to enforce the shape at this boundary. The provider's JSON
 * Schema is advisory — a model can and does return values that violate it, and
 * without a runtime check the bad shape is cast to `T`, persisted, and only
 * discovered when something downstream crashes or silently renders nothing.
 * Validating here means one honest failure at the source instead.
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
    /** Runtime contract for the tool output. Strongly recommended. */
    validate?: z.ZodType<T>;
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
    if (block.type !== "tool_use") continue;
    if (!opts.validate) return block.input as T;

    // Validate the value as returned FIRST: a tool whose output is legitimately
    // a JSON-looking string must not be silently parsed into an object.
    // Unwrapping is a recovery path, not a preprocessing step.
    const asReturned = opts.validate.safeParse(block.input);
    if (asReturned.success) return asReturned.data;

    const unwrapped = unwrapEncodedJson(block.input);
    const parsed =
      unwrapped === block.input
        ? asReturned
        : opts.validate.safeParse(unwrapped);
    if (parsed.success) return parsed.data;

    // Log the shape mismatch before throwing: the thrown message is truncated
    // for storage, and the issue list is what actually identifies the field.
    console.error(
      `${opts.toolName}: tool output failed validation`,
      JSON.stringify(parsed.error.issues.slice(0, 10))
    );
    const summary = parsed.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(
      `${opts.toolName}: model returned an unexpected shape — ${summary}`
    );
  }
  throw new Error(`${opts.toolName}: model did not return structured output`);
}
