import { describe, test, expect } from "vitest";
import { smoothStream, type TextStreamPart, type ToolSet } from "ai";
import { preserveReasoningSignature } from "./reasoningSignature";

/**
 * Guards the Anthropic thinking-signature round-trip through the exact
 * transform stack `@convex-dev/agent` installs when `saveStreamDeltas` is on:
 * our transform first, then `smoothStream({ chunking: /[\p{P}\s]/u })`.
 *
 * Without the fix, reasoning text ending in punctuation loses its signature,
 * and step 2 of a tool turn sends Anthropic an unsigned thinking block.
 */

const AGENT_CHUNKING = /[\p{P}\s]/u;
const SIGNATURE = "ErUBCkYIBRgCIkDd8VBqZ+signature+example";

type Part = TextStreamPart<ToolSet>;

function reasoningStream(text: string): Part[] {
  return [
    { type: "reasoning-start", id: "0" },
    { type: "reasoning-delta", id: "0", text },
    // Anthropic delivers signature_delta as a final, EMPTY reasoning delta.
    {
      type: "reasoning-delta",
      id: "0",
      text: "",
      providerMetadata: { anthropic: { signature: SIGNATURE } },
    },
    { type: "reasoning-end", id: "0" },
  ] as Part[];
}

async function pipe(parts: Part[], withFix: boolean): Promise<Part[]> {
  const source = new ReadableStream<Part>({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
  const options = { tools: {} as ToolSet, stopStream: () => {} };
  const smooth = smoothStream<ToolSet>({
    delayInMs: null,
    chunking: AGENT_CHUNKING,
  })(options);

  const stream = withFix
    ? source.pipeThrough(preserveReasoningSignature()(options)).pipeThrough(smooth)
    : source.pipeThrough(smooth);

  const out: Part[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.push(value);
  }
  return out;
}

/** How the AI SDK assembles a step's reasoning content from the stream. */
function assembleReasoning(parts: Part[]) {
  let text = "";
  let signature: string | undefined;
  for (const part of parts) {
    if (part.type === "reasoning-delta" || part.type === "reasoning-end") {
      if ("text" in part && typeof part.text === "string") text += part.text;
      const anthropic = part.providerMetadata?.anthropic as
        | { signature?: string }
        | undefined;
      if (anthropic?.signature) signature = anthropic.signature;
    }
  }
  return { text, signature };
}

describe("preserveReasoningSignature", () => {
  // Ending in punctuation is the common case ("Checks complete.") and the one
  // that breaks: smoothStream's buffer is already drained, so its flush — the
  // only path that carries providerMetadata — never runs.
  test.each([
    ["The writer wants this passage tightened.", "trailing period"],
    ["Which section does this belong to?", "trailing question mark"],
    ["Considering the uncertainty framing", "no trailing punctuation"],
    ["Done!", "trailing exclamation"],
    ["Checking section 242 — then 244,", "trailing comma"],
    ["Reviewing the claim ", "trailing whitespace"],
  ])("preserves the signature for %j (%s)", async (text) => {
    const withFix = assembleReasoning(await pipe(reasoningStream(text), true));
    expect(withFix.signature).toBe(SIGNATURE);
    // The reasoning text itself must be untouched.
    expect(withFix.text).toBe(text);
  });

  test("without the fix, punctuation-terminated reasoning loses its signature", async () => {
    const text = "Checks complete.";
    const unfixed = assembleReasoning(await pipe(reasoningStream(text), false));
    // Documents the upstream bug this transform exists to work around. If this
    // ever starts passing, `smoothStream` has been fixed and the transform can
    // be deleted.
    expect(unfixed.signature).toBeUndefined();
    expect(unfixed.text).toBe(text);
  });

  test("leaves text and tool chunks untouched", async () => {
    const parts = [
      { type: "text-start", id: "1" },
      { type: "text-delta", id: "1", text: "Here is the edit." },
      { type: "text-end", id: "1" },
      {
        type: "tool-call",
        toolCallId: "tc1",
        toolName: "proposeEdit",
        input: { targetText: "a", newText: "b" },
      },
      {
        type: "tool-result",
        toolCallId: "tc1",
        toolName: "proposeEdit",
        input: { targetText: "a", newText: "b" },
        output: "Edit proposed.",
      },
    ] as Part[];
    const out = await pipe(parts, true);
    const text = out
      .filter((p) => p.type === "text-delta")
      .map((p) => ("text" in p ? p.text : ""))
      .join("");
    expect(text).toBe("Here is the edit.");
    expect(out.filter((p) => p.type === "tool-call")).toHaveLength(1);
    expect(out.filter((p) => p.type === "tool-result")).toHaveLength(1);
  });

  test("passes redacted thinking through untouched", async () => {
    // Redacted blocks carry `redactedData` on reasoning-start, which
    // smoothStream never touches — but the transform must not eat it either.
    const parts = [
      {
        type: "reasoning-start",
        id: "0",
        providerMetadata: { anthropic: { redactedData: "REDACTED" } },
      },
      { type: "reasoning-end", id: "0" },
    ] as Part[];
    const out = await pipe(parts, true);
    const start = out.find(
      (p): p is Extract<Part, { type: "reasoning-start" }> =>
        p.type === "reasoning-start"
    );
    expect(
      (start?.providerMetadata?.anthropic as { redactedData?: string })?.redactedData
    ).toBe("REDACTED");
  });

  test("keeps signatures separate across interleaved reasoning blocks", async () => {
    // Interleaved, not sequential: both blocks are open at once, so a
    // single-slot implementation would cross the signatures.
    const parts = [
      { type: "reasoning-start", id: "0" },
      { type: "reasoning-start", id: "1" },
      { type: "reasoning-delta", id: "0", text: "First thought." },
      { type: "reasoning-delta", id: "1", text: "Second thought." },
      {
        type: "reasoning-delta",
        id: "0",
        text: "",
        providerMetadata: { anthropic: { signature: "SIG-A" } },
      },
      {
        type: "reasoning-delta",
        id: "1",
        text: "",
        providerMetadata: { anthropic: { signature: "SIG-B" } },
      },
      { type: "reasoning-end", id: "1" },
      { type: "reasoning-end", id: "0" },
    ] as Part[];
    const out = await pipe(parts, true);
    const signatureFor = (id: string) => {
      const end = out.find(
        (p): p is Extract<Part, { type: "reasoning-end" }> =>
          p.type === "reasoning-end" && p.id === id
      );
      return (end?.providerMetadata?.anthropic as { signature?: string })?.signature;
    };
    expect(signatureFor("0")).toBe("SIG-A");
    expect(signatureFor("1")).toBe("SIG-B");
  });
});
