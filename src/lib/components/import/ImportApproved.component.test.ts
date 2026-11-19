import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import ImportPage from "./ImportPage.svelte";
import ToastHarness from "$lib/test/ToastHarness.svelte";
import {
  __mutationCalls,
  __resetConvexStub,
  __setMutationHandler,
  __setPaginatedRowsForArgs,
  __setQueryData,
  __setQueryDataForArgs,
} from "$lib/test/convex-svelte-stub.svelte";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import { viewAs } from "$lib/shell/viewAs.svelte";
import { SEND_BACK_NOTES } from "./importApproved";

/**
 * The Approved tab (2026-11-17, docs/product-domain.md): edit after
 * approval (the writer, reviewer and science code cells, the row's menu with
 * "Reviewed by CRA", the file view's details) and Send back to review (the
 * row's menu, the selection bar and the file view, each with its confirm).
 * Made-up companies and people.
 */
const CAPTURES = "../../../../.vitest-attachments/import-approved";
const text = (node: Element | null | undefined) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();
const all = (selector: string, root: ParentNode = document) => [...root.querySelectorAll<HTMLElement>(selector)];
const one = (selector: string, root: ParentNode = document) => root.querySelector<HTMLElement>(selector);
const fileRow = (id: string) => one(`[data-import-file="${id}"]`)!;
const inRow = (id: string, selector: string) => one(selector, fileRow(id))!;

const totals = (files: number, companies: number, extra: Record<string, number> = {}) => ({
  files,
  companies,
  needsCheck: 0,
  ready: files,
  beingRead: 0,
  newFiles: 0,
  brainCheck: 0,
  complete: true,
  ...extra,
});

const BAND = {
  companyKey: "cedarline systems",
  displayName: "Cedarline Systems",
  total: 5,
  needsCheck: 0,
  ready: 5,
  beingRead: 0,
  newFiles: 0,
  brainCheck: 1,
  categories: {
    final_pd: { total: 4, needsCheck: 0, fiscalYears: { "2025": 4 } },
    supporting: { total: 1, needsCheck: 0, fiscalYears: { "2025": 1 } },
  },
  company: { via: "name", clientId: "c1", name: "Cedarline Systems", industry: "software" },
  isNew: false,
};

const PAGE = { key: "cedarline systems", name: "Cedarline Systems" };

function row(id: string, extra: Record<string, unknown> = {}) {
  return {
    _id: id,
    name: `${id}.docx`,
    category: "final_pd",
    status: "approved",
    editedLabels: [],
    needsCheck: false,
    checkReasons: [],
    size: 2048,
    fiscalYearEnd: Date.UTC(2025, 2, 31),
    versionCode: "S",
    versionNumber: 1,
    companyPage: PAGE,
    ...extra,
  };
}

const APPROVED = [
  row("a1", {
    pdNumber: "1",
    pdTitle: "Route planning engine",
    writerName: "Dana Whitlock",
    writerId: "w-dana",
    writerNameSource: "initials",
    writerInitials: "DW",
    reviewerName: "Priya Nair",
    reviewerId: "w-priya",
    reviewerSource: "initials",
    reviewerInitials: "PN",
    scienceCode: "2.02.09",
    brain: "in_brain",
    craReviewed: true,
  }),
  row("a2", { pdNumber: "2", pdTitle: "Yard map solver", writerName: "Priya Nair", writerId: "w-priya", scienceCode: "2.02.09", brain: "brain_check" }),
  row("a3", { pdNumber: "3", pdTitle: "Label vision check", writerName: "Sam Okafor", writerId: "w-sam", scienceCode: "1.02.02", brain: "kept_out" }),
  row("a4", { pdNumber: "4", pdTitle: "Shelf gap finder", writerName: "Dana Whitlock", writerId: "w-dana", scienceCode: "2.02.09", brain: "removed", companyPage: undefined }),
];
const SUPPORTING = [row("s1", { name: "Freezer readings.pdf", category: "supporting", versionCode: undefined, versionNumber: undefined })];

