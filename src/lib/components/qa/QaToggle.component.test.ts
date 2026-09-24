import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import QaToggle from "./QaToggle.svelte";

const toggle = () => document.querySelector<HTMLButtonElement>("[data-qa-toggle]")!;

describe("QaToggle", () => {
  it("idle: shield only, named QA, 26px tile", async () => {
    const onToggle = vi.fn();
    await render(QaToggle, { state: "idle", onToggle });
    const node = toggle();
    expect(node.getAttribute("aria-label")).toBe("QA");
    expect(node.getAttribute("aria-pressed")).toBe("false");
    expect(node.querySelector("[data-qa-shield]")).not.toBeNull();
    expect(node.querySelector("[data-qa-chip]")).toBeNull();
    expect(node.querySelector("[data-ai-mark]")).toBeNull();
    expect(Math.round(node.getBoundingClientRect().height)).toBe(26);
    node.click();
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("running: gray-50 fill and a small Aurora spinner, no tooltip", async () => {
    await render(QaToggle, { state: "running", score: 78, onToggle: vi.fn() });
    const node = toggle();
    expect(node.getAttribute("aria-label")).toBe("QA, checking the draft");
    expect(node.hasAttribute("title")).toBe(false);
    expect(node.querySelector('[data-ai-mark="aurora"][data-ai-mark-glyph="spinner"]')).not.toBeNull();
    expect(node.querySelector("[data-qa-chip]")).toBeNull();
    const gray50 = getComputedStyle(document.documentElement).getPropertyValue("--color-gray-50").trim();
    expect(gray50).not.toBe("");
    const probe = document.createElement("span");
    probe.style.backgroundColor = gray50;
    document.body.appendChild(probe);
    expect(getComputedStyle(node).backgroundColor).toBe(getComputedStyle(probe).backgroundColor);
    probe.remove();
  });

  it("done: the band chip is always coloured", async () => {
    const view = await render(QaToggle, { state: "done", score: 78, onToggle: vi.fn() });
    let chip = toggle().querySelector<HTMLElement>("[data-qa-chip]")!;
    expect(chip.textContent).toBe("78");
    expect(getComputedStyle(chip).backgroundColor).toBe("rgb(255, 237, 213)");
    expect(getComputedStyle(chip).color).toBe("rgb(194, 65, 12)");
    expect(Number(getComputedStyle(chip).fontWeight)).toBeLessThanOrEqual(500);

    await view.rerender({ score: 86 });
    chip = toggle().querySelector<HTMLElement>("[data-qa-chip]")!;
    expect(getComputedStyle(chip).backgroundColor).toBe("rgb(220, 252, 231)");
    await view.rerender({ score: 41 });
    chip = toggle().querySelector<HTMLElement>("[data-qa-chip]")!;
    expect(getComputedStyle(chip).backgroundColor).toBe("rgb(254, 226, 226)");
    expect(toggle().getAttribute("aria-label")).toBe("QA score 41");
  });

  it("done and unseen: pink dot and 'new result' in the name", async () => {
    const view = await render(QaToggle, { state: "done", score: 78, unseen: true, onToggle: vi.fn() });
    const dot = toggle().querySelector<HTMLElement>("[data-qa-unseen-dot]")!;
    expect(getComputedStyle(dot).backgroundColor).toBe("rgb(232, 121, 249)");
    expect(toggle().getAttribute("aria-label")).toBe("QA score 78, new result");
    await view.rerender({ unseen: false });
    expect(toggle().querySelector("[data-qa-unseen-dot]")).toBeNull();
    expect(toggle().getAttribute("aria-label")).toBe("QA score 78");
  });

  it("active: #E9F1EF tile and fir icon, pressed", async () => {
    await render(QaToggle, { state: "done", score: 90, active: true, onToggle: vi.fn() });
    const node = toggle();
    expect(node.getAttribute("aria-pressed")).toBe("true");
    expect(getComputedStyle(node).backgroundColor).toBe("rgb(233, 241, 239)");
    expect(getComputedStyle(node.querySelector("[data-qa-shield]")!).color).toBe("rgb(10, 58, 56)");
  });
});
