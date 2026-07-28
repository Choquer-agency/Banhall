import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import {
  PROCESSING_STATUSES,
  type ReceiptStatus,
} from "../../../../shared/documentStatus";
import { PROCESSING_STATUS_COPY, LOADING_COPY } from "$lib/uploads/processingStatus";
import ProcessingStatusBadge from "./ProcessingStatusBadge.svelte";

const ALL_STATUSES: ReceiptStatus[] = [...PROCESSING_STATUSES, "upload_failed"];

describe("ProcessingStatusBadge", () => {
  it("renders every status as readable words, not just colour", async () => {
    // The mechanised form of "no colour-only state": if a status ever renders
    // without its literal label, this fails.
    for (const status of ALL_STATUSES) {
      const { container, unmount } = await render(ProcessingStatusBadge, { status });
      expect(container.textContent, status).toContain(
        PROCESSING_STATUS_COPY[status].label
      );
      await unmount();
    }
  });

  it("hides its decorative icon from assistive technology", async () => {
    for (const status of ALL_STATUSES) {
      const { container, unmount } = await render(ProcessingStatusBadge, { status });
      const svg = container.querySelector("svg");
      expect(svg?.getAttribute("aria-hidden"), status).toBe("true");
      await unmount();
    }
  });

  it("shows a spinner and says it is reading while a file is in flight", async () => {
    const { container } = await render(ProcessingStatusBadge, { status: null });
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    expect(container.textContent).toContain(LOADING_COPY.label);
  });

  it("stops the spinner animating under reduced motion", async () => {
    // There is no global reduced-motion reset in this app, so the opt-out has
    // to be carried explicitly or the spinner keeps moving.
    const { container } = await render(ProcessingStatusBadge, { status: null });
    const spinner = container.querySelector('[role="status"]')!;
    expect(spinner.className).toContain("motion-reduce:animate-none");
  });

  it("gives each status a distinguishable appearance as well as a label", async () => {
    const tones = new Set<string>();
    for (const status of ALL_STATUSES) {
      const { container, unmount } = await render(ProcessingStatusBadge, { status });
      const badge = container.querySelector("span")!;
      tones.add(getComputedStyle(badge).backgroundColor);
      await unmount();
    }
    // Not one per status — could_not_read and skipped_unsupported share a tone
    // by design — but colour must still carry some grouping.
    expect(tones.size).toBeGreaterThan(1);
  });

  it("renders at both sizes without losing the label", async () => {
    for (const size of ["sm", "md"] as const) {
      const { container, unmount } = await render(ProcessingStatusBadge, {
        status: "ready",
        size,
      });
      expect(container.textContent, size).toContain("Ready for AI");
      await unmount();
    }
  });
});