const WRITER_CHOICES = {
  members: [
    { userId: "u1", label: "Dana Whitlock", writerId: "w-dana", linkedWriterId: null },
    { userId: "u2", label: "Priya Nair", writerId: "w-priya", linkedWriterId: null },
    { userId: "u3", label: "Sam Okafor", writerId: "w-sam", linkedWriterId: null },
  ],
  pastWriters: [{ writerId: "w-kt", label: "Kim Tran", initials: "KT" }],
};

const filesArgs = (category: string) => ({ tab: "approved", companyKey: "cedarline systems", category, onlyToCheck: false });

function seed() {
  __setQueryDataForArgs("ingestion:sheetTotals", { tab: "review" }, totals(12, 1));
  __setQueryDataForArgs("ingestion:sheetTotals", { tab: "approved" }, totals(5, 1, { brainCheck: 1 }));
  __setQueryDataForArgs("ingestion:sheetTotals", { tab: "deleted" }, totals(0, 0));
  for (const onlyToCheck of [false, true]) {
    __setPaginatedRowsForArgs("ingestion:sheetCompanies", { tab: "review", onlyToCheck }, []);
    __setPaginatedRowsForArgs("ingestion:sheetCompanies", { tab: "approved", onlyToCheck }, [BAND]);
  }
  __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("final_pd"), APPROVED);
  __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("supporting"), SUPPORTING);
  __setQueryData("ingestion:writerChoices", WRITER_CHOICES);
  __setMutationHandler("ingestion:editApprovedFile", (args) => {
    const patch = (args as { patch: Record<string, unknown> }).patch;
    const changed = Object.keys(patch);
    return { changed, brainUpdated: changed.includes("writer") || changed.includes("scienceCode") };
  });
  __setMutationHandler("ingestion:sendBackToReview", (args) => {
    const ids = (args as { ids: string[] }).ids;
    return { sentBack: ids, refused: [], companyFileGone: [], brainKept: [], brainRevoked: ids.filter((id) => id === "a1") };
  });
}

async function mount(width = 1280) {
  await page.viewport(width, 900);
  await render(ToastHarness);
  await render(ImportPage);
  await userEvent.click(page.getByRole("tab", { name: /^Approved/ }));
  await expect.element(page.getByRole("button", { name: "Cedarline Systems" })).toBeVisible();
  await userEvent.click(page.getByRole("button", { name: "Cedarline Systems" }));
  await expect.poll(() => all('[data-import-file-category="final_pd"]').length).toBe(4);
}

function seedFile(id: string, extra: Record<string, unknown> = {}) {
  const base = APPROVED.find((entry) => entry._id === id) ?? SUPPORTING[0];
  __setQueryDataForArgs("ingestion:sheetFile", { id }, {
    ...base,
    sheetTab: "approved",
    companyKey: "cedarline systems",
    clientName: "Cedarline Systems",
    path: `Cedarline Systems/2025 - Mar 31/Submitted/${base.name}`,
    docKind: "pd",
    addedAt: Date.UTC(2026, 10, 12),
    addedVia: "onedrive_sync",
    lastModifiedAt: 1,
    hasText: true,
    hasOriginal: true,
    reviewerInitials: "PN",
    reviewerId: "w-priya",
    reviewerName: "Priya Nair",
    ...extra,
  });
  __setMutationHandler("ingestion:sheetFileText", () => ({
    text: "Project description\n\nThe team set out to plan delivery routes that adapt to freezer loads.\n",
    start: 0,
    end: 80,
    total: 80,
    source: "full",
    cutAtImport: false,
  }));
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  viewAs.clear();
  __resetPage();
  __resetNavigation();
  __resetConvexStub();
  __resetAuthState();
  __setPageUrl("/admin/import");
  __setQueryData("myWork:getViewConfig", { killSwitch: false, ready: true });
  __setQueryData("users:getCurrentUser", { _id: "a", role: "admin", firstName: "Jordan", lastName: "Ellis" });
});

