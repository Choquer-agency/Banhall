import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { tick } from "svelte";
import ReadingInterview from "./ReadingInterview.svelte";
import type { Id } from "../../../../../convex/_generated/dataModel";

const GENERATION = "generation-1" as Id<"generations">;
import {
  __mutationCalls,
  __resetConvexStub,
  __setMutationError,
  __setQueryData,
} from "$lib/test/convex-svelte-stub.svelte";

/**
 * Board F2 (and H3, H4): the centred pill counting the facts found so far,
 * its border filling in the AI gradient, and the three newest facts, newest
 * first, fading down the list. F6: the reading-failed danger box.
 */
const text = (node: Element | null | undefined) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();
const FACTS = [
  { seq: 6, chip: "Product name", quote: "We call the controller FrostLine, it sits on every compressor rack.", sourceLabel: "Priya, line 18" },
  { seq: 5, chip: "Uncertainty", quote: "Nobody knew if the load model would hold when doors open all day.", sourceLabel: "Priya, line 64" },
  { seq: 4, chip: "Fact", quote: "We ran three builds in the Delta warehouse over the summer.", sourceLabel: "Follow-up call, line 12" },
];

function view(overrides: Record<string, unknown> = {}) {
  return { count: 6, latest: FACTS, startedAt: Date.now() - 20_000, expectedMs: 40_000, done: false, ...overrides };
}

beforeEach(() => {
  __resetConvexStub();
});

