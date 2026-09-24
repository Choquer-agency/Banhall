import { afterEach, describe, expect, it, vi } from "vitest";
import { cdp } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { tick } from "svelte";
import DraftReadyToast from "./DraftReadyToast.svelte";

const toast = () => document.querySelector<HTMLElement>("[data-draft-ready-toast]")!;

afterEach(async () => {
  vi.useRealTimers();
  await cdp().send("Emulation.setEmulatedMedia", { features: [] });
});

describe("DraftReadyToast", () => {
  it("shows the Aurora check, the copy, the QA spinner and a close button", async () => {
    await render(DraftReadyToast, { onClose: vi.fn() });
    const node = toast();
    expect(node.getAttribute("role")).toBe("status");
    expect(node.querySelector('[data-ai-mark="aurora"][data-ai-mark-glyph="check"]')).not.toBeNull();
    expect(node.textContent).toContain("Your draft is ready");
    const running = node.querySelector("[data-toast-qa-running]")!;
    expect(running.textContent).toContain("QA is checking it");
    expect(running.querySelector('[data-ai-mark-glyph="spinner"]')).not.toBeNull();
    expect(node.querySelector("[data-toast-close]")?.getAttribute("aria-label")).toBe("Close");
    const drain = node.querySelector<HTMLElement>("[data-toast-drain]")!;
    expect(drain.classList.contains("toast-drain")).toBe(true);
    expect(getComputedStyle(drain).animationName).toBe("toast-drain");
    expect(getComputedStyle(drain).animationDuration).toBe("5s");
    expect(getComputedStyle(drain).transformOrigin.startsWith("0px")).toBe(true);
  });

  it("hides the QA line once QA is no longer running", async () => {
    await render(DraftReadyToast, { onClose: vi.fn(), qaRunning: false });
    expect(toast().querySelector("[data-toast-qa-running]")).toBeNull();
  });

  it("closes itself after 5s, fading first", async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    await render(DraftReadyToast, { onClose });
    vi.advanceTimersByTime(4_999);
    await tick();
    expect(onClose).not.toHaveBeenCalled();
    expect(toast().dataset.fading).toBe("false");
    vi.advanceTimersByTime(1);
    await tick();
    expect(toast().dataset.fading).toBe("true");
    expect(onClose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("pauses on hover and resumes with the time that was left", async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    await render(DraftReadyToast, { onClose });
    vi.advanceTimersByTime(2_000);
    toast().dispatchEvent(new PointerEvent("pointerenter"));
    await tick();
    expect(toast().dataset.paused).toBe("true");
    expect(toast().querySelector("[data-toast-drain]")?.classList.contains("is-paused")).toBe(true);
    vi.advanceTimersByTime(20_000);
    await tick();
    expect(onClose).not.toHaveBeenCalled();
    toast().dispatchEvent(new PointerEvent("pointerleave"));
    await tick();
    vi.advanceTimersByTime(2_999);
    await tick();
    expect(toast().dataset.fading).toBe("false");
    vi.advanceTimersByTime(1);
    await tick();
    vi.advanceTimersByTime(300);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("pauses while focus is inside", async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    await render(DraftReadyToast, { onClose });
    toast().querySelector<HTMLButtonElement>("[data-toast-close]")!.focus();
    await tick();
    expect(toast().dataset.paused).toBe("true");
    vi.advanceTimersByTime(10_000);
    await tick();
    expect(onClose).not.toHaveBeenCalled();
    toast().querySelector<HTMLButtonElement>("[data-toast-close]")!.blur();
    await tick();
    vi.advanceTimersByTime(5_300);
    await tick();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes at once from the close button, only once", async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    await render(DraftReadyToast, { onClose });
    toast().querySelector<HTMLButtonElement>("[data-toast-close]")!.click();
    expect(onClose).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(6_000);
    await tick();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("still times the close under reduced motion, without the fade delay", async () => {
    await cdp().send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
    vi.useFakeTimers();
    const onClose = vi.fn();
    await render(DraftReadyToast, { onClose });
    const drain = toast().querySelector<HTMLElement>("[data-toast-drain]")!;
    expect(getComputedStyle(drain).opacity).toBe("0");
    expect(getComputedStyle(toast()).transitionProperty).toBe("none");
    vi.advanceTimersByTime(5_000);
    await tick();
    expect(toast().dataset.fading).toBe("true");
    expect(window.matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(true);
    vi.advanceTimersByTime(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
