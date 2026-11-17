import { beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import ToastHarness from "$lib/test/ToastHarness.svelte";
import { page, userEvent } from "vitest/browser";
import ImportPage from "./ImportPage.svelte";
import {
  __mutationCalls,
  __resetConvexStub,
  __setMutationHandler,
  __setPaginatedRows,
  __setPaginatedRowsForArgs,
  __setQueryData,
  __setQueryDataForArgs,
} from "$lib/test/convex-svelte-stub.svelte";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import { viewAs } from "$lib/shell/viewAs.svelte";
import { board } from "$lib/test/boardScale";

/**
 * The Import page against the approved drawing (Paper "Files 1 / Dropping
 * files", 2026-11-12): the page at the boards' 1440px with the drawing's
 * data (made-up companies and people), so its captures sit beside the board
 * in .vitest-attachments/import-match-drawing/. It checks what the owner saw
 * differ: the toolbar's order, the one left edge the section labels, file
 * names and Show more rows share, the band's geometry and the lines.
 */
const CAPTURES = "../../../../.vitest-attachments/import-match-drawing";
const text = (node: Element | null | undefined) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();
const one = (selector: string, root: ParentNode = document) => root.querySelector<HTMLElement>(selector);
const all = (selector: string, root: ParentNode = document) => [...root.querySelectorAll<HTMLElement>(selector)];
const box = (node: Element) => node.getBoundingClientRect();
/** Where an element's own words start (its padding aside). */
function wordsLeft(node: Element): number {
  const range = document.createRange();
  range.selectNodeContents(node);
  return range.getBoundingClientRect().left;
}

const MAR_31_2025 = Date.UTC(2025, 2, 31);
const MAR_31_2024 = Date.UTC(2024, 2, 31);

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
  needsCheck: 16,
  ready: 207,
  beingRead: 0,
  categories: {
    final_pd: {
      total: 24,
      needsCheck: 13,
      fiscalYears: { "2025": 13, "2024": 11 },
      checkReasons: { unmatched_initials: 9, no_science_code: 4 },
    },
    draft: { total: 45, needsCheck: 0, fiscalYears: { "2025": 26, "2024": 19 } },
    review_copy: { total: 31, needsCheck: 0, fiscalYears: { "2025": 18, "2024": 13 } },
    transcript: { total: 17, needsCheck: 0, fiscalYears: { "2025": 10, "2024": 7 } },
    supporting: { total: 102, needsCheck: 3, fiscalYears: { "2025": 61, "2024": 41 }, checkReasons: { could_not_read: 3 } },
    company_file: { total: 4, needsCheck: 0, fiscalYears: { none: 4 } },
  },
  company: { via: "name", clientId: "c1", name: "Cedarline Systems", industry: "software" },
  isNew: false,
};
const HALDEN = {
  companyKey: "halden foods",
  displayName: "Halden Foods",
  total: 46,
  needsCheck: 46,
  ready: 0,
  beingRead: 0,
  categories: { final_pd: { total: 46, needsCheck: 46, fiscalYears: { "2025": 46 }, checkReasons: { no_science_code: 46 } } },
  company: null,
  isNew: true,
};
const NORTHGATE = {
  companyKey: "northgate labs",
  displayName: "Northgate Labs",
  total: 64,
  needsCheck: 0,
  ready: 64,
  beingRead: 0,
  categories: { final_pd: { total: 64, needsCheck: 0, fiscalYears: { "2025": 64 } } },
  company: { via: "name", clientId: "c2", name: "Northgate Labs", industry: "manufacturing" },
  isNew: false,
};
const BRIGHTWELL = {
  companyKey: "brightwell dairy",
  displayName: "Brightwell Dairy",
  total: 51,
  needsCheck: 2,
  ready: 49,
  beingRead: 0,
  categories: { final_pd: { total: 51, needsCheck: 2, fiscalYears: { "2025": 51 }, checkReasons: { no_science_code: 2 } } },
  company: { via: "name", clientId: "c3", name: "Brightwell Dairy", industry: "food-processing" },
  isNew: false,
};

