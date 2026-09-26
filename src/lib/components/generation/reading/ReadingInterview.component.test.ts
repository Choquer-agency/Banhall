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
    expect(pill.style.boxShadow).toContain("0px 6px 24px");

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
    expect(document.querySelectorAll("[data-reading-fact]")).toHaveLength(2);
    expect(document.querySelector("[data-reading-bottom]")).toBeNull();
    tablet.unmount();

    await render(ReadingInterview, { generationId: GENERATION, layout: "phone", canEdit: true, onCancel });
    expect(text(document.querySelector("[data-reading-count]"))).toBe("6 facts");
    expect(document.querySelectorAll("[data-reading-fact]")).toHaveLength(2);
    expect(text(document.querySelector('[data-reading-fact="4"] [data-reading-source]'))).toBe("");
    expect(text(document.querySelector('[data-reading-fact="5"] [data-reading-source]'))).toBe("Priya, line 64");
    const bottom = document.querySelector<HTMLElement>("[data-reading-bottom]")!;
    expect(text(bottom)).toContain("You can leave. We will notify you when ideas are ready.");
    expect(document.querySelector("[data-reading-note]")).toBeNull();
    const cancel = bottom.querySelector<HTMLButtonElement>("[data-reading-cancel]")!;
    expect(getComputedStyle(cancel).backgroundColor).toBe("rgb(254, 226, 226)");
    expect(getComputedStyle(cancel).height).toBe("44px");
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
  it("replaces the reading with the danger box, Try again and Back to project", async () => {
    __setQueryData("seeds:getReadingFacts", view());
    const onBack = vi.fn();
    await render(ReadingInterview, { generationId: GENERATION, failed: true, canEdit: true, onBack });
    const box = document.querySelector<HTMLElement>("[data-reading-failed] [data-status-callout]")!;
    expect(box.dataset.statusCallout).toBe("danger");
    expect(text(box)).toContain("We could not read the transcripts");
    expect(text(box)).toContain("Your files are still here. Try again, or cancel to change them.");
    expect(document.querySelector("[data-reading-pill]")).toBeNull();
    const buttons = [...box.querySelectorAll("button")];
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
