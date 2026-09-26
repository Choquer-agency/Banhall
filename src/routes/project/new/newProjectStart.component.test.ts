import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import NewProjectPage from "./+page.svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __navigationCalls, __resetNavigation } from "$lib/test/app-navigation-stub";
import {
  __mutationCalls,
  __resetConvexStub,
  __setMutationResult,
  __setQueryData,
} from "$lib/test/convex-svelte-stub.svelte";
import { takeProjectStart } from "$lib/workspace/projectIntentHandoff";
import {
  addSupportingFiles,
  confirmButton,
  fillBasics,
  openStartDialog,
  openTranscriptPaste,
  setInputValue,
  startButton,
} from "./newProjectTestSupport";

/**
 * The start sequence (E1 to F1, G1, G2): the start button opens the dialog
 * with every staged transcript and file; the dialog names the models that
 * run (decision 52); on confirm the page creates the project, saves every
 * file (unticked ones too) and starts the run with the leave-out lists
 * (decision 56), then opens the project.
 */
const text = (node: Element | null | undefined) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();
const CAPABILITIES = {
  models: [
    { id: "claude-sonnet-5", label: "Sonnet 5", provider: "Anthropic", gateway: "anthropic", description: "", available: true },
    { id: "claude-opus-5-5", label: "Opus 5.5", provider: "Anthropic", gateway: "anthropic", description: "", available: true },
  ],
  defaultModel: "claude-sonnet-5",
  defaultModelLabel: "Sonnet 5",
  planningModel: "claude-haiku-4-5-20251001",
  planningModelLabel: "Haiku 4.5",
  pdReviewModel: "claude-opus-5-5",
  pdReviewModelLabel: "Opus 5.5",
};

async function readyToStart() {
  await render(NewProjectPage, {});
  await fillBasics();
  await openTranscriptPaste();
  setInputValue("#transcript", "Interviewer: What was uncertain?\nEngineer: The seal.");
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
  __setQueryData("providerReadiness:getCapabilities", CAPABILITIES);
  __setMutationResult("projects:createProject", { projectId: "project-new", transcriptIds: ["transcript-new"] });
  __setMutationResult("documents:uploadDocument", "document-new");
  __setMutationResult("documents:generateUploadUrl", "https://upload.test/url");
});

describe("the start dialog names the models that run (decision 52)", () => {
  it("Step by step: the planning model writes the ideas, the picked model the report", async () => {
    await readyToStart();
    await openStartDialog();
    const dialog = document.querySelector<HTMLElement>("[data-start-run-dialog]")!;
    expect(dialog.dataset.mode).toBe("iterative");
    expect(text(dialog.querySelector("[data-start-run-model-title]"))).toBe("Haiku 4.5");
    expect(text(dialog.querySelector("[data-start-run-model-line]"))).toBe("Writes the ideas. Sonnet 5 writes the report.");
    // The paste in the box became the one transcript.
    expect(text(confirmButton())).toBe("Start with 1 file");
  });

  it("Step by step: one line when the same model does both", async () => {
    __setQueryData("providerReadiness:getCapabilities", { ...CAPABILITIES, planningModel: "claude-sonnet-5", planningModelLabel: "Sonnet 5" });
    await readyToStart();
    await openStartDialog();
    expect(text(document.querySelector("[data-start-run-model-line]"))).toBe("Writes the ideas and the report.");
  });

  it("Single draft names the picked model; Compare names both slots", async () => {
    await readyToStart();
    document.querySelector<HTMLElement>('[data-write-mode="single"]')!.click();
    await openStartDialog();
    expect(text(document.querySelector("[data-start-run-model-title]"))).toBe("Sonnet 5");
    expect(text(document.querySelector("[data-start-run-model-line]"))).toBe("Writes the draft, about 3 minutes");
    expect(text(confirmButton())).toBe("Write the draft");
    document.querySelector<HTMLButtonElement>("[data-start-run-cancel]")!.click();
    await expect.poll(() => document.querySelector("[data-start-run-dialog]")).toBeNull();

    document.querySelector<HTMLElement>('[data-write-mode="compare"]')!.click();
    await openStartDialog();
    expect(text(document.querySelector("[data-start-run-model-title]"))).toBe("A random model and a random model");
    expect(text(document.querySelector("[data-start-run-model-line]"))).toBe("One draft each, you keep the better one");
    expect(text(confirmButton())).toBe("Write 2 drafts");
    expect(document.querySelectorAll('[data-start-run-dialog] [data-ai-mark="aurora"]')).toHaveLength(1);
  });

  it("returns focus to the start button when the dialog is cancelled", async () => {
    await readyToStart();
    await openStartDialog();
    document.querySelector<HTMLButtonElement>("[data-start-run-cancel]")!.click();
    await expect.poll(() => document.querySelector("[data-start-run-dialog]")).toBeNull();
    await expect.poll(() => document.activeElement).toBe(startButton());
    expect(__mutationCalls("projects:createProject")).toEqual([]);
  });
});

