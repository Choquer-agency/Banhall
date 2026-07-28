import { describe, expect, it, vi } from "vitest";
import type { GenerationClient } from "./openrouterCore";
import { runSection244Agent } from "./section244Agent";
import type { TranscriptAnalysis } from "./analyzerAgent";

const analysis = {} as TranscriptAnalysis;

describe("section agent request budget", () => {
  it("disables direct-provider thinking so the answer cannot be crowded out", async () => {
    const create = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "Draft section" }],
      stop_reason: "end_turn",
    }));
    const client: GenerationClient = { messages: { create } };
    await expect(
      runSection244Agent(client, analysis, "claude-sonnet-5")
    ).resolves.toBe("Draft section");
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        max_tokens: 8192,
        thinking: { type: "disabled" },
      })
    );
  });

  it("keeps the OpenRouter answer budget before gateway headroom is applied", async () => {
    const create = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "Draft section" }],
    }));
    const client: GenerationClient = { messages: { create } };
    await runSection244Agent(client, analysis, "google/gemini-3.1-pro-preview");
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: 4096 })
    );
  });
});
