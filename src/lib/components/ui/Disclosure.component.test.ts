import { beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import DisclosureFixture from "./DisclosureFixture.svelte";

/**
 * Shared disclosure primitive (2026-08-08 amendment): animated enter+exit
 * ≥300ms via grid-template-rows (never content snapping behind a lone
 * chevron animation), correct aria lifecycle, no tabbable content while
 * collapsed, and truthful unmount after the exit settles.
 */
const trigger = () => document.querySelector<HTMLButtonElement>("[data-fixture-trigger]");
const wrapper = () => document.querySelector<HTMLElement>("[data-disclosure]");
const body = () => document.getElementById("disclosure-fixture-body");

describe("Disclosure", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("starts closed with no mounted body and aria-expanded=false", async () => {
    await render(DisclosureFixture, {});

    expect(trigger()?.getAttribute("aria-expanded")).toBe("false");
    expect(trigger()?.getAttribute("aria-controls")).toBe("disclosure-fixture-body");
    // Never-opened sections keep an empty DOM — nothing rendered, nothing
    // tabbable.
    expect(body()).toBeNull();
    expect(document.querySelector("[data-fixture-link]")).toBeNull();
  });

  it("opens with a ≥300ms grid-rows transition and exposes the body to focus", async () => {
    await render(DisclosureFixture, {});

    const style = getComputedStyle(wrapper()!);
    // Motivated-motion markers: the wrapper transitions grid-template-rows
    // for at least 300ms (enter AND exit ride the same transition).
    expect(style.transitionProperty).toContain("grid-template-rows");
    expect(Number.parseFloat(style.transitionDuration)).toBeGreaterThanOrEqual(0.3);

    trigger()?.click();
    await expect.poll(() => trigger()?.getAttribute("aria-expanded")).toBe("true");
    await expect.poll(() => body()).not.toBeNull();
    expect(body()?.hasAttribute("inert")).toBe(false);
    // The body opens to its intrinsic height (grid track grows to 1fr).
    await expect.poll(() => wrapper()!.getBoundingClientRect().height).toBeGreaterThan(20);
    const link = document.querySelector<HTMLAnchorElement>("[data-fixture-link]");
    link?.focus();
    expect(document.activeElement).toBe(link);
  });

  it("closes with an animated exit: body goes inert immediately, unmounts after the transition", async () => {
    await render(DisclosureFixture, { initialOpen: true });
    await expect.poll(() => body()).not.toBeNull();

    trigger()?.click();
    await expect.poll(() => trigger()?.getAttribute("aria-expanded")).toBe("false");
    // During the exit the content is still mounted (something to collapse
    // over) but inert — not tabbable, hidden from AT.
    const closing = body();
    if (closing) {
      expect(closing.hasAttribute("inert")).toBe(true);
      const link = document.querySelector<HTMLAnchorElement>("[data-fixture-link]");
      link?.focus();
      expect(document.activeElement).not.toBe(link);
    }
    // After the exit settles the body unmounts entirely (DOM truth).
    await expect.poll(() => body(), { timeout: 2000 }).toBeNull();
    await expect.poll(() => wrapper()!.getBoundingClientRect().height).toBeLessThan(2);
  });

  it("follows chevron rule 7: down when closed, rotated up + primary when open", async () => {
    await render(DisclosureFixture, {});

    const chevron = () => document.querySelector<HTMLElement>("[data-disclosure-chevron]");
    expect(chevron()?.classList.contains("rotate-180")).toBe(false);
    trigger()?.click();
    await expect.poll(() => chevron()?.classList.contains("rotate-180")).toBe(true);
    expect(chevron()?.classList.contains("text-primary-selected")).toBe(true);
  });
});
