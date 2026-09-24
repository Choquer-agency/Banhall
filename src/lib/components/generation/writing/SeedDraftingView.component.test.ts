import { afterEach, describe, expect, it, vi } from "vitest";
import { cdp } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { tick } from "svelte";
import SeedDraftingView from "./SeedDraftingView.svelte";
import type { SeedDraftProgress } from "./types";

function progress(overrides: Partial<SeedDraftProgress> = {}): SeedDraftProgress {
  return {
    phase: "drafting",
    percent: 55,
    estimatedRemainingMs: 60_000,
    currentSectionKey: "244",
    stoppedAfterSectionKey: null,
    sections: [
      {
        key: "242",
        number: "242",
        title: "Technological uncertainty",
        question: "What scientific or technological uncertainties did you attempt to overcome?",
        orderIndex: 0,
        status: "done",
        paragraphs: ["First paragraph.", "Second paragraph.", "Third.", "Fourth.", "Fifth.", "Sixth."],
        startedAt: 1,
        completedAt: 2,
      },
      {
        key: "244",
        number: "244",
        title: "Work performed",
        question: "What work did you perform to overcome these uncertainties?",
        orderIndex: 1,
        status: "writing",
        paragraphs: [],
        startedAt: 3,
        completedAt: null,
      },
      {
        key: "246",
        number: "246",
        title: "Technological advancement",
        question: "What scientific or technological advancements did you achieve?",
        orderIndex: 2,
        status: "queued",
        paragraphs: [],
        startedAt: null,
        completedAt: null,
      },
    ],
    ...overrides,
  };
}

const q = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector);
const qa = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)];

afterEach(async () => {
  await cdp().send("Emulation.setEmulatedMedia", { features: [] });
  document.querySelectorAll("[data-test-scroller]").forEach((node) => node.remove());
});

