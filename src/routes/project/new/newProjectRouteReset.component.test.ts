import { beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import NewProjectRoute from "$lib/test/NewProjectRouteHarness.svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __navigationCalls, __resetNavigation } from "$lib/test/app-navigation-stub";
import {
  __mutationCalls,
  __resetConvexStub,
  __setMutationResult,
  __setQueryData,
} from "$lib/test/convex-svelte-stub.svelte";
import { takeProjectStart } from "$lib/workspace/projectIntentHandoff";

/**
 * Opening New project from the command menu while on a duplicate's New
 * project screen is a same-route navigation: SvelteKit keeps the page
 * component. The wizard reads `from` and `drafts` once, so without a reset
 * the blank project kept the duplicate's prefill, and submitting it started
 * a paid generation on the original's transcripts and files.
 */

function buttonByText(text: string) {
  return [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === text
  );
}

async function clickText(text: string) {
  await expect.poll(() => buttonByText(text)?.disabled).toBe(false);
  buttonByText(text)!.click();
}

const titleValue = () => document.querySelector<HTMLInputElement>("#title")?.value;

function setField(selector: string, value: string) {
  const field = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

function seedDuplicateSource() {
  __setQueryData("projects:getProject", {
    _id: "project-1",
    title: "Alloy furnace",
    clientName: "Forgeworks Inc.",
    mode: "generate",
  });
  __setQueryData("transcripts:listTranscripts", [
    { _id: "transcript-1", label: "Kickoff.docx", position: 0, createdAt: 1, charCount: 120, wordCount: 20 },
  ]);
  __setQueryData("documents:listDocuments", [
    {
      _id: "doc-1",
      fileName: "Writer notes.md",
      fileType: "txt",
      source: "context_input",
      category: "writer_notes",
      createdAt: 1,
      sizeChars: 120,
      hasFile: true,
      mimeType: null,
      url: null,
      archived: false,
      processingStatus: "ready",
      processingDetail: null,
    },
  ]);
  __setMutationResult("projects:createProject", {
    projectId: "project-new",
    transcriptIds: ["new-transcript"],
  });
}

beforeEach(() => {
  localStorage.clear();
  __resetPage();
  __resetNavigation();
  __resetConvexStub();
  takeProjectStart();
  __setQueryData("users:getMyUser", { _id: "user-1", role: "writer", firstName: "Wendy" });
});

describe("/project/new from the command menu on a duplicate", () => {
  it("starts a blank project, not the duplicate", async () => {
    seedDuplicateSource();
    __setPageUrl("/project/new?from=project-1&drafts=iterative");
    await render(NewProjectRoute, {});

    await expect.poll(titleValue).toBe("Alloy furnace (copy)");
    await expect.poll(() => document.querySelector("[data-copied-files]")).not.toBeNull();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
    const newProjectItem = () =>
      document.querySelector<HTMLElement>('[role="option"][data-value="action:new-project"]') ??
      [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((item) =>
        item.textContent?.includes("New project")
      );
    await expect.poll(newProjectItem).not.toBeUndefined();
    newProjectItem()!.click();

    await expect.poll(() => __navigationCalls.map((call) => call.url)).toContain("/project/new");
    await expect.poll(titleValue).toBe("");
    expect(document.querySelector("[data-copied-files]")).toBeNull();
    expect(document.querySelector("[data-transcript-item]")).toBeNull();

    // Submitting the blank project copies nothing and drafts only what was
    // added here.
    setField("#title", "Fresh project");
    setField("#clientName", "New Client Ltd.");
    buttonByText("Paste text")!.click();
    await expect.poll(() => document.querySelector("#transcript")).not.toBeNull();
    setField("#transcript", "Interviewer: What was new?\nEngineer: The sensor.");
    await clickText("Next");
    await clickText("Generate Report");

    await expect.poll(() => __mutationCalls("generations:requestGeneration").length).toBe(1);
    const created = __mutationCalls("projects:createProject")[0] as {
      title: string;
      transcripts: Array<Record<string, unknown>>;
    };
    expect(created.title).toBe("Fresh project");
    expect(created.transcripts).toHaveLength(1);
    expect(created.transcripts[0]).not.toHaveProperty("fromTranscriptId");
    expect(__mutationCalls("projectDuplication:copyProjectContent")).toEqual([]);
    expect(__mutationCalls("generations:requestGeneration")[0]).toMatchObject({
      projectId: "project-new",
      candidateMode: "compare",
    });
  });
});
