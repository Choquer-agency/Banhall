import { beforeEach, describe, expect, it } from "vitest";
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

/**
 * Targeted tests for the redesigned Import page UX:
 * - Hover-to-bulk-select in the fixed left gutter without layout shift
 * - Quick delete for company bands, category sections, and individual rows with Undo
 * - Right-aligned down-to-up accordion chevrons
 * - Split-pane document preview (What AI read / Original, prev/next, inline edits, Approve and next)
 */
const text = (node: Element | null | undefined) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();
const one = (selector: string, root: ParentNode = document) => root.querySelector<HTMLElement>(selector);
const all = (selector: string, root: ParentNode = document) => [...root.querySelectorAll<HTMLElement>(selector)];
const box = (node: Element) => node.getBoundingClientRect();

const MAR_31_2025 = Date.UTC(2025, 2, 31);

const CEDARLINE = {
  companyKey: "cedarline systems",
  displayName: "Cedarline Systems",
  total: 6,
  needsCheck: 1,
  ready: 5,
  beingRead: 0,
  categories: {
    final_pd: { total: 3, needsCheck: 1, fiscalYears: { "2025": 3 }, checkReasons: { no_science_code: 1 } },
    supporting: { total: 3, needsCheck: 0, fiscalYears: { "2025": 3 } },
  },
  company: { via: "name", clientId: "c1", name: "Cedarline Systems", industry: "software" },
  isNew: false,
};

function makeFile(id: string, extra: Record<string, unknown> = {}) {
  return {
    _id: id,
    name: `${id}.pdf`,
    category: "final_pd",
    status: "pending_review",
    editedLabels: [],
    needsCheck: false,
    checkReasons: [],
    size: 4096,
    fiscalYearEnd: MAR_31_2025,
    ...extra,
  };
}

const FINAL_PDS = [
  makeFile("pd1", {
    pdNumber: "1",
    pdTitle: "Route planning engine",
    versionCode: "T",
    versionNumber: 2,
    writerName: "Dana Whitlock",
    writerId: "u1",
    scienceCode: "2.02.09",
    scienceCodeSource: "person",
    craReviewed: false,
  }),
  makeFile("pd2", {
    pdNumber: "2",
    pdTitle: "Yard map solver",
    versionCode: "T",
    versionNumber: 1,
    writerName: "Dana Whitlock",
    writerId: "u1",
    needsCheck: true,
    checkReasons: ["no_science_code"],
  }),
  makeFile("pd3", {
    pdNumber: "3",
    pdTitle: "Sensor pipeline",
    versionCode: "T",
    versionNumber: 3,
    writerName: "Priya Nair",
    writerId: "u2",
    scienceCode: "1.02.02",
    scienceCodeSource: "document",
  }),
];

function seedBase() {
  __setQueryDataForArgs("ingestion:sheetTotals", { tab: "review" }, { files: 6, companies: 1, needsCheck: 1, ready: 5, beingRead: 0, complete: true });
  __setQueryDataForArgs("ingestion:sheetTotals", { tab: "approved" }, { files: 0, companies: 0, needsCheck: 0, ready: 0, beingRead: 0, complete: true });
  __setQueryDataForArgs("ingestion:sheetTotals", { tab: "deleted" }, { files: 0, companies: 0, needsCheck: 0, ready: 0, beingRead: 0, complete: true });
  __setPaginatedRowsForArgs("ingestion:sheetCompanies", { tab: "review", onlyToCheck: false }, [CEDARLINE]);
  __setPaginatedRowsForArgs(
    "ingestion:sheetFiles",
    { tab: "review", companyKey: "cedarline systems", category: "final_pd", onlyToCheck: false },
    FINAL_PDS
  );
  __setQueryData("ingestion:writerChoices", {
    members: [
      { userId: "u1", label: "Dana Whitlock", writerId: null, linkedWriterId: null },
      { userId: "u2", label: "Priya Nair", writerId: null, linkedWriterId: null },
    ],
    pastWriters: [],
  });
}

async function mountAndOpen() {
  await page.viewport(1440, 900);
  await render(ToastHarness);
  await render(ImportPage);
  await userEvent.click(page.getByRole("button", { name: "Cedarline Systems" }));
  await expect.poll(() => all("[data-import-file]").length).toBe(3);
}

