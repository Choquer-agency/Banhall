import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import SourcesView from "./SourcesView.svelte";

/**
 * Sources tab interviews (2026-09-24, the transcript method): detected
 * format per row, Add transcript, and a row menu with Replace and Remove,
 * all refused while a report is generating.
 */
const rows = [
  { _id: "t1", label: "Helios kickoff.docx", wordCount: 5210, createdAt: 1, sourceFormat: "teams_docx" as const },
  { _id: "t2", label: "Follow up.vtt", wordCount: 812, createdAt: 2, sourceFormat: "vtt" as const },
  { _id: "t3", label: "Interview transcript", wordCount: 40, createdAt: 3 },
];

function setFile(input: HTMLInputElement, file: File) {
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

const fileInput = () => document.querySelector<HTMLInputElement>("[data-transcript-file-input]")!;

describe("Sources tab interviews", () => {
  beforeEach(async () => {
    document.body.innerHTML = "";
    await page.viewport(1280, 800);
  });

  it("shows each transcript's detected format and word count", async () => {
    await render(SourcesView, { transcripts: rows, documents: [] });
    const meta = Array.from(document.querySelectorAll("[data-transcript-meta]")).map((el) => el.textContent?.trim());
    expect(meta).toEqual(["Teams, 5,210 words", "WebVTT, 812 words", "40 words"]);
    // Read-only viewers get no actions.
    expect(document.querySelector("[data-add-transcript]")).toBeNull();
    expect(document.querySelector("[data-transcript-menu]")).toBeNull();
  });

  it("adds a picked file and accepts the transcript formats", async () => {
    const onAddTranscript = vi.fn();
    await render(SourcesView, {
      transcripts: rows,
      documents: [],
      canEditTranscripts: true,
      onAddTranscript,
    });
    expect(fileInput().accept).toBe(".docx,.vtt,.srt,.txt");
    const file = new File(["WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n<v Dana>Hi."], "call.vtt", { type: "text/vtt" });
    setFile(fileInput(), file);
    await vi.waitFor(() => expect(onAddTranscript).toHaveBeenCalledWith(file));
  });

  it("replaces and removes from the row menu", async () => {
    const onReplaceTranscript = vi.fn();
    const onRemoveTranscript = vi.fn();
    await render(SourcesView, {
      transcripts: rows,
      documents: [],
      canEditTranscripts: true,
      onReplaceTranscript,
      onRemoveTranscript,
    });
    await userEvent.click(document.querySelector<HTMLElement>('[data-transcript-menu="t2"]')!);
    await vi.waitFor(() => expect(document.querySelector('[data-transcript-replace="t2"]')).not.toBeNull());
    await userEvent.click(document.querySelector<HTMLElement>('[data-transcript-replace="t2"]')!);
    const replacement = new File(["Dana: Hi.\n\nPriya: Hello."], "follow-up-fixed.txt", { type: "text/plain" });
    setFile(fileInput(), replacement);
    await vi.waitFor(() => expect(onReplaceTranscript).toHaveBeenCalledWith("t2", replacement));

    await userEvent.click(document.querySelector<HTMLElement>('[data-transcript-menu="t1"]')!);
    await vi.waitFor(() => expect(document.querySelector('[data-transcript-remove="t1"]')).not.toBeNull());
    await userEvent.click(document.querySelector<HTMLElement>('[data-transcript-remove="t1"]')!);
    // Remove asks first.
    await vi.waitFor(() => expect(document.querySelector("[data-remove-transcript-dialog]")).not.toBeNull());
    expect(onRemoveTranscript).not.toHaveBeenCalled();
    await userEvent.click(document.querySelector<HTMLElement>("[data-remove-transcript-confirm]")!);
    await vi.waitFor(() => expect(onRemoveTranscript).toHaveBeenCalledWith("t1"));
    await vi.waitFor(() => expect(document.querySelector("[data-remove-transcript-dialog]")).toBeNull());
  });

  it("asks before removing, and keeps the transcript when the writer says so", async () => {
    const onRemoveTranscript = vi.fn();
    await render(SourcesView, {
      transcripts: rows,
      documents: [],
      canEditTranscripts: true,
      onRemoveTranscript,
    });
    await userEvent.click(document.querySelector<HTMLElement>('[data-transcript-menu="t2"]')!);
    await vi.waitFor(() => expect(document.querySelector('[data-transcript-remove="t2"]')).not.toBeNull());
    await userEvent.click(document.querySelector<HTMLElement>('[data-transcript-remove="t2"]')!);
    const dialog = await vi.waitFor(() => {
      const found = document.querySelector<HTMLElement>("[data-remove-transcript-dialog]");
      expect(found).not.toBeNull();
      return found!;
    });
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.textContent).toContain("Remove this transcript?");
    expect(dialog.textContent).toContain("New reports for this project won't use Follow up.vtt.");
    expect(dialog.textContent).toContain("You can't undo this, but you can add the file again.");
    // No title or button goes past weight 500.
    for (const el of [dialog, ...dialog.querySelectorAll<HTMLElement>("*")]) {
      expect(Number(getComputedStyle(el).fontWeight), el.textContent ?? "").toBeLessThanOrEqual(500);
    }
    await userEvent.click(document.querySelector<HTMLElement>("[data-remove-transcript-cancel]")!);
    await vi.waitFor(() => expect(document.querySelector("[data-remove-transcript-dialog]")).toBeNull());
    await userEvent.keyboard("{Escape}");
    expect(onRemoveTranscript).not.toHaveBeenCalled();
  });

  it("says why changes are refused while a report is generating", async () => {
    const onAddTranscript = vi.fn();
    const onRemoveTranscript = vi.fn();
    await render(SourcesView, {
      transcripts: rows,
      documents: [],
      canEditTranscripts: true,
      transcriptsBlockedReason: "Transcripts can't change while a report is generating.",
      onAddTranscript,
      onRemoveTranscript,
    });
    const add = document.querySelector<HTMLButtonElement>("[data-add-transcript]")!;
    expect(add.disabled).toBe(true);
    expect(document.querySelector("[data-transcripts-blocked]")?.textContent).toContain("while a report is generating");
    await userEvent.click(document.querySelector<HTMLElement>('[data-transcript-menu="t1"]')!);
    await vi.waitFor(() => expect(document.querySelector('[data-transcript-remove="t1"]')).not.toBeNull());
    expect(document.querySelector('[data-transcript-remove="t1"]')?.hasAttribute("data-disabled")).toBe(true);
    expect(onRemoveTranscript).not.toHaveBeenCalled();
  });

  it("offers Add transcript on a project with no interviews yet", async () => {
    await render(SourcesView, { transcripts: [], documents: [], canEditTranscripts: true });
    expect(document.querySelector("[data-add-transcript]")?.textContent).toContain("Add transcript");
    expect(document.body.textContent).toContain("No interviews yet.");
  });
});
