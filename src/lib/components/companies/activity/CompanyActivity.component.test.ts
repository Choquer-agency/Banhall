import { beforeEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import CompanyActivity from "./CompanyActivity.svelte";
import {
  __activeQueryArgs,
  __clientQueryCalls,
  __resetConvexStub,
  __setQueryDataForArgs,
} from "$lib/test/convex-svelte-stub.svelte";

/**
 * 2026-11-04 (the company profile, Paper "Activity / By day, with people
 * and links"): a company's Activity tab. Rows grouped by day (Today, a
 * weekday this past week, else the date), who did what, project labels that
 * link to the project, file labels that open the Files tab, stage chips,
 * the Everyone and All changes filters, and Show more.
 */
const text = (node: Element | null | undefined) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();
const KEY = "cedarline systems";

function at(daysAgo: number, hours: number, minutes: number) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hours, minutes, 0, 0);
  return date.getTime();
}

const JORDAN = { userId: "u-jordan", label: "Jordan Ellis", initials: "JE" };
const PRIYA = { userId: "u-priya", label: "Priya Nair", initials: "PN" };
const SAM = { userId: "u-sam", label: "Sam Okafor", initials: "SO" };

const FIRST_PAGE = {
  entries: [
    { id: "e1", kind: "file", at: at(0, 9, 14), actor: JORDAN, action: "added", fileId: "f1", fileName: "Engineering team org chart.pdf" },
    {
      id: "e2",
      kind: "stage_moved",
      at: at(3, 16, 2),
      actor: PRIYA,
      project: { id: "p1", title: "Adaptive cold storage controls" },
      fromStage: "drafting",
      toStage: "internal_review",
    },
    { id: "e3", kind: "draft_started", at: at(8, 11, 30), actor: JORDAN, project: { id: "p2", title: "High-efficiency pump control" } },
    { id: "e4", kind: "file", at: at(8, 9, 5), actor: JORDAN, action: "added", fileId: "f2", fileName: "FY2026 project time logs.xlsx" },
    { id: "e5", kind: "file", at: at(8, 9, 4), actor: JORDAN, action: "added", fileId: "f3", fileName: "Bench notes.docx" },
    { id: "e6", kind: "project_started", at: at(14, 14, 40), actor: SAM, project: { id: "p3", title: "Defrost cycle prediction" }, fiscalYear: 2026 },
  ],
  continueCursor: String(at(14, 14, 40)),
  projectsTruncated: false,
};

const SECOND_PAGE = {
  entries: [
    { id: "e7", kind: "website", at: at(33, 10, 12), actor: JORDAN, host: "example.com", outcome: "read", reason: null },
    { id: "e9", kind: "website", at: at(33, 9, 0), actor: JORDAN, host: "example.com", outcome: "failed", reason: "the site did not answer." },
    { id: "e8", kind: "file", at: at(34, 10, 0), actor: PRIYA, action: "removed", fileId: "f4", fileName: "old plan.txt" },
  ],
  continueCursor: null,
  projectsTruncated: true,
};

async function mount() {
  await page.viewport(1440, 900);
  return render(CompanyActivity, { companyKey: KEY, companyName: "Cedarline Systems", active: true });
}

const days = () => [...document.querySelectorAll("[data-activity-day]")];
const rowsOf = (day: Element) => [...day.querySelectorAll("[data-activity-row]")];

beforeEach(() => {
  __resetConvexStub();
  __setQueryDataForArgs("companyActivity:listCompanyActivity", { companyKey: KEY, cursor: null }, FIRST_PAGE);
  __setQueryDataForArgs("companyActivity:listCompanyActivity", { companyKey: KEY, cursor: FIRST_PAGE.continueCursor }, SECOND_PAGE);
});

