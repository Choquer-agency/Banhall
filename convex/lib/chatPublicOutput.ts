import type { UIMessage } from "@convex-dev/agent";
import type { StreamDelta } from "@convex-dev/agent/validators";
import { isToolUIPart } from "ai";

const STEP_COMPLETE = "Step completed. Review any proposed changes before applying.";
const STEP_FAILED = "This step could not finish.";

/** Keep model-only reasoning and tool results out of browser responses. */
export function publicChatMessage(message: UIMessage): UIMessage {
  return {
    ...message,
    metadata: undefined,
    parts: message.parts.filter(part => part.type !== "reasoning").map(part => {
      if (isToolUIPart(part)) {
        const hiddenMetadata = { callProviderMetadata: undefined, resultProviderMetadata: undefined, toolMetadata: undefined };
        if (part.state === "output-available") return { ...part, ...hiddenMetadata, input: {}, output: STEP_COMPLETE };
        if (part.state === "output-error") return { ...part, ...hiddenMetadata, input: {}, output: undefined, errorText: STEP_FAILED };
        return { ...part, ...hiddenMetadata, input: {} };
      }
      return { ...part, providerMetadata: undefined };
    }),
  };
}

function publicStreamPart(part: unknown): unknown[] {
  if (!part || typeof part !== "object" || !("type" in part) || typeof part.type !== "string") return [];
  // Only transport identifiers and public text cross the boundary. Unknown
  // future chunk kinds and provider metadata fail closed.
  const visible: Record<string, unknown> = { type: part.type };
  const fields = new Set(["id", "messageId", "toolCallId", "toolName", "dynamic", "providerExecuted", "finishReason"]);
  for (const [key, value] of Object.entries(part)) {
    if (fields.has(key) && (typeof value === "string" || typeof value === "boolean")) visible[key] = value;
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

export function publicChatDelta(delta: StreamDelta): StreamDelta {
  // Preserve transport offsets even when every part is private. The browser
  // must advance the cursor across an empty chunk, not keep requesting it.
  return { ...delta, parts: delta.parts.flatMap(publicStreamPart) };
}