describe("SeedDraftingView", () => {
  it("renders the status pill with the Aurora mark, section, percent, time and Stop", async () => {
    const onStop = vi.fn();
    await render(SeedDraftingView, { progress: progress(), reportTitle: "Adaptive cold storage controls", onStop });

    const pill = q("[data-writing-pill]")!;
    expect(pill.querySelector('[data-ai-mark="aurora"]')).not.toBeNull();
    expect(q("[data-pill-headline]")?.textContent).toBe("Writing section 244");
    expect(q("[data-pill-detail]")?.textContent).toBe("55%, about 1 minute left");
    const bar = q("[data-pill-progress]")!;
    expect(bar.getAttribute("role")).toBe("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("55");
    expect(bar.style.transform).toBe("scaleX(0.55)");
    expect(getComputedStyle(pill).backgroundColor).toBe("rgb(225, 233, 231)");

    const stop = q<HTMLButtonElement>("[data-pill-stop]")!;
    expect(stop.textContent?.trim()).toBe("Stop");
    expect(getComputedStyle(stop).borderTopWidth).toBe("0px");
    stop.click();
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("gives the draft title the host's heading id as a focus target", async () => {
    await render(SeedDraftingView, { progress: progress(), reportTitle: "Adaptive cold storage controls", headingId: "draft-heading" });
    const heading = document.getElementById("draft-heading")!;
    expect(heading.tagName).toBe("H2");
    expect(heading.getAttribute("tabindex")).toBe("-1");
    heading.focus();
    expect(document.activeElement).toBe(heading);
  });

  it("renders the report body per Section status", async () => {
    await render(SeedDraftingView, { progress: progress(), reportTitle: "Adaptive cold storage controls" });

    // The host's top bar owns the page h1; the draft title is an h2 and each
    // Section question an h3.
    expect(q("h1")).toBeNull();
    expect(q("h2")?.textContent).toBe("Adaptive cold storage controls");
    expect(qa("h3").map((heading) => heading.textContent)).toEqual([
      "What scientific or technological uncertainties did you attempt to overcome?",
      "What work did you perform to overcome these uncertainties?",
      "What scientific or technological advancements did you achieve?",
    ]);
    const text = q("[data-drafting-report]")!.textContent!;
    expect(text).toContain("242 Technological uncertainty");
    expect(text).toContain("What work did you perform to overcome these uncertainties?");

    const done = q('[data-section-status="done"]')!;
    const paragraphs = [...done.querySelectorAll<HTMLElement>("[data-revealed-paragraph]")];
    expect(paragraphs).toHaveLength(6);
    expect(paragraphs.every((p) => p.classList.contains("fade-rise"))).toBe(true);
    expect(paragraphs.map((p) => p.style.animationDelay)).toEqual(["0ms", "60ms", "120ms", "180ms", "240ms", "240ms"]);
    expect(getComputedStyle(paragraphs[0]).fontFamily).toMatch(/Georgia|serif/i);

    const writing = q('[data-section-status="writing"]')!;
    expect(writing.querySelectorAll('[data-skeleton-line="writing"]')).toHaveLength(4);
    expect(writing.querySelectorAll(".skeleton-shimmer")).toHaveLength(4);

    const queued = q('[data-section-status="queued"]')!;
    expect(queued.querySelectorAll('[data-skeleton-line="queued"]')).toHaveLength(3);
    expect(Number(getComputedStyle(queued).opacity)).toBeLessThan(1);
  });

  it("uses the grey skeleton by default and the Aurora one only behind the flag, never mixed", async () => {
    const grey = await render(SeedDraftingView, { progress: progress(), reportTitle: "T" });
    expect(q("[data-seed-drafting-view]")?.dataset.skeletonStyle).toBe("grey");
    for (const line of qa('[data-skeleton-line="writing"]')) {
      expect(getComputedStyle(line).backgroundColor).toBe("rgb(232, 238, 237)");
      expect(getComputedStyle(line).backgroundImage).toBe("none");
    }
    await grey.unmount();

    await render(SeedDraftingView, { progress: progress(), reportTitle: "T", skeletonStyle: "aurora" });
    expect(q("[data-seed-drafting-view]")?.dataset.skeletonStyle).toBe("aurora");
    for (const line of qa("[data-skeleton-line]")) {
      expect(getComputedStyle(line).backgroundImage).toContain("linear-gradient");
    }
  });

  it("only moves the percent forward when the server value regresses", async () => {
    const view = await render(SeedDraftingView, { progress: progress({ percent: 55 }), reportTitle: "T" });
    await view.rerender({ progress: progress({ percent: 40, estimatedRemainingMs: 20_000 }) });
    expect(q("[data-pill-detail]")?.textContent).toBe("55%, less than a minute left");
    expect(q("[data-pill-progress]")?.getAttribute("aria-valuenow")).toBe("55");
    await view.rerender({ progress: progress({ percent: 72, estimatedRemainingMs: null }) });
    expect(q("[data-pill-detail]")?.textContent).toBe("72%");
    expect(q("[data-pill-progress]")?.style.transform).toBe("scaleX(0.72)");
  });

  it("omits the time when there is no estimate and says minutes plainly", async () => {
    const view = await render(SeedDraftingView, {
      progress: progress({ estimatedRemainingMs: null }),
      reportTitle: "T",
    });
    expect(q("[data-pill-detail]")?.textContent).toBe("55%");
    await view.rerender({ progress: progress({ estimatedRemainingMs: 3 * 60_000 }) });
    expect(q("[data-pill-detail]")?.textContent).toBe("55%, about 3 minutes left");
  });

  it("shows the stopping phase without a Stop button", async () => {
    await render(SeedDraftingView, {
      progress: progress({ phase: "stopping", stoppedAfterSectionKey: "244" }),
      reportTitle: "T",
      onStop: vi.fn(),
    });
    expect(q("[data-pill-headline]")?.textContent).toBe("Stopping after section 244");
    expect(q("[data-pill-stop]")).toBeNull();
  });

  it("marks Not drafted Sections and hides the pill once stopped", async () => {
    const stopped = progress({
      phase: "stopped",
      currentSectionKey: null,
      stoppedAfterSectionKey: "242",
    });
    stopped.sections = stopped.sections.map((section) =>
      section.key === "242" ? section : { ...section, status: "not_drafted" as const }
    );
    await render(SeedDraftingView, { progress: stopped, reportTitle: "T", onStop: vi.fn() });

    expect(q("[data-writing-pill]")).toBeNull();
    expect(q("[data-writing-ring]")).toBeNull();
    const markers = qa("[data-not-drafted-marker]");
    expect(markers).toHaveLength(2);
    expect(markers.every((marker) => marker.textContent === "Not drafted")).toBe(true);
    expect(qa("[data-skeleton-line]")).toHaveLength(0);
  });

  it("collapses to the corner ring on scroll down and reopens on scroll up or hover", async () => {
    const scroller = document.createElement("div");
    scroller.dataset.testScroller = "";
    scroller.style.cssText = "height:200px;overflow:auto";
    scroller.innerHTML = '<div style="height:2000px"></div>';
    document.body.appendChild(scroller);

    await render(SeedDraftingView, { progress: progress(), reportTitle: "T", scrollContainer: scroller });
    const pill = q("[data-writing-pill]")!;
    const ring = q<HTMLButtonElement>("[data-writing-ring]")!;
    expect(pill.dataset.collapsed).toBe("false");
    expect(ring.dataset.open).toBe("false");
    expect(ring.inert).toBe(true);

    const scrollTo = async (top: number) => {
      scroller.scrollTop = top;
      scroller.dispatchEvent(new Event("scroll"));
      await tick();
    };

    await scrollTo(300);
    expect(pill.dataset.collapsed).toBe("true");
    expect(pill.inert).toBe(true);
    expect(ring.dataset.open).toBe("true");
    expect(ring.inert).toBe(false);
    expect(ring.querySelector('[data-ai-mark="aurora"]')).not.toBeNull();
    expect(ring.getAttribute("aria-label")).toBe("Writing section 244, 55%, about 1 minute left. Show progress");
    expect(ring.style.background).toContain("conic-gradient");
    await new Promise((resolve) => setTimeout(resolve, 260));
    const box = ring.getBoundingClientRect();
    expect(Math.round(box.width)).toBe(48);
    expect(Math.round(box.height)).toBe(48);

    await scrollTo(200);
    expect(pill.dataset.collapsed).toBe("false");

    await scrollTo(600);
    expect(pill.dataset.collapsed).toBe("true");
    ring.dispatchEvent(new PointerEvent("pointerenter"));
    await tick();
    expect(pill.dataset.collapsed).toBe("false");
  });

  it("keeps the same states without animation under reduced motion", async () => {
    await render(SeedDraftingView, { progress: progress(), reportTitle: "T" });
    const shimmer = q(".skeleton-shimmer")!;
    const glint = q("[data-pill-glint]")!;
    const paragraph = q("[data-revealed-paragraph]")!;
    expect(getComputedStyle(shimmer).animationName).toBe("skeleton-shimmer");
    expect(getComputedStyle(glint).animationName).toBe("aurora-glint-travel");

    await cdp().send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
    expect(window.matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(true);
    expect(getComputedStyle(shimmer).animationName).toBe("none");
    expect(getComputedStyle(glint).animationName).toBe("none");
    expect(getComputedStyle(paragraph).animationName).toBe("none");
    expect(getComputedStyle(paragraph).opacity).toBe("1");
    expect(getComputedStyle(q("[data-writing-pill]")!).transitionProperty).toBe("none");
    // Same states: headline, skeleton and revealed text are all still there.
    expect(q("[data-pill-headline]")?.textContent).toBe("Writing section 244");
    expect(qa('[data-skeleton-line="writing"]')).toHaveLength(4);
  });
});
