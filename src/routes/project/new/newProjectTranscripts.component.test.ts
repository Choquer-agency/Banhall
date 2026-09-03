import { beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
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

  it("accepts several files in one chooser and rejects non-.docx", async () => {
    __setPageUrl("/project/new");
    await render(NewProjectPage, {});

    await expect.poll(transcriptFileInput).not.toBeNull();
    expect(transcriptFileInput()?.multiple).toBe(true);

    const transfer = new DataTransfer();
    transfer.items.add(new File(["notes"], "notes.txt", { type: "text/plain" }));
    const input = transcriptFileInput()!;
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));

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
});
