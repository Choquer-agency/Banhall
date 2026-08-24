import type Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { MODEL } from "./model";
import {
  MalformedOutputError,
  type GenerationClient,
  type GenerationResponse,
} from "./openrouterCore";

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
  let validationSummary = "";

  // A forced tool call can still omit required JSON fields. Retry once with
  // the concrete validation feedback; accepting a partial object would let a
  // malformed analysis fail much later after more paid generation work.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const user =
      attempt === 0
        ? opts.user
        : `${opts.user}\n\nYour previous tool output was invalid: ${validationSummary}. Return the complete tool object and include every required field.`;
    let res: GenerationResponse;
    try {
      res = await client.messages.create({
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
        messages: [{ role: "user", content: user }],
      });
    } catch (error) {
      // The OpenRouter adapter decodes tool-call JSON inside create(), so a
      // truncated/malformed candidate response throws here instead of
      // returning an invalid block — the same class of failure as a zod
      // rejection, so it spends the same single repair attempt. Provider
      // errors (auth, billing, rate limit) are not repairable by re-prompting
      // and keep failing fast; the transport already retries rate limits.
      if (attempt > 0 || !(error instanceof MalformedOutputError)) throw error;
      validationSummary = error.message;
      console.warn(
        `${opts.toolName}: retrying after malformed provider output — ${error.message}`
      );
      continue;
    }

    const block = res.content.find((item) => item.type === "tool_use");
    if (!block || block.type !== "tool_use") {
      validationSummary = "the required tool was not called";
      if (attempt === 0) continue;
      throw new Error(`${opts.toolName}: model did not return structured output`);
    }
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

    validationSummary = parsed.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    console.error(
      `${opts.toolName}: tool output failed validation`,
      JSON.stringify(parsed.error.issues.slice(0, 10))
    );
    if (attempt === 0) continue;
    throw new Error(
      `${opts.toolName}: model returned an unexpected shape — ${validationSummary}`
    );
  }

  throw new Error(`${opts.toolName}: model did not return structured output`);
}