describe("Import page redesign interactions", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    viewAs.clear();
    __resetPage();
    __resetNavigation();
    __resetConvexStub();
    __resetAuthState();
    __setPageUrl("/import");
    __setQueryData("myWork:getViewConfig", { killSwitch: false, ready: true });
    __setQueryData("users:getCurrentUser", { _id: "a", role: "admin", firstName: "Jordan", lastName: "Ellis" });
  });

  it("rotates right-aligned accordion chevrons from down (closed) to up (open) on company bands and sections", async () => {
    seedBase();
    await page.viewport(1440, 900);
    await render(ImportPage);
    await expect.element(page.getByRole("button", { name: "Cedarline Systems" })).toBeVisible();

    const bandChevron = () => one('[data-import-band="cedarline systems"] [data-import-band-chevron]')!;
    expect(bandChevron().dataset.chevronState).toBe("down");
    expect(bandChevron().firstElementChild!.getAttribute("class")).toContain("rotate-0");

    await userEvent.click(page.getByRole("button", { name: "Cedarline Systems" }));
    await expect.poll(() => bandChevron().dataset.chevronState).toBe("up");
    expect(bandChevron().firstElementChild!.getAttribute("class")).toContain("rotate-180");

    // Final PDs opens by default (chevron up); Supporting files starts closed (chevron down).
    const finalChevron = one('[data-import-section="final_pd"] [data-import-section-chevron]')!;
    const supportingChevron = one('[data-import-section="supporting"] [data-import-section-chevron]')!;
    expect(finalChevron.dataset.chevronState).toBe("up");
    expect(finalChevron.firstElementChild!.getAttribute("class")).toContain("rotate-180");
    expect(supportingChevron.dataset.chevronState).toBe("down");
    expect(supportingChevron.firstElementChild!.getAttribute("class")).toContain("rotate-0");
  });

  it("auto-enables Select mode when clicking a row checkbox on hover with zero layout shift", async () => {
    seedBase();
    await mountAndOpen();
    const titleLeftBefore = box(one('[data-import-file="pd1"] [data-import-file-prefix]')!).left;
    expect(one("[data-import-select-header]")).toBeNull();

    // Hover the row and click its left-gutter checkbox without clicking the Select toolbar button first.
    await userEvent.hover(one('[data-import-file="pd1"]')!);
    await userEvent.click(one('[data-import-file-select="pd1"]')!);

    await expect.poll(() => one("[data-import-select-header]")).not.toBeNull();
    await expect.poll(() => text(one("[data-import-bar-count]"))).toBe("1 file selected");
    expect(box(one('[data-import-file="pd1"] [data-import-file-prefix]')!).left).toBeCloseTo(titleLeftBefore, 0);
  });

  it("supports quick delete on a single row, category section, and company band with Undo", async () => {
    seedBase();
    __setMutationHandler("ingestion:removeItems", (args) => {
      const { ids } = args as { ids: string[] };
      return { changed: ids.length, changedIds: ids, skipped: [] };
    });
    __setMutationHandler("ingestion:removeGroupItems", (args) => {
      const { category } = args as { companyKey: string; category?: string };
      const ids = category ? ["pd1", "pd2", "pd3"] : ["pd1", "pd2", "pd3", "s1", "s2", "s3"];
      return { changed: ids.length, changedIds: ids, skipped: [], hasMore: false };
    });
    __setMutationHandler("ingestion:restoreItems", (args) => {
      const { ids } = args as { ids: string[] };
      return { changed: ids.length, changedIds: ids, skipped: [] };
    });
    await mountAndOpen();

    // 1. Single row quick delete (1-click) + Undo
    await userEvent.click(one('[data-import-row-delete="pd1"]')!);
    await expect.poll(() => __mutationCalls("ingestion:removeItems")).toEqual([{ ids: ["pd1"] }]);
    await expect.element(page.getByText("1 file deleted")).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Undo" }));
    await expect.poll(() => __mutationCalls("ingestion:restoreItems")).toEqual([{ ids: ["pd1"] }]);

    // 2. Category section quick delete (popover confirm)
    await userEvent.click(one('[data-import-section-delete="final_pd"]')!);
    await expect.element(page.getByRole("button", { name: "Delete 3 files" })).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Delete 3 files" }));
    await expect.poll(() => __mutationCalls("ingestion:removeGroupItems")).toEqual([
      { companyKey: "cedarline systems", category: "final_pd" },
    ]);

    // 3. Company band quick delete (popover confirm)
    await userEvent.click(one('[data-import-band-delete="cedarline systems"]')!);
    await expect.element(page.getByRole("button", { name: "Delete 6 files" })).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Delete 6 files" }));
    await expect.poll(() => __mutationCalls("ingestion:removeGroupItems").at(-1)).toEqual({
      companyKey: "cedarline systems",
    });
  });

  it("opens split-pane preview with What AI read / Original toggle, prev/next pager, inline CRA toggle, and Approve and next", async () => {
    seedBase();
    __setQueryDataForArgs("ingestion:sheetFile", { id: "pd1" }, {
      ...FINAL_PDS[0],
      sheetTab: "review",
      companyKey: "cedarline systems",
      displayName: "Cedarline Systems",
      relativePath: "Cedarline Systems/2025/01 Route planning engine.pdf",
      createdAt: MAR_31_2025,
      hasText: true,
      hasOriginal: true,
      originalUrl: "https://files.test/pd1.pdf",
    });
    __setQueryDataForArgs("ingestion:sheetFile", { id: "pd2" }, {
      ...FINAL_PDS[1],
      sheetTab: "review",
      companyKey: "cedarline systems",
      displayName: "Cedarline Systems",
      relativePath: "Cedarline Systems/2025/02 Yard map solver.pdf",
      createdAt: MAR_31_2025,
      hasText: true,
      hasOriginal: true,
      originalUrl: "https://files.test/pd2.pdf",
    });
    __setQueryDataForArgs("ingestion:sheetFile", { id: "pd3" }, {
      ...FINAL_PDS[2],
      sheetTab: "review",
      companyKey: "cedarline systems",
      displayName: "Cedarline Systems",
      relativePath: "Cedarline Systems/2025/03 Sensor pipeline.pdf",
      createdAt: MAR_31_2025,
      hasText: true,
      hasOriginal: true,
      originalUrl: "https://files.test/pd3.pdf",
    });
    __setMutationHandler("ingestion:sheetFileText", (args) => {
      const { id } = args as { id: string };
      const body = id === "pd1" ? "Extracted text for Route planning engine." : "Extracted text for Yard map solver.";
      return { text: body, start: 0, end: body.length, total: body.length, source: "document", cutAtImport: false };
    });
    __setMutationHandler("ingestion:setCraReviewed", (args) => {
      const { ids } = args as { ids: string[] };
      return { changed: ids.length, changedIds: ids, skipped: [] };
    });
    __setMutationHandler("ingestion:approveFiles", (args) => ({
      approvalId: "ap-1",
      added: (args as { ids: string[] }).ids.length,
    }));

    await mountAndOpen();
    await userEvent.click(one('[data-import-file="pd1"] [data-import-file-open]')!);
    await expect.poll(() => one("[data-import-file-panel]")).not.toBeNull();

    // Header counter, title, and Download link
    expect(text(one("[data-import-file-panel-counter]"))).toBe("1 of 3");
    await expect.poll(() => text(one("[data-import-file-panel-text]"))).toContain("Extracted text for Route planning engine.");
    expect(one("[data-import-file-panel-download]")?.getAttribute("href")).toBe("https://files.test/pd1.pdf");

    // Switch to Original view -> renders PDF iframe
    await userEvent.click(one('[data-import-file-panel-view="original"]')!);
    await expect.poll(() => one("[data-import-file-panel-original-pdf]")?.getAttribute("src")).toBe("https://files.test/pd1.pdf");

    // Inline CRA toggle works inside the collapsed More details disclosure
    await userEvent.click(one("[data-import-file-panel-more-details]")!);
    await userEvent.click(one("[data-import-panel-cra-toggle]")!);
    await expect.poll(() => __mutationCalls("ingestion:setCraReviewed")).toEqual([{ ids: ["pd1"], reviewed: true }]);

    // Approve and next approves pd1, removes it from the queue, and advances to pd2 (now 1 of 2)
    expect(text(one("[data-import-file-panel-approve]"))).toBe("Approve and next");
    await userEvent.click(one("[data-import-file-panel-approve]")!);
    await expect.poll(() => __mutationCalls("ingestion:approveFiles")).toEqual([{ ids: ["pd1"] }]);
    await expect.poll(() => text(one("[data-import-file-panel-counter]"))).toBe("1 of 2");
    await expect.poll(() => text(one("[data-import-file-panel-checks]"))).toContain("The document has no code.");
    await expect.poll(() => text(one("[data-import-file-panel-callout]"))).toContain("Field of science or technology code:");

    // Next and previous pager buttons navigate between remaining files
    await userEvent.click(one("[data-import-file-panel-next]")!);
    await expect.poll(() => text(one("[data-import-file-panel-counter]"))).toBe("2 of 2");
    await userEvent.click(one("[data-import-file-panel-prev]")!);
    await expect.poll(() => text(one("[data-import-file-panel-counter]"))).toBe("1 of 2");
  });
});
