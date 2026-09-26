import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import NewProjectPage from "./+page.svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import {
  __mutationCalls,
  __resetConvexStub,
  __setMutationResult,
  __setQueryData,
} from "$lib/test/convex-svelte-stub.svelte";
import { takeProjectStart } from "$lib/workspace/projectIntentHandoff";
import {
  SupportingDocs,
  readingEtaSeconds,
  readingPercent,
  supportingMeta,
} from "$lib/components/project-new/supportingDocs.svelte";
import type { ParsedDocument, ParseOptions } from "$lib/parseDocument";
import {
  addSupportingFiles,
  fillBasics,
  openTranscriptPaste,
  pasteSupportingText,
  setDocumentCategory,
  setInputValue,
  startFromPage,
} from "./newProjectTestSupport";

/**
 * Board E1 section 03 and E3: supporting documents are read as soon as they
 * are added (PDFs report pages, other types animate), each card carries its
 * category chip (the five existing categories, decision 56), a previous-year
 * report says how many Sections were found, and the eye opens the preview
 * sheet with "What we found".
 */
const text = (node: Element | null | undefined) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();
const card = (name: string) =>
  [...document.querySelectorAll<HTMLElement>("[data-supporting-card]")].find((node) => node.textContent?.includes(name));

const LAST_YEAR = [
  "Line 242 Technological uncertainty",
  "Whether the seal holds at minus 30.",
  "Line 244 Work performed",
  "Built a rig.",
  "Line 246 Technological advancement",
  "A seal that holds.",
].join("\n");

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

beforeEach(async () => {
  await page.viewport(1440, 900);
  localStorage.clear();
  __resetPage();
  __resetNavigation();
  __resetConvexStub();
  takeProjectStart();
  __setPageUrl("/project/new");
  __setQueryData("users:getCurrentUser", { _id: "user-1", role: "writer", firstName: "Wendy" });
  __setQueryData("tags:listTags", []);
});

describe("SupportingDocs reading state", () => {
  function state(parse: (file: File, options: ParseOptions) => Promise<ParsedDocument>) {
    return new SupportingDocs({ lifetime: new AbortController().signal, defaultYear: () => 2025, parse });
  }

  it("reports pages read, an estimate from the pace so far, then the page count", async () => {
    const gate = deferred<ParsedDocument>();
    let report!: ParseOptions["onProgress"];
    const docs = state((_file, options) => {
      report = options.onProgress;
      return gate.promise;
    });
    const [id] = docs.add([new File(["x"], "Report.pdf")]);
    expect(docs.get(id)?.status).toBe("reading");
    expect(readingPercent(docs.get(id)!)).toBeNull();
    report?.({ kind: "pages", done: 0, total: 10 });
    report?.({ kind: "pages", done: 4, total: 10 });
    expect(readingPercent(docs.get(id)!)).toBe(40);
    const doc = docs.get(id)!;
    const eta = readingEtaSeconds({ ...doc, startedAt: Date.now() - 8_000 }, Date.now());
    expect(eta).toBeCloseTo(12, 0);
    gate.resolve({ fileName: "Report.pdf", fileType: "pdf", content: "Some text here", pageCount: 10, pageOffsets: [0] });
    await docs.whenRead([id]);
    expect(docs.get(id)?.status).toBe("ready");
    expect(supportingMeta(docs.get(id)!)).toBe("10 pages");
  });

  it("files a report with all three Sections as a previous-year report unless the writer chose", async () => {
    const docs = state(async (file) => ({ fileName: file.name, fileType: "txt", content: LAST_YEAR }));
    const [auto] = docs.add([new File(["x"], "FY2025.txt")]);
    const [chosen] = docs.add([new File(["x"], "Notes.txt")], "writer_notes");
    await docs.whenRead([auto, chosen]);
    expect(docs.get(auto)?.category).toBe("previous_pd");
    expect(supportingMeta(docs.get(auto)!)).toBe("3 sections found");
    expect(docs.get(chosen)?.category).toBe("writer_notes");
  });

  it("marks a file it could not read as failed, and stops reading a removed one", async () => {
    const gate = deferred<ParsedDocument>();
    let signal: AbortSignal | undefined;
    const docs = state(async (file, options) => {
      if (file.name === "Broken.pdf") throw new Error("bad file");
      signal = options.signal;
      return gate.promise;
    });
    const [broken] = docs.add([new File(["x"], "Broken.pdf")]);
    await docs.whenRead([broken]);
    expect(docs.get(broken)?.status).toBe("failed");
    expect(supportingMeta(docs.get(broken)!)).toBe("We could not read this file.");

    const [slow] = docs.add([new File(["x"], "Slow.pdf")]);
    await Promise.resolve();
    docs.remove(slow);
    expect(signal?.aborted).toBe(true);
    expect(docs.get(slow)).toBeUndefined();
    await docs.whenRead([slow]);
  });
});

