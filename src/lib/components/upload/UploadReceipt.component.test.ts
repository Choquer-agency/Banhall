import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import { DENIED_COPY } from "$lib/uploads/processingStatus";
import type { ReceiptRow } from "$lib/uploads/receiptRows";
import UploadReceipt from "./UploadReceipt.svelte";

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

const SIX_ROWS: ReceiptRow[] = [
  row({ key: "a", fileName: "a.docx" }),
  row({ key: "b", fileName: "b.docx" }),
  row({ key: "c", fileName: "c.docx" }),
  row({ key: "d", fileName: "d.docx" }),
  row({ key: "e", fileName: "e.png", status: "reference_only" }),
  row({ key: "f", fileName: "f.pdf", status: "upload_failed", canReplace: true }),
];

describe("UploadReceipt", () => {
  it("says so plainly when there are no files", async () => {
    const { container } = await render(UploadReceipt, {
      rows: [],
      emptyMessage: "No files yet.",
    });
    expect(container.textContent).toContain("No files yet.");
    expect(container.querySelectorAll("li")).toHaveLength(0);
    // No summary line for a receipt with nothing to summarise.
    expect(container.textContent).not.toMatch(/\d+ files?:/);
  });

  it("summarises a mixed batch in one line", async () => {
    const { container } = await render(UploadReceipt, { rows: SIX_ROWS });
    expect(container.textContent).toContain("6 files: 4 ready, 1 reference only, 1 failed");
    expect(container.querySelectorAll("li")).toHaveLength(6);
  });

  it("keeps a row's element identity when only its status changes", async () => {
    // Stable keys matter: a re-created element loses focus and restarts any
    // transition mid-upload.
    const rows: ReceiptRow[] = [
      row({ key: "a", fileName: "a.docx" }),
      row({ key: "b", fileName: "b.docx", status: null }),
      row({ key: "c", fileName: "c.docx" }),
    ];
    const { container, rerender } = await render(UploadReceipt, { rows });
    const before = container.querySelectorAll("li")[1];

    await rerender({
      rows: [rows[0], { ...rows[1], status: "ready" as const }, rows[2]],
    });

    const after = container.querySelectorAll("li")[1];
    expect(after).toBe(before);
  });

  it("does not contradict itself on an archived file", async () => {
    const { container } = await render(UploadReceipt, {
      rows: [row({ archived: true })],
    });
    expect(container.textContent).toContain("Archived");
    expect(container.textContent).not.toContain("Ready for AI");
  });

  it("distinguishes no permission from no files", async () => {
    const { container } = await render(UploadReceipt, {
      rows: [],
      denied: true,
      emptyMessage: "No files yet.",
    });
    expect(container.textContent).toContain(DENIED_COPY.explanation);
    expect(container.textContent).not.toContain("No files yet.");
  });

  it("announces status changes through a live region", async () => {
    const { container, rerender } = await render(UploadReceipt, {
      rows: [row({ key: "a", fileName: "a.pdf", status: null })],
    });
    const live = container.querySelector('[aria-live="polite"]')!;
    expect(live).not.toBeNull();
    const before = live.textContent;

    await rerender({
      rows: [row({ key: "a", fileName: "a.pdf", status: "could_not_read" })],
    });

    expect(live.textContent).not.toBe(before);
    expect(live.textContent).toContain("unreadable");
  });

  it("keeps the live region mounted even when empty", async () => {
    // A region inserted at the same moment as its text is not reliably
    // announced, so it has to pre-exist.
    const { container } = await render(UploadReceipt, { rows: [] });
    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull();
  });

  it("disables only the rows reported as busy", async () => {
    const { container } = await render(UploadReceipt, {
      rows: [
        row({ key: "a", fileName: "a.pdf", status: "upload_failed", canRemove: true }),
        row({ key: "b", fileName: "b.pdf", status: "upload_failed", canRemove: true }),
      ],
      busy: new Set(["a"]),
      onRemove: () => {},
    });
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons.map((b) => b.disabled)).toEqual([true, false]);
  });
});
