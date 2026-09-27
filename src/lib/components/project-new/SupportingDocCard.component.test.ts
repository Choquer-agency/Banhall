import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import SupportingDocCard from "./SupportingDocCard.svelte";
import type { SupportingDoc } from "./supportingDocs.svelte";

/**
 * Decision 65, stage 2: a supporting document's intake-draft receipt. A
 * save on its way says so; one that failed stays in view with Try again;
 * a saved file shows nothing extra.
 */
function doc(patch: Partial<SupportingDoc> = {}): SupportingDoc {
  return {
    id: "doc-1",
    name: "Soak log.txt",
    file: new File(["Cold soak log."], "Soak log.txt", { type: "text/plain" }),
    pastedText: null,
    category: "other",
    categoryTouched: true,
    year: 2025,
    status: "ready",
    progress: null,
    startedAt: 0,
    finishedAt: 1,
    parsed: { fileName: "Soak log.txt", fileType: "txt", content: "Cold soak log." },
    transcript: null,
    error: null,
    sections: [],
    words: 3,
    ...patch,
  } as SupportingDoc;
}

function props(overrides: Record<string, unknown> = {}) {
  return {
    doc: doc(),
    categories: ["other" as const],
    years: [2025],
    onPreview: vi.fn(),
    onRemove: vi.fn(),
    onReplace: vi.fn(),
    onCategory: vi.fn(),
    onYear: vi.fn(),
    ...overrides,
  };
}

const receipt = () => document.querySelector<HTMLElement>("[data-save-receipt]");

describe("SupportingDocCard save receipt", () => {
  it("shows Saving while the file is on its way to the draft", async () => {
    await render(SupportingDocCard, props({ saveState: "saving" }));
    expect(receipt()?.dataset.saveReceipt).toBe("saving");
    expect(receipt()?.textContent?.trim()).toBe("Saving");
  });

  it("keeps a failed save in view with Try again", async () => {
    const onRetrySave = vi.fn();
    await render(SupportingDocCard, props({ saveState: "failed", onRetrySave }));
    expect(receipt()?.textContent?.trim()).toBe("Not saved yet");
    document.querySelector<HTMLButtonElement>("[data-save-retry]")!.click();
    expect(onRetrySave).toHaveBeenCalledTimes(1);
  });

  it("says when only the original file did not save", async () => {
    await render(SupportingDocCard, props({ saveState: "saved", originalState: "failed", onRetrySave: vi.fn() }));
    expect(receipt()?.textContent?.trim()).toBe("The original file was not saved");
  });

  it("shows nothing extra once saved, and nothing while the file is still read", async () => {
    await render(SupportingDocCard, props({ saveState: "saved", originalState: "saved" }));
    expect(receipt()).toBeNull();
    document.body.innerHTML = "";
    await render(SupportingDocCard, props({ doc: doc({ status: "reading", parsed: null }), saveState: "saving" }));
    expect(receipt()).toBeNull();
  });
});