function file(id: string, extra: Record<string, unknown>) {
  return {
    _id: id,
    name: `${id}.docx`,
    category: "final_pd",
    status: "pending_review",
    editedLabels: [],
    needsCheck: false,
    checkReasons: [],
    size: 2048,
    fiscalYearEnd: MAR_31_2025,
    ...extra,
  };
}

const FINAL_PDS = [
  file("pd1", { pdNumber: "1", pdTitle: "Route planning engine", versionCode: "T", versionNumber: 2, writerName: "Dana Whitlock", writerNameSource: "initials", writerInitials: "DW", scienceCode: "2.02.09", scienceCodeSource: "document" }),
  file("pd2", { pdNumber: "2", pdTitle: "Yard map solver", fiscalYearEnd: MAR_31_2024, versionCode: "T", versionNumber: 1, writerInitials: "KT", scienceCode: "2.02.09", scienceCodeSource: "document", needsCheck: true, checkReasons: ["unmatched_initials"] }),
  file("pd3", { pdNumber: "3", pdTitle: "Sensor data pipeline", versionCode: "T", versionNumber: 3, writerName: "Priya Nair", scienceCode: "1.02.02", scienceCodeSource: "person" }),
  file("pd4", { pdNumber: "4", pdTitle: "Label vision check", versionCode: "T", versionNumber: 1, writerName: "Dana Whitlock", needsCheck: true, checkReasons: ["no_science_code"] }),
  file("pd5", { pdNumber: "5", pdTitle: "Shelf gap finder", versionCode: "T", versionNumber: 2, writerInitials: "KT", scienceCode: "2.02.09", scienceCodeSource: "document", needsCheck: true, checkReasons: ["unmatched_initials"] }),
];
const SUPPORTING = [
  file("wb", { name: "Whiteboard photo.pdf", category: "supporting", status: "failed", needsCheck: true, checkReasons: ["could_not_read"] }),
  file("notes", { name: "Site notes, scanned.pdf", category: "supporting", status: "failed", needsCheck: true, checkReasons: ["could_not_read"] }),
  file("dock", { name: "Dock layout sketch.pdf", category: "supporting", status: "failed", needsCheck: true, checkReasons: ["could_not_read"] }),
];

const filesArgs = (companyKey: string, category: string) => ({ tab: "review", companyKey, category, onlyToCheck: false });

function seedDrawing() {
  __setQueryDataForArgs("ingestion:sheetTotals", { tab: "review" }, totals(504, 7, 117));
  __setQueryDataForArgs("ingestion:sheetTotals", { tab: "approved" }, totals(1204, 9));
  __setQueryDataForArgs("ingestion:sheetTotals", { tab: "deleted" }, totals(41, 3));
  __setPaginatedRows("ingestion:sheetCompanies", [CEDARLINE, HALDEN, NORTHGATE, BRIGHTWELL], { more: true });
  __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("cedarline systems", "final_pd"), FINAL_PDS, { more: true });
  __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("cedarline systems", "supporting"), SUPPORTING, { more: true });
}

async function mountDrawing(width: number, height = 1400) {
  await page.viewport(width, height);
  seedDrawing();
  await render(ImportPage);
  await userEvent.click(page.getByRole("button", { name: "Cedarline Systems" }));
  await userEvent.click(page.getByRole("button", { name: /^Supporting files/ }));
  await expect.poll(() => all("[data-import-file]").length).toBe(8);
  await document.fonts.ready;
}

