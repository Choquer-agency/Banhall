import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { userEvent } from "vitest/browser";
import {
  PROCESSING_STATUSES,
  type ProcessingStatus,
} from "../../../../shared/documentStatus";
import {
  PROCESSING_STATUS_COPY,
  UNKNOWN_STATUS_COPY,
  statusAction,
} from "$lib/uploads/processingStatus";
import type { ReceiptRow } from "$lib/uploads/receiptRows";
import UploadReceiptRow from "./UploadReceiptRow.svelte";

function row(over: Partial<ReceiptRow> = {}): ReceiptRow {
  return {
    key: "row-1",
    fileName: "notes.docx",
    status: "ready",
    canRetry: false,
    canReplace: false,
    canRemove: false,
    ...over,
  };
}

const NON_READY: ProcessingStatus[] = PROCESSING_STATUSES.filter((s) => s !== "ready");

describe("UploadReceiptRow copy", () => {
  it("explains every non-ready outcome without the user having to interact", async () => {
    for (const status of [...NON_READY, "upload_failed" as const]) {
      const { container, unmount } = await render(UploadReceiptRow, {
        row: row({ status }),
      });
      const second = container.querySelector("p.text-xs")!;
      expect(second, status).not.toBeNull();
      expect(second.textContent, status).toContain(
        PROCESSING_STATUS_COPY[status].explanation
      );
      // The advice must be on screen too, not just the diagnosis.
      const advice = statusAction(status, { canRetry: false, canReplace: false });
      if (advice) expect(second.textContent, status).toContain(advice);
      // No hover, no disclosure: the advice has to be on screen already.
      expect(getComputedStyle(second).display, status).not.toBe("none");
      await unmount();
    }
  });

  it("survives a future or missing server status with honest fallback copy", async () => {
    const unknown = row({ status: "future_status" as never });
    const { container } = await render(UploadReceiptRow, { row: unknown });
    expect(container.textContent).toContain(UNKNOWN_STATUS_COPY.label);
    expect(container.textContent).toContain(UNKNOWN_STATUS_COPY.explanation);
  });

  it("says nothing extra about a file that is simply ready", async () => {
    const { container } = await render(UploadReceiptRow, { row: row() });
    expect(container.querySelector("p.text-xs")).toBeNull();
  });

  it("tells a failed upload to retry or to replace, depending on the file being held", async () => {
    const held = await render(UploadReceiptRow, {
      row: row({ status: "upload_failed", canRetry: true }),
    });
    expect(held.container.textContent).toContain(
      statusAction("upload_failed", { canRetry: true, canReplace: false })
    );
    await held.unmount();

    const gone = await render(UploadReceiptRow, {
      row: row({ status: "upload_failed", canReplace: true }),
    });
    expect(gone.container.textContent).toContain(
      statusAction("upload_failed", { canRetry: false, canReplace: true })
    );
  });
});

describe("UploadReceiptRow controls", () => {
  const noop = () => {};

  it("offers exactly the actions the row allows", async () => {
    const cases: Array<[Partial<ReceiptRow>, string[]]> = [
      [{ canRetry: true }, ["Retry"]],
      [{ canReplace: true }, ["Replace file…"]],
      [{ canRemove: true }, ["Remove"]],
      [{ canRetry: true, canRemove: true }, ["Retry", "Remove"]],
      [{}, []],
    ];
    for (const [flags, expected] of cases) {
      const { container, unmount } = await render(UploadReceiptRow, {
        row: row({ status: "upload_failed", ...flags }),
        onRetry: noop,
        onReplace: noop,
        onRemove: noop,
      });
      const labels = [...container.querySelectorAll("button")].map((b) =>
        b.textContent?.trim()
      );
      expect(labels, JSON.stringify(flags)).toEqual(expected);
      await unmount();
    }
  });

  it("hides an action the surface has no handler for", async () => {
    // Capability and intent are separate: a panel that passes no onRemove must
    // not show a dead Remove button.
    const { container } = await render(UploadReceiptRow, {
      row: row({ status: "upload_failed", canRetry: true, canRemove: true }),
      onRetry: noop,
    });
    const labels = [...container.querySelectorAll("button")].map((b) =>
      b.textContent?.trim()
    );
    expect(labels).toEqual(["Retry"]);
  });

  it("disables its controls while the row is busy and ignores clicks", async () => {
    const onRetry = vi.fn();
    const { container } = await render(UploadReceiptRow, {
      row: row({ status: "upload_failed", canRetry: true }),
      busy: true,
      onRetry,
    });
    const button = container.querySelector("button")!;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");

    // Native click: a real user gesture can't reach a disabled control, and
    // Playwright refuses to try.
    button.click();
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("passes the row to Retry and the picked file to Replace", async () => {
    const onRetry = vi.fn();
    const target = row({ status: "upload_failed", canRetry: true });
    const retry = await render(UploadReceiptRow, { row: target, onRetry });
    retry.container.querySelector("button")!.click();
    expect(onRetry).toHaveBeenCalledWith(target);
    await retry.unmount();

    const onReplace = vi.fn();
    const replaceRow = row({ status: "could_not_read", canReplace: true });
    const { container } = await render(UploadReceiptRow, {
      row: replaceRow,
      onReplace,
    });
    const input = container.querySelector('input[type="file"]')!;
    const file = new File(["x"], "replacement.pdf", { type: "application/pdf" });
    await userEvent.upload(input as HTMLInputElement, file);

    expect(onReplace).toHaveBeenCalledTimes(1);
    expect(onReplace.mock.calls[0][0]).toEqual(replaceRow);
    expect((onReplace.mock.calls[0][1] as File).name).toBe("replacement.pdf");
  });

  it("uses no bare title tooltips", async () => {
    const { container } = await render(UploadReceiptRow, {
      row: row({ status: "upload_failed", canRetry: true, canReplace: true, canRemove: true }),
      onRetry: noop,
      onReplace: noop,
      onRemove: noop,
    });
    expect(container.querySelectorAll("[title]")).toHaveLength(0);
  });
});

describe("UploadReceiptRow archived files", () => {
  it("does not claim an archived file is ready for AI", async () => {
    const { container } = await render(UploadReceiptRow, {
      row: row({ archived: true, status: "ready" }),
    });
    expect(container.textContent).not.toContain(PROCESSING_STATUS_COPY.ready.label);
    expect(container.textContent).toContain("Archived");
  });

  it("shows no explanation and no repair actions on an archived row", async () => {
    const { container } = await render(UploadReceiptRow, {
      row: row({
        archived: true,
        status: "could_not_read",
        canRemove: true,
      }),
      onRetry: () => {},
      onReplace: () => {},
      onRemove: () => {},
    });
    expect(container.querySelector("p.text-xs")).toBeNull();
    const labels = [...container.querySelectorAll("button")].map((b) =>
      b.textContent?.trim()
    );
    // Remove stays: an archived file can still be cleared out.
    expect(labels).toEqual(["Remove"]);
  });

  it("does not tell a user to press a Replace button that is not there", async () => {
    const { container } = await render(UploadReceiptRow, {
      row: row({ status: "could_not_read" }),
    });
    expect(container.textContent).not.toContain("Replace file");
    expect(container.textContent).toContain("paste the text into the chat");
  });
});
