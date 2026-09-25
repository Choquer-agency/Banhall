import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "svelte-sonner";
import { ConvexError } from "convex/values";
import { render } from "vitest-browser-svelte";
import JSZip from "jszip";
import NewProjectPage from "./+page.svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import {
  __mutationCalls,
  __resetConvexStub,
  __setMutationError,
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
  document.querySelector<HTMLInputElement>('input[type="file"][accept=".docx,.vtt,.srt,.txt"]');
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

/**
 * A cue-timed Teams export: one paragraph per cue with soft line breaks
 * between the timing, the name and the speech, the run layout of a real
 * export (github.com/endjin/TeamsTranscript, transcript-01.docx).
 */
async function teamsCueDocx(name: string) {
  const cues = [
    ["0:0:0.0 --&gt; 0:0:3.520", "Dana Whitfield", "Thanks for joining."],
    ["0:0:3.520 --&gt; 0:0:9.100", "Priya Shah", "We could not predict flow at the feeder."],
  ];
  const body = cues
    .map(
      ([timing, speaker, speech]) =>
        `<w:p><w:r><w:t>${timing}</w:t></w:r><w:r><w:br/><w:t>${speaker}</w:t></w:r><w:r><w:br/></w:r><w:r><w:t>${speech}</w:t></w:r></w:p>`
    )
    .join("");
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
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`
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

  it("rejects a file that is not a transcript format with a plain message", async () => {
    __setPageUrl("/project/new");
    await render(NewProjectPage, {});

    await expect.poll(transcriptFileInput).not.toBeNull();
    selectFiles([new File(["notes"], "notes.pdf", { type: "application/pdf" })]);

    await expect
      .poll(() => document.body.textContent)
      .toContain("Transcripts can be Word (.docx), WebVTT (.vtt), SubRip (.srt) or text (.txt) files.");
    expect(itemLabels()).toEqual([]);
  });

  it("detects each file's format, renders captions to text and sends the format", async () => {
    __setPageUrl("/project/new");
    __setMutationResult("projects:createProject", {
      projectId: "project-new",
      transcriptIds: ["transcript-a", "transcript-b"],
    });
    await render(NewProjectPage, {});

    await expect.poll(transcriptFileInput).not.toBeNull();
    selectFiles([
      new File(
        ["WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n<v Dana Whitfield>What did you try?</v>\n"],
        "Call.vtt",
        { type: "text/vtt" }
      ),
      new File(["[Dana] 10:02:33\nHello there.\n\n[Priya] 10:02:37\nHi."], "Zoom.txt", { type: "text/plain" }),
    ]);
    await expect.poll(itemLabels).toEqual(["Call.vtt", "Zoom.txt"]);
    const formats = [...document.querySelectorAll("[data-transcript-format]")].map((el) =>
      el.textContent?.trim()
    );
    expect(formats).toEqual(["WebVTT, 7 words", "Zoom, 7 words"]);

    setInputValue("#title", "Solar tracker");
    setInputValue("#clientName", "Acme Labs");
    await clickText("Next");
    await expect
      .poll(() =>
        [...document.querySelectorAll("button")].some((button) =>
          button.textContent?.includes("Generate Report")
        )
      )
      .toBe(true);
    await clickText("Generate Report");
    await expect.poll(() => __mutationCalls("projects:createProject").length).toBe(1);
    const created = __mutationCalls("projects:createProject")[0] as {
      transcripts: Array<{ content?: string; label?: string; sourceFormat?: string }>;
    };
    expect(created.transcripts.map(({ content, label, sourceFormat }) => ({ content, label, sourceFormat }))).toEqual([
      { content: "Dana Whitfield [00:00:01]: What did you try?", label: "Call.vtt", sourceFormat: "vtt" },
      {
        content: "[Dana] 10:02:33\nHello there.\n\n[Priya] 10:02:37\nHi.",
        label: "Zoom.txt",
        sourceFormat: "zoom",
      },
    ]);
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
      { content: "First interview body", label: "Pasted transcript 1", sourceFormat: "paste" },
      { content: "Second interview body", label: "Pasted transcript 2", sourceFormat: "paste" },
    ]);

    await expect
      .poll(() => __mutationCalls("generations:requestGeneration").length)
      .toBe(1);
    expect(
      __mutationCalls("generations:requestGeneration")[0]
    ).not.toHaveProperty("transcriptId");
  });
});

describe("/project/new transcript originals", () => {
  // Each uploaded file answers with a storage id named after it.
  let upload: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    __setPageUrl("/project/new");
    __setMutationResult("documents:generateUploadUrl", "https://upload.test/transcript");
    __setMutationResult("transcripts:discardTranscriptOriginals", null);
    upload = vi.fn<typeof fetch>().mockImplementation(async (_url, init) =>
      Response.json({ storageId: `storage-${(init?.body as File).name}` })
    );
    vi.stubGlobal("fetch", upload);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function submit() {
    setInputValue("#title", "Solar tracker");
    setInputValue("#clientName", "Acme Labs");
    await clickText("Next");
    await expect
      .poll(() =>
        [...document.querySelectorAll("button")].some((button) => button.textContent?.includes("Generate Report"))
      )
      .toBe(true);
    await clickText("Generate Report");
  }

  it("uploads each file's original and reads a Teams cue export with its speakers", async () => {
    __setMutationResult("projects:createProject", {
      projectId: "project-new",
      transcriptIds: ["transcript-a", "transcript-b"],
    });
    await render(NewProjectPage, {});
    await expect.poll(transcriptFileInput).not.toBeNull();
    selectFiles([
      await teamsCueDocx("Helios.docx"),
      new File(["Dana: What did you try?\n\nPriya: A test rig."], "Follow up.txt", { type: "text/plain" }),
    ]);
    await expect.poll(itemLabels).toEqual(["Helios.docx", "Follow up.txt"]);
    await submit();
    await expect.poll(() => __mutationCalls("projects:createProject").length).toBe(1);
    const created = __mutationCalls("projects:createProject")[0] as {
      transcripts: Array<{ content?: string; sourceFormat?: string; originalStorageId?: string }>;
    };
    expect(created.transcripts).toEqual([
      {
        content:
          "Dana Whitfield [00:00:00]: Thanks for joining.\n\nPriya Shah [00:00:03]: We could not predict flow at the feeder.",
        label: "Helios.docx",
        sourceFormat: "teams_docx",
        originalStorageId: "storage-Helios.docx",
      },
      {
        content: "Dana: What did you try?\n\nPriya: A test rig.",
        label: "Follow up.txt",
        sourceFormat: "txt",
        originalStorageId: "storage-Follow up.txt",
      },
    ]);
    expect(__mutationCalls("transcripts:discardTranscriptOriginals")).toEqual([]);
  });

  it("releases the uploaded originals when the project is refused", async () => {
    __setMutationError(
      "projects:createProject",
      new ConvexError({ code: "INVALID_INPUT", message: "Combined transcript text is too large" })
    );
    const error = vi.spyOn(toast, "error");
    await render(NewProjectPage, {});
    await expect.poll(transcriptFileInput).not.toBeNull();
    selectFiles([
      new File(["Dana: First."], "One.txt", { type: "text/plain" }),
      new File(["Dana: Second."], "Two.txt", { type: "text/plain" }),
    ]);
    await expect.poll(itemLabels).toEqual(["One.txt", "Two.txt"]);
    await submit();
    await expect.poll(() => __mutationCalls("transcripts:discardTranscriptOriginals").length).toBe(1);
    expect(__mutationCalls("transcripts:discardTranscriptOriginals")[0]).toEqual({
      storageIds: ["storage-One.txt", "storage-Two.txt"],
    });
    await expect.poll(() => error.mock.calls.map((call) => call[0])).toContain("Combined transcript text is too large");
    expect(__mutationCalls("generations:requestGeneration")).toEqual([]);
  });
});

/** Copied rows carry a tick box, not Remove (owner decision 35, 2026-09-25). */
const copiedLabels = () =>
  [...document.querySelectorAll('[data-transcript-item] button[aria-label^="Copy "]')].map(
    (box) => box.getAttribute("aria-label")!.replace("Copy ", "")
  );
const copiedBox = (label: string) =>
  document.querySelector<HTMLButtonElement>(
    `[data-transcript-item] button[aria-label="Copy ${label}"]`
  );

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

  it("prefills every source transcript ticked, and an unticked one stays listed", async () => {
    await render(NewProjectPage, {});

    await expect.poll(copiedLabels).toEqual(["Day 1.docx", "Day 2.docx"]);
    expect(itemLabels()).toEqual([]);
    expect(copiedBox("Day 1.docx")?.getAttribute("aria-checked")).toBe("true");
    expect(copiedBox("Day 2.docx")?.getAttribute("aria-checked")).toBe("true");
    await expect.poll(() => document.body.textContent).toContain("2 transcripts · 30 words");

    copiedBox("Day 1.docx")!.click();
    await expect.poll(() => copiedBox("Day 1.docx")?.getAttribute("aria-checked")).toBe("false");
    // Still listed, marked, and out of the count.
    expect(copiedLabels()).toEqual(["Day 1.docx", "Day 2.docx"]);
    expect(copiedBox("Day 1.docx")!.closest("li")?.textContent).toContain("Not copied");
    await expect.poll(() => document.body.textContent).toContain("10 words");
    expect(document.body.textContent).not.toContain("2 transcripts");
  });

  it("leaves an unticked transcript out of createProject, and ticking it brings it back", async () => {
    __setMutationResult("projects:createProject", {
      projectId: "project-copy",
      transcriptIds: ["copied-2"],
    });
    await render(NewProjectPage, {});

    await expect.poll(copiedLabels).toEqual(["Day 1.docx", "Day 2.docx"]);
    copiedBox("Day 1.docx")!.click();
    await expect.poll(() => copiedBox("Day 1.docx")?.getAttribute("aria-checked")).toBe("false");
    copiedBox("Day 2.docx")!.click();
    await expect.poll(() => copiedBox("Day 2.docx")?.getAttribute("aria-checked")).toBe("false");
    copiedBox("Day 2.docx")!.click();
    await expect.poll(() => copiedBox("Day 2.docx")?.getAttribute("aria-checked")).toBe("true");

    await clickText("Next");
    await clickText("Generate Report");
    await expect.poll(() => __mutationCalls("projects:createProject").length).toBe(1);
    expect(
      (__mutationCalls("projects:createProject")[0] as { transcripts: unknown[] }).transcripts
    ).toEqual([{ fromTranscriptId: "transcript-2", label: "Day 2.docx" }]);
  });

  it("submits them as references and hands the first new row to the copy", async () => {
    __setMutationResult("projects:createProject", {
      projectId: "project-copy",
      transcriptIds: ["copied-1", "copied-2"],
    });
    await render(NewProjectPage, {});

    await expect.poll(copiedLabels).toEqual(["Day 1.docx", "Day 2.docx"]);
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
