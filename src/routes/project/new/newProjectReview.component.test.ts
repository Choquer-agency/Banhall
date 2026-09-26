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
  addSupportingFiles,
  chooseMode,
  confirmButton,
  fillBasics,
  openStartDialog,
  setDocumentCategory,
} from "./newProjectTestSupport";

/**
 * Board E4, Review a written PD: the PD card with each Section's form line
 * count, the pd_review model shown read-only (decision 52, no per-review
 * choice, no check list: decision 56), and the start dialog with the written
 * PD locked (G3). Supporting documents take transcripts too.
 */
const text = (node: Element | null | undefined) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();

const PD_TEXT = [
  "Line 242 Technological uncertainty",
  "The team did not know whether the seal would hold at minus 30 degrees.",
  "",
  "Line 244 Work performed",
  ...Array.from({ length: 12 }, (_, index) => `Test ${index + 1}: cooled the rig and measured the leak rate.`),
].join("\n");

async function dropWrittenPd(content = PD_TEXT, name = "Cedarline cold storage PD, draft v3.txt") {
  const input = document.querySelector<HTMLInputElement>("[data-written-pd-input]")!;
  const transfer = new DataTransfer();
  transfer.items.add(new File([content], name, { type: "text/plain" }));
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await expect.poll(() => document.querySelector("[data-review-pd-card]")).not.toBeNull();
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
  __setQueryData("providerReadiness:getCapabilities", {
    models: [{ id: "claude-sonnet-5", label: "Sonnet 5", provider: "Anthropic", gateway: "anthropic", description: "", available: true }],
    defaultModel: "claude-sonnet-5",
    defaultModelLabel: "Sonnet 5",
    planningModel: "claude-haiku-4-5-20251001",
    planningModelLabel: "Haiku 4.5",
    pdReviewModel: "claude-opus-5-5",
    pdReviewModelLabel: "Opus 5.5",
  });
});