describe("confirming starts the run with the leave-out lists (decision 56)", () => {
  it("saves every file, then leaves the unticked transcript and file out of the run", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(Response.json({ storageId: "storage-1" })));
    try {
      await readyToStart();
      addSupportingFiles([new File(["Scoping notes for the rig."], "Scoping.txt")]);
      await expect.poll(() => document.querySelector('[data-supporting-card][data-status="ready"]')).not.toBeNull();
      await openStartDialog();
      const rows = [...document.querySelectorAll<HTMLElement>("[data-start-run-row]")];
      expect(rows.map((row) => [row.dataset.kind, text(row.querySelector("[data-start-run-chip]"))])).toEqual([
        ["transcript", "Transcript"],
        ["document", "Other supporting docs"],
      ]);
      // Leave the file out; the transcript stays in.
      rows[1].querySelector<HTMLElement>("[data-start-run-check]")!.click();
      await expect.poll(() => text(confirmButton())).toBe("Start with 1 file");
      confirmButton()!.click();

      await expect.poll(() => __mutationCalls("generations:requestGeneration").length).toBe(1);
      // The unticked file is still saved to the project.
      expect(__mutationCalls("documents:uploadDocument")).toEqual([
        expect.objectContaining({ fileName: "Scoping.txt", category: "other", projectId: "project-new" }),
      ]);
      expect(__mutationCalls("generations:requestGeneration")[0]).toEqual({
        projectId: "project-new",
        candidateMode: "iterative",
        excludeDocumentIds: ["document-new"],
      });
      await expect.poll(() => __navigationCalls.map((call) => call.url)).toContain("/project/project-new");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("maps an unticked transcript to the created row", async () => {
    await readyToStart();
    await openStartDialog();
    // Tick a second source first so the rule allows leaving the transcript out.
    document.querySelector<HTMLButtonElement>("[data-start-run-cancel]")!.click();
    addSupportingFiles([new File(["Scoping notes for the rig."], "Scoping.txt")]);
    await expect.poll(() => document.querySelector('[data-supporting-card][data-status="ready"]')).not.toBeNull();
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(Response.json({ storageId: "storage-1" })));
    try {
      await openStartDialog();
      const transcript = [...document.querySelectorAll<HTMLElement>("[data-start-run-row]")].find(
        (row) => row.dataset.kind === "transcript"
      )!;
      transcript.querySelector<HTMLElement>("[data-start-run-check]")!.click();
      await expect.poll(() => confirmButton()?.disabled).toBe(false);
      confirmButton()!.click();
      await expect.poll(() => __mutationCalls("generations:requestGeneration").length).toBe(1);
      expect((__mutationCalls("projects:createProject")[0] as { transcripts: unknown[] }).transcripts).toHaveLength(1);
      expect(__mutationCalls("generations:requestGeneration")[0]).toEqual({
        projectId: "project-new",
        candidateMode: "iterative",
        excludeTranscriptIds: ["transcript-new"],
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("sends no leave-out lists when everything stays ticked", async () => {
    await readyToStart();
    await openStartDialog();
    confirmButton()!.click();
    await expect.poll(() => __mutationCalls("generations:requestGeneration").length).toBe(1);
    expect(__mutationCalls("generations:requestGeneration")[0]).toEqual({
      projectId: "project-new",
      candidateMode: "iterative",
    });
  });
});