describe("the Import page against the drawing (Paper Files 1)", () => {
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

  it("orders the toolbar as drawn: search, To check, then at the right the legend and Select", async () => {
    await mountDrawing(1440);
    const toolbar = one("[data-import-toolbar]")!;
    const search = one('[role="search"]', toolbar)!;
    const toCheck = one("[data-import-to-check]", toolbar)!;
    const legend = one("[data-import-legend]", toolbar)!;
    const select = one("[data-import-select-toggle]", toolbar)!;
    // One row, left to right in that order.
    const lefts = [search, toCheck, legend, select].map((node) => box(node).left);
    expect([...lefts].sort((a, b) => a - b)).toEqual(lefts);
    const middle = (node: Element) => (box(node).top + box(node).bottom) / 2;
    for (const node of [toCheck, legend, select]) expect(middle(node)).toBeCloseTo(middle(search), 0);
    // The field is 192px (the drawing's 176px cuts its placeholder in Geist); 8px to the chip; Select ends the row.
    expect(box(search).width).toBeCloseTo(board(192), 0);
    expect(box(toCheck).left - box(search).right).toBeCloseTo(board(8), 0);
    expect(box(select).right).toBeCloseTo(box(toolbar).right, 0);
    // 24px from the legend to Select, and Select has no icon.
    expect(box(select).left - box(legend).right).toBeCloseTo(board(24), 0);
    expect(select.querySelector("svg")).toBeNull();
    // 20px from the toolbar to the sheet's header row.
    expect(box(one("[data-import-sheet-header]")!).top - box(toolbar).bottom).toBeCloseTo(board(20), 0);
  });

  it("puts the section labels, file names and Show more rows on one left edge, the band name 24px in", async () => {
    await mountDrawing(1440);
    const header = one("[data-import-sheet-header]")!;
    const sheetLeft = box(header).left;
    const edge = wordsLeft(one('[role="columnheader"]', header)!);
    // "File" in the header: 48px in, the edge everything below shares.
    expect(edge - sheetLeft).toBeCloseTo(board(48), 0);
    for (const label of all("[data-import-section-label]")) expect(box(label).left, text(label)).toBeCloseTo(edge, 0);
    for (const prefix of all("[data-import-file-prefix]")) expect(box(prefix).left, text(prefix)).toBeCloseTo(edge, 0);
    // A file with no PD number starts its name there too.
    expect(box(one('[data-import-file="wb"] [data-import-file-title]')!).left).toBeCloseTo(edge, 0);
    for (const more of all("[data-import-show-more-files]")) expect(box(more).left, text(more)).toBeCloseTo(edge, 0);
    // A PD's title 50px after its number (a 40px number, then 10px).
    const pd1 = one('[data-import-file="pd1"]')!;
    expect(box(one("[data-import-file-title]", pd1)!).left - edge).toBeCloseTo(board(50), 0);

    // The band: the chevron at the sheet's edge, the name 24px in, its industry 16px after.
    const cedarline = one('[data-import-band="cedarline systems"]')!;
    expect(box(one("[data-import-band-chevron]", cedarline)!).left).toBeCloseTo(sheetLeft, 0);
    const name = one("[data-import-band-name]", cedarline)!;
    expect(box(name).left - sheetLeft).toBeCloseTo(board(24), 0);
    const industry = one("[data-import-band-industry]", cedarline)!;
    expect(text(industry)).toBe("Software");
    expect(box(industry).left - box(name).right).toBeCloseTo(board(16), 0);
    // A section's chevron sits at the sections' own edge, 24px in.
    expect(box(one("[data-import-section-chevron]", cedarline)!).left - sheetLeft).toBeCloseTo(board(24), 0);
    // "N files" ends on the Science code column's rule; the status words end 8px inside the sheet.
    const codeHeader = all('[role="columnheader"]', header)[5];
    expect(box(one("[data-import-band-files]", cedarline)!).right).toBeCloseTo(box(codeHeader).left, 0);
    const words = all("[data-import-band-status] span", cedarline);
    expect(box(words.at(-1)!).right).toBeCloseTo(box(header).right - board(8), 0);
  });

  it("draws the band, section and file lines and spacing as the drawing does", async () => {
    await mountDrawing(1440);
    const color = (node: Element, side: "Top" | "Bottom" = "Top") => getComputedStyle(node)[`border${side}Color`];
    const gray300 = "rgb(194, 208, 205)";
    const line = "rgb(218, 229, 227)";
    const lineSoft = "rgb(233, 240, 239)";
    const bandRow = (key: string) => one(`[data-import-band="${key}"] > [role="row"]`)!;
    expect(color(bandRow("cedarline systems"))).toBe(gray300);
    expect(bandRow("cedarline systems").getBoundingClientRect().height).toBeCloseTo(board(52), 0);
    expect(color(one('[data-import-section="final_pd"] > [role="row"]')!)).toBe(line);
    expect(color(one('[data-import-file="pd1"]')!)).toBe(lineSoft);
    // Closed companies sit 14px apart; the one after an open company 28px under its last line.
    expect(box(bandRow("northgate labs")).top - box(bandRow("halden foods")).bottom).toBeCloseTo(board(14), 0);
    const sections = one('[data-import-band="cedarline systems"] [data-import-band-sections]')!;
    expect(box(bandRow("halden foods")).top - box(sections).bottom).toBeCloseTo(board(28), 0);
    // The amber words are the drawing's #A8500F, and its pick controls 26px tall.
    const note = one('[data-import-section="final_pd"] [data-import-section-note]')!;
    expect(text(note)).toBe("9 need a writer, 4 need a science code");
    expect(getComputedStyle(note).color).toBe("rgb(168, 80, 15)");
    // The cells' words are secondary ink; the file's name is ink.
    const ink = "rgb(22, 33, 31)";
    const secondary = "rgb(79, 97, 93)";
    const pd1 = one('[data-import-file="pd1"]')!;
    expect(getComputedStyle(one("[data-import-year]", pd1)!).color).toBe(secondary);
    expect(getComputedStyle(one('[data-import-cell="version"] span', pd1)!).color).toBe(secondary);
    expect(getComputedStyle(one("[data-import-writer-tone]", pd1)!).color).toBe(secondary);
    expect(getComputedStyle(one("[data-import-code]", pd1)!).color).toBe(secondary);
    expect(getComputedStyle(one("[data-import-file-title]", pd1)!).color).toBe(ink);
    const pick = one('[data-import-file="pd2"] [data-import-writer-pick]')!;
    expect(text(pick)).toBe("Choose writer");
    expect(box(pick).height).toBeCloseTo(board(26), 0);
    // A known company's industry, and a new one's picker.
    expect(text(one('[data-import-band="northgate labs"] [data-import-band-industry]'))).toBe("Manufacturing");
    expect(text(one('[data-import-band="brightwell dairy"] [data-import-band-industry]'))).toBe("Food processing");
    expect(text(one('[data-import-band="halden foods"] [data-import-band-industry-pick]'))).toBe("Pick an industry");
    // The Admin menu's Import row with the To review count.
    const importLink = one('[data-admin-link="/admin/import"]')!;
    expect(text(importLink)).toBe("Import 504");
    expect(importLink.getAttribute("aria-current")).toBe("page");
  });

  /** The page's own scrolling area (the frame's card), to bring the lower half into view. */
  function scroller(): HTMLElement {
    let node: HTMLElement | null = one("[data-import-page]");
    while (node && !(node.scrollHeight > node.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(node).overflowY))) {
      node = node.parentElement;
    }
    return node ?? document.documentElement;
  }

  // The test browser shows a window taller than 720px scaled down, so the
  // detail captures are 720px tall (1280 is then exact, 1440 at 0.89) and the
  // whole page is one more, scaled, capture.
  for (const width of [1440, 1280]) {
    it(`captures the page at ${width}px beside the board`, async () => {
      await mountDrawing(width, 720);
      const area = scroller();
      area.scrollTop = 0;
      await new Promise((resolve) => setTimeout(resolve, 400));
      await page.screenshot({ path: `${CAPTURES}/after-files1-${width}-top.png` });
      // The hovered row: its "..." over the code cell's end.
      await userEvent.hover(one('[data-import-file="pd4"]')!);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await page.screenshot({ path: `${CAPTURES}/after-row-hover-${width}.png` });
      await userEvent.unhover(one('[data-import-file="pd4"]')!);
      area.scrollTop = area.scrollHeight;
      await new Promise((resolve) => setTimeout(resolve, 300));
      await page.screenshot({ path: `${CAPTURES}/after-files1-${width}-bottom.png` });
      expect(all("[data-import-band]").length).toBe(4);
    });
  }

  it("picks a new company's industry from the app's list, then shows it in muted words that can still be changed", async () => {
    __setQueryData("projects:listIndustries", ["food-processing", "software"]);
    __setMutationHandler("ingestion:setNewCompanyIndustry", (args) => ({ industry: (args as { industry: string }).industry }));
    await render(ToastHarness);
    await mountDrawing(1440);
    const halden = () => one('[data-import-band="halden foods"]')!;
    const pick = one("[data-import-band-industry-pick]", halden())!;
    expect(getComputedStyle(pick).color).toBe("rgb(168, 80, 15)");
    // 8px after the green label, as drawn.
    expect(box(pick).left - box(one("[data-import-band-new]", halden())!).right).toBeCloseTo(board(8), 0);
    await userEvent.click(pick);
    // The one industry list: the base three, then what projects use, by label.
    await expect.poll(() => all("[data-import-name-option]").map((node) => text(node))).toEqual([
      "Software",
      "Manufacturing",
      "Life sciences",
      "Food processing",
    ]);
    // Opening it never opened the company.
    expect(halden().hasAttribute("data-import-band-open")).toBe(false);
    await userEvent.click(one('[data-import-name-option="food-processing"]')!);
    await expect.poll(() => __mutationCalls("ingestion:setNewCompanyIndustry")).toEqual([
      { companyKey: "halden foods", industry: "food-processing" },
    ]);
    // The sheet reads it back: muted words, still a control.
    __setPaginatedRows("ingestion:sheetCompanies", [CEDARLINE, { ...HALDEN, pickedIndustry: "food-processing" }, NORTHGATE, BRIGHTWELL], { more: true });
    await expect.poll(() => text(one("[data-import-band-industry]", halden()))).toBe("Food processing");
    const edit = one("[data-import-band-industry-edit]", halden())!;
    expect(getComputedStyle(one("[data-import-band-industry]", halden())!).color).toBe("rgb(107, 127, 123)");
    expect(one("[data-import-band-industry-pick]", halden())).toBeNull();
    // A typed industry is added as its slug, as on New company.
    await userEvent.click(edit);
    await userEvent.fill(page.getByRole("combobox", { name: "Industry" }), "Cold storage");
    await expect.element(page.getByText('Add "Cold storage"')).toBeVisible();
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => __mutationCalls("ingestion:setNewCompanyIndustry").at(-1)).toEqual({
      companyKey: "halden foods",
      industry: "cold-storage",
    });
    // No AI suggestion beside it: nothing knows a new company's industry without a new AI call.
    expect(text(halden())).not.toContain("Use ");
  });

  it("captures Select at 1280px beside Files 4, the boxes in one column and the names on their edge", async () => {
    await mountDrawing(1280, 720);
    scroller().scrollTop = 0;
    await userEvent.click(page.getByRole("button", { name: "Select", exact: true }));
    await expect.poll(() => all("[data-import-file-select]").length).toBe(8);
    await userEvent.click(one('[data-import-file-select="pd1"]')!);
    await userEvent.click(one('[data-import-file-select="pd3"]')!);
    // Every box sits in the one column at the sheet's left, and the file names keep one edge.
    const lefts = all('[role="checkbox"][data-import-file-select], [role="checkbox"][data-import-band-select], [role="checkbox"][data-import-section-select]').map(
      (node) => box(node).left
    );
    for (const left of lefts) expect(left).toBeCloseTo(lefts[0], 0);
    const labels = all("[data-import-section-label]").map((node) => box(node).left);
    expect(box(one('[data-import-file="pd1"] [data-import-file-prefix]')!).left).toBeCloseTo(labels[0], 0);
    await new Promise((resolve) => setTimeout(resolve, 400));
    await page.screenshot({ path: `${CAPTURES}/after-select-1280.png` });
  });

  it("captures the whole page at 1440px", async () => {
    await mountDrawing(1440);
    await new Promise((resolve) => setTimeout(resolve, 400));
    await page.screenshot({ path: `${CAPTURES}/after-files1-1440.png` });
    expect(all("[data-import-band]").length).toBe(4);
  });
});
