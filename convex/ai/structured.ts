import type Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { MODEL } from "./model";
import {
  MalformedOutputError,
  OutputLimitError,
  isCutOffStopReason,
  type GenerationClient,
  type GenerationMessageContent,
  type GenerationResponse,
} from "./openrouterCore";

export const STRUCTURED_OUTPUT_PROGRAM = {
  attempts: 2,
  repairScaffold: {
    prefix: "\n\nYour previous tool output was invalid: ",
    suffix:
      ". Return the complete tool object and include every required field.",
    runtimeSentinel: "{{runtime.validationSummary}}",
    // 2026-09-25: the validation summary for an answer the provider stopped
    // at the output token limit, on either gateway. The repair runs with the
    // same limit, so it asks for a shorter answer.
    cutOffSummary:
      "it was cut off at the output token limit before it finished, so write a shorter answer",
  },
  request: {
    defaultMaxTokens: 8192,
    defaultSchema: { type: "object" },
    roleOrder: ["system", "user"],
    userRole: "user",
    toolChoice: { type: "tool", selection: "named", forced: true },
    retryUserPolicy: "reuse-original-and-append-repair-scaffold",
    // Cost phase 1: a block-form user message keeps its cached prefix on
    // the repair attempt; the scaffold is appended as one more text block.
    retryBlockPolicy: "append-repair-scaffold-as-uncached-text-block",
    thinking: { kind: "omitted" },
  },
} as const;

/**
 * The final validation failure of a structured call. The message is the same
 * as before; `issues` adds each failing path and zod issue code so a caller
 * can record why without storing model text. A custom issue also keeps its
 * message, which the schema author wrote.
 */
export class StructuredValidationError extends Error {
  readonly issues: ReadonlyArray<{ path: string; code: string; message?: string }>;
  constructor(
    message: string,
    issues: ReadonlyArray<{ path: string; code: string; message?: string }>
  ) {
    super(message);
    this.name = "StructuredValidationError";
    this.issues = issues;
  }
}

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