describe("a company's Activity tab", () => {
  it("groups rows by day: Today, a weekday this past week, else the date", async () => {
    await mount();
    await expect.poll(() => days().length).toBe(4);
    expect(text(document.querySelector("#company-activity-title"))).toBe("Activity");
    expect(text(document.querySelector("[data-company-activity]"))).toContain("What changed on Cedarline Systems and its projects.");
    const titles = days().map((day) => text(day.querySelector("[data-activity-day-title]")));
    const weekday = (daysAgo: number) => new Date(at(daysAgo, 12, 0)).toLocaleDateString("en-US", { weekday: "long" });
    const short = (daysAgo: number) => new Date(at(daysAgo, 12, 0)).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(new Date(at(daysAgo, 12, 0)).getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }) });
    expect(titles).toEqual(["Today", weekday(3), short(8), short(14)]);
    expect(text(days()[2])).toContain(weekday(8));
    expect(text(days()[0])).toContain("9:14 AM");
  });

  it("names who did what, with project links, file labels and stage chips", async () => {
    await mount();
    await expect.poll(() => days().length).toBe(4);
    const [today, weekday, older, oldest] = days();

    expect(text(rowsOf(today)[0])).toContain("Jordan Ellis added a file Engineering team org chart.pdf");
    const fileLink = today.querySelector<HTMLAnchorElement>('[data-activity-file="f1"]')!;
    expect(fileLink.tagName).toBe("A");
    expect(fileLink.getAttribute("href")).toBe("?tab=files");
    expect(fileLink.querySelector("[data-file-icon]")?.getAttribute("data-file-icon")).toBe("pdf");

    const moved = rowsOf(weekday)[0];
    expect(text(moved)).toContain("Priya Nair moved Adaptive cold storage controls");
    expect([...moved.querySelectorAll("[data-activity-stage]")].map((chip) => text(chip))).toEqual(["Drafting", "Internal review"]);
    const projectLink = moved.querySelector<HTMLAnchorElement>('[data-activity-project="p1"]')!;
    expect(projectLink.getAttribute("href")).toBe("/project/p1");
    expect(projectLink.className).toContain("bg-primary-wash");
    expect(projectLink.className).toContain("hover:underline");

    expect(text(rowsOf(older)[0])).toContain("Jordan Ellis started drafting High-efficiency pump control");
    // Two files one person added one after the other read as one row.
    const files = rowsOf(older)[1];
    expect(text(files)).toContain("Jordan Ellis added 2 files FY2026 project time logs.xlsx");
    expect(text(files.querySelector("[data-activity-more-files]"))).toBe("+1");
    expect(rowsOf(older)).toHaveLength(2);

    expect(text(rowsOf(oldest)[0])).toContain("Sam Okafor started Defrost cycle prediction for FY 2026");
  });

  it("shows more on request, with website reads and deleted files that no longer open", async () => {
    await mount();
    await expect.poll(() => days().length).toBe(4);
    expect(document.querySelector("[data-activity-truncated]")).toBeNull();
    document.querySelector<HTMLButtonElement>("[data-activity-show-more]")!.click();
    await expect.poll(() => days().length).toBe(6);
    expect(__clientQueryCalls("companyActivity:listCompanyActivity")).toEqual([{ companyKey: KEY, cursor: FIRST_PAGE.continueCursor }]);
    expect(document.querySelector("[data-activity-show-more]")).toBeNull();
    const [website, failed] = [...document.querySelectorAll('[data-activity-row="website"]')];
    expect(text(website)).toContain("The website example.com was read into files");
    expect(text(failed)).toContain("The website example.com could not be read");
    const removed = document.querySelector('[data-activity-file="f4"]')!;
    expect(removed.tagName).toBe("SPAN");
    expect(text(removed.closest("[data-activity-row]"))).toContain("Priya Nair deleted a file old plan.txt");
    expect(text(document.querySelector("[data-activity-truncated]"))).toContain("50 newest projects");
  });

  it("keeps a row a newer change pushed off the first page after Show more", async () => {
    await mount();
    await expect.poll(() => days().length).toBe(4);
    document.querySelector<HTMLButtonElement>("[data-activity-show-more]")!.click();
    await expect.poll(() => days().length).toBe(6);
    const newer = { id: "e0", kind: "file", at: Date.now(), actor: PRIYA, action: "added", fileId: "f9", fileName: "New notes.txt" };
    __setQueryDataForArgs(
      "companyActivity:listCompanyActivity",
      { companyKey: KEY, cursor: null },
      { ...FIRST_PAGE, entries: [newer, ...FIRST_PAGE.entries.slice(0, -1)], continueCursor: String(FIRST_PAGE.entries[4].at) }
    );
    await expect.poll(() => document.querySelector('[data-activity-file="f9"]')).not.toBeNull();
    const ids = [...document.querySelectorAll("[data-activity-row]")].map((row) => text(row));
    expect(ids.some((row) => row.includes("Defrost cycle prediction"))).toBe(true);
    expect(ids.some((row) => row.includes("old plan.txt"))).toBe(true);
  });

  it("drops a row the first page lost after Show more because it was removed", async () => {
    await mount();
    await expect.poll(() => days().length).toBe(4);
    document.querySelector<HTMLButtonElement>("[data-activity-show-more]")!.click();
    await expect.poll(() => days().length).toBe(6);
    const stage = (row: Element) => text(row).includes("Adaptive cold storage controls");
    expect([...document.querySelectorAll("[data-activity-row]")].some(stage)).toBe(true);
    __setQueryDataForArgs(
      "companyActivity:listCompanyActivity",
      { companyKey: KEY, cursor: null },
      { ...FIRST_PAGE, entries: FIRST_PAGE.entries.filter((entry) => entry.id !== "e2") }
    );
    await expect.poll(() => [...document.querySelectorAll("[data-activity-row]")].some(stage)).toBe(false);
    const keys = days().map((day) => day.getAttribute("data-activity-day"));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("filters by one person and by one kind of change", async () => {
    __setQueryDataForArgs("companyActivity:listCompanyActivity", { companyKey: KEY, cursor: null, personId: "u-priya" }, {
      entries: [FIRST_PAGE.entries[1]],
      continueCursor: null,
      projectsTruncated: false,
    });
    __setQueryDataForArgs("companyActivity:listCompanyActivity", { companyKey: KEY, cursor: null, personId: "u-priya", kind: "stages" }, {
      entries: [],
      continueCursor: null,
      projectsTruncated: false,
    });
    await mount();
    await expect.poll(() => days().length).toBe(4);

    const personFilter = document.querySelector<HTMLButtonElement>("[data-activity-person-filter]")!;
    expect(text(personFilter)).toBe("Everyone");
    personFilter.click();
    await expect.poll(() => document.querySelector('[data-activity-person-option="u-priya"]')).not.toBeNull();
    expect([...document.querySelectorAll("[data-activity-person-option]")].map((option) => text(option))).toEqual([
      "Everyone",
      "Jordan Ellis",
      "Priya Nair",
      "Sam Okafor",
    ]);
    document.querySelector<HTMLElement>('[data-activity-person-option="u-priya"]')!.click();
    await expect.poll(() => text(document.querySelector("[data-activity-person-filter]"))).toBe("Priya Nair");
    expect(__activeQueryArgs("companyActivity:listCompanyActivity")).toEqual([{ companyKey: KEY, cursor: null, personId: "u-priya" }]);
    await expect.poll(() => days().length).toBe(1);

    const kindFilter = document.querySelector<HTMLButtonElement>("[data-activity-kind-filter]")!;
    expect(text(kindFilter)).toBe("All changes");
    kindFilter.click();
    await expect.poll(() => document.querySelector('[data-activity-kind-option="stages"]')).not.toBeNull();
    expect([...document.querySelectorAll("[data-activity-kind-option]")].map((option) => text(option))).toEqual([
      "All changes",
      "Files",
      "Projects started",
      "Stage moves",
      "Drafts started",
      "Website reads",
    ]);
    document.querySelector<HTMLElement>('[data-activity-kind-option="stages"]')!.click();
    await expect.poll(() => text(document.querySelector("[data-activity-kind-filter]"))).toBe("Stage moves");
    expect(__activeQueryArgs("companyActivity:listCompanyActivity")).toEqual([{ companyKey: KEY, cursor: null, personId: "u-priya", kind: "stages" }]);
    await expect.poll(() => text(document.querySelector("[data-activity-empty]"))).toBe("No changes match these filters.");
  });

  it("opens the Files tab through onOpenFiles when given, keeping the link for a new tab", async () => {
    const opened: number[] = [];
    await page.viewport(1440, 900);
    await render(CompanyActivity, { companyKey: KEY, companyName: "Cedarline Systems", active: true, onOpenFiles: () => opened.push(1) });
    await expect.poll(() => document.querySelector('[data-activity-file="f1"]')).not.toBeNull();
    const link = document.querySelector<HTMLAnchorElement>('[data-activity-file="f1"]')!;
    expect(link.getAttribute("href")).toBe("?tab=files");
    // Seen last (after the component's handler); always stops the test page navigating.
    const prevented: boolean[] = [];
    const last = (event: Event) => {
      prevented.push(event.defaultPrevented);
      event.preventDefault();
    };
    window.addEventListener("click", last);
    try {
      link.click();
      expect(opened).toHaveLength(1);
      expect(prevented).toEqual([true]);
      // A modified click (open in a new tab) is left to the browser.
      link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true }));
      expect(opened).toHaveLength(1);
      expect(prevented).toEqual([true, false]);
    } finally {
      window.removeEventListener("click", last);
    }
  });

  it("reads nothing while hidden", async () => {
    await page.viewport(1440, 900);
    render(CompanyActivity, { companyKey: KEY, companyName: "Cedarline Systems", active: false });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(__activeQueryArgs("companyActivity:listCompanyActivity")).toEqual([]);
    expect(document.querySelector("[data-activity-loading]")).not.toBeNull();
  });
});
