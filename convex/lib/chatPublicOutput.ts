import type { UIMessage } from "@convex-dev/agent";
import type { StreamDelta } from "@convex-dev/agent/validators";
import { isToolUIPart } from "ai";

const STEP_COMPLETE = "Step completed. Review any proposed changes before applying.";
const STEP_FAILED = "This step could not finish.";

/**
 * Phase A of report chat parity (owner decision 2026-10-19): the browser may
 * read Anthropic's thinking summaries (`display: "summarized"`), capped at
 * this many characters per reasoning part. Nothing else of the model's
 * reasoning crosses the boundary: no signature, no provider metadata.
 */
export const MAX_PUBLIC_REASONING_CHARS = 4_000;

/** The tool whose results may hold other clients' approved reports. */
const BRAIN_TOOL = "searchBrain";

export type PublicChatOptions = {
  /**
   * The turn ran a Brain search (`chatTurns.brainSearchedAt`). Its reasoning
   * summaries are withheld wherever the order of the parts cannot prove they
   * came before the search.
   */
  brainSearched?: boolean;
};

function capReasoning(text: string): string {
  return text.length > MAX_PUBLIC_REASONING_CHARS ? text.slice(0, MAX_PUBLIC_REASONING_CHARS) : text;
}

type LoosePart = { type: string } & Record<string, unknown>;

function toolNameOf(part: LoosePart): string | undefined {
  if (part.type === "dynamic-tool") return typeof part.toolName === "string" ? part.toolName : undefined;
  return part.type.startsWith("tool-") ? part.type.slice("tool-".length) : undefined;
}

function publicToolPart(part: LoosePart): LoosePart {
  const visible: LoosePart = { type: part.type };
  if (typeof part.toolCallId === "string") visible.toolCallId = part.toolCallId;
  if (part.type === "dynamic-tool" && typeof part.toolName === "string") visible.toolName = part.toolName;
  if (typeof part.state === "string") visible.state = part.state;
  if (typeof part.providerExecuted === "boolean") visible.providerExecuted = part.providerExecuted;
  visible.input = {};
  if (part.state === "output-available") visible.output = STEP_COMPLETE;
  if (part.state === "output-error") visible.errorText = STEP_FAILED;
  return visible;
}

/**
 * Keep the browser's view of a saved message to public text, capped reasoning
 * summaries, step markers and tool call identifiers. Deny by default: any
 * part type not named here is dropped, and every kept part is rebuilt from
 * named fields, so provider metadata, signatures, tool arguments and tool
 * results never leave. Reasoning after a searchBrain call is dropped; when
 * the turn ran a Brain search but this message does not hold the call (a
 * page split the turn), all of its reasoning is dropped.
 */
export function publicChatMessage(message: UIMessage, options: PublicChatOptions = {}): UIMessage {
  const parts = message.parts as unknown as LoosePart[];
  const holdsBrainCall = parts.some((part) => isToolUIPart(part as never) && toolNameOf(part) === BRAIN_TOOL);
  let reasoningHidden = options.brainSearched === true && !holdsBrainCall;
  const visible: LoosePart[] = [];
  for (const part of parts) {
    if (!part || typeof part.type !== "string") continue;
    if (part.type === "text") {
      visible.push({
        type: "text",
        text: typeof part.text === "string" ? part.text : "",
        ...(typeof part.state === "string" ? { state: part.state } : {}),
      });
      continue;
    }
    if (part.type === "reasoning") {
      if (reasoningHidden) continue;
      visible.push({
        type: "reasoning",
        text: capReasoning(typeof part.text === "string" ? part.text : ""),
        ...(typeof part.state === "string" ? { state: part.state } : {}),
      });
      continue;
    }
    if (part.type === "step-start") {
      visible.push({ type: "step-start" });
      continue;
    }
    if (isToolUIPart(part as never)) {
      if (toolNameOf(part) === BRAIN_TOOL) reasoningHidden = true;
      visible.push(publicToolPart(part));
      continue;
    }
    // Files, sources, data parts and any future kind: dropped.
  }
  return { ...message, metadata: undefined, parts: visible as unknown as UIMessage["parts"] };
}

