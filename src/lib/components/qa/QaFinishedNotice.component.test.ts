import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import QaFinishedNotice from "./QaFinishedNotice.svelte";

const sections = [
  { key: "242", number: "242", name: "Uncertainty", score: 86 },
  { key: "244", number: "244", name: "Work performed", score: 62 },
  { key: "246", number: "246", name: "Advancement", score: 84 },
];
const notice = () => document.querySelector<HTMLElement>("[data-qa-finished-notice]")!;
const now = 1_800_000_000_000;

describe("QaFinishedNotice", () => {
  it("shows the header, overall band chip and one row per Section", async () => {
    await render(QaFinishedNotice, {
      overallScore: 78,
      sections,
      completedAt: now - 10_000,
      now,
      onOpen: vi.fn(),
      onDismiss: vi.fn(),
    });
    const node = notice();
    expect(Math.round(node.getBoundingClientRect().width)).toBe(340);
    expect(getComputedStyle(node).borderTopLeftRadius).toBe("14px");
    expect(node.querySelector("[data-ai-mark]")).toBeNull();
    expect(node.querySelector("h2")?.textContent).toBe("QA finished");
    expect(node.querySelector("[data-qa-finished-time]")?.textContent).toBe("Just now");

    const chip = node.querySelector<HTMLElement>("[data-qa-overall-chip]")!;
    expect(chip.textContent).toBe("78");
    expect(getComputedStyle(chip).backgroundColor).toBe("rgb(255, 237, 213)");
    expect(getComputedStyle(chip).color).toBe("rgb(194, 65, 12)");

    const rows = [...node.querySelectorAll<HTMLElement>("[data-qa-section-row]")];
    expect(rows.map((row) => row.textContent?.replace(/\s+/g, " ").trim())).toEqual([
      "242 Uncertainty 86",
      "244 Work performed 62",
      "246 Advancement 84",
    ]);
    const bars = rows.map((row) => row.querySelector<HTMLElement>("[data-qa-section-bar]")!);
    expect(bars.map((bar) => getComputedStyle(bar).backgroundColor)).toEqual([
      "rgb(22, 163, 74)",
      "rgb(245, 158, 11)",
      "rgb(22, 163, 74)",
    ]);
    const track = bars[0].parentElement!.getBoundingClientRect();
    expect(Math.round(track.width)).toBe(64);
    expect(Math.round(track.height)).toBe(3);
    expect(getComputedStyle(rows[0].firstElementChild!).fontFamily).toMatch(/mono/i);
    for (const el of node.querySelectorAll<HTMLElement>("*")) {
      expect(Number(getComputedStyle(el).fontWeight)).toBeLessThanOrEqual(500);
    }
  });

  it("reads a relative time for older results", async () => {
    await render(QaFinishedNotice, {
      overallScore: 55,
      sections,
      completedAt: now - 5 * 60_000,
      now,
      onOpen: vi.fn(),
      onDismiss: vi.fn(),
    });
    expect(notice().querySelector("[data-qa-finished-time]")?.textContent).toBe("5 minutes ago");
    expect(getComputedStyle(notice().querySelector("[data-qa-overall-chip]")!).backgroundColor).toBe("rgb(254, 226, 226)");
  });

  it("routes Open QA, Later and close to their callbacks", async () => {
    const onOpen = vi.fn();
    const onLater = vi.fn();
    const onDismiss = vi.fn();
    await render(QaFinishedNotice, { overallScore: 78, sections, now, onOpen, onLater, onDismiss });
    const later = notice().querySelector<HTMLButtonElement>("[data-qa-later]")!;
    const open = notice().querySelector<HTMLButtonElement>("[data-qa-open]")!;
    expect(later.textContent?.trim()).toBe("Later");
    expect(open.textContent?.trim()).toBe("Open QA");
    expect(getComputedStyle(later).borderTopColor).toBe("rgba(0, 0, 0, 0)");
    expect(getComputedStyle(open).backgroundColor).toBe("rgb(8, 122, 117)");
    open.click();
    later.click();
    notice().querySelector<HTMLButtonElement>("[data-qa-finished-close]")!.click();
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onLater).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("falls back to dismiss for Later and stays until acted on", async () => {
    const onDismiss = vi.fn();
    await render(QaFinishedNotice, { overallScore: 78, sections, now, onOpen: vi.fn(), onDismiss });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(document.querySelector("[data-qa-finished-notice]")).not.toBeNull();
    notice().querySelector<HTMLButtonElement>("[data-qa-later]")!.click();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
