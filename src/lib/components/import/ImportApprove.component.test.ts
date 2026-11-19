import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import ImportPage from "./ImportPage.svelte";
import ImportApprovalRun from "./ImportApprovalRun.svelte";
import ToastHarness from "$lib/test/ToastHarness.svelte";
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

/**
 * Approve on the Import page (2026-11-17): "Approve N ready" on a company
 * and its confirm, Approve in the selection bar, the approval line under
 * the toolbar, the Brain check tab, the file view and what each approved
 * file became on the Approved tab. Made-up companies and people.
 */
const CAPTURES = "../../../../.vitest-attachments/import-approve";
const text = (node: Element | null | undefined) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();
const all = (selector: string, root: ParentNode = document) => [...root.querySelectorAll<HTMLElement>(selector)];
const one = (selector: string, root: ParentNode = document) => root.querySelector<HTMLElement>(selector);

const totals = (files: number, companies: number, needsCheck = 0, extra: Record<string, number> = {}) => ({
  files,
  companies,
  needsCheck,
  ready: files - needsCheck,
  beingRead: 0,
  newFiles: 0,
  brainCheck: 0,
  complete: true,
  ...extra,
});

const CEDARLINE = {
  companyKey: "cedarline systems",
  displayName: "Cedarline Systems",
  total: 179,
  needsCheck: 2,
  ready: 176,
  beingRead: 1,
  newFiles: 0,
  brainCheck: 0,
  categories: {
    final_pd: { total: 24, needsCheck: 2, fiscalYears: { "2025": 24 }, checkReasons: { no_writer: 2 } },
    supporting: { total: 150, needsCheck: 0, fiscalYears: { "2025": 150 } },
  },
  company: { via: "name", clientId: "c1", name: "Cedarline Systems", industry: "software" },
  isNew: false,
};

const HALDEN = {
  companyKey: "halden foods",
  displayName: "Halden Foods",
  total: 12,
  needsCheck: 0,
  ready: 12,
  beingRead: 0,
  newFiles: 0,
  brainCheck: 0,
  categories: { final_pd: { total: 3, needsCheck: 0, fiscalYears: { "2024": 3 } }, draft: { total: 9, needsCheck: 0, fiscalYears: { "2024": 9 } } },
  company: null,
  isNew: true,
};

function row(id: string, extra: Record<string, unknown> = {}) {
  return {
    _id: id,
    name: `${id}.docx`,
    category: "final_pd",
    status: "pending_review",
    editedLabels: [],
    needsCheck: false,
    checkReasons: [],
    size: 2048,
    fiscalYearEnd: Date.UTC(2025, 2, 31),
    ...extra,
  };
}

const FINAL_PDS = [
  row("pd1", { pdNumber: "1", pdTitle: "Route planning engine", versionCode: "T", versionNumber: 2, writerName: "Dana Whitlock", scienceCode: "2.02.09" }),
  row("pd2", { pdNumber: "2", pdTitle: "Yard map solver", versionCode: "T", versionNumber: 1, writerName: "Priya Nair", scienceCode: "2.02.09" }),
  row("pd3", { pdNumber: "3", pdTitle: "Label vision check", needsCheck: true, checkReasons: ["no_writer"] }),
  row("pd4", { pdNumber: "4", pdTitle: "Shelf gap finder", status: "fetched" }),
];
const SUPPORTING = Array.from({ length: 130 }, (_, index) =>
  row(`s${String(index).padStart(3, "0")}`, { name: `Freezer readings ${index}.pdf`, category: "supporting" })
);

const filesArgs = (category: string, tab = "review", companyKey = "cedarline systems") => ({ tab, companyKey, category, onlyToCheck: false });

function seedPage(options: { brainCheck?: number } = {}) {
  __setQueryDataForArgs("ingestion:sheetTotals", { tab: "review" }, totals(191, 2, 2));
  __setQueryDataForArgs("ingestion:sheetTotals", { tab: "approved" }, totals(40, 1, 0, { brainCheck: options.brainCheck ?? 2 }));
  __setQueryDataForArgs("ingestion:sheetTotals", { tab: "deleted" }, totals(3, 1));
  for (const onlyToCheck of [false, true]) {
    __setPaginatedRowsForArgs("ingestion:sheetCompanies", { tab: "review", onlyToCheck }, [CEDARLINE, HALDEN]);
  }
  __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("final_pd"), FINAL_PDS);
  __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("supporting"), SUPPORTING);
  __setQueryData("ingestion:writerChoices", { members: [], pastWriters: [] });
}

async function mount(width = 1280) {
  await page.viewport(width, 900);
  await render(ToastHarness);
  await render(ImportPage);
  await expect.element(page.getByRole("button", { name: "Cedarline Systems" })).toBeVisible();
}