const STREAM_TOOL_NAME_CHUNKS = new Set([
  "tool-input-start", "tool-call-streaming-start", "tool-input-available", "tool-call",
]);

function publicStreamPart(part: unknown, state: { reasoningHidden: boolean }): unknown[] {
  if (!part || typeof part !== "object" || !("type" in part) || typeof part.type !== "string") return [];
  // Only transport identifiers and public text cross the boundary. Unknown
  // future chunk kinds and provider metadata fail closed.
  const visible: Record<string, unknown> = { type: part.type };
  const fields = new Set(["id", "messageId", "toolCallId", "toolName", "dynamic", "providerExecuted", "finishReason"]);
  for (const [key, value] of Object.entries(part)) {
    if (fields.has(key) && (typeof value === "string" || typeof value === "boolean")) visible[key] = value;
  }
  if (STREAM_TOOL_NAME_CHUNKS.has(part.type) && "toolName" in part && part.toolName === BRAIN_TOOL) {
    state.reasoningHidden = true;
  }
  switch (part.type) {
    case "start": case "start-step": case "finish-step": case "finish":
    case "text-start": case "text-end":
    case "tool-input-start": case "tool-call-streaming-start":
      return [visible];
    case "text-delta":
      return [{ ...visible,
        ...("delta" in part && typeof part.delta === "string" ? { delta: part.delta } : {}),
        ...("text" in part && typeof part.text === "string" ? { text: part.text } : {}) }];
    // Summaries only: the signature travels on provider metadata, which is
    // never copied. A hidden reasoning block loses its start, its deltas and
    // its end together, so the browser's stream reader never meets a delta
    // for a block it was not told about.
    case "reasoning-start": case "reasoning-end":
      return state.reasoningHidden ? [] : [visible];
    case "reasoning-delta": case "reasoning":
      if (state.reasoningHidden) return [];
      return [{ ...visible,
        ...("delta" in part && typeof part.delta === "string" ? { delta: capReasoning(part.delta) } : {}),
        ...("text" in part && typeof part.text === "string" ? { text: capReasoning(part.text) } : {}) }];
    case "tool-input-available": case "tool-call":
      return [{ ...visible, input: {}, ...(part.type === "tool-call" ? { args: {} } : {}) }];
    case "tool-input-error":
      return [{ ...visible, input: {}, errorText: STEP_FAILED }];
    case "tool-output-available":
      return [{ ...visible, output: STEP_COMPLETE }];
    case "tool-result":
      return [{ ...visible, output: STEP_COMPLETE, result: STEP_COMPLETE }];
    case "tool-output-error":
      return [{ ...visible, errorText: STEP_FAILED }];
    case "tool-error": case "error":
      return [{ ...visible, error: STEP_FAILED, errorText: STEP_FAILED }];
    case "abort": return [{ type: "abort", reason: STEP_FAILED }];
    case "message-metadata": return [{ type: "message-metadata", messageMetadata: {} }];
    default: return [];
  }
}

/**
 * The live stream's counterpart of `publicChatMessage`. Each reasoning delta
 * is capped at MAX_PUBLIC_REASONING_CHARS (a stream cannot see the lengths
 * of the deltas before it; the saved message caps the whole part). Reasoning
 * after a searchBrain call in the same delta is dropped, and all of it when
 * the turn already ran a Brain search.
 */
export function publicChatDelta(delta: StreamDelta, options: PublicChatOptions = {}): StreamDelta {
  const state = { reasoningHidden: options.brainSearched === true };
  // Preserve transport offsets even when every part is private. The browser
  // must advance the cursor across an empty chunk, not keep requesting it.
  return { ...delta, parts: delta.parts.flatMap((part) => publicStreamPart(part, state)) };
}

/** Whether any part of a delta is reasoning, so the caller can skip a lookup. */
export function deltaHasReasoning(delta: StreamDelta): boolean {
  return delta.parts.some((part) =>
    !!part && typeof part === "object" && "type" in part && typeof part.type === "string" &&
    (part.type.startsWith("reasoning")));
}

/** Whether a saved message holds a reasoning part. */
export function messageHasReasoning(message: UIMessage): boolean {
  return message.parts.some((part) => part.type === "reasoning");
}
