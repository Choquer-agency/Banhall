import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import BanhallLogo from "./BanhallLogo.svelte";
import BanhallRailMark from "./BanhallRailMark.svelte";

describe("BanhallLogo", () => {
  it("uses the dark logo by default at 56px tall, keeping the 308 x 138 ratio", async () => {
    await render(BanhallLogo, {});
    const image = document.body.querySelector<HTMLImageElement>("img[data-banhall-logo]")!;
    expect(image.dataset.banhallLogo).toBe("dark");
    expect(image.getAttribute("src")).toBe("/banhall-logo-dark.png");
    expect(image.getAttribute("alt")).toBe("Banhall");
    expect(image.getBoundingClientRect()).toMatchObject({ width: 125, height: 56 });
  });

  it("uses the white logo on dark backgrounds at the requested height", async () => {
    await render(BanhallLogo, { tone: "white", height: 64 });
    const image = document.body.querySelector<HTMLImageElement>("img[data-banhall-logo]")!;
    expect(image.getAttribute("src")).toBe("/banhall-logo-white.png");
    expect(image.getBoundingClientRect()).toMatchObject({ width: 143, height: 64 });
  });
});

describe("BanhallRailMark", () => {
  it("clips the padding so the expanded mark is the 36px-tall artwork", async () => {
    await render(BanhallRailMark, {});
    const mark = document.body.querySelector<HTMLElement>("[data-banhall-rail-mark]")!;
    const image = mark.querySelector("img")!;
    expect(mark.dataset.banhallRailMark).toBe("expanded");
    expect(image.getAttribute("src")).toBe("/banhall-logo-dark.png");
    expect(image.getAttribute("alt")).toBe("Banhall");
    const box = mark.getBoundingClientRect();
    expect(box.height).toBeCloseTo(36, 0);
    expect(box.width).toBeCloseTo(95.07, 0);
    expect(getComputedStyle(mark).overflow).toBe("hidden");
    // Artwork starts 18 source px in and 15 down; both are cut away.
    expect(image.getBoundingClientRect().left - box.left).toBeCloseTo(-6.29, 1);
    expect(image.getBoundingClientRect().top - box.top).toBeCloseTo(-5.24, 1);
  });

  it("fits the 56px collapsed rail at 40px wide", async () => {
    await render(BanhallRailMark, { collapsed: true });
    const mark = document.body.querySelector<HTMLElement>("[data-banhall-rail-mark]")!;
    expect(mark.dataset.banhallRailMark).toBe("collapsed");
    expect(mark.getBoundingClientRect().width).toBeCloseTo(40, 0);
    expect(mark.getBoundingClientRect().height).toBeCloseTo(15.15, 0);
  });
});