async function openCedarline() {
  await userEvent.click(page.getByRole("button", { name: "Cedarline Systems" }));
  await expect.poll(() => all("[data-import-file]").length).toBe(4);
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

describe("Approve N ready on a company", () => {
  it("shows Approve N ready in place of N ready, confirms what Approve does, and starts it", async () => {
    seedPage();
    __setMutationHandler("ingestion:approveCompanyReady", () => ({ approvalId: "ap1", ready: 176 }));
    await mount();
    const band = one('[data-import-band="cedarline systems"]')!;
    // "Approve 176 ready" where "176 ready" was.
    expect([...one("[data-import-band-status]", band)!.children].map((node) => text(node))).toEqual(["1 being read", "Approve 176 ready", "2 to check"]);
    await userEvent.click(page.getByRole("button", { name: "Approve 176 ready" }));
    const confirm = one("[data-import-approve-confirm]")!;
    await expect.element(page.getByText("Approve 176 files of Cedarline Systems?")).toBeVisible();
    expect(text(confirm)).toContain("Each file goes on its company's page.");
    expect(text(confirm)).toContain("Final PDs then wait in Brain check, where a person reads each Brain copy before it is added.");
    expect(text(confirm)).toContain("Files that still need a check stay on To review.");
    expect(one("[data-import-approve-new-company]", confirm)).toBeNull();
    // Nothing happens until the person confirms.
    expect(__mutationCalls("ingestion:approveCompanyReady")).toEqual([]);
    await userEvent.click(page.getByRole("button", { name: "Approve 176 files" }));
    expect(__mutationCalls("ingestion:approveCompanyReady")).toEqual([{ companyKey: "cedarline systems" }]);
    await expect.element(page.getByText("Approving 176 files of Cedarline Systems")).toBeVisible();
    await expect.poll(() => one("[data-import-approve-confirm]")).toBeNull();
  });

  it("says a new company is added with the industry picked, or that its final PDs wait for one", async () => {
    seedPage();
    __setPaginatedRowsForArgs("ingestion:sheetCompanies", { tab: "review", onlyToCheck: false }, [
      CEDARLINE,
      { ...HALDEN, pickedIndustry: "food_beverage" },
    ]);
    await mount();
    await userEvent.click(page.getByRole("button", { name: "Approve 12 ready" }));
    const note = () => text(one("[data-import-approve-new-company]"));
    await expect.poll(note).toMatch(/^Halden Foods is new\. Approve adds it with the industry .+\.$/);
    await userEvent.keyboard("{Escape}");

    __setPaginatedRowsForArgs("ingestion:sheetCompanies", { tab: "review", onlyToCheck: false }, [CEDARLINE, HALDEN]);
    await expect.poll(() => one('[data-import-band="halden foods"] [data-import-band-industry-pick]')).not.toBeNull();
    await userEvent.click(page.getByRole("button", { name: "Approve 12 ready" }));
    await expect.poll(note).toBe("Halden Foods is new and has no industry yet. Its final PDs stay on To review until you pick one.");
    expect(one("[data-import-approve-new-company]")!.className).toContain("text-gap-text");
  });

  it("says where a merged company's files go instead of offering to approve them", async () => {
    seedPage();
    __setPaginatedRowsForArgs("ingestion:sheetCompanies", { tab: "review", onlyToCheck: false }, [
      { ...CEDARLINE, displayName: "Cedarline Labs", companyKey: "cedarline labs", company: { via: "merge", clientId: "c1", name: "Cedarline Systems" } },
    ]);
    await page.viewport(1280, 900);
    await render(ImportPage);
    await userEvent.click(page.getByRole("button", { name: "Approve 176 ready" }));
    await expect.poll(() => text(one("[data-import-approve-merged]"))).toBe(
      "Cedarline Labs was merged into Cedarline Systems. Move these files to Cedarline Systems first, then approve them there."
    );
    expect(one("[data-import-approve-go]")).toBeNull();
  });

  it("shows a refusal from the server in plain words", async () => {
    seedPage();
    __setMutationHandler("ingestion:approveCompanyReady", () => {
      throw { data: { message: "This company has no files ready to approve." } };
    });
    await mount();
    await userEvent.click(page.getByRole("button", { name: "Approve 176 ready" }));
    await userEvent.click(page.getByRole("button", { name: "Approve 176 files" }));
    await expect.element(page.getByText("This company has no files ready to approve.")).toBeVisible();
  });
});

describe("Approve in the selection bar", () => {
  it("leaves out files being read or still to check, and sends the rest", async () => {
    seedPage();
    __setMutationHandler("ingestion:approveFiles", (args) => ({ approvalId: "ap2", added: (args as { ids: string[] }).ids.length }));
    await mount();
    await userEvent.click(page.getByRole("button", { name: "Select", exact: true }));
    await openCedarline();
    await userEvent.click(one('[data-import-section-select="final_pd"]')!);
    await expect.poll(() => text(one("[data-import-bar-count]"))).toBe("4 files selected");
    await userEvent.click(one("[data-import-bar-approve]")!);
    const confirm = one("[data-import-bar-approve-confirm]")!;
    await expect.poll(() => text(one("[data-import-approve-left-out]", confirm))).toBe(
      "1 file was left out: it still needs a check. 1 file was left out: it is still being read."
    );
    expect(__mutationCalls("ingestion:approveFiles")).toEqual([]);
    await userEvent.click(page.getByRole("button", { name: "Approve 2 files" }));
    expect(__mutationCalls("ingestion:approveFiles")).toEqual([{ ids: ["pd1", "pd2"] }]);
    await expect.element(page.getByText("Approving 2 files")).toBeVisible();
    await expect.poll(() => one("[data-import-selection-bar]")).toBeNull();
  });

  it("sends more than 100 files in parts of 100 into one approval", async () => {
    seedPage();
    __setMutationHandler("ingestion:approveFiles", (args) => ({ approvalId: "ap3", added: (args as { ids: string[] }).ids.length }));
    await mount();
    await userEvent.click(page.getByRole("button", { name: "Select", exact: true }));
    await userEvent.click(page.getByRole("button", { name: "Cedarline Systems" }));
    await userEvent.click(page.getByRole("button", { name: /Supporting files/ }));
    await expect.poll(() => all('[data-import-file-category="supporting"]').length).toBe(130);
    await userEvent.click(one('[data-import-section-select="supporting"]')!);
    await expect.poll(() => text(one("[data-import-bar-count]"))).toBe("130 files selected");
    await userEvent.click(one("[data-import-bar-approve]")!);
    await userEvent.click(page.getByRole("button", { name: "Approve 130 files" }));
    const calls = __mutationCalls("ingestion:approveFiles") as { ids: string[]; approvalId?: string }[];
    expect(calls.map((call) => [call.ids.length, call.approvalId])).toEqual([
      [100, undefined],
      [30, "ap3"],
    ]);
  });
});

describe("the approval line", () => {
  const progress = (extra: Record<string, unknown>) => ({
    approvalId: "ap1",
    scope: "company",
    companyName: "Cedarline Systems",
    status: "running",
    lastProgressAt: Date.now(),
    total: 176,
    done: 40,
    approved: 40,
    refused: 0,
    startedAt: 1,
    mine: true,
    ...extra,
  });

  it("shows how far a running approval is, with a bar", async () => {
    seedPage();
    __setQueryData("ingestion:approvalProgress", [progress({})]);
    await mount();
    await expect.poll(() => text(one("[data-import-approval-text]"))).toBe("Approving files of Cedarline Systems: 40 of 176 done.");
    const bar = page.getByRole("progressbar", { name: "Files approved" });
    await expect.element(bar).toHaveAttribute("aria-valuenow", "40");
    await expect.element(bar).toHaveAttribute("aria-valuemax", "176");
    expect(one("[data-import-approval-dismiss]")).toBeNull();
  });

  it("says what a finished approval did, lists why files were left, and closes", async () => {
    seedPage();
    __setQueryData("ingestion:approvalProgress", [progress({ status: "done", done: 176, approved: 173, refused: 3 })]);
    __setQueryDataForArgs("ingestion:approvalRefusals", { approvalId: "ap1" }, {
      files: [
        { itemId: "x1", name: "05 Cedarline Second.docx", reason: "needs_check" },
        { itemId: "x2", name: "06 Cedarline Third.docx", reason: "needs_check" },
        { itemId: "x3", name: "Brightwell notes.docx", reason: "company_merged", detail: "Merged into Brightwell Farms" },
      ],
      more: false,
    });
    __setMutationHandler("ingestion:dismissApproval", () => null);
    await mount();
    await expect.poll(() => text(one("[data-import-approval-text]"))).toBe("Approved 173 files of Cedarline Systems. 3 were left on To review.");
    expect(all('[role="progressbar"]')).toHaveLength(0);
    await userEvent.click(page.getByRole("button", { name: "Show why" }));
    const list = one("[data-import-approval-refusals]")!;
    await expect.poll(() => text(list)).toContain("2 files still need a check. 1 file belongs to a company that was merged into another one.");
    expect(text(list)).toContain("It belongs to a company that was merged into another one. Merged into Brightwell Farms.");
    await userEvent.keyboard("{Escape}");
    await userEvent.click(page.getByRole("button", { name: "Close this line" }));
    expect(__mutationCalls("ingestion:dismissApproval")).toEqual([{ approvalId: "ap1" }]);
  });

  it("shows another Admin's running approval beside one's own finished one, which only its starter closes", async () => {
    seedPage();
    __setQueryData("ingestion:approvalProgress", [
      progress({ approvalId: "ap9", mine: false, startedByName: "Robin Sample", companyName: "Halden Foods", done: 3, total: 12 }),
      progress({ status: "done", done: 176, approved: 176 }),
    ]);
    await mount();
    await expect.poll(() => all("[data-import-approval-text]").map((node) => text(node))).toEqual([
      "Robin Sample is approving files of Halden Foods: 3 of 12 done.",
      "Approved 176 files of Cedarline Systems.",
    ]);
    expect(all("[data-import-approval-dismiss]")).toHaveLength(1);
    expect(one('[data-import-approval="ap9"] [data-import-approval-dismiss]')).toBeNull();
  });

  it("says who is already approving a company when another Admin presses it again", async () => {
    seedPage();
    __setMutationHandler("ingestion:approveCompanyReady", () => ({ approvalId: "ap9", ready: 176, alreadyRunningBy: "Robin Sample" }));
    await mount();
    await userEvent.click(page.getByRole("button", { name: "Approve 176 ready" }));
    await userEvent.click(page.getByRole("button", { name: "Approve 176 files" }));
    await expect.element(page.getByText("Robin Sample is already approving these files. The line under the toolbar shows how far it is.")).toBeVisible();
  });

  it("says when an approval stopped", async () => {
    seedPage();
    __setQueryData("ingestion:approvalProgress", [progress({ lastProgressAt: Date.now() - 5 * 60_000 })]);
    await mount();
    await expect.poll(() => text(one("[data-import-approval-text]"))).toBe("This approval stopped after 40 of 176 files. Approve again to go on.");
    expect(all('[role="progressbar"]')).toHaveLength(0);
  });

  it("says a running approval stopped once its chain has not moved for five minutes, on an open page", async () => {
    const T = Date.UTC(2026, 10, 17, 15);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(T);
    try {
      // The query gives the same answer all along: nothing moves the line but the page's clock.
      await render(ImportApprovalRun, { progress: progress({ lastProgressAt: T - 60_000 }) as never });
      await expect.poll(() => text(one("[data-import-approval-text]"))).toBe("Approving files of Cedarline Systems: 40 of 176 done.");
      vi.advanceTimersByTime(4 * 60_000 - 1);
      await Promise.resolve();
      expect(text(one("[data-import-approval-text]"))).toBe("Approving files of Cedarline Systems: 40 of 176 done.");
      expect(all('[role="progressbar"]')).toHaveLength(1);
      vi.advanceTimersByTime(1);
      await expect.poll(() => text(one("[data-import-approval-text]"))).toBe("This approval stopped after 40 of 176 files. Approve again to go on.");
      expect(all('[role="progressbar"]')).toHaveLength(0);
      // Stopped, its starter may close the line.
      expect(one("[data-import-approval-dismiss]")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the Brain check", () => {
  const WAITING = [
    { _id: "b1", name: "04 Cedarline 2025-03-31 S1.DW Route planning engine.docx", companyKey: "cedarline systems", companyName: "Cedarline Systems", fiscalYear: 2025, pdNumber: "4", pdTitle: "Route planning engine", versionCode: "S", versionNumber: 1, writerName: "Dana Whitlock", scienceCode: "2.02.09" },
    { _id: "b2", name: "02 Halden 2024-12-31 S1.PN Proofing.docx", companyKey: "halden foods", companyName: "Halden Foods", fiscalYear: 2024, pdNumber: "2", pdTitle: "Proofing", writerName: "Priya Nair" },
  ];
  const NOT_COVERED = "The check looks for the company's names. It does not find product names. Read the copy and add any of them to Also remove.";
  const COPY = {
    ok: true,
    content: "[redacted] built a route planner for [redacted] depots.\nThe KelpTrack app sent readings from [redacted address].",
    title: "Past PD, FY2025",
    industry: "software",
    writerName: "Dana Whitlock",
    warnings: ['"Route" still appears capitalized. If it means the company, add it to Also remove.'],
    notCovered: NOT_COVERED,
    seen: "seen-1",
  };

  async function openBrainCheck(width = 1280) {
    seedPage();
    __setPaginatedRows("ingestion:brainCheckFiles", WAITING);
    await mount(width);
    const tab = page.getByRole("tab", { name: "Brain check 2" });
    await expect.element(tab).toBeVisible();
    await userEvent.click(tab);
  }

  it("sits after Approved with its count, and shows one PD's scrubbed copy, its warnings and what the check does not cover", async () => {
    __setMutationHandler("ingestion:previewBrainCopy", () => COPY);
    await openBrainCheck();
    expect(all('[role="tab"]').map((tab) => text(tab))).toEqual(["To review 191", "Approved 40", "Brain check 2", "Deleted 3", "History"]);
    await expect.poll(() => text(one("[data-import-brain-copy]"))).toBe(COPY.content.replace(/\s+/g, " "));
    expect(__mutationCalls("ingestion:previewBrainCopy")).toEqual([{ itemId: "b1", alsoRemove: [] }]);
    expect(all("[data-import-brain-redacted]").map((node) => node.textContent)).toEqual(["[redacted]", "[redacted]", "[redacted address]"]);
    expect(text(one("[data-import-brain-company]"))).toBe("Cedarline Systems");
    expect(text(one("[data-import-brain-title]"))).toBe("PD 4 Route planning engine");
    expect(text(one("[data-import-brain-details]"))).toBe("FY2025 · S1 · Dana Whitlock · 2.02.09");
    expect(text(one("[data-import-brain-position]"))).toBe("1 of 2");
    expect(text(one("[data-import-brain-warnings]"))).toContain(COPY.warnings[0]);
    expect(text(one("[data-import-brain-not-covered]"))).toBe(NOT_COVERED);
  });

  it("reads the copy again with Also remove words before it can be added, then adds the copy read", async () => {
    __setMutationHandler("ingestion:previewBrainCopy", (args) => {
      const words = (args as { alsoRemove: string[] }).alsoRemove;
      return words.length > 0 ? { ...COPY, content: COPY.content.replace("KelpTrack", "[redacted]"), seen: "seen-2" } : COPY;
    });
    __setMutationHandler("ingestion:addToBrain", () => ({ ok: true, outcome: "added", sourceId: "s1" }));
    await openBrainCheck();
    await expect.poll(() => one("[data-import-brain-copy]")).not.toBeNull();
    await userEvent.fill(page.getByLabelText("Also remove"), "KelpTrack, Mill Road site");
    await userEvent.click(page.getByRole("button", { name: "Add", exact: true }));
    expect(all("[data-import-brain-words] li").map((node) => text(node))).toEqual(["KelpTrack", "Mill Road site"]);
    // The copy on screen was read without them: Add waits for Check again.
    await expect.element(page.getByRole("button", { name: "Add to the Brain" })).toBeDisabled();
    await userEvent.click(page.getByRole("button", { name: "Do not remove Mill Road site" }));
    await userEvent.click(page.getByRole("button", { name: "Check again" }));
    await expect.poll(() => text(one("[data-import-brain-copy]"))).not.toContain("KelpTrack");
    expect(__mutationCalls("ingestion:previewBrainCopy").at(-1)).toEqual({ itemId: "b1", alsoRemove: ["KelpTrack"] });
    await userEvent.click(page.getByRole("button", { name: "Add to the Brain" }));
    expect(__mutationCalls("ingestion:addToBrain")).toEqual([{ itemId: "b1", alsoRemove: ["KelpTrack"], seen: "seen-2" }]);
    await expect.element(page.getByText("Added to the Brain")).toBeVisible();
  });

  it("offers Check again when Add is refused because the copy changed, and adds the copy read again", async () => {
    let reads = 0;
    __setMutationHandler("ingestion:previewBrainCopy", () => {
      reads += 1;
      return reads === 1 ? COPY : { ...COPY, writerName: "Dana Whitlock-Reyes", seen: "seen-3" };
    });
    __setMutationHandler("ingestion:addToBrain", (args) =>
      (args as { seen: string }).seen === "seen-3"
        ? { ok: true, outcome: "added", sourceId: "s1" }
        : { ok: false, changed: true, reason: "The Brain copy changed since you read it. Read it again, then add it." }
    );
    await openBrainCheck();
    await expect.poll(() => one("[data-import-brain-copy]")).not.toBeNull();
    expect(one("[data-import-brain-check-again]")).toBeNull();
    await userEvent.click(page.getByRole("button", { name: "Add to the Brain" }));
    await expect.element(page.getByText("The Brain copy changed since you read it. Read it again, then add it.")).toBeVisible();
    // No Also remove change, yet Check again is offered, and Add waits for it.
    await expect.element(page.getByRole("button", { name: "Check again" })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Add to the Brain" })).toBeDisabled();
    expect(text(one("[data-import-brain-changed]"))).toBe("The Brain copy changed since you read it. Check again to read it as it is now.");
    await userEvent.click(page.getByRole("button", { name: "Check again" }));
    await expect.poll(() => one("[data-import-brain-check-again]")).toBeNull();
    expect(__mutationCalls("ingestion:previewBrainCopy")).toEqual([
      { itemId: "b1", alsoRemove: [] },
      { itemId: "b1", alsoRemove: [] },
    ]);
    expect(one("[data-import-brain-changed]")).toBeNull();
    await expect.element(page.getByRole("button", { name: "Add to the Brain" })).toBeEnabled();
    await userEvent.click(page.getByRole("button", { name: "Add to the Brain" }));
    expect(__mutationCalls("ingestion:addToBrain").map((call) => (call as { seen: string }).seen)).toEqual(["seen-1", "seen-3"]);
    await expect.element(page.getByText("Added to the Brain")).toBeVisible();
  });

  it("offers Add to the Brain only once the whole copy has been shown", async () => {
    const long = `${"[redacted] built a route planner. ".repeat(1_000)}The last line.`;
    __setMutationHandler("ingestion:previewBrainCopy", () => ({ ...COPY, content: long }));
    await openBrainCheck();
    await expect.poll(() => one("[data-import-brain-copy]")).not.toBeNull();
    await expect.element(page.getByRole("button", { name: "Add to the Brain" })).toBeDisabled();
    expect(text(one("[data-import-brain-read-whole]"))).toBe("Show the whole copy before you add it.");
    expect(text(one("[data-import-brain-copy]"))).not.toContain("The last line.");
    await userEvent.click(one("[data-import-brain-more]")!);
    await expect.poll(() => text(one("[data-import-brain-copy]")).endsWith("The last line.")).toBe(true);
    await expect.element(page.getByRole("button", { name: "Add to the Brain" })).toBeEnabled();
    expect(one("[data-import-brain-read-whole]")).toBeNull();
  });

  it("keeps a PD out of the Brain, and moves on to the next", async () => {
    __setMutationHandler("ingestion:previewBrainCopy", () => COPY);
    __setMutationHandler("ingestion:keepOutOfBrain", () => {
      __setPaginatedRows("ingestion:brainCheckFiles", WAITING.slice(1));
      return null;
    });
    await openBrainCheck();
    await expect.poll(() => one("[data-import-brain-copy]")).not.toBeNull();
    await userEvent.click(page.getByRole("button", { name: "Keep out of the Brain" }));
    expect(__mutationCalls("ingestion:keepOutOfBrain")).toEqual([{ itemId: "b1" }]);
    await expect.poll(() => text(one("[data-import-brain-company]"))).toBe("Halden Foods");
    expect(__mutationCalls("ingestion:previewBrainCopy").at(-1)).toEqual({ itemId: "b2", alsoRemove: [] });
  });

  it("shows why no copy can be made, with only Keep out, and says when nothing waits", async () => {
    __setMutationHandler("ingestion:previewBrainCopy", () => ({
      ok: false,
      code: "names_left",
      reason: 'The Brain copy would still name the company ("cedarline"), so it was not made. The final PD still goes on the company\'s page.',
      notCovered: NOT_COVERED,
    }));
    await openBrainCheck();
    await expect.poll(() => text(one("[data-import-brain-refusal]"))).toContain("would still name the company");
    expect(one("[data-import-brain-add]")).toBeNull();
    await expect.element(page.getByRole("button", { name: "Keep out of the Brain" })).toBeEnabled();
    __setPaginatedRows("ingestion:brainCheckFiles", []);
    await expect.poll(() => text(one("[data-import-brain-empty]"))).toBe("No final PDs are waiting for a Brain check.");
  });
});

describe("the file view", () => {
  const FILE = {
    ...FINAL_PDS[0],
    sheetTab: "review",
    companyKey: "cedarline systems",
    clientName: "Cedarline Systems",
    path: "Cedarline Systems/2025 - Mar 31/Submitted/pd1.docx",
    docKind: "pd",
    addedAt: Date.UTC(2026, 10, 12),
    addedVia: "onedrive_sync",
    lastModifiedAt: 1,
    hasText: true,
    hasOriginal: true,
    reviewerInitials: "PN",
    name: "01 Cedarline 2025-03-31 T2.DW.PN Route planning engine.docx",
  };
  const page1 = "Route planning engine.\n".repeat(900);

  it("opens from a file's name with its labels and its text, a page at a time", async () => {
    seedPage();
    __setQueryDataForArgs("ingestion:sheetFile", { id: "pd1" }, FILE);
    __setMutationHandler("ingestion:sheetFileText", (args) => {
      const start = (args as { start?: number }).start ?? 0;
      return { text: start === 0 ? page1 : "The end.", start, end: start + 100, total: page1.length + 8, source: "full", cutAtImport: false };
    });
    await mount();
    await openCedarline();
    await userEvent.click(one('[data-import-file-open="pd1"]')!);
    const panel = page.getByRole("dialog");
    await expect.element(panel).toBeVisible();
    expect(text(one("[data-import-file-panel-title]"))).toBe("PD 1 Route planning engine");
    const label = (name: string) => text(one(`[data-import-file-panel-label="${name}"]`));
    expect(label("Company")).toBe("Cedarline Systems");
    expect(label("Kind")).toBe("Final PD");
    expect(label("Where")).toBe("To review");
    expect(label("Version")).toBe("T2");
    expect(label("Writer")).toBe("Dana Whitlock");
    expect(label("Reviewer initials")).toBe("PN");
    expect(label("Path")).toBe(FILE.path);
    await expect.poll(() => one("[data-import-file-panel-text]")?.textContent?.length ?? 0).toBe(page1.length);
    expect(text(one("[data-import-file-panel-text-note]"))).toBe(`Showing ${page1.length.toLocaleString("en-US")} of ${(page1.length + 8).toLocaleString("en-US")} characters.`);
    expect(__mutationCalls("ingestion:sheetFileText")).toEqual([{ id: "pd1", start: 0 }]);
    await userEvent.click(page.getByRole("button", { name: "Show more" }));
    await expect.poll(() => one("[data-import-file-panel-text]")?.textContent?.endsWith("The end.")).toBe(true);
    expect(__mutationCalls("ingestion:sheetFileText").at(-1)).toEqual({ id: "pd1", start: page1.length });
    expect(one("[data-import-file-panel-more]")).toBeNull();
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => one("[data-import-file-panel]")).toBeNull();
  });

  it("drops a page asked for before the panel closed, so a reopened file never skips a page (Greptile, 2026-11-19)", async () => {
    seedPage();
    __setQueryDataForArgs("ingestion:sheetFile", { id: "pd1" }, FILE);
    const size = page1.length;
    let releaseThird: (() => void) | null = null;
    __setMutationHandler("ingestion:sheetFileText", (args) => {
      const start = (args as { start?: number }).start ?? 0;
      const answer = { text: start === 0 ? page1 : start === size ? "B".repeat(size) : "C".repeat(size), start, end: start + size, total: size * 4, source: "full", cutAtImport: false };
      if (start !== size * 2) return answer;
      // The third page waits until the test lets it through.
      return new Promise((resolvePage) => {
        releaseThird = () => resolvePage(answer);
      });
    });
    await mount();
    await openCedarline();
    await userEvent.click(one('[data-import-file-open="pd1"]')!);
    await expect.poll(() => one("[data-import-file-panel-text]")?.textContent?.length ?? 0).toBe(size);
    await userEvent.click(page.getByRole("button", { name: "Show more" }));
    await expect.poll(() => one("[data-import-file-panel-text]")?.textContent?.length ?? 0).toBe(size * 2);
    await userEvent.click(page.getByRole("button", { name: "Show more" }));
    await expect.poll(() => releaseThird !== null).toBe(true);
    // Closed while the third page loads, then the same file opened again.
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => one("[data-import-file-panel]")).toBeNull();
    await userEvent.click(one('[data-import-file-open="pd1"]')!);
    await expect.poll(() => one("[data-import-file-panel-text]")?.textContent?.length ?? 0).toBe(size);
    releaseThird!();
    await new Promise((settle) => setTimeout(settle, 50));
    const shown = one("[data-import-file-panel-text]")?.textContent ?? "";
    expect(shown.length).toBe(size);
    expect(shown.includes("C")).toBe(false);
    // Show more goes on from where the text ends: the second page.
    await userEvent.click(page.getByRole("button", { name: "Show more" }));
    expect(__mutationCalls("ingestion:sheetFileText").at(-1)).toEqual({ id: "pd1", start: size });
    await expect.poll(() => one("[data-import-file-panel-text]")?.textContent?.endsWith("B")).toBe(true);
  });

  it("opens from Open in a row's menu, and lists what a file still needs", async () => {
    seedPage();
    __setQueryDataForArgs("ingestion:sheetFile", { id: "pd3" }, { ...FILE, ...FINAL_PDS[2], name: "pd3.docx" });
    __setMutationHandler("ingestion:sheetFileText", () => ({ text: "", start: 0, end: 0, total: 0, source: "none", cutAtImport: false }));
    await mount();
    await openCedarline();
    await userEvent.click(page.getByRole("button", { name: "More for PD 3 Label vision check" }));
    await userEvent.click(page.getByRole("menuitem", { name: "Open" }));
    await expect.element(page.getByRole("dialog")).toBeVisible();
    await expect.poll(() => text(one("[data-import-file-panel-checks]"))).toBe("Needs a writer");
    await expect.poll(() => text(one("[data-import-file-panel-no-text]"))).toBe("No text could be read from this file.");
  });
});

describe("the Approved tab", () => {
  const APPROVED = [
    row("a1", { status: "approved", pdNumber: "1", pdTitle: "Route planning engine", brain: "in_brain", companyPage: { key: "cedarline systems", name: "Cedarline Systems" } }),
    row("a2", { status: "approved", pdNumber: "2", pdTitle: "Yard map solver", brain: "brain_check", companyPage: { key: "cedarline systems", name: "Cedarline Systems" } }),
    row("a3", { status: "approved", pdNumber: "3", pdTitle: "Label vision check", brain: "kept_out", companyPage: { key: "cedarline systems", name: "Cedarline Systems" } }),
    row("a4", { status: "approved", pdNumber: "4", pdTitle: "Shelf gap finder", brain: "removed" }),
  ];

  it("shows what each approved file became, and links to its company page", async () => {
    seedPage();
    __setPaginatedRowsForArgs("ingestion:sheetCompanies", { tab: "approved", onlyToCheck: false }, [
      { ...CEDARLINE, total: 4, needsCheck: 0, ready: 4, beingRead: 0, brainCheck: 1, categories: { final_pd: { total: 4, needsCheck: 0, fiscalYears: { "2025": 4 } } } },
    ]);
    __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("final_pd", "approved"), APPROVED);
    await mount();
    await userEvent.click(page.getByRole("tab", { name: /^Approved/ }));
    await expect.poll(() => text(one('[data-import-band="cedarline systems"] [data-import-band-status]'))).toBe("1 for Brain check");
    expect(one("[data-import-band-approve]")).toBeNull();
    await userEvent.click(page.getByRole("button", { name: "Cedarline Systems" }));
    await expect.poll(() => all("[data-import-file]").length).toBe(4);
    expect(all("[data-import-file-brain]").map((node) => node.getAttribute("aria-label"))).toEqual([
      "In the Brain",
      "Waiting for its Brain check",
      "Kept out of the Brain",
      "Removed from the Brain",
    ]);
    // A fixed 20px slot: each name shows whole, or keeps all its line but the
    // slot and its gap (the File column shares the sheet with Reviewer).
    for (const id of ["a1", "a2", "a3", "a4"]) {
      const title = one(`[data-import-file="${id}"] [data-import-file-title]`)!;
      if (title.scrollWidth <= title.clientWidth + 1) continue;
      const line = title.parentElement!.getBoundingClientRect().width;
      expect(title.getBoundingClientRect().width, id).toBeGreaterThanOrEqual(line - 28 - 1);
    }
    const links = all("[data-import-file-company-page]");
    expect(links).toHaveLength(3);
    expect(links[0].getAttribute("href")).toMatch(/\/companies\/cedarline(%20| )systems$/);
    expect(links[0].getAttribute("aria-label")).toBe("Open Cedarline Systems's company page");
    expect(one('[data-import-file="a4"] [data-import-file-no-company-page]')!.getAttribute("aria-label")).toBe("Not on a company page");
    // The row's cells stay inside the sheet.
    for (const node of all("[data-import-file-company-page], [data-import-file-no-company-page]")) {
      const cell = node.closest('[data-import-cell="science-code"]')!;
      expect(node.getBoundingClientRect().right).toBeLessThanOrEqual(cell.getBoundingClientRect().right + 0.5);
    }
    // Since 2026-11-17 (edit after approval) each row has its own menu, but
    // never the year end, version, move or delete of To review.
    expect(all("[data-import-file] [data-import-approved-menu]")).toHaveLength(4);
    expect(all('[data-import-file] [data-import-year-edit], [data-import-file] [data-import-version-edit], [data-import-row-action="delete"]')).toHaveLength(0);
  });
});

describe("captures (2026-11-17, Approve on Import)", () => {
  for (const width of [1280, 1100]) {
    it(`captures the Approve confirm, the bar, the line, the Brain check, the file view and Approved at ${width}`, async () => {
      seedPage();
      __setQueryData("ingestion:approvalProgress", [
        {
          approvalId: "ap1",
          scope: "company",
          companyName: "Cedarline Systems",
          status: "running",
          lastProgressAt: Date.now(),
          total: 176,
          done: 40,
          approved: 40,
          refused: 0,
          startedAt: 1,
          mine: true,
        },
      ]);
      await mount(width);
      await openCedarline();
      await userEvent.click(page.getByRole("button", { name: "Approve 176 ready" }));
      await expect.element(page.getByText("Approve 176 files of Cedarline Systems?")).toBeVisible();
      for (const node of all("[data-import-approve-confirm]")) expect(node.getBoundingClientRect().right).toBeLessThanOrEqual(width);
      await page.screenshot({ path: `${CAPTURES}/approve-confirm-${width}.png` });
      await userEvent.keyboard("{Escape}");

      await userEvent.click(page.getByRole("button", { name: "Select", exact: true }));
      await userEvent.click(one('[data-import-section-select="final_pd"]')!);
      await userEvent.click(one("[data-import-bar-approve]")!);
      await expect.poll(() => one("[data-import-bar-approve-confirm]")).not.toBeNull();
      await page.screenshot({ path: `${CAPTURES}/approve-bar-${width}.png` });
      await userEvent.keyboard("{Escape}");
      await userEvent.click(page.getByRole("button", { name: "Clear selection" }));

      __setQueryDataForArgs("ingestion:sheetFile", { id: "pd1" }, {
        ...FINAL_PDS[0],
        sheetTab: "review",
        companyKey: "cedarline systems",
        clientName: "Cedarline Systems",
        path: "Cedarline Systems/2025 - Mar 31/Submitted/01 Cedarline 2025-03-31 T2.DW.PN Route planning engine.docx",
        docKind: "pd",
        addedAt: Date.UTC(2026, 10, 12),
        addedVia: "onedrive_sync",
        lastModifiedAt: 1,
        hasText: true,
        hasOriginal: true,
        reviewerInitials: "PN",
        name: "01 Cedarline 2025-03-31 T2.DW.PN Route planning engine.docx",
      });
      __setMutationHandler("ingestion:sheetFileText", () => ({
        text: "Project description\n\nCedarline Systems set out to plan delivery routes that adapt to freezer loads.\n\nLine 242: The team did not know whether...\n".repeat(20),
        start: 0,
        end: 20_000,
        total: 48_210,
        source: "full",
        cutAtImport: false,
      }));
      await userEvent.click(one('[data-import-file-open="pd1"]')!);
      await expect.poll(() => one("[data-import-file-panel-text]")).not.toBeNull();
      // After the dialog's fade (300ms, layout.css).
      await expect.poll(() => getComputedStyle(one("[data-import-file-panel]")!).opacity).toBe("1");
      await page.screenshot({ path: `${CAPTURES}/file-view-${width}.png` });
      await userEvent.keyboard("{Escape}");
      await expect.poll(() => one("[data-import-file-panel]")).toBeNull();

      __setPaginatedRows("ingestion:brainCheckFiles", [
        { _id: "b1", name: "04 Cedarline 2025-03-31 S1.DW Route planning engine.docx", companyKey: "cedarline systems", companyName: "Cedarline Systems", fiscalYear: 2025, pdNumber: "4", pdTitle: "Route planning engine", versionCode: "S", versionNumber: 1, writerName: "Dana Whitlock", scienceCode: "2.02.09" },
      ]);
      __setMutationHandler("ingestion:previewBrainCopy", () => ({
        ok: true,
        content:
          "Project description\n\n[redacted] set out to plan delivery routes that adapt to freezer loads at its [redacted] depots. The planner reads readings from the KelpTrack app every five minutes.\n\nLine 242: The team did not know whether a route solver could re-plan within 30 seconds when a freezer failed mid-route, given [redacted]'s 400 stops a day.\n\nPrepared by [redacted]. Contact: [redacted] at [redacted address].\n".repeat(3),
        title: "Past PD, FY2025",
        industry: "software",
        writerName: "Dana Whitlock",
        warnings: ['"Route" still appears capitalized. If it means the company, add it to Also remove.'],
        notCovered:
          "The check looks for the company's names and their distinctive words, initials, short forms the PD defines, the website, Business Numbers, addresses with a postal code, and people named next to a title, a role or a cue. It does not find product names, nicknames, places, or people named without a title or role. Read the copy and add any of them to Also remove.",
        seen: "seen-1",
      }));
      await userEvent.click(page.getByRole("tab", { name: /^Brain check/ }));
      await expect.poll(() => one("[data-import-brain-copy]")).not.toBeNull();
      await userEvent.fill(page.getByLabelText("Also remove"), "KelpTrack");
      await userEvent.click(page.getByRole("button", { name: "Add", exact: true }));
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      await page.screenshot({ path: `${CAPTURES}/brain-check-${width}.png` });

      __setPaginatedRowsForArgs("ingestion:sheetCompanies", { tab: "approved", onlyToCheck: false }, [
        { ...CEDARLINE, total: 4, needsCheck: 0, ready: 4, beingRead: 0, brainCheck: 1, categories: { final_pd: { total: 4, needsCheck: 0, fiscalYears: { "2025": 4 } } } },
      ]);
      __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("final_pd", "approved"), [
        row("a1", { status: "approved", pdNumber: "1", pdTitle: "Route planning engine", writerName: "Dana Whitlock", scienceCode: "2.02.09", versionCode: "S", versionNumber: 1, brain: "in_brain", companyPage: { key: "cedarline systems", name: "Cedarline Systems" } }),
        row("a2", { status: "approved", pdNumber: "2", pdTitle: "Yard map solver", writerName: "Priya Nair", scienceCode: "2.02.09", versionCode: "S", versionNumber: 1, brain: "brain_check", companyPage: { key: "cedarline systems", name: "Cedarline Systems" } }),
        row("a3", { status: "approved", pdNumber: "3", pdTitle: "Label vision check", writerName: "Sam Okafor", scienceCode: "2.02.09", versionCode: "S", versionNumber: 2, brain: "kept_out", companyPage: { key: "cedarline systems", name: "Cedarline Systems" } }),
        row("a4", { status: "approved", pdNumber: "4", pdTitle: "Shelf gap finder", writerName: "Dana Whitlock", scienceCode: "2.02.09", versionCode: "S", versionNumber: 1, brain: "removed" }),
      ]);
      await userEvent.click(page.getByRole("tab", { name: /^Approved/ }));
      await userEvent.click(page.getByRole("button", { name: "Cedarline Systems" }));
      await expect.poll(() => all("[data-import-file-brain]").length).toBe(4);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      await page.screenshot({ path: `${CAPTURES}/approved-tab-${width}.png` });
      await page.viewport(1280, 800);
    });
  }
});