describe("the Approved tab's controls", () => {
  it("offers the writer, reviewer and science code pickers and the row's own menu, never a year, version, move or delete", async () => {
    seed();
    await mount();
    for (const id of ["a1", "a2", "a3", "a4"]) {
      expect(one("[data-import-writer-edit]", fileRow(id)), id).not.toBeNull();
      expect(one("[data-import-reviewer-edit]", fileRow(id)), id).not.toBeNull();
      expect(one("[data-import-code-edit]", fileRow(id)), id).not.toBeNull();
      expect(one("[data-import-approved-menu]", fileRow(id)), id).not.toBeNull();
      expect(one("[data-import-year-edit], [data-import-version-edit]", fileRow(id)), id).toBeNull();
    }
    // The Reviewer column is the reviewer change's: its name, else "Choose reviewer" in quiet words.
    expect(text(inRow("a1", '[data-import-cell="reviewer"]'))).toBe("Priya Nair");
    expect(text(inRow("a2", '[data-import-cell="reviewer"]'))).toBe("Choose reviewer");
    // A supporting file takes no writer, reviewer or code, but has the menu.
    await userEvent.click(page.getByRole("button", { name: /^Supporting/ }));
    await expect.poll(() => one('[data-import-file="s1"]')).not.toBeNull();
    expect(one("[data-import-writer-edit], [data-import-reviewer-edit], [data-import-code-edit]", fileRow("s1"))).toBeNull();
    expect(one("[data-import-approved-menu]", fileRow("s1"))).not.toBeNull();
    // The company page link stays, beside the menu, inside the cell.
    expect(one("[data-import-file-company-page]", fileRow("a1"))).not.toBeNull();
    for (const id of ["a1", "a4"]) {
      for (const selector of ["[data-import-row-end]", "[data-import-row-menu-slot]"]) {
        const node = inRow(id, selector);
        const cell = node.closest('[data-import-cell="science-code"]')!;
        expect(node.getBoundingClientRect().right, `${id} ${selector}`).toBeLessThanOrEqual(cell.getBoundingClientRect().right + 0.5);
      }
    }
    // "Reviewed by CRA" is the reviewer change's quiet tag after the name.
    // With the Reviewer column the name's line is narrow at 1280, so the tag
    // is just its seal there; with it and the Brain's mark a long name gives
    // way (its whole name on hover) but keeps its first words, and the marks
    // stay whole inside the cell.
    const cra = one("[data-import-file-cra]", fileRow("a1"))!;
    expect(cra.getAttribute("title")).toBe("Reviewed by CRA");
    expect(one("[data-import-file-cra]", fileRow("a2"))).toBeNull();
    expect(inRow("a1", "[data-import-file-title]").clientWidth).toBeGreaterThanOrEqual(48);
    const fileCell = inRow("a1", '[data-import-cell="file"]').getBoundingClientRect();
    for (const mark of [cra, inRow("a1", "[data-import-file-brain]")]) {
      expect(mark.getBoundingClientRect().width).toBeGreaterThanOrEqual(19.5);
      expect(mark.getBoundingClientRect().right).toBeLessThanOrEqual(fileCell.right + 0.5);
    }
    // One mark leaves the name more room than two.
    expect(inRow("a2", "[data-import-file-title]").clientWidth).toBeGreaterThan(inRow("a1", "[data-import-file-title]").clientWidth);
  });

  it("sets a writer, a reviewer or a science code on that one approved file, never a firm-wide pick for its initials", async () => {
    seed();
    await mount();
    const writer = inRow("a1", "[data-import-writer-edit]");
    // No talk of the initials: the choice is for this file alone.
    expect(writer.getAttribute("aria-label")).toBe("Writer Dana Whitlock. Change the writer");
    await userEvent.click(writer);
    await userEvent.click(await vi.waitFor(() => one('[data-import-name-option="writer:w-kt"]')!));
    await expect.poll(() => __mutationCalls("ingestion:editApprovedFile")).toEqual([
      { id: "a1", patch: { writer: { kind: "writer", writerId: "w-kt" } } },
    ]);
    expect(__mutationCalls("ingestion:matchWriterInitials")).toEqual([]);
    expect(__mutationCalls("ingestion:setSheetLabels")).toEqual([]);
    await expect.element(page.getByText("Writer changed")).toBeVisible();
    await expect.element(page.getByText("Its Brain copy was updated too.")).toBeVisible();

    const reviewer = inRow("a1", "[data-import-reviewer-edit]");
    expect(reviewer.getAttribute("aria-label")).toBe("Reviewer Priya Nair. Change the reviewer");
    await userEvent.click(reviewer);
    await userEvent.click(await vi.waitFor(() => one('[data-import-name-option="user:u3"]')!));
    await expect.poll(() => __mutationCalls("ingestion:editApprovedFile").at(-1)).toEqual({
      id: "a1",
      patch: { reviewer: { kind: "user", userId: "u3" } },
    });
    expect(__mutationCalls("ingestion:matchWriterInitials")).toEqual([]);
    expect(__mutationCalls("ingestion:setFileReviewers")).toEqual([]);
    await expect.element(page.getByText("Reviewer changed")).toBeVisible();

    await userEvent.click(inRow("a3", "[data-import-code-edit]"));
    await userEvent.fill(page.getByRole("combobox", { name: "Science code" }), "2.02.09");
    await userEvent.click(await vi.waitFor(() => one('[data-science-code="2.02.09"]')!));
    await expect.poll(() => __mutationCalls("ingestion:editApprovedFile").at(-1)).toEqual({ id: "a3", patch: { scienceCode: "2.02.09" } });
  });

  it("marks a final PD as reviewed by CRA from its menu, and clears the mark", async () => {
    seed();
    await mount();
    await userEvent.click(page.getByRole("button", { name: "More for PD 2 Yard map solver" }));
    await userEvent.click(page.getByRole("menuitem", { name: "Mark as reviewed by CRA" }));
    await expect.poll(() => __mutationCalls("ingestion:editApprovedFile")).toEqual([{ id: "a2", patch: { craReviewed: true } }]);
    await expect.element(page.getByText("Marked as reviewed by CRA")).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "More for PD 1 Route planning engine" }));
    await userEvent.click(page.getByRole("menuitem", { name: 'Clear "Reviewed by CRA"' }));
    await expect.poll(() => __mutationCalls("ingestion:editApprovedFile").at(-1)).toEqual({ id: "a1", patch: { craReviewed: false } });
    // A supporting file's menu has no CRA item.
    await userEvent.click(page.getByRole("button", { name: /^Supporting/ }));
    await userEvent.click(await vi.waitFor(() => one("[data-import-approved-menu]", fileRow("s1"))!));
    await expect.poll(() => one('[data-import-row-action="send-back"]')).not.toBeNull();
    expect(one('[data-import-row-action="cra"]')).toBeNull();
  });
});

