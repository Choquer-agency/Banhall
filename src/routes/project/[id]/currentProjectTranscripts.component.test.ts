import { beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import ProjectPage from "./+page.svelte";
import { __resetPage, __setPageParams, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import {
  __activeQueryArgs,
  __activeQueryCount,
  __resetConvexStub,
  __setQueryData,
} from "$lib/test/convex-svelte-stub.svelte";

/**
 * The `?workspace=current` chrome is frozen legacy, but it reads transcripts
 * through the same pair as the preview workbench: `listTranscripts` for the
 * rows and `getTranscriptContent` for the one that is open. Mounted through
 * the real route (not the component directly) so the surface under test is the
 * one a reader reaches with `?workspace=current`.
 */
const TRANSCRIPT_BODY =
  "Interviewer: describe the thermal uncertainty.\nEngineer: we could not predict flow.";

function transcriptRow(id: string, label: string, wordCount: number) {
  return { _id: id, label, position: 0, createdAt: 1753747200000, charCount: wordCount * 6, wordCount };
}

function seedProject(
  transcripts: ReturnType<typeof transcriptRow>[],
  mode: "full" | "review" = "full"
) {
  __setQueryData("workspaceRollout:getAccess", { available: true });
  __setQueryData("projects:getProject", {
    _id: "project-1",
    title: "Acme FY24 thermal narrative",
    sredTitle: "",
    clientName: "Acme Labs",
    writer: "Wren Writer",
    interviewer: "",
    interviewees: [],
    createdAt: 1753747200000,
    fiscalYearEnd: null,
    industry: null,
    scienceCode: null,
    tagIds: [],
    mode,
    status: "draft",
    workflowStage: "intake",
    shareToken: "tok-1",
    createdBy: "u-1",
  });
  __setQueryData("reports:getLatestReport", null);
  __setQueryData("generations:getLatestGeneration", null);
  __setQueryData("pdReviews:getLatestPdReview", null);
  __setQueryData("reportViews:getViewSummary", null);
  __setQueryData("tags:listTags", []);
  __setQueryData("documents:listDocuments", []);
  __setQueryData("transcripts:listTranscripts", transcripts);
  if (transcripts.length > 0) {
    __setQueryData("transcripts:getTranscriptContent", {
      _id: transcripts[0]._id,
      label: transcripts[0].label,
      content: TRANSCRIPT_BODY,
    });
  }
  __setQueryData("users:getCurrentUser", {
    _id: "u-1",
    role: "writer",
    firstName: "Wren",
    lastName: "Writer",
    email: "wren@example.test",
  });
}

const currentPage = () =>
  document.querySelector<HTMLElement>('[data-dashboard-experience="current"]');
// The Files panel's own disclosure trigger is not heading-wrapped, so this
// selects the transcript rows and nothing else.
const transcriptTriggers = () =>
  Array.from(
    document.querySelectorAll<HTMLButtonElement>('main h3 > button[aria-expanded]')
  );

async function mountCurrent(
  transcripts: ReturnType<typeof transcriptRow>[],
  mode?: "full" | "review"
) {
  __setPageUrl("/project/project-1?workspace=current");
  __setPageParams({ id: "project-1" });
  seedProject(transcripts, mode);
  await render(ProjectPage, {});
  await expect.poll(currentPage).not.toBeNull();
  await expect.poll(() => document.querySelector("main")).not.toBeNull();
}

describe("?workspace=current project transcripts", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetPage();
    __resetNavigation();
    __resetConvexStub();
    document.body.innerHTML = "";
  });

  it("stacks one disclosure per transcript, opens the first and subscribes one body at a time", async () => {
    await mountCurrent([
      transcriptRow("t-1", "Kickoff interview.docx", 11),
      transcriptRow("t-2", "Follow-up call.docx", 240),
    ]);

    await expect.poll(() => transcriptTriggers()).toHaveLength(2);
    const triggers = transcriptTriggers();
    expect(triggers[0].textContent).toContain("Kickoff interview.docx");
    expect(triggers[1].textContent).toContain("Follow-up call.docx");
    // Word counts come from the metadata list; no body is fetched for them.
    expect(triggers[1].textContent).toContain("240 words");
    expect(triggers[0].getAttribute("aria-expanded")).toBe("true");
    expect(triggers[1].getAttribute("aria-expanded")).toBe("false");
    expect(
      document.getElementById(triggers[0].getAttribute("aria-controls")!)!.textContent
    ).toContain(TRANSCRIPT_BODY);
    expect(document.getElementById(triggers[1].getAttribute("aria-controls")!)).toBeNull();
    expect(__activeQueryArgs("transcripts:getTranscriptContent")).toEqual([
      { transcriptId: "t-1" },
    ]);

    triggers[1].click();
    await expect
      .poll(() => transcriptTriggers()[1].getAttribute("aria-expanded"))
      .toBe("true");
    // Opening a row closes the one that was open: still one body, and it is
    // the row the reader asked for.
    expect(transcriptTriggers()[0].getAttribute("aria-expanded")).toBe("false");
    expect(__activeQueryCount("transcripts:getTranscriptContent")).toBe(1);
    expect(__activeQueryArgs("transcripts:getTranscriptContent")).toEqual([
      { transcriptId: "t-2" },
    ]);
    // Until the body query answers for t-2 the row says so rather than
    // painting its neighbour's transcript.
    const openBody = () =>
      document.getElementById(transcriptTriggers()[1].getAttribute("aria-controls")!)
        ?.textContent;
    await expect.poll(openBody).toContain("Loading transcript...");
    __setQueryData("transcripts:getTranscriptContent", {
      _id: "t-2",
      label: "Follow-up call.docx",
      content: TRANSCRIPT_BODY,
    });
    await expect.poll(openBody).toContain(TRANSCRIPT_BODY);
  });

  it("hides the transcript block in review mode with no transcripts", async () => {
    await mountCurrent([], "review");

    // The intake branch rendered — the absence below is the transcript
    // block's, not a page that never got there.
    await expect.poll(() => document.querySelector("main")?.textContent).toContain("Files");
    expect(transcriptTriggers()).toHaveLength(0);
    // The block still exists in the frozen chrome; the hide rule is what keeps
    // an empty "Transcripts" heading off a review project.
    const heading = Array.from(document.querySelectorAll<HTMLElement>("main h2")).find((h) =>
      ["Transcript", "Transcripts"].includes(h.textContent?.trim() ?? "")
    );
    expect(heading).toBeDefined();
    expect(heading!.closest("[hidden]")).not.toBeNull();
    expect(__activeQueryCount("transcripts:getTranscriptContent")).toBe(0);
  });
});
