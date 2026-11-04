/**
 * F1, step 1 (2026-10-27, `docs/todos/phase-f-scale.md`): how many characters
 * an Anthropic request sends, measured on the request as sent, so the
 * evidence budgets' characters-per-token can be set from data instead of the
 * fixed 4 (`CHARS_PER_TOKEN`).
 *
 * Text only, in UTF-16 units as the budgets count them: the system prompt,
 * every message's text, document text and titles, tool calls' inputs and
 * tool results, thinking text, and the tool definitions (as JSON). No JSON
 * framing of the request itself and no base64 (an image, a PDF sent as
 * data). `evidenceChars` is the part sent in user turns (the files,
 * transcripts and tool results a step reads, with the user's own text, such
 * as "Draft Line 242 now."; evidence in a system prompt is not in it).
 *
 * Close, not exact: a streamed request's tools gain `eager_input_streaming`
 * after this count (about 29 characters a tool); blocks with no text here
 * (redacted thinking, search results, files by id or address) cost tokens
 * and count as none; earlier turns' thinking counts here even where the API
 * leaves it out.
 */
export type RequestSize = { requestChars: number; evidenceChars: number };

type Block = Record<string, unknown>;

function asBlocks(content: unknown): Block[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content) ? content.filter((block): block is Block => !!block && typeof block === "object") : [];
}

function text(value: unknown): number {
  return typeof value === "string" ? value.length : 0;
}

/** The characters of one content block; base64 data counts as none. */
function blockChars(block: Block): number {
  switch (block.type) {
    case "text":
      return text(block.text);
    case "thinking":
      return text(block.thinking);
    case "document": {
      const source = block.source as Block | undefined;
      const body =
        source?.type === "text"
          ? text(source.data)
          : source?.type === "content"
            ? asBlocks(source.content).reduce((sum, inner) => sum + blockChars(inner), 0)
            : 0;
      return body + text(block.title) + text(block.context);
    }
    case "tool_use":
    case "server_tool_use":
      return block.input === undefined ? 0 : JSON.stringify(block.input).length;
    case "tool_result":
      return asBlocks(block.content).reduce((sum, inner) => sum + blockChars(inner), 0);
    default:
      // Images, redacted thinking and other blocks carry no text the budgets count.
      return 0;
  }
}

/** The size of a Messages API request body; zero for anything that is not one. */
export function requestSize(request: unknown): RequestSize {
  if (!request || typeof request !== "object") return { requestChars: 0, evidenceChars: 0 };
  const body = request as { system?: unknown; messages?: unknown; tools?: unknown };
  const system = asBlocks(body.system).reduce((sum, block) => sum + blockChars(block), 0);
  const tools = Array.isArray(body.tools) && body.tools.length > 0 ? JSON.stringify(body.tools).length : 0;
  let evidenceChars = 0;
  let messageChars = 0;
  for (const message of Array.isArray(body.messages) ? body.messages : []) {
    if (!message || typeof message !== "object") continue;
    const { role, content } = message as { role?: unknown; content?: unknown };
    const chars = asBlocks(content).reduce((sum, block) => sum + blockChars(block), 0);
    messageChars += chars;
    if (role === "user") evidenceChars += chars;
  }
  return { requestChars: system + tools + messageChars, evidenceChars };
}
