import { beforeEach, describe, expect, it } from "vitest";
import { page as browserPage } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import PreviewProjectPage from "./PreviewProjectPage.svelte";
import { __resetPage, __setPageParams, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import {
  __mutationCalls,
  __resetConvexStub,
  __setQueryData,
  __setQueryError,
} from "$lib/test/convex-svelte-stub.svelte";

/**
 * 2026-09-15 metadata gate: the single-project metadata mutations accept only
 * the Owner, an open-work-item collaborator, a Manager or an Admin. The page
 * asks `projects:getProjectEditAccess` and, on a definite `false`, renders the
 * plain values instead of EditableText/pickers, so a writer outside that
 * scope never reaches a control whose save would fail with NOT_AUTHORIZED.
 * While the answer is loading the controls stay editable (no read-only flash).
 * The fields live in the Details panel (ui-design-final.md section 8): the
 * facts rows, and the quiet More disclosure for titles, client and tags.
 */
const FISCAL_YEAR_END = Date.UTC(2025, 11, 31, 12);

function seedProject() {
  __setQueryData("projects:getProject", {
    _id: "project-1",
    title: "Acme FY24 thermal narrative",
    sredTitle: "Thermal flow prediction under uncertainty",
    clientName: "Acme Labs",
    projectNumber: "2A",
    writer: "Wren Writer",
    interviewer: "",
    interviewees: [],
    createdAt: 1753747200000,
    fiscalYearEnd: FISCAL_YEAR_END,
    industry: "manufacturing",
    scienceCode: "1.02.01",
    tagIds: ["tag-hw"],
    mode: "full",
    status: "draft",
    workflowStage: "intake",
    shareToken: "tok-1",
    createdBy: "u-owner",
    ownerId: "u-owner",
  });
  __setQueryData("reports:getLatestReport", null);
  __setQueryData("generations:getLatestGeneration", null);
  __setQueryData("pdReviews:getLatestPdReview", null);
  __setQueryData("reportViews:getViewSummary", null);
  __setQueryData("tags:listTags", [{ _id: "tag-hw", name: "Hardware", parentId: null }]);
  __setQueryData("documents:listDocuments", []);
  __setQueryData("transcripts:listTranscripts", []);
  __setQueryData("users:getCurrentUser", {
    _id: "u-other-writer",
    role: "writer",
    firstName: "Wren",
    lastName: "Writer",
    email: "wren@example.test",
  });
  __setQueryData("projectWorkflow:getProjectWorkflowHeader", {
    workflowStage: "intake",
    stageIsFallback: false,
    workflowUpdatedAt: null,
    workflowVersion: 1,
    owner: { userId: "u-owner", label: "Olive Owner", initials: "OO" },
    ownerNeedsReview: false,
    createdByLabel: "Olive Owner",
    viewerAuthorities: [],
  });
  __setQueryData("projects:getProjectDetailsPanel", {
    stage: "intake",
    workflowVersion: 1,
    industry: "manufacturing",
    fiscalYearEnd: FISCAL_YEAR_END,
    scienceCode: "1.02.01",
    projectNumber: "2A",
    owner: { userId: "u-owner", label: "Olive Owner", initials: "OO", isYou: false },
    createdAt: 1753747200000,
    editedAt: 1753747200000,
    currentHandoff: null,
    permissions: { canEditDetails: true, canChangeStage: false, canHandOff: false },
  });
  __setQueryData("workItems:getProjectWorkPanel", {
    currentHandoffId: null,
    openItems: [],
    viewer: { canCreate: false, canCreateFinancial: false },
    assignable: true,
    assignableReason: null,
    pointerHealthy: true,
    truncated: false,
  });
}

async function mountWithAccess(access: { canEditDetails: boolean } | undefined) {
  __setPageUrl("/project/project-1");
  __setPageParams({ id: "project-1" });
  seedProject();
  if (access !== undefined) __setQueryData("projects:getProjectEditAccess", access);
  await browserPage.viewport(1440, 900);
  await render(PreviewProjectPage, {});
  await expect.poll(() => document.querySelector("[data-intake-workbench]")).not.toBeNull();
  // The fields live in the Details panel; titles, client and tags sit behind
  // its quiet More disclosure.
  await browserPage.getByRole("button", { name: "Details", exact: true }).click();
  await expect.poll(() => document.querySelector("[data-details-more-toggle]")).not.toBeNull();
  document.querySelector<HTMLButtonElement>("[data-details-more-toggle]")!.click();
  await expect.poll(() => document.querySelector("[data-details-more]")).not.toBeNull();
}

const details = () => document.querySelector<HTMLElement>("[data-details-panel]");
const button = (name: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (el) => el.getAttribute("aria-label") === name
  ) ?? null;
/** Value cell of the fact or More row whose label reads `label`. */
function rowValue(label: string) {
  const row = Array.from(
    details()!.querySelectorAll<HTMLElement>("[data-details-facts] dt, [data-details-more] span.text-ink-muted")
  ).find((el) => el.textContent?.trim() === label);
  if (!row) throw new Error(`No "${label}" row`);
  return row.nextElementSibling as HTMLElement;
}

const EDIT_CONTROLS = [
  "Edit internal project title",
  "Edit SR&ED title",
  "Edit client name",
  "Edit project number",
  "Edit fiscal year",
  "Edit industry",
  "Edit science code",
  "Add tags",
  "Remove tag Hardware",
];

describe("PreviewProjectPage metadata edit access", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetAuthState();
    __resetPage();
    __resetNavigation();
    __resetConvexStub();
    document.body.innerHTML = "";
  });

  it("renders plain values and no edit controls when canEditDetails is false", async () => {
    await mountWithAccess({ canEditDetails: false });

    for (const name of EDIT_CONTROLS) expect(button(name), name).toBeNull();
    expect(details()!.querySelector("[role=combobox]")).toBeNull();

    // The title is still the page heading, and its row is not editable.
    const heading = document.querySelector("h1[data-project-heading]");
    expect(heading?.textContent?.trim()).toBe("Acme FY24 thermal narrative");
    const title = rowValue("Internal title");
    expect(title.querySelector("button")).toBeNull();
    expect(title.textContent?.trim()).toBe("Acme FY24 thermal narrative");

    // Client and SR&ED title rows are text, the way the Writer row already is.
    const client = rowValue("Client");
    expect(client.querySelector("button")).toBeNull();
    expect(client.textContent?.trim()).toBe("Acme Labs");
    expect(client.querySelector("p")).not.toBeNull();
    expect(rowValue("SR&ED title").textContent?.trim()).toBe(
      "Thermal flow prediction under uncertainty"
    );
    expect(rowValue("Project number").textContent?.trim()).toBe("2A");
    // Pickers become their current value, with human labels.
    expect(rowValue("Industry").textContent).toContain("Manufacturing");
    expect(rowValue("Science code").textContent).toContain("Computer sciences");
    expect(rowValue("Science code").textContent).toContain("1.02.01");
    expect(rowValue("Fiscal year").textContent).toContain("December 31, 2025");
    expect(rowValue("Tags").textContent).toContain("Hardware");
    // Nothing was written.
    expect(__mutationCalls("projects:updateProjectClientName")).toEqual([]);
    expect(__mutationCalls("projects:updateProjectTags")).toEqual([]);
  });

  it("renders the editable controls when canEditDetails is true", async () => {
    await mountWithAccess({ canEditDetails: true });

    for (const name of EDIT_CONTROLS) expect(button(name), name).not.toBeNull();
    // The AI science code suggestion stays reachable from the picker.
    button("Edit science code")!.click();
    await expect.poll(() => document.body.textContent).toContain("Suggest with AI");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    // The client EditableText really opens.
    button("Edit client name")!.click();
    await expect
      .poll(() => document.querySelector<HTMLInputElement>('input[aria-label="Edit client name"]'))
      .not.toBeNull();
  });

  it("keeps the controls editable while the access answer is still loading", async () => {
    await mountWithAccess(undefined);

    expect(button("Edit client name")).not.toBeNull();
    expect(button("Edit SR&ED title")).not.toBeNull();
    expect(button("Add tags")).not.toBeNull();
  });

  // PR #16 review: an errored access query is not "loading"; fail closed.
  it("falls back to read-only when the access query errors", async () => {
    __setQueryError("projects:getProjectEditAccess", new Error("access lookup failed"));
    await mountWithAccess(undefined);

    for (const name of EDIT_CONTROLS) expect(button(name), name).toBeNull();
    expect(rowValue("Client").textContent?.trim()).toBe("Acme Labs");
    expect(__mutationCalls("projects:updateProjectClientName")).toEqual([]);
  });
});
