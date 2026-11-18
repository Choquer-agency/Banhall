import { beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import ImportPage from "./ImportPage.svelte";
import {
  __activeQueryCount,
  __resetConvexStub,
  __setPaginatedRows,
  __setQueryData,
  __setQueryDataForArgs,
  __setQueryError,
} from "$lib/test/convex-svelte-stub.svelte";
import { WIDER_TEXT, wordsWidth } from "$lib/test/textRoom";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import { viewAs } from "$lib/shell/viewAs.svelte";

/**
 * Final PD progress on the Import page (2026-11-17, asked for in a client
 * meeting): the line with its bar, its words and the note that the total
 * is only the final PDs added so far; the breakdown by fiscal year and by
 * writer (past writers with "No login", then "No writer yet" and "Not
 * sorted yet"); the empty state; and nothing for anyone but an Admin.
 * Captures at 1280 and 1100 go to .vitest-attachments/import-progress/.
 * Made-up companies and people.
 */
const text = (node: Element | null | undefined) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();
const one = (selector: string, root: ParentNode = document) => root.querySelector<HTMLElement>(selector);
const all = (selector: string, root: ParentNode = document) => [...root.querySelectorAll<HTMLElement>(selector)];
const box = (node: Element) => node.getBoundingClientRect();

const CAPTURES = "../../../../.vitest-attachments/import-progress";

const totals = (files: number) => ({ files, companies: 2, needsCheck: 0, ready: files, beingRead: 0, complete: true });

const CEDARLINE = {
  companyKey: "cedarline systems",
  displayName: "Cedarline Systems",
  total: 40,
  needsCheck: 0,
  ready: 40,
  beingRead: 0,
  categories: { final_pd: { total: 40, needsCheck: 0, fiscalYears: { "2025": 40 } } },
  company: { via: "name", clientId: "c1", name: "Cedarline Systems", industry: "Software" },
  isNew: false,
};

const BREAKDOWN = {
  years: [
    { key: "2025", approved: 52, staged: 52 },
    { key: "2024", approved: 180, staged: 410 },
    { key: "2023", approved: 80, staged: 500 },
    { key: "none", approved: 0, staged: 78 },
  ],
  writers: [
    { key: "user:u-dana", label: "Dana Whitlock", noLogin: false, approved: 140, staged: 600 },
    { key: "writer:w-so", label: "Sam Okafor", noLogin: true, approved: 120, staged: 200 },
    { key: "writer:w-kt", label: "KT", noLogin: true, approved: 52, staged: 52 },
  ],
  noWriter: { key: "none", approved: 0, staged: 150 },
  unsorted: { key: "unsorted", approved: 0, staged: 38 },
  complete: true,
};

function seedPage(progress: unknown = { approved: 312, staged: 1040 }, breakdown: unknown = BREAKDOWN) {
  __setQueryDataForArgs("ingestion:sheetTotals", { tab: "review" }, totals(728));
  __setQueryDataForArgs("ingestion:sheetTotals", { tab: "approved" }, totals(312));
  __setQueryDataForArgs("ingestion:sheetTotals", { tab: "deleted" }, totals(4));
  __setPaginatedRows("ingestion:sheetCompanies", [CEDARLINE]);
  __setQueryData("ingestion:finalPdProgress", progress);
  __setQueryData("ingestion:finalPdBreakdown", breakdown);
}

async function mount(width = 1440) {
  await page.viewport(width, 900);
  await render(ImportPage);
  await expect.element(page.getByRole("button", { name: "Cedarline Systems" })).toBeVisible();
}

const line = () => one("[data-import-progress]");
const dialog = () => one('[data-testid="import-progress-dialog"]');
const rows = (section: string) =>
  all(`[data-import-progress-section="${section}"] [data-import-progress-row]`).map((row) => [
    text(one("[data-import-progress-name]", row)),
    text(one("[data-import-progress-tag]", row)),
    text(one("[data-import-progress-count]", row)),
  ]);

async function openBreakdown() {
  await userEvent.click(line()!);
  await expect.poll(() => dialog()).not.toBeNull();
  // Settled: the dialog's opening motion has finished.
  await expect.poll(() => dialog()!.getAnimations().length).toBe(0);
  await expect.poll(() => all("[data-import-progress-row]").length).toBeGreaterThan(0);
}

describe("final PD progress on the Import page", () => {
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

  it("says how many of the final PDs added so far are approved, with a bar and no percentage", async () => {
    seedPage();
    await mount();
    await expect.poll(() => line()).not.toBeNull();
    expect(text(one("[data-import-progress-text]"))).toBe("312 of 1,040 final PDs approved");
    expect(text(one("[data-import-progress-note]"))).toBe(
      "Out of the final PDs added so far. The total grows as more files are added."
    );
    expect(text(one("[data-import-progress-open]"))).toBe("By year and writer");
    // No share of anything is printed: the words carry the numbers, the bar is for the eye.
    expect(text(line())).not.toMatch(/%/);
    expect(one("[data-import-progress-bar]")!.getAttribute("aria-hidden")).toBe("true");
    const fill = box(one("[data-import-progress-fill]")!).width / box(one("[data-import-progress-bar]")!).width;
    expect(fill).toBeCloseTo(312 / 1040, 2);
    // One button that opens the breakdown, on the line above the toolbar.
    await expect.element(page.getByRole("button", { name: /^312 of 1,040 final PDs approved/ })).toBeVisible();
    expect(line()!.getAttribute("aria-haspopup")).toBe("dialog");
    expect(box(line()!).bottom).toBeLessThanOrEqual(box(one("[data-import-toolbar]")!).top);
    // The breakdown is read only once it is open.
    expect(__activeQueryCount("ingestion:finalPdBreakdown")).toBe(0);

    // On every tab: it counts the whole Import.
    await userEvent.click(page.getByRole("tab", { name: /^History/ }));
    await expect.poll(() => text(one("[data-import-progress-text]"))).toBe("312 of 1,040 final PDs approved");
  });

  it("breaks the count down by fiscal year and by writer, and closes back to the line", async () => {
    seedPage();
    await mount();
    await expect.poll(() => line()).not.toBeNull();
    await openBreakdown();
    expect(__activeQueryCount("ingestion:finalPdBreakdown")).toBe(1);
    expect(text(one("[data-form-dialog-title]"))).toBe("Final PD progress");
    expect(text(one("[data-form-dialog] header"))).toBe(
      "Final PD progress Final PDs approved, out of those added to Import so far. The total grows as more files are added."
    );

    // Newest year first; no fiscal year last.
    expect(rows("import-progress-years")).toEqual([
      ["2025", "", "52 of 52"],
      ["2024", "", "180 of 410"],
      ["2023", "", "80 of 500"],
      ["No fiscal year", "", "0 of 78"],
    ]);
    // Writers by their label now, past writers tagged like the picker; then the two buckets.
    expect(rows("import-progress-writers")).toEqual([
      ["Dana Whitlock", "", "140 of 600"],
      ["Sam Okafor", "No login", "120 of 200"],
      ["KT", "No login", "52 of 52"],
      ["No writer yet", "", "0 of 150"],
      ["Not sorted yet", "", "0 of 38"],
    ]);
    expect(text(one("[data-import-progress-unsorted-note]"))).toBe(
      "Not sorted yet: file names with three or four sets of initials. They get a writer once the client confirms what the extra initials mean."
    );
    // A row with every final PD approved says so in words too.
    const done = one('[data-import-progress-section="import-progress-years"] [data-import-progress-row="2025"]')!;
    expect(text(one("[data-import-progress-all]", done))).toBe("All approved");
    expect(one("[data-import-progress-all]", done)!.classList.contains("sr-only")).toBe(true);
    expect(all("[data-import-progress-all]")).toHaveLength(2);
    // Tables with row headers, so a screen reader reads each name with its figure.
    expect(all('[data-import-progress-section] th[scope="row"]').length).toBe(9);
    expect(all("[data-import-progress-section] [data-import-progress-bar]").every((bar) => bar.getAttribute("aria-hidden") === "true")).toBe(true);
    // An empty bar for none approved; a full one for all.
    const fillOf = (section: string, key: string) => {
      const row = one(`[data-import-progress-section="${section}"] [data-import-progress-row="${key}"]`)!;
      return box(one("[data-import-progress-fill]", row)!).width / box(one("[data-import-progress-bar]", row)!).width;
    };
    expect(fillOf("import-progress-years", "none")).toBe(0);
    expect(fillOf("import-progress-years", "2025")).toBe(1);
    expect(fillOf("import-progress-years", "2024")).toBeCloseTo(180 / 410, 2);

    await userEvent.click(page.getByRole("button", { name: "Done" }));
    await expect.poll(() => dialog()).toBeNull();
    await expect.poll(() => document.activeElement).toBe(line());
    expect(__activeQueryCount("ingestion:finalPdBreakdown")).toBe(0);
  });

  it("says no final PDs are added yet, with no bar, and the breakdown says what it will show", async () => {
    seedPage({ approved: 0, staged: 0 }, { years: [], writers: [], noWriter: null, unsorted: null, complete: true });
    await mount();
    await expect.poll(() => line()).not.toBeNull();
    expect(text(one("[data-import-progress-text]"))).toBe("No final PDs added yet");
    expect(one("[data-import-progress-bar]")).toBeNull();
    expect(one("[data-import-progress-note]")).toBeNull();
    await userEvent.click(line()!);
    await expect.poll(() => text(one("[data-import-progress-empty]"))).toBe(
      "No final PDs added yet. Once final PDs are added, this shows how many are approved for each fiscal year and each writer."
    );
    expect(all("[data-import-progress-row]")).toHaveLength(0);
  });

  it("says the breakdown could not be loaded when its read fails, not Loading for ever", async () => {
    seedPage();
    __setQueryData("ingestion:finalPdBreakdown", undefined);
    __setQueryError("ingestion:finalPdBreakdown", new Error("Server error"));
    await mount();
    await expect.poll(() => line()).not.toBeNull();
    await userEvent.click(line()!);
    await expect.poll(() => text(one("[data-import-progress-error]"))).toBe(
      "The breakdown could not be loaded. Close this and open it again."
    );
    expect(one("[data-import-progress-error]")!.getAttribute("role")).toBe("alert");
    expect(document.querySelector('[data-testid="import-progress-dialog"] [role="status"]')).toBeNull();
  });

  it("shows nothing while the count loads, or to anyone but an Admin", async () => {
    seedPage(undefined);
    __resetConvexStub();
    __setQueryDataForArgs("ingestion:sheetTotals", { tab: "review" }, totals(728));
    __setQueryDataForArgs("ingestion:sheetTotals", { tab: "approved" }, totals(312));
    __setQueryDataForArgs("ingestion:sheetTotals", { tab: "deleted" }, totals(4));
    __setPaginatedRows("ingestion:sheetCompanies", [CEDARLINE]);
    __setQueryData("myWork:getViewConfig", { killSwitch: false, ready: true });
    __setQueryData("users:getCurrentUser", { _id: "a", role: "admin", firstName: "Jordan", lastName: "Ellis" });
    await mount();
    expect(line()).toBeNull();
    __setQueryData("ingestion:finalPdProgress", null);
    await expect.poll(() => one("[data-import-toolbar]")).not.toBeNull();
    expect(line()).toBeNull();
  });

  it("keeps the line readable on a phone: the bar on its own row, the words whole (Greptile on #47)", async () => {
    seedPage(undefined, BREAKDOWN);
    await mount(375);
    await expect.poll(() => line()).not.toBeNull();
    await document.fonts.ready;
    const lineBox = box(line()!);
    expect(lineBox.right).toBeLessThanOrEqual(375);
    const bar = box(one("[data-import-progress-bar]")!);
    const count = box(one("[data-import-progress-text]")!);
    // The bar sits above the count, not beside it.
    expect(bar.bottom).toBeLessThanOrEqual(count.top + 0.5);
    for (const selector of ["[data-import-progress-text]", "[data-import-progress-note]", "[data-import-progress-open]"]) {
      const node = one(selector)!;
      expect(box(node).right, selector).toBeLessThanOrEqual(lineBox.right + 0.5);
      expect(node.scrollWidth, selector).toBeLessThanOrEqual(node.clientWidth + 1);
    }
    // Nothing overlaps: the count ends before "By year and writer" starts.
    expect(count.right).toBeLessThanOrEqual(box(one("[data-import-progress-open]")!).left + 0.5);
    await page.screenshot({ path: `${CAPTURES}/import-progress-line-375.png` });
  });

  for (const width of [1280, 1100]) {
    it(`fits the line and the breakdown at ${width} wide, bars lined up, four-digit figures whole (captures)`, async () => {
      // The widest figures: four digits each side, with the check.
      seedPage(undefined, {
        ...BREAKDOWN,
        years: [{ key: "2025", approved: 1040, staged: 1040 }, ...BREAKDOWN.years.slice(1)],
        writers: [{ ...BREAKDOWN.writers[0], approved: 1040, staged: 1040 }, ...BREAKDOWN.writers.slice(1)],
        noWriter: { key: "none", approved: 1180, staged: 4520 },
      });
      await mount(width);
      await expect.poll(() => line()).not.toBeNull();
      await document.fonts.ready;
      // The line stays inside the page, its words whole.
      const lineBox = box(line()!);
      expect(lineBox.right).toBeLessThanOrEqual(width);
      for (const selector of ["[data-import-progress-text]", "[data-import-progress-note]", "[data-import-progress-open]"]) {
        const node = one(selector)!;
        expect(box(node).right, selector).toBeLessThanOrEqual(lineBox.right + 0.5);
        expect(node.scrollWidth, selector).toBeLessThanOrEqual(node.clientWidth + 1);
      }
      await page.screenshot({ path: `${CAPTURES}/import-progress-line-${width}.png` });

      await openBreakdown();
      const frame = box(one("[data-form-dialog]")!);
      expect(frame.right).toBeLessThanOrEqual(width);
      // Every bar starts and ends at the same place, in both lists.
      const bars = all("[data-import-progress-section] [data-import-progress-bar]").map(box);
      expect(bars.length).toBe(9);
      for (const bar of bars) {
        expect(Math.abs(bar.left - bars[0].left)).toBeLessThan(0.5);
        expect(Math.abs(bar.width - bars[0].width)).toBeLessThan(0.5);
        expect(bar.width).toBeGreaterThan(60);
      }
      // Names and figures are whole, and a figure would still fit drawn 8% wider (Linux, Windows).
      for (const node of all("[data-import-progress-name], [data-import-progress-figure]")) {
        expect(node.scrollWidth, text(node)).toBeLessThanOrEqual(node.clientWidth + 1);
      }
      expect(rows("import-progress-years")[0][2]).toBe("1,040 of 1,040");
      expect(rows("import-progress-writers")[0][2]).toBe("1,040 of 1,040");
      for (const figure of all("[data-import-progress-figure]")) {
        const count = one("[data-import-progress-count]", figure)!;
        const check = one("svg", figure);
        const gap = parseFloat(getComputedStyle(figure).columnGap) || 0;
        const needed = wordsWidth(count) * WIDER_TEXT + (check ? box(check).width + gap : 0);
        expect(needed, text(count)).toBeLessThanOrEqual(box(figure).width);
      }
      await page.screenshot({ path: `${CAPTURES}/import-progress-breakdown-${width}.png` });
      await userEvent.keyboard("{Escape}");
    });
  }
});
