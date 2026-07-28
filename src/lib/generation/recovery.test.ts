import { describe, expect, it } from "vitest";
import {
  recoveryExplanation,
  recoveryHeading,
  runStatusLabel,
  safeGenerationActivity,
} from "./recovery";

describe("generation recovery copy", () => {
  it("describes partial success without discarding ready work", () => {
    expect(recoveryHeading(1, 1)).toBe("1 draft needs another try");
    expect(recoveryExplanation(1, 1)).toContain("1 draft is ready");
    expect(recoveryExplanation(2, 1)).toContain("continue with the ready work");
  });

  it("uses plain labels for every run state", () => {
    expect(["queued", "running", "succeeded", "failed"].map((status) =>
      runStatusLabel(status as Parameters<typeof runStatusLabel>[0])
    )).toEqual(["Queued", "Generating", "Ready", "Needs retry"]);
  });

  it("never exposes a stored provider string", () => {
    const raw = "unknown: OpenRouter exception stack anthropic request id";
    const copy = safeGenerationActivity("failed", raw);
    expect(copy).toBe("Generation stopped before all requested drafts completed.");
    expect(copy).not.toMatch(/openrouter|anthropic|exception|request id/i);
  });

  it("recognizes stale recovery without echoing internals", () => {
    expect(safeGenerationActivity("failed", "Section timed out: convex trace")).toBe(
      "Generation took too long and stopped safely."
    );
  });
});