describe("ReadingInterview", () => {
  it("shows the pill with the count and the three newest facts, fading down the list", async () => {
    __setQueryData("seeds:getReadingFacts", view());
    await render(ReadingInterview, { generationId: GENERATION, canEdit: true });
    const pill = document.querySelector<HTMLElement>("[data-reading-pill]")!;
    expect(text(pill)).toBe("Reading the interview 6 facts found so far");
    expect(pill.querySelectorAll('[data-ai-mark="aurora"]')).toHaveLength(1);
    const bar = pill.querySelector<HTMLElement>('[role="progressbar"]')!;
    // Half of the expected time has passed: about 50%, never past 95.
    expect(Number(bar.getAttribute("aria-valuenow"))).toBeGreaterThanOrEqual(45);
    expect(Number(bar.getAttribute("aria-valuenow"))).toBeLessThanOrEqual(95);
    // F2: the glow token, a 40px white pill with 9px and 16px padding.
    expect(getComputedStyle(pill).boxShadow).toContain("0px 6px 24px");
    const inner = pill.lastElementChild as HTMLElement;
    expect(getComputedStyle(inner).height).toBe("40px");
    expect(getComputedStyle(inner).paddingLeft).toBe("9px");
    expect(getComputedStyle(inner).paddingRight).toBe("16px");
    expect(getComputedStyle(inner).columnGap).toBe("10px");

    const cards = [...document.querySelectorAll<HTMLElement>("[data-reading-fact]")];
    expect(cards.map((card) => card.dataset.readingFact)).toEqual(["6", "5", "4"]);
    await expect.poll(() => cards.map((card) => getComputedStyle(card).opacity)).toEqual(["1", "0.6", "0.3"]);
    expect(text(cards[0].querySelector("[data-reading-chip]"))).toBe("Product name");
    expect(getComputedStyle(cards[0].querySelector("[data-reading-chip]")!).backgroundColor).toBe("rgb(213, 243, 241)");
    expect(text(cards[0].querySelector("[data-reading-source]"))).toBe("Priya, line 18");
    expect(text(cards[0].querySelector("[data-reading-quote]"))).toBe(
      '"We call the controller FrostLine, it sits on every compressor rack."'
    );
    expect(getComputedStyle(cards[0]).maxWidth).toBe("520px");
    expect(text(document.querySelector("[data-reading-note]"))).toBe(
      "You can leave this page. We will let you know when the first ideas are ready."
    );
    // The board's bell (14px, stroke 1.6), not a stand-in icon.
    const bell = document.querySelector("[data-reading-note] svg")!;
    expect(bell.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(bell.getAttribute("width")).toBe("14");
    expect(bell.getAttribute("stroke-width")).toBe("1.6");
    expect(bell.querySelector("path")!.getAttribute("d")).toBe("M5 17h14l-2-3V9a5 5 0 0 0-10 0v5Z M10 21h4");
    const chip = getComputedStyle(cards[0].querySelector("[data-reading-chip]")!);
    expect(chip.color).toBe("rgb(8, 122, 117)");
    expect(chip.borderRadius).toBe("5px");
    expect(chip.fontSize).toBe("11px");
    expect(document.body.textContent).not.toMatch(/[‐-―·]/);
  });

  it("says Looking for facts before the first one and uses the singular", async () => {
    __setQueryData("seeds:getReadingFacts", view({ count: 0, latest: [] }));
    const mounted = await render(ReadingInterview, { generationId: GENERATION });
    expect(text(document.querySelector("[data-reading-count]"))).toBe("Looking for facts");
    expect(document.querySelectorAll("[data-reading-fact]")).toHaveLength(0);
    mounted.unmount();
    __setQueryData("seeds:getReadingFacts", view({ count: 1, latest: [FACTS[0]] }));
    await render(ReadingInterview, { generationId: GENERATION });
    expect(text(document.querySelector("[data-reading-count]"))).toBe("1 fact found so far");
  });

  it("fills to 100% once the Brief has landed, and only moves forward", async () => {
    __setQueryData("seeds:getReadingFacts", view({ startedAt: Date.now() - 1_000_000 }));
    await render(ReadingInterview, { generationId: GENERATION });
    const bar = () => document.querySelector<HTMLElement>('[data-reading-pill] [role="progressbar"]')!;
    expect(bar().getAttribute("aria-valuenow")).toBe("95");
    // A later read with a longer estimate never pulls the fill back.
    __setQueryData("seeds:getReadingFacts", view({ startedAt: Date.now(), expectedMs: 1_000_000 }));
    await tick();
    expect(bar().getAttribute("aria-valuenow")).toBe("95");
    __setQueryData("seeds:getReadingFacts", view({ done: true }));
    await expect.poll(() => bar().getAttribute("aria-valuenow")).toBe("100");
  });

  it("announces a new fact politely", async () => {
    __setQueryData("seeds:getReadingFacts", view());
    await render(ReadingInterview, { generationId: GENERATION });
    const live = document.querySelector<HTMLElement>("[data-reading-announcement]")!;
    expect(live.getAttribute("aria-live")).toBe("polite");
    await expect.poll(() => text(live)).toBe(
      "New fact: Product name, We call the controller FrostLine, it sits on every compressor rack."
    );
  });

  it("does not move the cards under reduced motion", async () => {
    const matchMedia = vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) =>
        ({ matches: query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
    );
    try {
      __setQueryData("seeds:getReadingFacts", view({ latest: [] , count: 0}));
      await render(ReadingInterview, { generationId: GENERATION });
      __setQueryData("seeds:getReadingFacts", view({ latest: [FACTS[0]], count: 1 }));
      await tick();
      const card = document.querySelector<HTMLElement>("[data-reading-fact]")!;
      // No rise: the card is in place at once.
      expect(getComputedStyle(card).transform === "none" || getComputedStyle(card).transform === "matrix(1, 0, 0, 1, 0, 0)").toBe(true);
    } finally {
      matchMedia.mockRestore();
    }
  });

  it("shows two cards on a tablet and the phone layout with the bottom cancel (H3, H4)", async () => {
    __setQueryData("seeds:getReadingFacts", view());
    const onCancel = vi.fn();
    const tablet = await render(ReadingInterview, { generationId: GENERATION, layout: "tablet", canEdit: true, onCancel });
    const tabletCards = [...document.querySelectorAll<HTMLElement>("[data-reading-fact]")];
    expect(tabletCards).toHaveLength(2);
    await expect.poll(() => tabletCards.map((card) => getComputedStyle(card).opacity)).toEqual(["1", "0.55"]);
    // H3: pill and cards 12px apart.
    expect(getComputedStyle(document.querySelector<HTMLElement>("[data-reading-interview] > div")!).rowGap).toBe("12px");
    expect(document.querySelector("[data-reading-bottom]")).toBeNull();
    tablet.unmount();

    await render(ReadingInterview, { generationId: GENERATION, layout: "phone", canEdit: true, onCancel });
    expect(text(document.querySelector("[data-reading-count]"))).toBe("6 facts");
    // H4: three cards fading to 55% and 25%, 40px from the top, 16px margins.
    const phoneCards = [...document.querySelectorAll<HTMLElement>("[data-reading-fact]")];
    expect(phoneCards).toHaveLength(3);
    await expect.poll(() => phoneCards.map((card) => getComputedStyle(card).opacity)).toEqual(["1", "0.55", "0.25"]);
    const content = getComputedStyle(document.querySelector<HTMLElement>("[data-reading-interview] > div")!);
    expect(content.paddingTop).toBe("40px");
    expect(content.paddingLeft).toBe("16px");
    expect(content.justifyContent).toBe("normal");
    expect(text(document.querySelector('[data-reading-fact="4"] [data-reading-source]'))).toBe("Follow-up, line 12");
    expect(text(document.querySelector('[data-reading-fact="5"] [data-reading-source]'))).toBe("Priya, line 64");
    const bottom = document.querySelector<HTMLElement>("[data-reading-bottom]")!;
    expect(text(bottom)).toContain("You can leave. We will notify you when ideas are ready.");
    expect(document.querySelector("[data-reading-note]")).toBeNull();
    const cancel = bottom.querySelector<HTMLButtonElement>("[data-reading-cancel]")!;
    expect(getComputedStyle(cancel).backgroundColor).toBe("rgb(254, 226, 226)");
    expect(getComputedStyle(cancel).height).toBe("44px");
    expect(getComputedStyle(cancel).color).toBe("rgb(185, 28, 28)");
    expect(getComputedStyle(cancel).fontSize).toBe("15px");
    expect(getComputedStyle(cancel).borderRadius).toBe("8px");
    cancel.click();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("shortens the source on a phone", async () => {
    __setQueryData("seeds:getReadingFacts", view({ latest: [FACTS[2], FACTS[1]] }));
    await render(ReadingInterview, { generationId: GENERATION, layout: "phone" });
    expect(text(document.querySelector('[data-reading-fact="4"] [data-reading-source]'))).toBe("Follow-up, line 12");
  });
});

describe("ReadingInterview when reading failed (F6)", () => {
  it("replaces the reading with the danger box, Back to project and Try again", async () => {
    __setQueryData("seeds:getReadingFacts", view());
    const onBack = vi.fn();
    await render(ReadingInterview, { generationId: GENERATION, failed: true, canEdit: true, onBack });
    const box = document.querySelector<HTMLElement>("[data-reading-failed] [data-reading-failed-box]")!;
    expect(box.getAttribute("role")).toBe("alert");
    expect(text(box)).toContain("We could not read the transcripts");
    expect(text(box)).toContain("Your files are still here. Try again, or cancel to change them.");
    expect(document.querySelector("[data-reading-pill]")).toBeNull();
    // F6: red surface, #FECACA hairline, radius 12, 14px padding, 10px gap.
    const style = getComputedStyle(box);
    expect(style.backgroundColor).toBe("rgb(254, 242, 242)");
    expect(style.borderTopColor).toBe("rgb(254, 202, 202)");
    expect(style.borderRadius).toBe("12px");
    expect(style.padding).toBe("14px");
    expect(style.columnGap).toBe("10px");
    const icon = box.querySelector("svg")!;
    expect(icon.getAttribute("width")).toBe("18");
    expect(icon.querySelector("path")!.getAttribute("d")).toBe("M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M12 7.5V13 M12 16.3v.2");
    expect(getComputedStyle(box.querySelector("[data-reading-failed-body]")!).color).toBe("rgba(153, 27, 27, 0.8)");
    const buttons = [...box.querySelectorAll("button")];
    // Back to project first (soft red), then Try again (solid red), 28px.
    expect(buttons.map((button) => text(button))).toEqual(["Back to project", "Try again"]);
    expect(getComputedStyle(buttons[0]).backgroundColor).toBe("rgb(254, 226, 226)");
    expect(getComputedStyle(buttons[0]).color).toBe("rgb(153, 27, 27)");
    expect(getComputedStyle(buttons[1]).backgroundColor).toBe("rgb(220, 38, 38)");
    expect(getComputedStyle(buttons[1]).height).toBe("28px");
    expect(getComputedStyle(buttons[1]).borderRadius).toBe("6px");
    buttons.find((button) => text(button) === "Try again")!.click();
    await expect.poll(() => __mutationCalls("generations:retryInitializeSeedStage")).toEqual([{ generationId: "generation-1" }]);
    buttons.find((button) => text(button) === "Back to project")!.click();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("says why a retry was refused", async () => {
    __setMutationError("generations:retryInitializeSeedStage", new Error("Seed preparation is already running"));
    await render(ReadingInterview, { generationId: GENERATION, failed: true, canEdit: true, onBack: vi.fn() });
    [...document.querySelectorAll<HTMLButtonElement>("[data-reading-failed] button")].find((button) => text(button) === "Try again")!.click();
    await expect.poll(() => text(document.querySelector("[data-reading-retry-error]"))).not.toBe("");
  });

  it("shows only the text to someone who cannot edit", async () => {
    await render(ReadingInterview, { generationId: GENERATION, failed: true, canEdit: false, onBack: vi.fn() });
    expect(document.querySelectorAll("[data-reading-failed] button")).toHaveLength(0);
    expect(text(document.querySelector("[data-reading-failed]"))).toContain("We could not read the transcripts");
  });
});