describe("Send back to review", () => {
  it("from a row's menu: says exactly what happens first, then sends that file back", async () => {
    seed();
    await mount();
    await userEvent.click(page.getByRole("button", { name: "More for PD 1 Route planning engine" }));
    await userEvent.click(page.getByRole("menuitem", { name: "Send back to review" }));
    await expect.poll(() => one("[data-import-row-send-back]")).not.toBeNull();
    expect(__mutationCalls("ingestion:sendBackToReview")).toEqual([]);
    expect(all("[data-import-send-back-notes] li").map(text)).toEqual([...SEND_BACK_NOTES]);
    const go = one("[data-import-send-back-go]")!;
    expect(text(go)).toBe("Send back 1 file");
    await userEvent.click(go);
    await expect.poll(() => __mutationCalls("ingestion:sendBackToReview")).toEqual([{ ids: ["a1"] }]);
    await expect.element(page.getByText("1 file sent back to To review")).toBeVisible();
    await expect.element(page.getByText("1 copy was removed from the Brain.")).toBeVisible();
  });

  it("says why when the server leaves a file as it was", async () => {
    seed();
    __setMutationHandler("ingestion:sendBackToReview", (args) => ({
      sentBack: [],
      refused: (args as { ids: string[] }).ids.map((id) => ({ id, reason: "approval_running" })),
      companyFileGone: [],
      brainKept: [],
      brainRevoked: [],
    }));
    await mount();
    await userEvent.click(page.getByRole("button", { name: "More for PD 2 Yard map solver" }));
    await userEvent.click(page.getByRole("menuitem", { name: "Send back to review" }));
    await userEvent.click(await vi.waitFor(() => one("[data-import-send-back-go]")!));
    await expect.element(page.getByText("No files were sent back.")).toBeVisible();
    await expect
      .element(page.getByText("1 file is in a company that is still being approved. Send it back once that is done."))
      .toBeVisible();
  });

  it("from the selection bar: Select on Approved, the confirm, then the selected files", async () => {
    seed();
    await mount();
    await userEvent.click(page.getByRole("button", { name: "Select", exact: true }));
    await userEvent.click(one(`[data-import-file-select="a2"]`)!);
    await userEvent.click(one(`[data-import-file-select="a3"]`)!);
    await expect.poll(() => text(one("[data-import-bar-count]"))).toBe("2 files selected");
    // Only Send back on Approved: no category, year, approve or delete.
    expect(one("[data-import-bar-category], [data-import-bar-year], [data-import-bar-approve], [data-import-bar-delete]")).toBeNull();
    await userEvent.click(one("[data-import-bar-send-back]")!);
    await expect.poll(() => text(one("[data-import-send-back-go]"))).toBe("Send back 2 files");
    await userEvent.click(one("[data-import-send-back-go]")!);
    await expect.poll(() => __mutationCalls("ingestion:sendBackToReview")).toEqual([{ ids: ["a2", "a3"] }]);
    await expect.element(page.getByText("2 files sent back to To review")).toBeVisible();
    await expect.poll(() => one("[data-import-selection-bar]")).toBeNull();
  });
});

