import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import GenerationRecoveryPanel from "./GenerationRecoveryPanel.svelte";
import GenerationStatusChip from "./GenerationStatusChip.svelte";

const models = [
  { model: "sonnet", label: "Sonnet 5", status: "succeeded" as const },
  { model: "gemini", label: "Gemini 3.1 Pro", status: "failed" as const },
];

describe("generation recovery components", () => {
  it("shows partial success and keeps both recovery choices visible", async () => {
    const onRetry = vi.fn();
    const onContinue = vi.fn();
    const { container } = await render(GenerationRecoveryPanel, {
      models,
      candidatesDone: 1,
      candidatesFailed: 1,
      onRetry,
      onContinue,
    });
    expect(container.textContent).toContain("1 draft is ready");
    expect(container.textContent).toContain("Retry failed drafts");
    expect(container.textContent).toContain("Continue with ready drafts");
    expect(container.textContent).toContain("Needs retry");
    for (const button of container.querySelectorAll("button")) {
      expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }
  });

  it("shows one obvious action after full failure", async () => {
    const { container } = await render(GenerationRecoveryPanel, {
      models: [{ model: "gemini", label: "Gemini", status: "failed" }],
      candidatesDone: 0,
      candidatesFailed: 1,
      onRetry: vi.fn(),
    });
    expect(container.textContent).toContain("No draft completed");
    expect(container.textContent).toContain("Try again");
    expect(container.textContent).not.toContain("Continue with ready drafts");
  });

  it("renders text status in the header chip", async () => {
    const { container } = await render(GenerationStatusChip, {
      status: "awaiting_selection",
      candidatesDone: 1,
      candidatesFailed: 1,
    });
    expect(container.textContent).toContain("Some drafts need retry");
  });
});
