import { beforeEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import CurrentProjectPage from "./CurrentProjectPage.svelte";
import { __resetPage, __setPageParams } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import {
  __activeQueryArgs,
  __resetConvexStub,
  __setPaginatedRows,
  __setQueryData,
  __setQueryError,
} from "$lib/test/convex-svelte-stub.svelte";

/**
 * Story 4 integration facts that live only in CurrentProjectPage: rail
 * exclusivity, `banhall_brief_open` persistence and its precedence, the
 * launcher's right-offset stepping, the legacy "absent, not empty" rule, the
 * placement of the Brief under the generation progress card, and the single
 * generation id every Brief surface shares.
 */
const briefPill = () => page.getByRole("button", { name: "Open Brief", exact: true });
const closeBrief = () => page.getByRole("button", { name: "Close Brief", exact: true });
const chatPill = () => page.getByRole("button", { name: "Open AI assistant", exact: true }).first();
const qaPill = () => page.getByRole("button", { name: "Open QA panel", exact: true });

const inclusion = {
  recorded: true,
  cap: 12,
  documentsInContext: 1,
  documentsTotal: 2,
  rows: [
    { key: "source:t1", kind: "transcript", label: "Interview transcript", inclusion: "included" },
    { key: "source:d1", kind: "document", label: "specs.pdf", inclusion: "included" },
    { key: "document:p1", kind: "document", label: "old.pdf", inclusion: "not_included", reason: "archived" },
  ],
};

const brief = {
  _id: "brief-1",
  version: 1,
  storylineText: "The team pursued a custom control loop.",
  storylineOrigin: "derived",
  editedSinceGeneration: false,
  canEdit: true,
  entries: [],
};

function seed() {
  __setQueryData("projects:getProject", {
    _id: "project-1",
    title: "Thermal investigation",
    clientName: "Acme",
    writer: "Writer",
    interviewer: "",
    interviewees: [],
    tagIds: [],
    mode: "generate",
    status: "review",
    workflowStage: "drafting",
    createdBy: "user-1",
    ownerId: "user-1",
    createdAt: 1,
    updatedAt: 1,
  });
  __setQueryData("users:getCurrentUser", { _id: "user-1", role: "writer", firstName: "Writer", email: "writer@example.test" });
  __setQueryData("reports:getLatestReport", {
    _id: "report-1",
    projectId: "project-1",
    generationId: "generation-1",
    version: 1,
    revisionNumber: 1,
    content: JSON.stringify({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Evidence from thermal trials." }] }],
    }),
    createdAt: 1,
    updatedAt: 1,
  });
  for (const name of ["generations:getLatestGeneration", "pdReviews:getLatestPdReview", "reportViews:getViewSummary"]) {
    __setQueryData(name, null);
  }
  for (const name of [
    "transcripts:listTranscripts",
    "documents:listDocuments",
    "tags:listTags",
    "comments:listComments",
    "chatV2:listThreads",
    "chatV2:listTurns",
    "chatV2:listProposals",
    "research:listSessions",
    "uploadAttempts:listUploadAttempts",
  ]) {
    __setQueryData(name, []);
  }
  __setQueryData("chatV2:listMessages", { streams: { kind: "list", messages: [] } });
  __setPaginatedRows("chatV2:listMessages", []);
  __setQueryData("briefs:getBrief", brief);
  __setQueryData("generations:getContextInclusion", inclusion);
  __setQueryData("writerProfiles:getGenerationWriterSettings", null);
}

beforeEach(() => {
  __resetAuthState();
  __resetPage();
  __resetNavigation();
  __resetConvexStub();
  localStorage.clear();
  __setPageParams({ id: "project-1" });
  seed();
});

it("opens the Brief from its launcher, and chat or QA takes the rail back", async () => {
  await page.viewport(1440, 1000);
  await render(CurrentProjectPage);
  await expect.element(page.getByText("Evidence from thermal trials.", { exact: true })).toBeVisible();

  await briefPill().click();
  await expect.element(closeBrief()).toBeVisible();
  await expect.element(page.getByRole("heading", { name: "Brief", exact: true })).toBeVisible();
  await expect.poll(() => localStorage.getItem("banhall_brief_open")).toBe("1");

  // Opening the assistant clears the Brief, and its pill comes back.
  await chatPill().click();
  expect(closeBrief().elements()).toHaveLength(0);
  await expect.element(briefPill()).toBeVisible();
  await expect.poll(() => localStorage.getItem("banhall_brief_open")).toBe("0");

  // So does opening QA.
  await briefPill().click();
  await expect.element(closeBrief()).toBeVisible();
  await qaPill().click();
  expect(closeBrief().elements()).toHaveLength(0);
  await expect.element(briefPill()).toBeVisible();
});

it("remembers an open Brief, and a remembered QA still wins the rail", async () => {
  await page.viewport(1440, 1000);
  localStorage.setItem("banhall_brief_open", "1");
  await render(CurrentProjectPage);
  await expect.element(closeBrief()).toBeVisible();
  // The Brief took the rail, so the assistant never initialized.
  expect(page.getByRole("button", { name: "Close assistant", exact: true }).elements()).toHaveLength(0);

  document.body.innerHTML = "";
  localStorage.setItem("banhall_qa_open", "1");
  localStorage.setItem("banhall_brief_open", "1");
  await render(CurrentProjectPage);
  await expect.element(page.getByRole("button", { name: "Close QA review", exact: true })).toBeVisible();
  expect(closeBrief().elements()).toHaveLength(0);
});

it("steps the Brief pill past every other visible pill", async () => {
  await page.viewport(1440, 1000);
  await render(CurrentProjectPage);
  // Chat open, QA closed: the Brief sits one slot past the QA pill.
  await expect.poll(() => briefPill().element().getAttribute("style")).toContain("right: 5rem");
  await page.getByRole("button", { name: "Close assistant", exact: true }).click();
  await expect.poll(() => briefPill().element().getAttribute("style")).toContain("right: 8.5rem");
});

it("is absent for a legacy generation that recorded nothing", async () => {
  await page.viewport(1440, 1000);
  __setQueryData("briefs:getBrief", null);
  __setQueryData("writerProfiles:getGenerationWriterSettings", null);
  __setQueryData("generations:getContextInclusion", {
    recorded: false,
    cap: 12,
    documentsInContext: 0,
    documentsTotal: 1,
    rows: [{ key: "document:p1", kind: "document", label: "old.pdf", inclusion: "not_included", reason: "archived" }],
  });
  await render(CurrentProjectPage);
  await expect.element(page.getByText("Evidence from thermal trials.", { exact: true })).toBeVisible();
  expect(briefPill().elements()).toHaveLength(0);
  expect(page.getByRole("heading", { name: "Brief", exact: true }).elements()).toHaveLength(0);
});

it("keeps the launcher when a Brief read fails, and the rail says so (DW-128)", async () => {
  await page.viewport(1440, 1000);
  // A failed read is not a legacy generation: data never arrives, an error does.
  __setQueryData("briefs:getBrief", undefined);
  __setQueryError("briefs:getBrief", new Error("Server Error"));
  __setQueryData("writerProfiles:getGenerationWriterSettings", null);
  __setQueryData("generations:getContextInclusion", null);
  await render(CurrentProjectPage);
  await expect.element(page.getByText("Evidence from thermal trials.", { exact: true })).toBeVisible();

  await expect.element(briefPill()).toBeVisible();
  await briefPill().click();
  await expect.element(closeBrief()).toBeVisible();
  await expect
    .element(page.getByRole("alert").filter({ hasText: "Couldn't load the Generation Brief. Try reloading the page." }))
    .toBeVisible();
});

it("shows the Brief under the progress card while generating, for the running generation only", async () => {
  await page.viewport(1440, 1000);
  __setQueryData("reports:getLatestReport", null);
  __setQueryData("generations:getLatestGeneration", {
    _id: "generation-2",
    status: "running",
    candidateMode: "single",
    startedAt: Date.now(),
    currentStep: "Drafting",
    progressLog: [],
  });
  __setQueryData("generations:getGeneration", {
    _id: "generation-2",
    status: "running",
    candidateMode: "single",
    startedAt: Date.now(),
    currentStep: "Drafting",
    progressLog: [],
  });
  await render(CurrentProjectPage);

  await expect.element(page.getByRole("heading", { name: "Brief", exact: true })).toBeVisible();
  await expect.element(page.getByText("1 of 2 documents in context · cap 12", { exact: true })).toBeVisible();
  // One id feeds every Brief surface: the generation that is running, never
  // the report's older one.
  const args = __activeQueryArgs("briefs:getBrief").map((entry) => JSON.stringify(entry));
  expect(new Set(args)).toEqual(new Set([JSON.stringify({ generationId: "generation-2" })]));
  expect(__activeQueryArgs("generations:getContextInclusion")).toContainEqual({
    generationId: "generation-2",
  });
});

it("keeps the rail and the progress panel on one generation during a regeneration", async () => {
  await page.viewport(1440, 1000);
  // A project that already has a report from generation-1, now regenerating.
  __setQueryData("generations:getLatestGeneration", {
    _id: "generation-2",
    status: "reserved",
    candidateMode: "single",
    startedAt: Date.now(),
    currentStep: "Queued",
    progressLog: [],
  });
  __setQueryData("generations:getGeneration", {
    _id: "generation-2",
    status: "reserved",
    candidateMode: "single",
    startedAt: Date.now(),
    currentStep: "Queued",
    progressLog: [],
  });
  await render(CurrentProjectPage);
  await expect.poll(() => __activeQueryArgs("briefs:getBrief").length).toBeGreaterThan(0);
  const args = __activeQueryArgs("briefs:getBrief").map((entry) => JSON.stringify(entry));
  expect(new Set(args)).toEqual(new Set([JSON.stringify({ generationId: "generation-2" })]));
});