describe("Put back in Brain check (2026-11-18 (second))", () => {
  it("offers it only on a final PD kept out of the Brain, and puts it back from the row's menu", async () => {
    seed();
    __setMutationHandler("ingestion:reopenBrainCheck", (args) => ({ reopened: (args as { ids: string[] }).ids, refused: [] }));
    await mount();
    for (const name of ["PD 1 Route planning engine", "PD 2 Yard map solver", "PD 4 Shelf gap finder"]) {
      await userEvent.click(page.getByRole("button", { name: `More for ${name}` }));
      await expect.poll(() => one('[data-import-row-action="send-back"]')).not.toBeNull();
      expect(one('[data-import-row-action="reopen-brain-check"]'), name).toBeNull();
      await userEvent.keyboard("{Escape}");
      await expect.poll(() => one("[data-import-row-menu-content]")).toBeNull();
    }
    await userEvent.click(page.getByRole("button", { name: "More for PD 3 Label vision check" }));
    await userEvent.click(page.getByRole("menuitem", { name: "Put back in Brain check" }));
    await expect.poll(() => __mutationCalls("ingestion:reopenBrainCheck")).toEqual([{ ids: ["a3"] }]);
    await expect.element(page.getByText("Back in Brain check. Read its copy there to add it.")).toBeVisible();
  });

  it("says why when the server refuses it", async () => {
    seed();
    __setMutationHandler("ingestion:reopenBrainCheck", (args) => ({
      reopened: [],
      refused: (args as { ids: string[] }).ids.map((id) => ({ id, reason: "not_kept_out" })),
    }));
    await mount();
    await userEvent.click(page.getByRole("button", { name: "More for PD 3 Label vision check" }));
    await userEvent.click(page.getByRole("menuitem", { name: "Put back in Brain check" }));
    await expect.element(page.getByText("This PD is not kept out of the Brain any more.")).toBeVisible();
  });

  it("is in the file view beside Send back to review", async () => {
    seed();
    seedFile("a3");
    __setMutationHandler("ingestion:reopenBrainCheck", (args) => ({ reopened: (args as { ids: string[] }).ids, refused: [] }));
    await mount();
    await userEvent.click(one('[data-import-file-open="a3"]')!);
    await expect.poll(() => one("[data-import-approved-reopen-brain-check]")).not.toBeNull();
    expect(text(one("[data-import-approved-reopen-brain-check]"))).toBe("Put back in Brain check");
    await userEvent.click(one("[data-import-approved-reopen-brain-check]")!);
    await expect.poll(() => __mutationCalls("ingestion:reopenBrainCheck")).toEqual([{ ids: ["a3"] }]);
    await page.screenshot({ path: `${CAPTURES}/reopen-brain-check-file-view.png` });
  });
});

