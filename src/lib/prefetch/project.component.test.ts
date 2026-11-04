import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadPreviewProjectPage } from "$lib/components/project/projectPageModules";
import { startProjectPrefetch } from "./project";

vi.mock("$lib/components/project/projectPageModules", () => ({
  loadPreviewProjectPage: vi.fn(async () => ({ default: null })),
}));

beforeEach(() => {
  vi.mocked(loadPreviewProjectPage).mockClear();
});

afterEach(() => {
  document.body.innerHTML = "";
});

it("warms project code on link hover or focus across the signed-in shell", async () => {
  const idle = vi.spyOn(window, "requestIdleCallback").mockImplementation(() => 1);
  const root = document.createElement("div");
  document.body.append(root);
  const stop = startProjectPrefetch(root);
  try {
    for (const href of ["/project/new", "/project/questionnaire", "https://example.invalid/project/other"]) {
      const link = document.createElement("a");
      link.href = href;
      root.append(link);
      link.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
      link.remove();
    }
    expect(loadPreviewProjectPage).not.toHaveBeenCalled();

    const link = document.createElement("a");
    link.href = "/project/report-1";
    root.append(link);
    link.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    await expect.poll(() => vi.mocked(loadPreviewProjectPage).mock.calls.length).toBe(1);
    link.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await expect.poll(() => vi.mocked(loadPreviewProjectPage).mock.calls.length).toBe(2);
  } finally {
    stop();
    idle.mockRestore();
  }
});

/**
 * Live test 2026-09-26 (P2): a prepared start showed "Loading report
 * workspace..." for 10 s while the project page's code loaded. The signed-in
 * shell now warms that code once the browser is idle on every page, New
 * project included, and stops if the shell closes first.
 */
it("warms the project page code once the browser is idle, and not after it stops", async () => {
  let runIdle: (() => void) | undefined;
  const idle = vi.spyOn(window, "requestIdleCallback").mockImplementation((callback) => {
    runIdle = () => callback({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline);
    return 7;
  });
  const cancel = vi.spyOn(window, "cancelIdleCallback").mockImplementation(() => undefined);
  try {
    const stop = startProjectPrefetch(document.body);
    expect(loadPreviewProjectPage).not.toHaveBeenCalled();
    runIdle?.();
    await expect.poll(() => vi.mocked(loadPreviewProjectPage).mock.calls.length).toBe(1);
    stop();

    const stopEarly = startProjectPrefetch(document.body);
    stopEarly();
    expect(cancel).toHaveBeenCalledWith(7);
  } finally {
    idle.mockRestore();
    cancel.mockRestore();
  }
});