describe("E1 supporting documents on the page", () => {
  it("reads a file as soon as it is added and shows its meta and chip", async () => {
    await render(NewProjectPage, {});
    addSupportingFiles([new File(["Plan for the rig, twelve words in this short plan file."], "FrostLine work plan.txt")]);
    await expect.poll(() => card("FrostLine work plan.txt")?.dataset.status).toBe("ready");
    const node = card("FrostLine work plan.txt")!;
    expect(text(node.querySelector("[data-supporting-meta]"))).toBe("11 words");
    expect(text(node.querySelector("[data-category-chip]"))).toBe("Other supporting docs");
    expect(node.querySelector('[data-file-icon="txt"]')).not.toBeNull();
    expect(text(document.querySelector('[data-checklist-row="supporting"]'))).toContain("1 supporting document");
  });

  it("offers the five existing categories on the chip, never Work plan or Test results", async () => {
    await render(NewProjectPage, {});
    addSupportingFiles([new File(["Notes."], "Notes.txt")]);
    await expect.poll(() => card("Notes.txt")?.dataset.status).toBe("ready");
    await userEvent.click(card("Notes.txt")!.querySelector<HTMLElement>("[data-category-chip]")!);
    await expect.poll(() => document.querySelectorAll("[data-category-option]").length).toBe(5);
    expect([...document.querySelectorAll("[data-category-option]")].map((node) => text(node))).toEqual([
      "Writer's notes",
      "Previous-year reports",
      "Scoping notes",
      "Background research",
      "Other supporting docs",
    ]);
    await userEvent.keyboard("{Escape}");
    await setDocumentCategory("Notes.txt", "Scoping notes");
  });

  it("finds a previous-year report's Sections and shows them in the preview with the never-copied note", async () => {
    await render(NewProjectPage, {});
    addSupportingFiles([new File([LAST_YEAR], "Cedarline FY 2025 report.txt")]);
    await expect.poll(() => card("Cedarline FY 2025 report.txt")?.dataset.category).toBe("previous_pd");
    const node = card("Cedarline FY 2025 report.txt")!;
    expect(text(node.querySelector("[data-supporting-meta]"))).toBe("3 sections found");
    expect(text(node.querySelector("[data-year-chip]"))).toMatch(/^FY \d{4}$/);

    node.querySelector<HTMLButtonElement>("[data-preview]")!.click();
    await expect.poll(() => document.querySelector("[data-supporting-preview]")).not.toBeNull();
    const sheet = document.querySelector<HTMLElement>("[data-supporting-preview]")!;
    expect(text(sheet)).toContain("Cedarline FY 2025 report.txt");
    expect(text(sheet)).toContain("Previous-year reports");
    expect(text(sheet)).toContain("words, added just now");
    expect([...sheet.querySelectorAll("[data-found-section]")].map((row) => text(row))).toEqual([
      "242 Technological uncertainty",
      "244 Work performed",
      "246 Technological advancement",
    ]);
    expect(text(sheet.querySelector("[data-previous-year-note]"))).toBe(
      "We use this to check facts and match last year's claim. It is never copied into the new PD."
    );
    // Not a PDF: the start of the text in a page box.
    expect(text(sheet.querySelector("[data-preview-text]"))).toContain("Line 242 Technological uncertainty");
    expect(getComputedStyle(sheet).maxWidth).toBe("560px");
    sheet.querySelector<HTMLButtonElement>("[data-preview-done]")!.click();
    await expect.poll(() => document.querySelector("[data-supporting-preview]")).toBeNull();
  });

  it("removes from the card and from the preview, and replaces a file in place", async () => {
    await render(NewProjectPage, {});
    addSupportingFiles([new File(["One."], "One.txt"), new File(["Two."], "Two.txt")]);
    await expect.poll(() => card("Two.txt")?.dataset.status).toBe("ready");

    card("One.txt")!.querySelector<HTMLButtonElement>("[data-remove]")!.click();
    await expect.poll(() => card("One.txt")).toBeUndefined();

    card("Two.txt")!.querySelector<HTMLButtonElement>("[data-preview]")!.click();
    await expect.poll(() => document.querySelector("[data-preview-replace]")).not.toBeNull();
    document.querySelector<HTMLButtonElement>("[data-preview-replace]")!.click();
    const input = document.querySelector<HTMLInputElement>("[data-replace-input]")!;
    const transfer = new DataTransfer();
    transfer.items.add(new File(["Three words here."], "Three.txt"));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await expect.poll(() => card("Three.txt")?.dataset.status).toBe("ready");
    expect(card("Two.txt")).toBeUndefined();
    expect(document.querySelectorAll("[data-supporting-card]")).toHaveLength(1);
  });

  it("uploads each file with its chip and its year header, the note alongside", async () => {
    __setMutationResult("projects:createProject", { projectId: "project-new", transcriptIds: ["t-1"] });
    __setMutationResult("documents:uploadDocument", "document-1");
    __setMutationResult("documents:generateUploadUrl", "https://upload.test/url");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(Response.json({ storageId: "storage-1" })));
    try {
      await render(NewProjectPage, {});
      await fillBasics();
      await openTranscriptPaste();
      setInputValue("#transcript", "Interviewer: What was uncertain?\nEngineer: The seal.");
      addSupportingFiles([new File([LAST_YEAR], "FY report.txt")]);
      await expect.poll(() => card("FY report.txt")?.dataset.category).toBe("previous_pd");
      const year = Number(text(card("FY report.txt")!.querySelector("[data-year-chip]")).replace("FY ", ""));
      await expect.poll(() => document.querySelector("[data-year-notes] input")).not.toBeNull();
      setInputValue("[data-year-notes] input", "Same rig as last year.");
      await pasteSupportingText("Call notes from the site visit.");

      await startFromPage();
      await expect.poll(() => __mutationCalls("generations:requestGeneration").length).toBe(1);
      const uploads = __mutationCalls("documents:uploadDocument") as Array<Record<string, unknown>>;
      expect(uploads.map((call) => [call.fileName, call.category])).toEqual([
        ["Writer's notes (pasted)", "writer_notes"],
        ["FY report.txt", "previous_pd"],
      ]);
      expect(String(uploads[1].content)).toMatch(new RegExp(`fiscal ${year}`));
      expect(String(uploads[1].content)).toContain("Note: Same rig as last year.");
      expect(uploads[0]).toMatchObject({ content: "Call notes from the site visit.", intake: "pasted" });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