describe("the file view of an approved file", () => {
  it("confirms the science code the document gave when it is chosen again", async () => {
    seed();
    seedFile("a1", { scienceCode: "2.02.09", scienceCodeSource: "document" });
    await mount();
    await userEvent.click(one('[data-import-file-open="a1"]')!);
    await expect.poll(() => one("[data-import-approved-details]")).not.toBeNull();
    await userEvent.click(one("[data-import-approved-code]")!);
    await userEvent.fill(page.getByRole("combobox", { name: "Science code" }), "2.02.09");
    await userEvent.click(await vi.waitFor(() => one('[data-science-code="2.02.09"]')!));
    await expect.poll(() => __mutationCalls("ingestion:editApprovedFile")).toEqual([{ id: "a1", patch: { scienceCode: "2.02.09" } }]);
  });

  it("does not save the science code a person already chose when it is chosen again", async () => {
    seed();
    seedFile("a1", { scienceCode: "2.02.09", scienceCodeSource: "person" });
    await mount();
    await userEvent.click(one('[data-import-file-open="a1"]')!);
    await expect.poll(() => one("[data-import-approved-details]")).not.toBeNull();
    await userEvent.click(one("[data-import-approved-code]")!);
    await userEvent.fill(page.getByRole("combobox", { name: "Science code" }), "2.02.09");
    await userEvent.click(await vi.waitFor(() => one('[data-science-code="2.02.09"]')!));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(__mutationCalls("ingestion:editApprovedFile")).toEqual([]);
  });

  it("changes its details and sends it back, each with its own call", async () => {
    seed();
    seedFile("a1", { craReviewed: false });
    await mount();
    await userEvent.click(one('[data-import-file-open="a1"]')!);
    await expect.poll(() => one("[data-import-approved-details]")).not.toBeNull();
    // Its writer and science code are in Details, where they can be changed.
    const labels = all("[data-import-file-panel-label]").map((node) => node.dataset.importFilePanelLabel);
    expect(labels).not.toContain("Writer");
    expect(labels).not.toContain("Science code");
    expect(text(one("[data-import-approved-writer]"))).toBe("Dana Whitlock");
    expect(text(one("[data-import-approved-reviewer]"))).toBe("Priya Nair");
    expect(text(one("[data-import-approved-code]"))).toContain("2.02.09");

    const title = page.getByLabelText("PD title");
    await expect.element(title).toHaveValue("Route planning engine");
    expect((one("[data-import-approved-title-save]") as HTMLButtonElement).disabled).toBe(true);
    await userEvent.fill(title, "Route planner for freezer loads");
    await userEvent.click(one("[data-import-approved-title-save]")!);
    await expect.poll(() => __mutationCalls("ingestion:editApprovedFile")).toEqual([
      { id: "a1", patch: { pdTitle: "Route planner for freezer loads" } },
    ]);
    await expect.element(page.getByText("PD title changed")).toBeVisible();

    await userEvent.click(one("[data-import-approved-reviewer]")!);
    await userEvent.click(await vi.waitFor(() => one("[data-import-approved-reviewer-clear]")!));
    await expect.poll(() => __mutationCalls("ingestion:editApprovedFile").at(-1)).toEqual({ id: "a1", patch: { reviewer: null } });

    await userEvent.click(page.getByRole("checkbox", { name: "Reviewed by CRA" }));
    await expect.poll(() => __mutationCalls("ingestion:editApprovedFile").at(-1)).toEqual({ id: "a1", patch: { craReviewed: true } });

    await userEvent.click(one("[data-import-approved-send-back]")!);
    expect(all("[data-import-approved-details] [data-import-send-back-notes] li").map(text)).toEqual([...SEND_BACK_NOTES]);
    expect(__mutationCalls("ingestion:sendBackToReview")).toEqual([]);
    await userEvent.click(one("[data-import-approved-details] [data-import-send-back-go]")!);
    await expect.poll(() => __mutationCalls("ingestion:sendBackToReview")).toEqual([{ ids: ["a1"] }]);
    await expect.poll(() => one("[data-import-file-panel]")).toBeNull();
  });

  it("offers only what the file takes: a supporting file has no writer, code, title or CRA mark", async () => {
    seed();
    seedFile("s1", { docKind: "supporting", reviewerId: undefined, reviewerName: undefined, reviewerInitials: undefined });
    await mount();
    await userEvent.click(page.getByRole("button", { name: /^Supporting/ }));
    await userEvent.click(await vi.waitFor(() => one('[data-import-file-open="s1"]')!));
    await expect.poll(() => one("[data-import-approved-details]")).not.toBeNull();
    expect(one("[data-import-approved-writer], [data-import-approved-reviewer], [data-import-approved-code], [data-import-approved-title], [data-import-approved-cra]")).toBeNull();
    expect(one("[data-import-approved-send-back]")).not.toBeNull();
  });
});

