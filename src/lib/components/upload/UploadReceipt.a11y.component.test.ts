// The playwright provider augments CDPSession with `send`; without this
// reference the type resolves to the bare interface even though the method is
// there at runtime.
/// <reference types="@vitest/browser-playwright" />
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { cdp, page, userEvent } from "vitest/browser";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { ReceiptRow } from "$lib/uploads/receiptRows";
import UploadReceipt from "./UploadReceipt.svelte";

/**
 * The automated oracle for "component states; keyboard nav" (AC5). A human
 * decision funded this suite instead of a manual checklist, so these assertions
 * measure real behaviour in a real browser: actual Tab traversal, computed
 * styles, and measured geometry — never class names.
 */

const ROWS: ReceiptRow[] = [
  {
    key: "d1",
    fileName: "notes.docx",
    documentId: "d1" as Id<"projectDocuments">,
    status: "ready",
    detail: "text_extracted",
    canRetry: false,
    canReplace: false,
    canRemove: true,
  },
  {
    key: "d2",
    fileName: "scan.pdf",
    documentId: "d2" as Id<"projectDocuments">,
    status: "could_not_read",
    detail: "no_text_extracted",
    canRetry: false,
    canReplace: true,
    canRemove: true,
  },
  {
    key: "local:a3",
    fileName: "budget.xlsx",
    attemptKey: "a3",
    status: "upload_failed",
    canRetry: true,
    canReplace: false,
    canRemove: true,
  },
  {
    key: "attempt:a4",
    fileName: "minutes.pdf",
    attemptKey: "a4",
    status: "upload_failed",
    canRetry: false,
    canReplace: true,
    canRemove: true,
  },
];

const EXPECTED_TAB_ORDER = [
  "Remove — notes.docx",
  "Replace file… — scan.pdf",
  "Remove — scan.pdf",
  "Retry — budget.xlsx",
  "Remove — budget.xlsx",
  "Replace file… — minutes.pdf",
  "Remove — minutes.pdf",
];

const accessibleName = (el: Element) =>
  el.getAttribute("aria-label") ?? el.textContent?.trim() ?? "";

async function renderReceipt(rows: ReceiptRow[] = ROWS) {
  return await render(UploadReceipt, {
    rows,
    onRetry: vi.fn(),
    onReplace: vi.fn(),
    onRemove: vi.fn(),
  });
}

describe("keyboard navigation", () => {
  it("reaches every action in reading order, then leaves the receipt", async () => {
    const { container } = await renderReceipt();
    const visited: string[] = [];

    for (let i = 0; i < EXPECTED_TAB_ORDER.length; i++) {
      await userEvent.tab();
      const active = document.activeElement!;
      expect(container.contains(active), `stop ${i}`).toBe(true);
      visited.push(accessibleName(active));
    }

    expect(visited).toEqual(EXPECTED_TAB_ORDER);
    await userEvent.tab();
    expect(container.contains(document.activeElement)).toBe(false);
  });

  it("never reorders focus with a positive tabindex", async () => {
    const { container } = await renderReceipt();
    for (const el of container.querySelectorAll("[tabindex]")) {
      expect(Number(el.getAttribute("tabindex")), el.tagName).toBeLessThanOrEqual(0);
    }
  });

  it("shows a visible focus ring on every keyboard stop", async () => {
    const { container } = await renderReceipt();
    for (let i = 0; i < EXPECTED_TAB_ORDER.length; i++) {
      await userEvent.tab();
      const active = document.activeElement as HTMLElement;
      // Must be real keyboard focus: browsers withhold :focus-visible from
      // programmatic .focus(), so a scripted focus would prove nothing.
      expect(active.matches(":focus-visible"), EXPECTED_TAB_ORDER[i]).toBe(true);
      const style = getComputedStyle(active);
      const ringed = style.outlineStyle !== "none" || style.boxShadow !== "none";
      expect(ringed, EXPECTED_TAB_ORDER[i]).toBe(true);
      expect(container.contains(active)).toBe(true);
    }
  });

  it("gives every control a name, and uses no bare title tooltips", async () => {
    const { container } = await renderReceipt();
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons).toHaveLength(EXPECTED_TAB_ORDER.length);
    for (const button of buttons) {
      expect(accessibleName(button).length).toBeGreaterThan(0);
    }
    expect(container.querySelectorAll("[title]")).toHaveLength(0);
  });

  it("activates a control with both Enter and Space", async () => {
    const onRetry = vi.fn();
    await render(UploadReceipt, {
      rows: ROWS,
      onRetry,
      onReplace: vi.fn(),
      onRemove: vi.fn(),
    });

    // Tab to "Retry — budget.xlsx" (the fourth stop).
    for (let i = 0; i < 4; i++) await userEvent.tab();
    expect(accessibleName(document.activeElement!)).toBe("Retry — budget.xlsx");

    await userEvent.keyboard("{Enter}");
    expect(onRetry).toHaveBeenCalledTimes(1);
    await userEvent.keyboard(" ");
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenLastCalledWith(ROWS[2]);
  });
});

describe("layout on a small screen", () => {
  it("keeps every control at least 44px in both directions", async () => {
    await page.viewport(375, 812);
    const { container } = await renderReceipt();

    const buttons = [...container.querySelectorAll("button")];
    // Without this, a render regression that produces no buttons would make
    // the loop below pass by doing nothing.
    expect(buttons).toHaveLength(EXPECTED_TAB_ORDER.length);

    for (const button of buttons) {
      const rect = button.getBoundingClientRect();
      expect(rect.height, accessibleName(button)).toBeGreaterThanOrEqual(44);
      expect(rect.width, accessibleName(button)).toBeGreaterThanOrEqual(44);
    }

    // The file inputs are 0×0 on purpose — the visible button is the control,
    // so they are excluded from the touch-target rule rather than failing it.
    for (const input of container.querySelectorAll('input[type="file"]')) {
      expect(getComputedStyle(input).display).toBe("none");
    }
  });

  it("stacks rows without overlapping or spilling off screen", async () => {
    await page.viewport(375, 812);
    const { container } = await renderReceipt();
    const rects = [...container.querySelectorAll("li")].map((li) =>
      li.getBoundingClientRect()
    );
    expect(rects).toHaveLength(ROWS.length);

    for (let i = 1; i < rects.length; i++) {
      // Allow a hairline for the divider.
      expect(rects[i].top).toBeGreaterThanOrEqual(rects[i - 1].bottom - 1);
    }
    for (const rect of rects) {
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.right).toBeLessThanOrEqual(375);
    }
  });
});

describe("reduced motion", () => {
  it("stops the loading spinner animating when the user asks for less motion", async () => {
    const rows: ReceiptRow[] = [
      ...ROWS,
      {
        key: "local:a5",
        fileName: "photo.png",
        attemptKey: "a5",
        status: null,
        canRetry: false,
        canReplace: false,
        canRemove: false,
      },
    ];
    const { container } = await renderReceipt(rows);

    await cdp().send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });

    try {
      // Fail loudly here if the emulation never reached this frame, rather than
      // letting the sweep below pass for the wrong reason.
      expect(window.matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(true);
      for (const el of container.querySelectorAll("*")) {
        expect(getComputedStyle(el).animationName, el.className.toString()).toBe("none");
      }
    } finally {
      await cdp().send("Emulation.setEmulatedMedia", { features: [] });
    }
  });
});