/** A JSON Schema node as far as decodeEncodedToolFields reads it. */
type SchemaNode = { type?: unknown; properties?: Record<string, unknown>; items?: unknown };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A JSON text's value, read through at most one more layer of encoding; undefined when it is not JSON. */
function parseEncodedText(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[") && !trimmed.startsWith('"')) return undefined;
  try {
    const once = JSON.parse(trimmed) as unknown;
    if (typeof once !== "string") return once;
    const again = once.trim();
    if (!again.startsWith("{") && !again.startsWith("[")) return undefined;
    return JSON.parse(again) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * 2026-10-04 (first), Round 3 (owner approved 2026-10-05): a field the tool
 * schema wants as an object or array that arrived as a string holding valid
 * JSON of that very shape, read as that value. Guided by the schema: a field
 * whose type allows a string is never touched, a string that is not JSON or
 * holds another shape stays as sent, and nothing is invented or dropped.
 * Returns the value (a copy only where something was read) and the paths of
 * the fields it read, never their text. The caller still validates the value
 * as usual; this is a decode, not a repair call.
 */
export function decodeEncodedToolFields(
  value: unknown,
  schema: unknown,
  path = ""
): { value: unknown; paths: string[] } {
  if (!isPlainObject(schema)) return { value, paths: [] };
  const node = schema as SchemaNode;
  const types = (Array.isArray(node.type) ? node.type : [node.type]).filter(
    (type): type is string => typeof type === "string"
  );
  const paths: string[] = [];
  let current = value;
  if (typeof current === "string" && !types.includes("string")) {
    const parsed = parseEncodedText(current);
    if ((types.includes("object") && isPlainObject(parsed)) || (types.includes("array") && Array.isArray(parsed))) {
      current = parsed;
      paths.push(path || "(root)");
    }
  }
  if (isPlainObject(current) && isPlainObject(node.properties)) {
    let copy: Record<string, unknown> | null = null;
    for (const [key, child] of Object.entries(node.properties)) {
      if (!(key in current)) continue;
      const read = decodeEncodedToolFields(current[key], child, path ? `${path}.${key}` : key);
      if (read.paths.length === 0) continue;
      copy ??= { ...current };
      copy[key] = read.value;
      paths.push(...read.paths);
    }
    if (copy) current = copy;
  } else if (Array.isArray(current) && node.items !== undefined) {
    let copy: unknown[] | null = null;
    current.forEach((item, index) => {
      const read = decodeEncodedToolFields(item, node.items, `${path || "(root)"}.${index}`);
      if (read.paths.length === 0) return;
      copy ??= [...(current as unknown[])];
      copy[index] = read.value;
      paths.push(...read.paths);
    });
    if (copy) current = copy;
  }
  return { value: current, paths };
}

/**
 * Get structured JSON from the model via tool-use. On Anthropic the API
 * returns the tool input already parsed and schema-valid. On OpenRouter the
 * adapter parses function-call arguments and throws a clean provider error on
 * malformed/truncated JSON (surfaces as a failed candidate run). An answer
 * either gateway stopped at `max_tokens` is cut off and never accepted: it
 * spends the repair attempt, then fails with OutputLimitError.
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
    /**
     * The user message. Block form carries a cache breakpoint after a shared
     * prefix (see GenerationTextBlock); a string is sent as it always was.
     */
    user: GenerationMessageContent;
    toolName: string;
    description: string;
    schema?: Anthropic.Tool.InputSchema;
    maxTokens?: number;
    model?: string;
    /** Runtime contract for the tool output. Strongly recommended. */
    validate?: z.ZodType<T>;
    /**
     * Total attempts, repair pass included. Defaults to the program's two. A
     * call the whole generation waits on can ask for one, trading the repair
     * for a bounded wall clock.
     */
    attempts?: number;
    /**
     * Legacy calls accept a JSON-encoded root string as a compatibility
     * recovery. Strict raw-boundary callers can disable that recovery.
     */
    encodedJsonRecovery?: boolean;
    /**
     * 2026-10-04 (first), Round 3: opt in to reading a field `schema` wants
     * as an object or array that arrived as a string of valid JSON of that
     * shape (decodeEncodedToolFields), then validating as usual. Off by
     * default; only the settings document classifier sets it. It makes no
     * request of its own, so a one-attempt call stays one attempt.
     */
    encodedFieldRecovery?: boolean;
    /**
     * Called each time an answer is cut off at the output token limit, on
     * either gateway, even when the repair then succeeds or fails another
     * way. Request bytes are unchanged.
     */
    onCutOff?: () => void;
    /**
     * Round 2 (F2, decision 57): stream the first attempt and report the
     * tool input written so far (see GenerationStreamHandlers). Only when the
     * client can stream; the request then gains `stream: true` and nothing
     * else. Repairs and validation are unchanged and never stream.
     */
    onPartialToolInput?: (json: string) => void;
    /**
     * 2026-09-27 (third): a repair for an answer that passed `validate` but
     * falls short (a Seed citing a line that does not back it). `ask` gets
     * the validated answer and the tool input as the model sent it, and
     * returns the whole text appended for the repair, with its own opening
     * (not the invalid-output scaffold), or null to accept; an error there
     * means no repair. Asked once, and only while a repair attempt is left.
     * The first answer is kept and returned if the repair fails in any way,
     * or if `keepRepaired` says the valid repaired answer is not better.
     */
    softRepair?: {
      ask: (value: T, answer: unknown) => string | null | Promise<string | null>;
      keepRepaired?: (first: T, repaired: T) => boolean | Promise<boolean>;
    };
    /**
     * 2026-09-29 (first, run 7 re-check): more text for the repair of an
     * answer that failed `validate`, given the tool input as the model sent
     * it, appended after the invalid-output scaffold. It never reaches the
     * validation summary, which is logged. Null adds nothing. Not used for a
     * cut-off, malformed or missing answer.
     */
    invalidAnswerRepair?: (answer: unknown) => string | null;
    /**
     * 2026-09-29 (first, run 7 re-check): the whole tools list, sent as
     * given in every attempt so its bytes (and their cache) never depend on
     * which tool is forced; `toolName` names the forced one and must be in
     * it. Without it, the one tool from `toolName`, `description` and
     * `schema` is sent, as before.
     */
    tools?: ReadonlyArray<{ name: string; description: string; input_schema: Anthropic.Tool.InputSchema }>;
    /**
     * PR #22 review (G13): with `tools`, an answer from any tool but
     * `toolName` is invalid, on every gateway and attempt. A model that
     * cannot be forced to call a tool (tool_choice becomes auto) can pick
     * another offered tool. Such an answer is never accepted: it spends the
     * repair, whose issue names the tool to call, and fails the call when no
     * attempt is left. Told the tool the model called, then the answer.
     */
    onWrongTool?: (calledTool: string, answer: unknown) => void;
  }
): Promise<T> {
  // The answer a soft repair set aside, returned if the repair fails.
  const kept: { answer?: { value: T } } = {};
  try {
    return await structuredAttempts(rawClient, opts, kept);
  } catch (error) {
    if (kept.answer) return kept.answer.value;
    throw error;
  }
}

async function structuredAttempts<T>(
  rawClient: GenerationClient | Anthropic,
  opts: Parameters<typeof generateStructured<T>>[1],
  kept: { answer?: { value: T } }
): Promise<T> {
  const client = rawClient as GenerationClient;
  const attempts = opts.attempts ?? STRUCTURED_OUTPUT_PROGRAM.attempts;
  if (opts.tools && !opts.tools.some((tool) => tool.name === opts.toolName)) {
    throw new Error(`${opts.toolName}: the forced tool is not in the tools list`);
  }
  const tools = opts.tools
    ? opts.tools.map((tool) => ({ ...tool }))
    : [
        {
          name: opts.toolName,
          description: opts.description,
          input_schema: opts.schema ?? STRUCTURED_OUTPUT_PROGRAM.request.defaultSchema,
        },
      ];
  let validationSummary = "";
  // Set when the soft repair asked for the next attempt: its own text.
  let softRepairText: string | null = null;
  // Set when the last answer failed validation and the caller adds text.
  let invalidAnswerText: string | null = null;
  // A valid answer is returned unless the soft repair asks for another.
  const askedSoftRepair = async (value: T, answer: unknown, lastAttempt: boolean): Promise<boolean> => {
    if (kept.answer || lastAttempt || !opts.softRepair) return false;
    let text: string | null;
    try {
      text = await opts.softRepair.ask(value, answer);
    } catch (error) {
      console.warn(`${opts.toolName}: soft repair skipped (${error instanceof Error ? error.name : "error"})`);
      return false;
    }
    if (!text) return false;
    softRepairText = text;
    kept.answer = { value };
    return true;
  };
  // After a soft repair: the repaired answer, or the first when it is not better.
  const settled = async (value: T): Promise<T> => {
    const first = kept.answer;
    if (!first || !opts.softRepair?.keepRepaired) return value;
    return (await opts.softRepair.keepRepaired(first.value, value)) ? value : first.value;
  };

  // A forced tool call can still omit required JSON fields. Retry once with
  // the concrete validation feedback; accepting a partial object would let a
  // malformed analysis fail much later after more paid generation work.
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const lastAttempt = attempt === attempts - 1;
    const repair =
      softRepairText ??
      `${STRUCTURED_OUTPUT_PROGRAM.repairScaffold.prefix}${validationSummary}${STRUCTURED_OUTPUT_PROGRAM.repairScaffold.suffix}${invalidAnswerText ?? ""}`;
    softRepairText = null;
    invalidAnswerText = null;
    const user: GenerationMessageContent =
      attempt === 0
        ? opts.user
        : typeof opts.user === "string"
          ? `${opts.user}${repair}`
          : [...opts.user, { type: "text", text: repair }];
    let res: GenerationResponse;
    const stream =
      attempt === 0 && opts.onPartialToolInput && client.messages.createStreaming
        ? client.messages.createStreaming.bind(client.messages)
        : null;
    const onToolInput = opts.onPartialToolInput;
    const send = (params: Parameters<GenerationClient["messages"]["create"]>[0]) =>
      stream && onToolInput ? stream(params, { onToolInput }) : client.messages.create(params);
    try {
      res = await send({
        model: opts.model ?? MODEL,
        max_tokens:
          opts.maxTokens ?? STRUCTURED_OUTPUT_PROGRAM.request.defaultMaxTokens,
        system: opts.system,
        tools,
        tool_choice: {
          type: STRUCTURED_OUTPUT_PROGRAM.request.toolChoice.type,
          name: opts.toolName,
        },
        messages: [
          { role: STRUCTURED_OUTPUT_PROGRAM.request.userRole, content: user },
        ],
      });
    } catch (error) {
      // The OpenRouter adapter decodes tool-call JSON inside create(), so a
      // truncated/malformed candidate response throws here instead of
      // returning an invalid block — the same class of failure as a zod
      // rejection, so it spends the same single repair attempt. Provider
      // errors (auth, billing, rate limit) are not repairable by re-prompting
      // and keep failing fast; the transport already retries rate limits.
      if (error instanceof OutputLimitError) opts.onCutOff?.();
      if (lastAttempt || !(error instanceof MalformedOutputError)) throw error;
      validationSummary =
        error instanceof OutputLimitError
          ? STRUCTURED_OUTPUT_PROGRAM.repairScaffold.cutOffSummary
          : error.message;
      console.warn(
        `${opts.toolName}: retrying after malformed provider output — ${error.message}`
      );
      continue;
    }

    // Model catalog: a forced-tool request's outcome is recorded only now,
    // after this validation, so usable JSON in an unusable shape counts as
    // a failure of the model that answered (providers.ts).
    const settle = async (result: { ok: true } | { ok: false; code: string }) =>
      await res.settleOutcome?.(result);

    // An answer stopped at the output token limit is cut off, even when the
    // partial tool input would pass validation: most schemas default their
    // trailing lists to empty, so a cut analysis or Brief used to be saved as
    // complete. The same failure the OpenRouter adapter raises for
    // `finish_reason: "length"`: it spends the one repair attempt, then fails.
    if (isCutOffStopReason(res.stop_reason)) {
      opts.onCutOff?.();
      await settle({ ok: false, code: "output_limit" });
      validationSummary = STRUCTURED_OUTPUT_PROGRAM.repairScaffold.cutOffSummary;
      console.warn(
        `${opts.toolName}: answer cut off at the output token limit (stop reason: ${res.stop_reason})`
      );
      if (!lastAttempt) continue;
      throw new OutputLimitError(
        `${opts.toolName}: response was truncated at the max_tokens limit before completing`
      );
    }

    // With several tools offered, the answer is the call of the intended
    // one, wherever it stands among the blocks.
    const block =
      (opts.tools && res.content.find((item) => item.type === "tool_use" && item.name === opts.toolName)) ||
      res.content.find((item) => item.type === "tool_use");
    if (!block || block.type !== "tool_use") {
      await settle({ ok: false, code: "no_tool_output" });
      validationSummary = "the required tool was not called";
      if (!lastAttempt) continue;
      throw new Error(`${opts.toolName}: model did not return structured output`);
    }
    if (opts.tools && block.name !== opts.toolName) {
      await settle({ ok: false, code: "wrong_tool" });
      // Only offered names are repeated: a name the model made up is not.
      const called = tools.some((tool) => tool.name === block.name)
        ? block.name
        : "a tool this request does not offer";
      validationSummary = `it called ${called}, but this request must be answered with ${opts.toolName}`;
      try {
        opts.onWrongTool?.(block.name, block.input);
      } catch (error) {
        console.warn(`${opts.toolName}: wrong tool not reported (${error instanceof Error ? error.name : "error"})`);
      }
      try {
        invalidAnswerText = opts.invalidAnswerRepair?.(block.input) ?? null;
      } catch (error) {
        invalidAnswerText = null;
        console.warn(`${opts.toolName}: repair text skipped (${error instanceof Error ? error.name : "error"})`);
      }
      console.error(`${opts.toolName}: the model answered with another tool (${called})`);
      if (!lastAttempt) continue;
      throw new StructuredValidationError(
        `${opts.toolName}: model returned an unexpected shape: ${validationSummary}`,
        [{ path: "(root)", code: "wrong_tool", message: validationSummary }]
      );
    }
    if (!opts.validate) {
      await settle({ ok: true });
      return block.input as T;
    }

    // Validate the value as returned FIRST: a tool whose output is legitimately
    // a JSON-looking string must not be silently parsed into an object.
    // Unwrapping is a recovery path, not a preprocessing step.
    const asReturned = opts.validate.safeParse(block.input);
    if (asReturned.success) {
      await settle({ ok: true });
      if (!(await askedSoftRepair(asReturned.data, block.input, lastAttempt))) return await settled(asReturned.data);
      continue;
    }

    const unwrapped = opts.encodedJsonRecovery === false
      ? block.input
      : unwrapEncodedJson(block.input);
    const parsed =
      unwrapped === block.input
        ? asReturned
        : opts.validate.safeParse(unwrapped);
    if (parsed.success) {
      await settle({ ok: true });
      if (!(await askedSoftRepair(parsed.data, block.input, lastAttempt))) return await settled(parsed.data);
      continue;
    }
    // Round 3 (opt-in): fields sent as JSON text, read and validated as usual.
    const fields = opts.encodedFieldRecovery && opts.schema
      ? decodeEncodedToolFields(unwrapped, opts.schema)
      : null;
    const decoded = fields && fields.paths.length > 0 ? opts.validate.safeParse(fields.value) : null;
    if (decoded?.success) {
      console.warn(`${opts.toolName}: read ${fields!.paths.join(", ")} sent as JSON text`);
      await settle({ ok: true });
      if (!(await askedSoftRepair(decoded.data, block.input, lastAttempt))) return await settled(decoded.data);
      continue;
    }
    await settle({ ok: false, code: "invalid_output" });

    try {
      invalidAnswerText = opts.invalidAnswerRepair?.(block.input) ?? null;
    } catch (error) {
      invalidAnswerText = null;
      console.warn(`${opts.toolName}: repair text skipped (${error instanceof Error ? error.name : "error"})`);
    }
    validationSummary = parsed.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    console.error(
      `${opts.toolName}: tool output failed validation`,
      JSON.stringify(parsed.error.issues.slice(0, 10))
    );
    if (!lastAttempt) continue;
    throw new StructuredValidationError(
      `${opts.toolName}: model returned an unexpected shape: ${validationSummary}`,
      parsed.error.issues.slice(0, 10).map((issue) => ({
        path: issue.path.map(String).join(".") || "(root)",
        code: issue.code,
        ...(issue.code === "custom" ? { message: issue.message } : {}),
      }))
    );
  }

  throw new Error(`${opts.toolName}: model did not return structured output`);
}