describe("captures (2026-11-17, Send back and edit after approval)", () => {
  for (const width of [1280, 1100]) {
    it(`captures the Approved tab, its menu, the Send back confirms and the file view's details at ${width}`, async () => {
      seed();
      seedFile("a1", { craReviewed: true });
      await mount(width);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      await page.screenshot({ path: `${CAPTURES}/approved-tab-${width}.png` });

      await userEvent.click(page.getByRole("button", { name: "More for PD 2 Yard map solver" }));
      await expect.poll(() => one('[data-import-row-action="send-back"]')).not.toBeNull();
      // After the menu's fade in.
      await expect.poll(() => getComputedStyle(one("[data-import-row-menu-content]")!).opacity).toBe("1");
      await page.screenshot({ path: `${CAPTURES}/row-menu-${width}.png` });
      await userEvent.click(page.getByRole("menuitem", { name: "Send back to review" }));
      await expect.poll(() => one("[data-import-row-send-back]")).not.toBeNull();
      expect(one("[data-import-row-send-back]")!.getBoundingClientRect().right).toBeLessThanOrEqual(width);
      await page.screenshot({ path: `${CAPTURES}/row-send-back-${width}.png` });
      await userEvent.keyboard("{Escape}");

      await userEvent.click(page.getByRole("button", { name: "Select", exact: true }));
      await userEvent.click(one('[data-import-section-select="final_pd"]')!);
      await userEvent.click(one("[data-import-bar-send-back]")!);
      await expect.poll(() => one("[data-import-send-back-go]")).not.toBeNull();
      await page.screenshot({ path: `${CAPTURES}/bar-send-back-${width}.png` });
      await userEvent.keyboard("{Escape}");
      await userEvent.click(page.getByRole("button", { name: "Clear selection" }));
      await userEvent.click(page.getByRole("button", { name: "Select", exact: true }));

      await userEvent.click(one('[data-import-file-open="a1"]')!);
      await expect.poll(() => one("[data-import-approved-details]")).not.toBeNull();
      await expect.poll(() => getComputedStyle(one("[data-import-file-panel]")!).opacity).toBe("1");
      await page.screenshot({ path: `${CAPTURES}/file-view-details-${width}.png` });
      await userEvent.click(one("[data-import-approved-send-back]")!);
      await expect.poll(() => one("[data-import-approved-details] [data-import-send-back-go]")).not.toBeNull();
      one("[data-import-approved-details]")!.scrollIntoView({ block: "end" });
      await page.screenshot({ path: `${CAPTURES}/file-view-send-back-${width}.png` });
      await page.viewport(1280, 800);
    });
  }
});
