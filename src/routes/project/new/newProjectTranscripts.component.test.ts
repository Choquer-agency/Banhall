import { beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import JSZip from "jszip";
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

/**
 * The wizard's transcript intake is an ordered list: several .docx files at
 * once, one at a time, pastes, and — in the duplicate flow — the source
 * project's rows referenced by id so no transcript text is downloaded to the
 * browser and re-uploaded.
 */
const transcriptTextarea = () =>
  document.querySelector<HTMLTextAreaElement>("#transcript");
const transcriptFileInput = () =>
  document.querySelector<HTMLInputElement>('input[type="file"][accept=".docx"]');
const itemLabels = () =>
  [...document.querySelectorAll('button[aria-label^="Remove "]')].map((button) =>
    button.getAttribute("aria-label")!.replace("Remove ", "")
  );

const itemWordCounts = () =>
  [...document.querySelectorAll('button[aria-label^="Remove "]')].map(
    (button) => button.closest("li")?.textContent?.match(/[\d,]+ words/)?.[0] ?? ""
  );

function buttonByText(text: string) {
  return [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === text
  );
}

/** Waits for the button to be enabled — a disabled button ignores clicks. */
async function clickText(text: string) {
  await expect.poll(() => buttonByText(text)?.disabled).toBe(false);
  buttonByText(text)!.click();
}

async function clickTextContaining(text: string) {
  const find = () =>
    [...document.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes(text)
    );
  await expect.poll(() => find()).not.toBeUndefined();
  find()!.click();
}

async function pollFor<T extends Element>(selector: string) {
  await expect.poll(() => document.querySelector(selector)).not.toBeNull();
  return document.querySelector<T>(selector)!;
}

async function clickLabel(label: string) {
  await expect
    .poll(() => document.querySelector(`button[aria-label="${label}"]`))
    .not.toBeNull();
  document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click();
}

function setInputValue(selector: string, value: string) {
  const field = document.querySelector<HTMLInputElement>(selector)!;
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * A real Word package, small enough to build here: the upload path runs
 * mammoth on these bytes, so the list rows come from the same extraction the
 * writer's Teams export goes through.
 */
async function docxFile(name: string, words: string[]) {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${words.join(
      " "
    )}</w:t></w:r></w:p></w:body></w:document>`
  );
  const blob = await zip.generateAsync({ type: "blob" });
  return new File([blob], name, {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

function selectFiles(files: File[]) {
  const transfer = new DataTransfer();
  for (const file of files) transfer.items.add(file);
  const input = transcriptFileInput()!;
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function addPaste(text: string) {
  const textarea = transcriptTextarea()!;
  textarea.value = text;
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  await expect.poll(() => transcriptTextarea()?.value).toBe(text);
  await clickText("Add transcript");
}

beforeEach(() => {
  localStorage.clear();
  __resetPage();
  __resetNavigation();
  __resetConvexStub();
  takeProjectStart();
  __setQueryData("users:getMyUser", {
    _id: "user-1",
    role: "writer",
    firstName: "Wendy",
  });
});

describe("/project/new transcript list", () => {
  it("appends each paste as its own removable item and clears the box", async () => {
    __setPageUrl("/project/new");
    await render(NewProjectPage, {});

    await expect.poll(() => document.querySelector("#title")).not.toBeNull();
    await clickText("Paste text");
    await expect.poll(() => transcriptTextarea()).not.toBeNull();

    await addPaste("First interview body");
    await expect.poll(itemLabels).toEqual(["Pasted transcript 1"]);
    await expect.poll(() => transcriptTextarea()?.value).toBe("");

    await addPaste("Second interview body");
    await expect
      .poll(itemLabels)
      .toEqual(["Pasted transcript 1", "Pasted transcript 2"]);

    await clickLabel("Remove Pasted transcript 1");
    await expect.poll(itemLabels).toEqual(["Pasted transcript 2"]);
  });

  it("adds three .docx from one chooser and appends more on reuse", async () => {
    __setPageUrl("/project/new");
    await render(NewProjectPage, {});

    await expect.poll(transcriptFileInput).not.toBeNull();
    expect(transcriptFileInput()?.multiple).toBe(true);

    selectFiles([
      await docxFile("Day 1.docx", ["alpha", "beta", "gamma"]),
      await docxFile("Day 2.docx", ["delta", "epsilon"]),
      await docxFile("Day 3.docx", ["zeta", "eta", "theta", "iota"]),
    ]);
    await expect
      .poll(itemLabels)
      .toEqual(["Day 1.docx", "Day 2.docx", "Day 3.docx"]);
    // Word counts come out of the real mammoth extraction, per file and total.
    expect(itemWordCounts()).toEqual(["3 words", "2 words", "4 words"]);
    await expect
      .poll(() => document.body.textContent)
      .toContain("3 transcripts · 9 words");

    selectFiles([await docxFile("Day 4.docx", ["kappa", "lambda"])]);
    await expect
      .poll(itemLabels)
      .toEqual(["Day 1.docx", "Day 2.docx", "Day 3.docx", "Day 4.docx"]);

    await clickLabel("Remove Day 2.docx");
    await expect
      .poll(itemLabels)
      .toEqual(["Day 1.docx", "Day 3.docx", "Day 4.docx"]);
  });

  it("rejects a non-.docx file with the existing message", async () => {
    __setPageUrl("/project/new");
    await render(NewProjectPage, {});

    await expect.poll(transcriptFileInput).not.toBeNull();
    selectFiles([new File(["notes"], "notes.txt", { type: "text/plain" })]);

    await expect
      .poll(() => document.body.textContent)
      .toContain("Transcripts must be Word (.docx) files");
    expect(itemLabels()).toEqual([]);
  });

  it("blocks the submit with no transcript and no context document", async () => {
    __setPageUrl("/project/new");
    await render(NewProjectPage, {});

    await expect.poll(() => document.querySelector("#title")).not.toBeNull();
    setInputValue("#title", "Solar tracker");
    setInputValue("#clientName", "Acme Labs");
    await clickText("Next");

    await expect
      .poll(() => document.body.textContent)
      .toContain("Add a transcript or at least one context document first.");
    const submit = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Generate Report")
    );
    expect(submit?.disabled).toBe(true);
  });

  it("sends the list in order and no transcript id to generation", async () => {
    __setPageUrl("/project/new");
    __setMutationResult("projects:createProject", {
      projectId: "project-new",
      transcriptIds: ["transcript-a", "transcript-b"],
    });
    await render(NewProjectPage, {});

    await expect.poll(() => document.querySelector("#title")).not.toBeNull();
    setInputValue("#title", "Solar tracker");
    setInputValue("#clientName", "Acme Labs");
    await clickText("Paste text");
    await expect.poll(() => transcriptTextarea()).not.toBeNull();
    await addPaste("First interview body");
    await addPaste("Second interview body");
    await expect
      .poll(itemLabels)
      .toEqual(["Pasted transcript 1", "Pasted transcript 2"]);

    await clickText("Next");
    await expect
      .poll(() =>
        [...document.querySelectorAll("button")].some((button) =>
          button.textContent?.includes("Generate Report")
        )
      )
      .toBe(true);
    await clickText("Generate Report");

    await expect
      .poll(() => __mutationCalls("projects:createProject").length)
      .toBe(1);
    const created = __mutationCalls("projects:createProject")[0] as {
      transcripts: Array<{ content?: string; label?: string }>;
    };
    expect(created.transcripts).toEqual([
      { content: "First interview body", label: "Pasted transcript 1" },
      { content: "Second interview body", label: "Pasted transcript 2" },
    ]);

    await expect
      .poll(() => __mutationCalls("generations:requestGeneration").length)
      .toBe(1);
    expect(
      __mutationCalls("generations:requestGeneration")[0]
    ).not.toHaveProperty("transcriptId");
  });
});

describe("/project/new duplicate prefill", () => {
  beforeEach(() => {
    __setPageUrl("/project/new?from=project-1");
    __setQueryData("projects:getProject", {
      _id: "project-1",
      title: "Existing project",
      clientName: "Acme Labs",
      mode: "generate",
    });
    __setQueryData("transcripts:listTranscripts", [
      {
        _id: "transcript-1",
        label: "Day 1.docx",
        position: 0,
        createdAt: 1,
        charCount: 120,
        wordCount: 20,
      },
      {
        _id: "transcript-2",
        label: "Day 2.docx",
        position: 1,
        createdAt: 2,
        charCount: 60,
        wordCount: 10,
      },
    ]);
  });

  it("prefills every source transcript as a removable item", async () => {
    await render(NewProjectPage, {});

    await expect.poll(itemLabels).toEqual(["Day 1.docx", "Day 2.docx"]);
    await expect.poll(() => document.body.textContent).toContain("30 words");

    await clickLabel("Remove Day 1.docx");
    await expect.poll(itemLabels).toEqual(["Day 2.docx"]);
  });

  it("submits them as references and hands the first new row to the copy", async () => {
    __setMutationResult("projects:createProject", {
      projectId: "project-copy",
      transcriptIds: ["copied-1", "copied-2"],
    });
    await render(NewProjectPage, {});

    await expect.poll(itemLabels).toEqual(["Day 1.docx", "Day 2.docx"]);
    await clickText("Next");
    await expect
      .poll(() =>
        [...document.querySelectorAll("button")].some((button) =>
          button.textContent?.includes("Generate Report")
        )
      )
      .toBe(true);
    await clickText("Generate Report");

    await expect
      .poll(() => __mutationCalls("projects:createProject").length)
      .toBe(1);
    const created = __mutationCalls("projects:createProject")[0] as {
      transcripts: Array<{ fromTranscriptId?: string; label?: string }>;
    };
    expect(created.transcripts).toEqual([
      { fromTranscriptId: "transcript-1", label: "Day 1.docx" },
      { fromTranscriptId: "transcript-2", label: "Day 2.docx" },
    ]);

    await expect
      .poll(() => __mutationCalls("projectDuplication:copyProjectContent").length)
      .toBe(1);
    expect(
      __mutationCalls("projectDuplication:copyProjectContent")[0]
    ).toMatchObject({
      fromProjectId: "project-1",
      toProjectId: "project-copy",
      targetTranscriptId: "copied-1",
    });
  });

  it("omits the copy target when the source has no transcript", async () => {
    __setQueryData("transcripts:listTranscripts", []);
    __setMutationResult("projects:createProject", {
      projectId: "project-copy",
      transcriptIds: [],
    });
    await render(NewProjectPage, {});

    await expect.poll(() => document.querySelector("#title")).not.toBeNull();
    // A context note is the only source, so the submit is allowed with an
    // empty transcript list.
    await clickTextContaining("Add files or paste text");
    await clickText("Paste text instead");
    const note = await pollFor<HTMLTextAreaElement>(
      'textarea[placeholder="Paste text, notes, or links"]'
    );
    note.value = "Scoping call notes";
    note.dispatchEvent(new Event("input", { bubbles: true }));

    await clickText("Next");
    await clickText("Generate Report");

    await expect
      .poll(() => __mutationCalls("projects:createProject").length)
      .toBe(1);
    expect(
      (__mutationCalls("projects:createProject")[0] as { transcripts: unknown[] })
        .transcripts
    ).toEqual([]);

    await expect
      .poll(() => __mutationCalls("projectDuplication:copyProjectContent").length)
      .toBe(1);
    expect(
      __mutationCalls("projectDuplication:copyProjectContent")[0]
    ).not.toHaveProperty("targetTranscriptId");
  });
});
