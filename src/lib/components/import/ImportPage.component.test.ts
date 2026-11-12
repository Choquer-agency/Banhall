import { beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import ImportPage from "./ImportPage.svelte";
import ImportToolbar from "./ImportToolbar.svelte";
import {
  __activeQueryArgs,
  __activeQueryCount,
  __resetConvexStub,
  __setPaginatedRows,
  __setQueryData,
  __setQueryDataForArgs,
} from "$lib/test/convex-svelte-stub.svelte";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import { viewAs } from "$lib/shell/viewAs.svelte";
import { board } from "$lib/test/boardScale";

/**
 * The Import page (2026-11-11 phase 3a): the title note, the tabs with
 * their counts, the one toolbar row, search, and the admin gate. The sheet
 * itself is covered in ImportSheet.component.test.ts.
 */
const text = (node: Element | null | undefined) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();
const one = (selector: string, root: ParentNode = document) => root.querySelector<HTMLElement>(selector);
const all = (selector: string, root: ParentNode = document) => [...root.querySelectorAll<HTMLElement>(selector)];

const totals = (files: number, companies: number, needsCheck = 0) => ({
  files,
  companies,
  needsCheck,
  ready: files - needsCheck,
  beingRead: 0,
  complete: true,
});

const CEDARLINE = {
  companyKey: "cedarline systems",
  displayName: "Cedarline Systems",
  total: 223,
  needsCheck: 15,
  ready: 208,
  beingRead: 0,
  categories: { final_pd: { total: 24, needsCheck: 15, fiscalYears: { "2025": 24 } } },
  company: { via: "name", clientId: "c1", name: "Cedarline Systems", industry: "Software" },
  isNew: false,
};

function seedPage() {
  __setQueryDataForArgs("ingestion:sheetTotals", { tab: "review" }, totals(556, 7, 168));
  __setQueryDataForArgs("ingestion:sheetTotals", { tab: "approved" }, totals(1204, 9));
  __setQueryDataForArgs("ingestion:sheetTotals", { tab: "deleted" }, totals(41, 3));
  __setPaginatedRows("ingestion:sheetCompanies", [CEDARLINE]);
}

describe("ImportPage", () => {
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

  it("titles the page Import with how many files from how many companies, over three tabs with their counts", async () => {
    seedPage();
    await render(ImportPage);
    const bar = one("[data-page-top-bar]")!;
    await expect.poll(() => text(one("[data-page-count]", bar))).toBe("556 files from 7 companies");
    expect(text(bar.querySelector("h1"))).toBe("Import");

    const tablist = page.getByRole("tablist", { name: "Import" });
    await expect.element(tablist).toBeVisible();
    const tabs = all('[role="tab"]');
    expect(tabs.map((tab) => text(tab))).toEqual(["To review 556", "Approved 1,204", "Deleted 41"]);
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
    expect(tabs[0].id).toBe("import-tab-review");
    expect(one('[role="tabpanel"]')!.getAttribute("aria-labelledby")).toBe("import-tab-review");
    // No History tab in this phase.
    expect(tabs.some((tab) => text(tab).startsWith("History"))).toBe(false);

    // One slim toolbar row, then the sheet: no summary, tiles or progress.
    expect(one("[data-import-toolbar]")).not.toBeNull();
    expect(all('[role="progressbar"]')).toHaveLength(0);
    expect(text(one("[data-import-legend]"))).toBe("Filled in by AI No mark: from the file name or a person");
    expect(one('[data-import-legend] [data-ai-mark="aurora"]')).not.toBeNull();
    await expect.element(page.getByRole("button", { name: "Cedarline Systems" })).toBeVisible();

    // Another tab: its own note and sheet, and no To check chip.
    await userEvent.click(page.getByRole("tab", { name: /^Approved/ }));
    await expect.poll(() => text(one("[data-page-count]"))).toBe("1,204 files from 9 companies");
    expect(__activeQueryArgs("ingestion:sheetCompanies")).toContainEqual({ tab: "approved", onlyToCheck: false });
    expect(one("[data-import-to-check]")).toBeNull();
    expect(one('[role="tabpanel"]')!.id).toBe("import-panel-approved");
  });

  it("turns To check on and off, changing what the sheet reads", async () => {
    seedPage();
    await render(ImportPage);
    const chip = page.getByRole("checkbox", { name: "To check 168" });
    await expect.element(chip).toHaveAttribute("aria-checked", "false");
    expect(__activeQueryArgs("ingestion:sheetCompanies")).toEqual([{ tab: "review", onlyToCheck: false }]);

    await userEvent.click(chip);
    await expect.element(chip).toHaveAttribute("aria-checked", "true");
    await expect.poll(() => __activeQueryArgs("ingestion:sheetCompanies")).toEqual([{ tab: "review", onlyToCheck: true }]);
    // Open sections read only the files to check too.
    await userEvent.click(page.getByRole("button", { name: "Cedarline Systems" }));
    await expect.poll(() => __activeQueryArgs("ingestion:sheetFiles")).toEqual([
      { tab: "review", companyKey: "cedarline systems", category: "final_pd", onlyToCheck: true },
    ]);

    await userEvent.click(chip);
    await expect.poll(() => __activeQueryArgs("ingestion:sheetCompanies")).toEqual([{ tab: "review", onlyToCheck: false }]);
    // The company stays open while the sheet reloads.
    await expect.poll(() => __activeQueryArgs("ingestion:sheetFiles")).toEqual([
      { tab: "review", companyKey: "cedarline systems", category: "final_pd", onlyToCheck: false },
    ]);
  });

  it("searches from two characters, shows companies then files in place of the sheet, and clears back to it", async () => {
    seedPage();
    __setQueryDataForArgs(
      "ingestion:sheetSearch",
      { tab: "review", text: "ce" },
      {
        companies: [{ companyKey: "cedarline systems", displayName: "Cedarline Systems", total: 223, needsCheck: 15 }],
        files: [
          {
            _id: "f1",
            name: "Cell count notes.docx",
            category: "supporting",
            status: "pending_review",
            fiscalYearEnd: Date.UTC(2025, 2, 31),
            editedLabels: [],
            needsCheck: false,
            checkReasons: [],
            size: 10,
            companyKey: "halden foods",
            clientName: "Halden Foods",
          },
          {
            _id: "f2",
            name: "Cedar notes.docx",
            category: "unknown",
            status: "fetched",
            editedLabels: [],
            needsCheck: true,
            checkReasons: ["no_company", "unknown_category"],
            size: 10,
            companyKey: "",
          },
        ],
      }
    );
    await render(ImportPage);
    const box = page.getByRole("searchbox", { name: "Find a file or company" });
    await expect.element(box).toBeVisible();

    await userEvent.fill(box, "c");
    // One character never searches.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(__activeQueryArgs("ingestion:sheetSearch")).toEqual([]);
    expect(one("[data-import-search-results]")).toBeNull();

    await userEvent.fill(box, "ce");
    await expect.poll(() => __activeQueryArgs("ingestion:sheetSearch")).toEqual([{ tab: "review", text: "ce" }]);
    await expect.poll(() => one("[data-import-search-results]")).not.toBeNull();
    // The sheet steps aside while the results show.
    expect(one("[data-import-sheet]")!.closest("[hidden]")).not.toBeNull();

    const results = one("[data-import-search-results]")!;
    expect(all("[data-import-found-company]", results).map((node) => node.dataset.importFoundCompany)).toEqual(["cedarline systems"]);
    expect(text(one("[data-import-found-company]", results))).toContain("223 files");
    expect(text(one("[data-import-found-company]", results))).toContain("15 to check");
    // Companies come before files.
    const companyRow = one("[data-import-found-company]", results)!;
    const fileRow = one('[data-import-file="f1"]', results)!;
    expect(companyRow.compareDocumentPosition(fileRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(text(one("[data-import-file-company]", fileRow))).toBe("Halden Foods");
    expect(one('[data-import-file="f1"] [data-import-year]', results)!.firstChild!.textContent).toBe("2025");
    expect(text(one('[data-import-file="f2"] [data-import-file-company]', results))).toBe("No company yet");
    expect(text(one('[data-import-file="f2"] [data-import-file-state]', results))).toBe("Being read");

    await userEvent.click(page.getByRole("button", { name: "Clear the search" }));
    await expect.poll(() => one("[data-import-search-results]")).toBeNull();
    expect(one("[data-import-sheet]")!.closest("[hidden]")).toBeNull();
    await expect.element(box).toHaveValue("");
    // The clear control is gone with the text; focus is back in the field, not on the page.
    expect(one("[data-import-search-clear]")).toBeNull();
    expect(document.activeElement).toBe(one("[data-import-search]"));
  });

  it("says when nothing matches, and opens a found company in the sheet", async () => {
    seedPage();
    __setQueryDataForArgs("ingestion:sheetSearch", { tab: "review", text: "zz" }, { companies: [], files: [] });
    __setQueryDataForArgs(
      "ingestion:sheetSearch",
      { tab: "review", text: "cedar" },
      { companies: [{ companyKey: "cedarline systems", displayName: "Cedarline Systems", total: 223, needsCheck: 15 }], files: [] }
    );
    await render(ImportPage);
    const box = page.getByRole("searchbox", { name: "Find a file or company" });
    await userEvent.fill(box, "zz");
    await expect.element(page.getByText('Nothing matches "zz".')).toBeVisible();

    await userEvent.fill(box, "cedar");
    const found = page.getByRole("button", { name: "Cedarline Systems, show in the sheet" });
    await expect.element(found).toBeVisible();
    await userEvent.click(found);
    await expect.poll(() => one("[data-import-search-results]")).toBeNull();
    await expect.element(box).toHaveValue("");
    await expect.poll(() => one('[data-import-band="cedarline systems"]')?.hasAttribute("data-import-band-open")).toBe(true);
  });

  it("leaves To check on for To review when a company is opened from a search on another tab", async () => {
    seedPage();
    __setQueryDataForArgs(
      "ingestion:sheetSearch",
      { tab: "approved", text: "cedar" },
      { companies: [{ companyKey: "cedarline systems", displayName: "Cedarline Systems", total: 40, needsCheck: 0 }], files: [] }
    );
    await render(ImportPage);
    const chip = page.getByRole("checkbox", { name: "To check 168" });
    await userEvent.click(chip);
    await expect.element(chip).toHaveAttribute("aria-checked", "true");

    await userEvent.click(page.getByRole("tab", { name: /^Approved/ }));
    await expect.poll(() => __activeQueryArgs("ingestion:sheetCompanies")).toContainEqual({ tab: "approved", onlyToCheck: false });
    await userEvent.fill(page.getByRole("searchbox", { name: "Find a file or company" }), "cedar");
    await userEvent.click(page.getByRole("button", { name: "Cedarline Systems, show in the sheet" }));
    await expect.poll(() => one('[data-import-band="cedarline systems"]')?.hasAttribute("data-import-band-open")).toBe(true);

    // Back on To review, To check is still on.
    await userEvent.click(page.getByRole("tab", { name: /^To review/ }));
    await expect.element(page.getByRole("checkbox", { name: "To check 168" })).toHaveAttribute("aria-checked", "true");
    expect(__activeQueryArgs("ingestion:sheetCompanies")).toContainEqual({ tab: "review", onlyToCheck: true });
  });

  it("turns To check off on To review to open a company found by the search that it would hide", async () => {
    seedPage();
    __setQueryDataForArgs(
      "ingestion:sheetSearch",
      { tab: "review", text: "cedar" },
      { companies: [{ companyKey: "cedarline systems", displayName: "Cedarline Systems", total: 223, needsCheck: 0 }], files: [] }
    );
    await render(ImportPage);
    const chip = page.getByRole("checkbox", { name: "To check 168" });
    await userEvent.click(chip);
    await userEvent.fill(page.getByRole("searchbox", { name: "Find a file or company" }), "cedar");
    await userEvent.click(page.getByRole("button", { name: "Cedarline Systems, show in the sheet" }));
    await expect.element(chip).toHaveAttribute("aria-checked", "false");
  });

  it("tells anyone but an admin that the page is for admins, and shows nothing else", async () => {
    __setQueryData("ingestion:sheetTotals", null);
    __setPaginatedRows("ingestion:sheetCompanies", []);
    await render(ImportPage);
    await expect.element(page.getByText("Admin access only.")).toBeVisible();
    expect(one('[role="tablist"]')).toBeNull();
    expect(one("[data-import-toolbar]")).toBeNull();
    expect(one("[data-page-count]")).toBeNull();
    // Only the totals, which say who may see the page, are read: never the sheet.
    for (const name of ["ingestion:sheetCompanies", "ingestion:sheetFiles", "ingestion:sheetSearch", "ingestion:sheetFile"]) {
      expect(__activeQueryCount(name), name).toBe(0);
    }
  });
});

describe("ImportToolbar", () => {
  beforeEach(() => {
    __resetConvexStub();
  });

  /** How wide the placeholder is in the field's own font, and how wide the field's text box is. */
  function placeholderFit(input: HTMLInputElement) {
    const style = getComputedStyle(input);
    const context = document.createElement("canvas").getContext("2d")!;
    context.font = style.font;
    const text = context.measureText(input.placeholder).width;
    const box = input.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
    return { text, box };
  }

  it("shows the whole placeholder, with the legend on the same row at the 1064px content width", async () => {
    const holder = document.createElement("div");
    holder.style.width = "1064px";
    document.body.append(holder);
    try {
      await render(ImportToolbar, { target: holder, props: { toCheckCount: 168 } });
      const input = one("[data-import-search]", holder) as HTMLInputElement;
      await expect.poll(() => input.isConnected).toBe(true);
      expect(input.placeholder).toBe("Find a file or company");
      // 15rem (240 board px). The placeholder fits with a fifth to spare, for
      // fonts that set wider than this browser's (it ran out of room at 12.5rem).
      await document.fonts.ready;
      expect(input.getBoundingClientRect().width).toBeCloseTo(board(240), 0);
      const { text, box } = placeholderFit(input);
      expect(text * 1.2).toBeLessThanOrEqual(box);
      const legend = one("[data-import-legend]", holder)!;
      const search = one('[role="search"]', holder)!;
      // One row: the legend sits on the field's middle line.
      const middle = (box: DOMRect) => (box.top + box.bottom) / 2;
      expect(middle(legend.getBoundingClientRect())).toBeCloseTo(middle(search.getBoundingClientRect()), 0);

      // Narrower: the legend wraps under the row; the field keeps its width.
      const wide = search.getBoundingClientRect().width;
      holder.style.width = "480px";
      await expect.poll(() => legend.getBoundingClientRect().top).toBeGreaterThan(search.getBoundingClientRect().bottom - 1);
      expect(search.getBoundingClientRect().width).toBe(wide);
    } finally {
      holder.remove();
    }
  });
});
