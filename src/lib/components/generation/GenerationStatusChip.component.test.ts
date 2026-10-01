import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import GenerationStatusChip from "./GenerationStatusChip.svelte";

describe("GenerationStatusChip", () => {
  it("reads on the light top bar with secondary ink and a coloured dot", async () => {
    const { container } = await render(GenerationStatusChip, { status: "awaiting_input", surface: "light" });
    const chip = container.querySelector<HTMLElement>('[role="status"]')!;
    expect(chip.textContent).toContain("Action needed: review a section");
    expect(chip.className).toContain("bg-chrome");
    expect(chip.className).toContain("text-ink-secondary");
    expect(chip.className).not.toContain("text-white");
    const style = getComputedStyle(chip);
    expect(style.color).not.toBe("rgb(255, 255, 255)");
  });

  it("keeps the dark app bar treatment by default", async () => {
    const { container } = await render(GenerationStatusChip, { status: "running" });
    const chip = container.querySelector<HTMLElement>('[role="status"]')!;
    expect(chip.className).toContain("text-white");
    expect(chip.textContent).toContain("AI generating");
  });
});