describe("E4 Review a written PD", () => {
  it("switches the copy and shows the PD card with line counts and a missing Section", async () => {
    await render(NewProjectPage, {});
    await chooseMode("Review a written PD");
    expect(text(document.querySelector("[data-new-project-subtitle]"))).toBe(
      "Add the draft and the basics. You become the project Owner."
    );
    expect(text(document.querySelector("#section-interview-title"))).toBe("Written PD");
    await dropWrittenPd();

    expect(text(document.querySelector("[data-written-pd-status]"))).toBe("Ready to review");
    const rows = [...document.querySelectorAll<HTMLElement>("[data-review-section]")];
    expect(rows.map((row) => [row.dataset.reviewSection, row.dataset.found, text(row.querySelector("[data-review-lines]"))])).toEqual([
      ["242", "true", "1 of 50 lines"],
      ["244", "true", "12 of 100 lines"],
      ["246", "false", "Not found"],
    ]);
    expect(document.body.textContent).toContain(
      "Add the interview under Supporting documents if you want facts checked against it."
    );
    // E4 card: 14px padding, the 40 by 52 thumbnail with its five 3px lines,
    // the 12px "Uploaded" line and 30px rows with the 13px, stroke 2.2 tick.
    const card = document.querySelector<HTMLElement>("[data-review-pd-card]")!;
    expect(getComputedStyle(card).paddingTop).toBe("14px");
    const thumb = card.querySelector<HTMLElement>("[data-review-pd-thumb]")!;
    expect([getComputedStyle(thumb).width, getComputedStyle(thumb).height, getComputedStyle(thumb).borderTopLeftRadius]).toEqual(["40px", "52px", "4px"]);
    expect(getComputedStyle(thumb).boxShadow).toContain("0px 1px 2px");
    const line = thumb.querySelector<HTMLElement>("span")!;
    expect([getComputedStyle(line).height, getComputedStyle(line).backgroundColor]).toEqual(["3px", "rgb(221, 230, 228)"]);
    expect(getComputedStyle(card.querySelector("[data-review-pd-uploaded]")!).fontSize).toBe("12px");
    expect(getComputedStyle(rows[0]).height).toBe("30px");
    const tick = rows[0].querySelector("svg")!;
    expect([tick.getAttribute("width"), tick.getAttribute("stroke-width")]).toEqual(["13", "2.2"]);
  });

  it("shows the pd_review model read-only and no check list", async () => {
    await render(NewProjectPage, {});
    await chooseMode("Review a written PD");
    await expect.poll(() => text(document.querySelector("[data-review-model]"))).toBe("Opus 5.5");
    expect(document.querySelector("[data-review-model]")!.querySelector('[data-ai-mark="aurora"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="Draft generation mode"]')).toBeNull();
    expect(document.body.textContent).not.toContain("CRA structure and limits");
    expect(text(document.querySelector("[data-start-button]"))).toBe("Start the review");
    expect(text(document.querySelector("[data-start-note]"))).toBe(
      "You get a feedback report. Your draft is never changed."
    );
    // E4: the model field on white with the 18px mark; the start straight
    // under it, 36px and full width, no "Before you start" box.
    const model = document.querySelector<HTMLElement>("[data-review-model]")!;
    expect([getComputedStyle(model).backgroundColor, getComputedStyle(model).borderTopLeftRadius]).toEqual(["rgb(255, 255, 255)", "8px"]);
    expect(document.querySelector<HTMLElement>("[data-start-checklist]")!.dataset.startChecklist).toBe("plain");
    expect(document.body.textContent).not.toContain("Before you start");
    const start = document.querySelector<HTMLElement>("[data-start-button]")!;
    expect(getComputedStyle(start).height).toBe("36px");
    // Full width of the 360px column, less its 24px sides.
    expect(start.getBoundingClientRect().width).toBeGreaterThan(300);
  });

  it("locks the written PD in the dialog and leaves out what the writer unticks", async () => {
    __setMutationResult("projects:createProject", { projectId: "project-new", transcriptIds: ["transcript-new"] });
    __setMutationResult("documents:uploadDocument", "document-new");
    __setMutationResult("documents:generateUploadUrl", "https://upload.test/url");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ storageId: "storage-1" })));
    try {
      await render(NewProjectPage, {});
      await fillBasics();
      await chooseMode("Review a written PD");
      await dropWrittenPd();
      addSupportingFiles([
        new File(["WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n<v Dana>What did you try?</v>\n"], "Call.vtt", { type: "text/vtt" }),
      ]);
      // A .vtt comes in as a transcript chip in Review.
      await expect
        .poll(() => document.querySelector('[data-supporting-card][data-category="transcript"][data-status="ready"]'))
        .not.toBeNull();

      await openStartDialog();
      const dialog = document.querySelector<HTMLElement>("[data-start-run-dialog]")!;
      expect(dialog.dataset.mode).toBe("review");
      expect(text(dialog)).toContain("Choose what the review checks against");
      expect(text(dialog.querySelector("[data-start-run-model-title]"))).toBe("Opus 5.5");
      expect(text(dialog.querySelector("[data-start-run-model-line]"))).toBe("Reviews the draft, you get a feedback report");
      const pdRow = dialog.querySelector<HTMLElement>('[data-start-run-row="pd"]')!;
      expect(pdRow.querySelector("[data-start-run-lock]")).not.toBeNull();
      expect(text(pdRow.querySelector("[data-start-run-chip]"))).toBe("Being reviewed");
      expect(text(pdRow.querySelector("[data-start-run-meta]"))).toContain("2 of 3 sections found");

      const transcriptRow = [...dialog.querySelectorAll<HTMLElement>("[data-start-run-row]")].find(
        (row) => row.dataset.kind === "transcript"
      )!;
      transcriptRow.querySelector<HTMLElement>("[data-start-run-check]")!.click();
      await expect.poll(() => confirmButton()?.disabled).toBe(false);
      confirmButton()!.click();

      await expect.poll(() => __mutationCalls("pdReviews:startPdReview").length).toBe(1);
      const created = __mutationCalls("projects:createProject")[0] as { transcripts: Array<{ label: string; sourceFormat: string }> };
      // Unticked files still go into the project.
      expect(created.transcripts).toEqual([expect.objectContaining({ label: "Call.vtt", sourceFormat: "vtt" })]);
      expect(__mutationCalls("pdReviews:startPdReview")[0]).toEqual({
        projectId: "project-new",
        documentId: "document-new",
        excludeTranscriptIds: ["transcript-new"],
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("sends a transcript pasted under Supporting documents as a transcript", async () => {
    __setMutationResult("projects:createProject", { projectId: "project-new", transcriptIds: ["transcript-new"] });
    __setMutationResult("documents:uploadDocument", "document-new");
    __setMutationResult("documents:generateUploadUrl", "https://upload.test/url");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ storageId: "storage-1" })));
    try {
      await render(NewProjectPage, {});
      await fillBasics();
      await chooseMode("Review a written PD");
      await dropWrittenPd();
      await userEvent.click(document.querySelector<HTMLElement>("[data-add-supporting]")!);
      await userEvent.click(document.querySelector<HTMLElement>("[data-add-paste]")!);
      await expect.poll(() => document.querySelector('[aria-label="Type of pasted text"]')).not.toBeNull();
      await userEvent.click(document.querySelector<HTMLElement>('[aria-label="Type of pasted text"]')!);
      await userEvent.click(page.getByRole("option", { name: "Transcript", exact: true }));
      const box = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Pasted text"]')!;
      box.value = "Dana: We measured the leak rate every hour.";
      box.dispatchEvent(new Event("input", { bubbles: true }));
      await expect.poll(() => document.querySelector<HTMLButtonElement>("[data-add-pasted]")?.disabled).toBe(false);
      document.querySelector<HTMLButtonElement>("[data-add-pasted]")!.click();
      await expect.poll(() => document.querySelector('[data-supporting-card][data-category="transcript"]')).not.toBeNull();
      await openStartDialog();
      confirmButton()!.click();
      await expect.poll(() => __mutationCalls("pdReviews:startPdReview").length).toBe(1);
      expect((__mutationCalls("projects:createProject")[0] as { transcripts: unknown[] }).transcripts).toEqual([
        { content: "Dana: We measured the leak rate every hour.", label: "Transcript (pasted)", sourceFormat: "paste" },
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("offers Transcript as a chip on supporting documents in Review only", async () => {
    await render(NewProjectPage, {});
    addSupportingFiles([new File(["Notes."], "Notes.txt", { type: "text/plain" })]);
    await expect.poll(() => document.querySelector('[data-supporting-card][data-status="ready"]')).not.toBeNull();
    await chooseMode("Review a written PD");
    await setDocumentCategory("Notes.txt", "Transcript");
  });
});
