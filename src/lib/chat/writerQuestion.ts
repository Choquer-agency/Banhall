/**
 * Owner 2026-10-28 ("Assistant needs you"): the AI's askWriter call, read back
 * from the conversation so the panel above the message box can show it. The
 * question is open while it is the newest thing in the conversation: any
 * writer message after it answers it.
 */
import type { UIMessage } from "@convex-dev/agent";

export const SOMETHING_ELSE = "Something else…";

export type WriterQuestion = {
  toolCallId: string;
  question: string;
  options: string[];
};

type LoosePart = { type?: unknown; toolCallId?: unknown; input?: unknown; state?: unknown };

function questionFrom(part: LoosePart): WriterQuestion | null {
  if (part.type !== "tool-askWriter" || part.state === "output-error") return null;
  const input = part.input as { question?: unknown; options?: unknown } | undefined;
  const question = typeof input?.question === "string" ? input.question.trim() : "";
  const options = Array.isArray(input?.options)
    ? input.options.filter((option): option is string => typeof option === "string" && option.trim() !== "")
    : [];
  if (!question || options.length < 2) return null;
  return {
    toolCallId: typeof part.toolCallId === "string" ? part.toolCallId : question,
    question,
    options: options.slice(0, 3).map((option) => option.trim()),
  };
}

/** The newest question the writer has not answered yet, or null. */
export function openWriterQuestion(messages: readonly UIMessage[] | undefined): WriterQuestion | null {
  if (!messages?.length) return null;
  const last = messages.at(-1);
  if (!last || last.role !== "assistant") return null;
  const parts = (last.parts ?? []) as LoosePart[];
  for (let index = parts.length - 1; index >= 0; index--) {
    const question = questionFrom(parts[index]);
    if (question) return question;
  }
  return null;
}
