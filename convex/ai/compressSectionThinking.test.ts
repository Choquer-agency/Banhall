import { describe, expect, it, vi } from "vitest";
import { compressSection } from "./pipeline";
import type { GenerationClient } from "./openrouterCore";

describe("compressSection with a thinking-first reply", () => {
  it("returns the compressed text, not the original, when a thinking block comes first", async () => {
    const create = vi.fn(async () => ({
      content: [
        { type: "thinking", thinking: "Cut the second paragraph." },
        { type: "text", text: "The shorter section." },
      ],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    }));
    const client = { messages: { create } } as unknown as GenerationClient;
    const out = await compressSection(client, "claude-opus-5-5", "s242", "The original, longer section text.", "standard");
    expect(create).toHaveBeenCalledTimes(1);
    expect(out).toBe("The shorter section.");
  });

  it("keeps the original text when the reply was cut off at the token limit", async () => {
    const create = vi.fn(async () => ({
      content: [
        { type: "thinking", thinking: "Long planning." },
        { type: "text", text: "The shorter sec" },
      ],
      stop_reason: "max_tokens",
      usage: { input_tokens: 10, output_tokens: 4096 },
    }));
    const client = { messages: { create } } as unknown as GenerationClient;
    const original = "The original, longer section text.";
    expect(await compressSection(client, "claude-opus-5-5", "s242", original, "standard")).toBe(original);
  });
});
