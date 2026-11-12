import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import ToastHarness from "$lib/test/ToastHarness.svelte";
import ImportPage from "./ImportPage.svelte";
import { importUploads } from "./importUploads.svelte";
import {
  __activeQueryArgs,
  __clientQueryCalls,
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
 * Adding files on the Import page (2026-11-12) against the approved drawing:
 * Files 1 (dropping a folder: the dashed outline and the dark bar, the top
 * bar's "Get the uploader" and "Add files", the History tab), Files 2 (just
 * added: the New filter, the status line, "N new", the New labels, Not
 * sorted yet and the closing line) and Files 3 (another person uploading).
 * Made-up companies and people. Captures go to .vitest-attachments/import-intake/.
 */
const CAPTURES = "../../../../.vitest-attachments/import-intake";
const text = (node: Element | null | undefined) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();
const one = (selector: string, root: ParentNode = document) => root.querySelector<HTMLElement>(selector);
const all = (selector: string, root: ParentNode = document) => [...root.querySelectorAll<HTMLElement>(selector)];
const box = (node: Element) => node.getBoundingClientRect();
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const MAR_31_2025 = Date.UTC(2025, 2, 31);
const MAR_31_2024 = Date.UTC(2024, 2, 31);

const totals = (files: number, companies: number, needsCheck = 0, newFiles = 0, beingRead = 0) => ({
  files,
  companies,
  needsCheck,
  ready: files - needsCheck - beingRead,
  beingRead,
  newFiles,
  complete: true,
});

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

// ─── Files 1: the page as it was before the drop ────────────────────────────
const CEDARLINE = {
  companyKey: "cedarline systems",
  displayName: "Cedarline Systems",
  total: 223,
  needsCheck: 16,
  ready: 207,
  beingRead: 0,
  newFiles: 0,
  categories: {
    final_pd: { total: 24, needsCheck: 13, fiscalYears: { "2025": 13, "2024": 11 }, checkReasons: { unmatched_initials: 9, no_science_code: 4 } },
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
  newFiles: 0,
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
  newFiles: 0,
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
  newFiles: 0,
  categories: { final_pd: { total: 51, needsCheck: 2, fiscalYears: { "2025": 51 }, checkReasons: { no_science_code: 2 } } },
  company: { via: "name", clientId: "c3", name: "Brightwell Dairy", industry: "food-processing" },
  isNew: false,
};

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

const filesArgs = (companyKey: string, category: string, onlyNew = false) => ({
  tab: "review",
  companyKey,
  category,
  onlyToCheck: false,
  ...(onlyNew ? { onlyNew: true } : {}),
});

function seedTotals(review: ReturnType<typeof totals>) {
  __setQueryDataForArgs("ingestion:sheetTotals", { tab: "review" }, review);
  __setQueryDataForArgs("ingestion:sheetTotals", { tab: "approved" }, totals(1204, 9));
  __setQueryDataForArgs("ingestion:sheetTotals", { tab: "deleted" }, totals(41, 3));
}

function seedFiles1() {
  seedTotals(totals(504, 7, 117));
  __setPaginatedRows("ingestion:sheetCompanies", [CEDARLINE, HALDEN, NORTHGATE, BRIGHTWELL], { more: true });
  __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("cedarline systems", "final_pd"), FINAL_PDS, { more: true });
  __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("cedarline systems", "supporting"), SUPPORTING, { more: true });
  __setQueryData("ingestion:importActivity", []);
}

// ─── Files 2: Jordan's 52 files just added, the New filter on ───────────────
const NOW = Date.now();
const HALDEN_NEW = {
  ...HALDEN,
  total: 98,
  needsCheck: 77,
  ready: 0,
  beingRead: 21,
  newFiles: 52,
  categories: {
    final_pd: { total: 50, needsCheck: 50, fiscalYears: { "2025": 49, "2024": 1 }, checkReasons: { no_science_code: 50 }, newFiles: 4, newFiscalYears: { "2025": 3, "2024": 1 } },
    draft: { total: 5, needsCheck: 5, fiscalYears: { "2025": 3, "2024": 2 }, checkReasons: { no_writer: 5 }, newFiles: 5, newFiscalYears: { "2025": 3, "2024": 2 } },
    transcript: { total: 6, needsCheck: 6, fiscalYears: { "2025": 4, "2024": 2 }, checkReasons: { no_fiscal_year: 6 }, newFiles: 6, newFiscalYears: { "2025": 4, "2024": 2 } },
    supporting: { total: 14, needsCheck: 14, fiscalYears: { "2025": 9, "2024": 5 }, checkReasons: { no_text: 14 }, newFiles: 14, newFiscalYears: { "2025": 9, "2024": 5 } },
    company_file: { total: 2, needsCheck: 2, fiscalYears: { none: 2 }, checkReasons: { no_text: 2 }, newFiles: 2, newFiscalYears: { none: 2 } },
    unknown: { total: 21, needsCheck: 0, fiscalYears: { "2025": 21 }, newFiles: 21, newFiscalYears: { "2025": 21 } },
  },
};
const NEW_PDS = [
  file("np1", { pdNumber: "1", pdTitle: "Dough proofing control", versionCode: "T", versionNumber: 2, writerName: "Sam Okafor", scienceCode: "2.02.09", scienceCodeSource: "document", isNew: true }),
  file("np2", { pdNumber: "2", pdTitle: "Line changeover model", fiscalYearEnd: MAR_31_2024, versionCode: "T", versionNumber: 1, writerName: "Priya Nair", scienceCode: "2.02.09", scienceCodeSource: "document", isNew: true }),
];
const NEW_SUPPORTING = [
  file("ns1", { name: "Oven trial results, line 2.pdf", category: "supporting", isNew: true }),
  file("ns2", { name: "Proofing room temperature log.pdf", category: "supporting", isNew: true }),
];
const BEING_READ = [
  file("br1", { name: "Batch notes, March.docx", category: "draft", status: "fetched", isNew: true }),
  file("br2", { name: "Interview, Feb 18.vtt", category: "transcript", status: "discovered", isNew: true }),
  file("br3", { name: "Mixer trial photos.pdf", category: "supporting", status: "fetched", isNew: true }),
];

function seedFiles2() {
  seedTotals(totals(556, 7, 148, 52, 21));
  __setPaginatedRowsForArgs("ingestion:sheetCompanies", { tab: "review", onlyToCheck: false }, [CEDARLINE, HALDEN_NEW, NORTHGATE, BRIGHTWELL], { more: true });
  __setPaginatedRowsForArgs("ingestion:sheetCompanies", { tab: "review", onlyToCheck: false, onlyNew: true }, [HALDEN_NEW]);
  __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("halden foods", "final_pd", true), NEW_PDS, { more: true });
  __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("halden foods", "supporting", true), NEW_SUPPORTING, { more: true });
  __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("halden foods", "unknown", true), BEING_READ, { more: true });
  __setQueryData("ingestion:importActivity", [
    {
      _id: "b1",
      source: "page",
      mine: true,
      addedByName: "Jordan Ellis",
      startedAt: NOW - 120_000,
      lastFileAt: NOW - 5_000,
      toSend: 52,
      sendingDone: true,
      added: 52,
      alreadyHere: 12,
      failed: 0,
      read: 31,
      couldNotRead: 0,
      lastReadAt: NOW - 2_000,
    },
  ]);
}

// ─── Files 3: Sam is sending files with the uploader ────────────────────────
const CEDARLINE_ARRIVING = {
  ...CEDARLINE,
  total: 127,
  needsCheck: 12,
  ready: 77,
  beingRead: 38,
  newFiles: 96,
  categories: {
    final_pd: { total: 13, needsCheck: 4, fiscalYears: { "2025": 8, "2024": 5 }, checkReasons: { unmatched_initials: 3, no_science_code: 1 }, newFiles: 2, newFiscalYears: { "2025": 2 } },
    draft: { total: 19, needsCheck: 0, fiscalYears: { "2025": 11, "2024": 8 }, newFiles: 19, newFiscalYears: { "2025": 11, "2024": 8 } },
    review_copy: { total: 12, needsCheck: 0, fiscalYears: { "2025": 7, "2024": 5 }, newFiles: 12, newFiscalYears: { "2025": 7, "2024": 5 } },
    transcript: { total: 9, needsCheck: 0, fiscalYears: { "2025": 5, "2024": 4 }, newFiles: 9, newFiscalYears: { "2025": 5, "2024": 4 } },
    supporting: { total: 34, needsCheck: 8, fiscalYears: { "2025": 20, "2024": 14 }, checkReasons: { no_text: 8 }, newFiles: 14, newFiscalYears: { "2025": 14 } },
    company_file: { total: 2, needsCheck: 0, fiscalYears: { none: 2 }, newFiles: 2, newFiscalYears: { none: 2 } },
    unknown: { total: 38, needsCheck: 0, fiscalYears: { "2025": 38 }, newFiles: 38, newFiscalYears: { "2025": 38 } },
  },
};
const ARRIVING_PDS = [
  FINAL_PDS[0],
  { ...FINAL_PDS[1], isNew: true },
  FINAL_PDS[2],
  { ...FINAL_PDS[3], isNew: true },
];

function seedFiles3() {
  seedTotals(totals(338, 6, 66, 180, 68));
  __setPaginatedRows("ingestion:sheetCompanies", [
    CEDARLINE_ARRIVING,
    HALDEN,
    { ...NORTHGATE, total: 41, ready: 16, beingRead: 25, newFiles: 41 },
    BRIGHTWELL,
  ]);
  __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("cedarline systems", "final_pd"), ARRIVING_PDS, { more: true });
  __setQueryData("ingestion:importActivity", [
    {
      _id: "b2",
      source: "page",
      mine: false,
      addedByName: "Sam Okafor",
      startedAt: NOW - 120_000,
      lastFileAt: Date.now(),
      toSend: 412,
      sendingDone: false,
      added: 180,
      alreadyHere: 0,
      failed: 0,
      read: 112,
      couldNotRead: 0,
    },
  ]);
}

/** The page's scrolling area (the frame's card). */
function scroller(): HTMLElement {
  let node: HTMLElement | null = one("[data-import-page]");
  while (node && !(node.scrollHeight > node.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(node).overflowY))) {
    node = node.parentElement;
  }
  return node ?? document.documentElement;
}

/** A drag's data, with files the way a person drags them from the desktop. */
function transferOf(files: File[]): DataTransfer {
  const transfer = new DataTransfer();
  for (const entry of files) transfer.items.add(entry);
  return transfer;
}
function drag(type: "dragenter" | "dragover" | "dragleave" | "drop", target: Element, transfer: DataTransfer, relatedTarget: Element | null = target) {
  target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer, relatedTarget }));
}
const pdf = (name: string, body = name) => new File([body], name, { type: "application/pdf" });
/** A file as a picked folder gives it: its path inside the folder. */
function inFolder(path: string, body = path): File {
  const name = path.split("/").pop()!;
  const picked = new File([body], name, { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  Object.defineProperty(picked, "webkitRelativePath", { value: path });
  return picked;
}
async function sha256Hex(body: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The upload URL and Convex calls a send makes, answered here; `failing` names files whose upload fails. */
function answerSends(failing: ReadonlySet<string> = new Set()) {
  let urls = 0;
  let stored = 0;
  __setMutationHandler("ingestion:generateUploadUrl", () => `https://upload.test/${++urls}`);
  __setMutationHandler("ingestion:startImportBatch", () => "batch-1");
  let newFiles = 0;
  __setMutationHandler("ingestion:stageImportFiles", (args) => {
    const files = (args as { files: Array<{ path: string }> }).files;
    // The server counts them as New, as the real one does.
    newFiles += files.length;
    __setQueryDataForArgs("ingestion:sheetTotals", { tab: "review" }, totals(504 + newFiles, 7, 117, newFiles));
    return files.map((entry) => ({ path: entry.path, outcome: "added" }));
  });
  __setMutationHandler("ingestion:finishImportBatch", () => null);
  __setMutationHandler("ingestion:reopenImportBatch", () => null);
  const realFetch = globalThis.fetch.bind(globalThis);
  const uploads: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith("https://upload.test/")) return realFetch(input, init);
    const body = init?.body as File;
    uploads.push(body.name);
    if (failing.has(body.name)) return new Response("no", { status: 500 });
    return Response.json({ storageId: `storage-${++stored}` });
  });
  return { uploads };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  viewAs.clear();
  __resetPage();
  __resetNavigation();
  __resetConvexStub();
  __resetAuthState();
  importUploads.reset();
  __setPageUrl("/admin/import");
  __setQueryData("myWork:getViewConfig", { killSwitch: false, ready: true });
  __setQueryData("users:getCurrentUser", { _id: "a", role: "admin", firstName: "Jordan", lastName: "Ellis" });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("Files 1: dropping files on the Import page", () => {
  async function mountFiles1(width: number, height = 1400) {
    await page.viewport(width, height);
    seedFiles1();
    await render(ImportPage);
    await userEvent.click(page.getByRole("button", { name: "Cedarline Systems" }));
    await userEvent.click(page.getByRole("button", { name: /^Supporting files/ }));
    await expect.poll(() => all("[data-import-file]").length).toBe(8);
    await document.fonts.ready;
  }

  it("puts Get the uploader and Add files at the right of the top bar, and History after Deleted", async () => {
    await mountFiles1(1440);
    const uploader = page.getByRole("button", { name: "Get the uploader" });
    const add = page.getByRole("button", { name: "Add files" });
    await expect.element(uploader).toBeVisible();
    await expect.element(add).toBeVisible();
    const bar = one("[data-page-top-bar]")!;
    const uploaderBox = box(one("[data-import-get-uploader]")!);
    const addBox = box(one("[data-import-add-files]")!);
    // Left of Add files, 12px apart, the bar's last controls; both 38px tall.
    expect(addBox.left - uploaderBox.right).toBeCloseTo(board(12), 0);
    expect(addBox.right).toBeLessThanOrEqual(box(bar).right);
    expect(addBox.height).toBeCloseTo(board(38), 0);
    expect(uploaderBox.height).toBeCloseTo(board(38), 0);
    // Add files is the filled main action with white words; the uploader is quiet.
    expect(getComputedStyle(one("[data-import-add-files]")!).backgroundColor).toBe("rgb(8, 122, 117)");
    expect(getComputedStyle(one("[data-import-add-files]")!).color).toBe("rgb(255, 255, 255)");
    expect(getComputedStyle(one("[data-import-get-uploader]")!).color).toBe("rgb(79, 97, 93)");
    const tabs = all('[role="tab"]').map((tab) => text(tab));
    expect(tabs.at(-1)).toBe("History");
  });

  it("draws the dashed outline and the dark bar while files are dragged over the page, and nothing else moves", async () => {
    await mountFiles1(1440, 720);
    scroller().scrollTop = 0;
    const toolbar = one("[data-import-toolbar]")!;
    const before = box(toolbar);
    const files = Array.from({ length: 64 }, (_, index) => pdf(`report ${index}.pdf`));
    const transfer = transferOf(files);
    drag("dragenter", toolbar, transfer);
    drag("dragover", toolbar, transfer);
    await expect.poll(() => one("[data-import-drop-overlay]")).not.toBeNull();
    expect(text(one("[data-import-drop-text]"))).toBe("Drop to add 64 files");
    expect(text(one("[data-import-drop-note]"))).toBe("Banhall sorts them by company, category and fiscal year");
    // The outline: 2px dashed, 8px inside the page column, beside the Admin sidebar.
    const area = one("[data-frame-main]")!;
    const outline = one("[data-import-drop-outline]")!;
    expect(getComputedStyle(outline).borderTopStyle).toBe("dashed");
    expect(getComputedStyle(outline).borderTopWidth).toBe("2px");
    expect(getComputedStyle(outline).borderTopColor).toBe("rgb(159, 211, 207)");
    expect(box(outline).left - box(area).left).toBeCloseTo(board(8), 0);
    expect(box(area).bottom - box(outline).bottom).toBeCloseTo(board(8), 0);
    // The bar: 48px, 24px above the area's foot, centred on it.
    const bar = one("[data-import-drop-bar]")!;
    expect(box(bar).height).toBeCloseTo(board(48), 0);
    expect(box(area).bottom - box(bar).bottom).toBeCloseTo(board(24), 0);
    expect((box(bar).left + box(bar).right) / 2).toBeCloseTo((box(area).left + box(area).right) / 2, 0);
    expect(getComputedStyle(bar).backgroundColor).toBe("rgb(22, 33, 31)");
    // Nothing on the page moved, and the overlay never takes the pointer.
    expect(box(toolbar).top).toBeCloseTo(before.top, 1);
    expect(getComputedStyle(one("[data-import-drop-overlay]")!).pointerEvents).toBe("none");
    // Keep the drag alive while the capture is taken.
    const alive = setInterval(() => drag("dragover", toolbar, transfer), 150);
    await pause(300);
    await page.screenshot({ path: `${CAPTURES}/files1-dropping-1440.png` });
    clearInterval(alive);

    // A folder cannot be counted while it is dragged.
    const withFolder = new DataTransfer();
    withFolder.items.add(new File(["x"], "Halden Foods"));
    drag("dragover", toolbar, withFolder);
    await expect.poll(() => text(one("[data-import-drop-text]"))).toBe("Drop to add these files");
    // Leaving the window takes it away.
    drag("dragleave", toolbar, withFolder, null);
    await expect.poll(() => one("[data-import-drop-overlay]")).toBeNull();
    // Dragging over the Admin sidebar is not a drop on the page.
    drag("dragover", one("[data-admin-link]")!, transfer);
    await pause(50);
    expect(one("[data-import-drop-overlay]")).toBeNull();
  });

  it("adds a drop: skips what is already here without sending it, sends the rest, then shows To review with New on", async () => {
    const { uploads } = answerSends();
    await mountFiles1(1440);
    __setQueryData("ingestion:importFilesHere", [await sha256Hex("already.pdf")]);
    // Switch to History first: a drop brings the page back to To review.
    await userEvent.click(page.getByRole("tab", { name: "History" }));
    __setQueryData("ingestion:importHistory", { rows: [], more: false });
    const transfer = transferOf([pdf("already.pdf"), pdf("fresh one.pdf"), pdf("fresh two.pdf"), new File(["x"], ".DS_Store"), pdf("empty.pdf", "")]);
    const target = one("[data-import-page]")!;
    drag("dragover", target, transfer);
    drag("drop", target, transfer);
    await expect.poll(() => __mutationCalls("ingestion:finishImportBatch")).toEqual([{ batchId: "batch-1", failed: 0 }]);
    // Asked before sending; only the two new files went up.
    expect(__clientQueryCalls("ingestion:importFilesHere")).toHaveLength(1);
    expect((__clientQueryCalls("ingestion:importFilesHere")[0] as { hashes: string[] }).hashes).toHaveLength(3);
    expect(__mutationCalls("ingestion:startImportBatch")).toEqual([{ toSend: 2, alreadyHere: 1 }]);
    expect(uploads.sort()).toEqual(["fresh one.pdf", "fresh two.pdf"]);
    const staged = __mutationCalls("ingestion:stageImportFiles").flatMap((call) => (call as { files: Array<{ path: string; storageId: string; contentHash: string }> }).files);
    expect(staged.map((entry) => entry.path).sort()).toEqual(["fresh one.pdf", "fresh two.pdf"]);
    expect(staged.every((entry) => /^storage-\d$/.test(entry.storageId) && /^[a-f0-9]{64}$/.test(entry.contentHash))).toBe(true);
    // To review, with the New filter on (it shows once the totals count New files).
    await expect.poll(() => one('[role="tab"][aria-selected="true"]')?.id).toBe("import-tab-review");
    await expect.poll(() => __activeQueryArgs("ingestion:sheetCompanies")).toContainEqual({ tab: "review", onlyToCheck: false, onlyNew: true });
    await expect.poll(() => one("[data-import-new-filter]")?.getAttribute("data-state")).toBe("checked");
    expect(text(one("[data-import-new-filter]"))).toBe("New 2");
  });

  it("walks a picked folder from Add files, keeping each file's path inside it, a few files at a time", async () => {
    const { uploads } = answerSends();
    await render(ToastHarness);
    await mountFiles1(1440);
    __setQueryData("ingestion:importFilesHere", []);
    await userEvent.click(page.getByRole("button", { name: "Add files" }));
    await expect.element(page.getByRole("menuitem", { name: "Files" })).toBeVisible();
    await expect.element(page.getByRole("menuitem", { name: "A folder" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    const input = document.querySelector<HTMLInputElement>("[data-import-folder-input]")!;
    expect(input.hasAttribute("webkitdirectory")).toBe(true);
    const picked = [
      ...Array.from({ length: 12 }, (_, index) => inFolder(`Halden Foods/2025 - Jun 30/Submitted/0${index} HaldenFoods 2025-06-30 T1.SO Proofing ${index}.docx`)),
      inFolder("Halden Foods/2025 - Jun 30/~$Proofing.docx"),
      inFolder("Halden Foods/2025 - Jun 30/budget.xlsx"),
    ];
    Object.defineProperty(input, "files", { value: transferOf(picked).files, configurable: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await expect.poll(() => __mutationCalls("ingestion:finishImportBatch")).toEqual([{ batchId: "batch-1", failed: 0 }]);
    expect(uploads).toHaveLength(12);
    const calls = __mutationCalls("ingestion:stageImportFiles") as Array<{ files: Array<{ path: string }> }>;
    // Staged ten at most a call, every path from the picked folder.
    expect(calls.every((call) => call.files.length <= 10)).toBe(true);
    expect(calls.flatMap((call) => call.files.map((entry) => entry.path)).every((path) => path.startsWith("Halden Foods/2025 - Jun 30/Submitted/"))).toBe(true);
    // The type Banhall does not read is said; the lock file is left out without a word.
    await expect.element(page.getByText("1 file was left out: 1 is not a type Banhall reads.")).toBeVisible();
  });

  it("keeps going when a file fails to send, says how many, and sends them again with Try again", async () => {
    answerSends(new Set(["broken.pdf"]));
    await mountFiles1(1440);
    __setQueryData("ingestion:importFilesHere", []);
    const transfer = transferOf([pdf("good.pdf"), pdf("broken.pdf"), pdf("fine.pdf")]);
    const target = one("[data-import-page]")!;
    drag("drop", target, transfer);
    await expect.poll(() => __mutationCalls("ingestion:finishImportBatch")).toEqual([{ batchId: "batch-1", failed: 1 }]);
    // The server's view of the batch, as the status line reads it.
    __setQueryData("ingestion:importActivity", [
      { _id: "batch-1", source: "page", mine: true, addedByName: "Jordan Ellis", startedAt: Date.now(), lastFileAt: Date.now(), toSend: 3, sendingDone: true, added: 2, alreadyHere: 0, failed: 1, read: 0, couldNotRead: 0 },
    ]);
    await expect.poll(() => text(one("[data-import-status-text]"))).toBe("2 files added. 0 read so far. 1 could not be sent.");
    vi.restoreAllMocks();
    answerSends();
    await userEvent.click(page.getByRole("button", { name: "Try again" }));
    await expect.poll(() => __mutationCalls("ingestion:reopenImportBatch")).toEqual([{ batchId: "batch-1" }]);
    await expect.poll(() => __mutationCalls("ingestion:finishImportBatch").at(-1)).toEqual({ batchId: "batch-1", failed: 0 });
    const staged = __mutationCalls("ingestion:stageImportFiles").at(-1) as { files: Array<{ path: string }> };
    expect(staged.files.map((entry) => entry.path)).toEqual(["broken.pdf"]);
  });

  it("sends two different files with one name, dropped together, as two files", async () => {
    const { uploads } = answerSends();
    await mountFiles1(1440);
    __setQueryData("ingestion:importFilesHere", []);
    const transfer = transferOf([pdf("Report.pdf", "Halden Foods report"), pdf("Report.pdf", "Northgate Labs report")]);
    drag("drop", one("[data-import-page]")!, transfer);
    await expect.poll(() => __mutationCalls("ingestion:finishImportBatch")).toEqual([{ batchId: "batch-1", failed: 0 }]);
    expect(__mutationCalls("ingestion:startImportBatch")).toEqual([{ toSend: 2, alreadyHere: 0 }]);
    expect(uploads).toEqual(["Report.pdf", "Report.pdf"]);
    const staged = __mutationCalls("ingestion:stageImportFiles").flatMap((call) => (call as { files: Array<{ path: string; contentHash: string }> }).files);
    expect(staged.map((entry) => entry.path)).toEqual(["Report.pdf", "Report.pdf"]);
    expect(new Set(staged.map((entry) => entry.contentHash)).size).toBe(2);
  });

  it("keeps the status region on the page before anything is sent, and speaks a new sentence but not every count", async () => {
    await mountFiles1(1440);
    const spoken = one("[data-import-status-spoken]");
    expect(spoken).not.toBeNull();
    expect(spoken!.getAttribute("role")).toBe("status");
    expect(text(spoken)).toBe("");
    // Nothing to say: no line shows, and the empty region takes no room.
    expect(one("[data-import-status]")).toBeNull();
    expect(getComputedStyle(spoken!).position).toBe("absolute");
    const batch = {
      _id: "b9",
      source: "page",
      mine: true,
      addedByName: "Dana Whitlock",
      startedAt: Date.now(),
      lastFileAt: Date.now(),
      toSend: 2,
      sendingDone: true,
      added: 2,
      alreadyHere: 0,
      failed: 0,
      read: 0,
      couldNotRead: 0,
    };
    __setQueryData("ingestion:importActivity", [batch]);
    // The first message is spoken by the region that was already there.
    await expect.poll(() => text(one("[data-import-status-spoken]"))).toBe("2 files added. 0 read so far.");
    expect(one("[data-import-status-spoken]")).toBe(spoken);
    expect(text(one("[data-import-status-text]"))).toBe("2 files added. 0 read so far.");
    // The line on screen is not read a second time.
    expect(one("[data-import-status-text]")!.getAttribute("aria-hidden")).toBe("true");
    // A count alone moves the words on screen, not what is spoken.
    __setQueryData("ingestion:importActivity", [{ ...batch, read: 1, lastReadAt: Date.now() }]);
    await expect.poll(() => text(one("[data-import-status-text]"))).toBe("2 files added. 1 read so far.");
    await pause(500);
    expect(text(spoken)).toBe("2 files added. 0 read so far.");
    // A new sentence is spoken.
    __setQueryData("ingestion:importActivity", [{ ...batch, read: 2, lastReadAt: Date.now() }]);
    await expect.poll(() => text(spoken)).toBe("2 files added. All read.");
  });

  it("says what the uploader is for and how to get it, without a download that does not exist", async () => {
    await mountFiles1(1440);
    await userEvent.click(page.getByRole("button", { name: "Get the uploader" }));
    const dialog = page.getByRole("dialog", { name: "Get the uploader" });
    await expect.element(dialog).toBeVisible();
    const steps = all("[data-import-uploader-steps] li").map((node) => text(node));
    expect(steps[0]).toBe("Ask the Banhall team for the uploader kit. It comes as a zip file.");
    expect(steps).toHaveLength(4);
    expect(one('[data-testid="import-uploader-dialog"] a[download]')).toBeNull();
    await page.screenshot({ path: `${CAPTURES}/uploader-dialog-1440.png` });
    await userEvent.click(page.getByRole("button", { name: "Done" }));
    await expect.element(dialog).not.toBeInTheDocument();
  });
});

describe("Files 2: just added, with the New filter on", () => {
  async function mountFiles2(width: number, height = 1400) {
    await page.viewport(width, height);
    seedFiles2();
    await render(ImportPage);
    await expect.element(page.getByRole("checkbox", { name: /New/ })).toBeVisible();
    await userEvent.click(page.getByRole("checkbox", { name: /New/ }));
    await userEvent.click(page.getByRole("button", { name: "Halden Foods" }));
    await userEvent.click(page.getByRole("button", { name: /^Supporting files/ }));
    await userEvent.click(page.getByRole("button", { name: /^Not sorted yet/ }));
    await expect.poll(() => all("[data-import-file]").length).toBe(7);
    await document.fonts.ready;
  }

  it("puts New after To check, lists only New companies and files, and closes with the companies it leaves out", async () => {
    await mountFiles2(1440);
    const toCheck = one("[data-import-to-check]")!;
    const newChip = one("[data-import-new-filter]")!;
    expect(text(newChip)).toBe("New 52");
    expect(box(newChip).left - box(toCheck).right).toBeCloseTo(board(8), 0);
    expect(newChip.getAttribute("data-state")).toBe("checked");
    expect(toCheck.getAttribute("data-state")).toBe("unchecked");
    // The chip that is on: fir words, the count in primary.
    await expect.poll(() => getComputedStyle(newChip).color).toBe("rgb(10, 58, 56)");
    expect(getComputedStyle(one("[data-import-filter-count]", newChip)!).color).toBe("rgb(8, 122, 117)");
    expect(__activeQueryArgs("ingestion:sheetCompanies")).toEqual([{ tab: "review", onlyToCheck: false, onlyNew: true }]);
    // The band: "52 new" 12px before "98 files".
    const band = one('[data-import-band="halden foods"]')!;
    const pill = one("[data-import-band-new-count]", band)!;
    expect(text(pill)).toBe("52 new");
    expect(box(one("[data-import-band-files]", band)!).left - box(pill).right).toBeCloseTo(board(12), 0);
    expect(getComputedStyle(pill).backgroundColor).toBe("rgb(220, 252, 231)");
    // Sections count their New files, with the New files' years.
    const labels = all("[data-import-section]", band).map((node) => [node.dataset.importSection, text(one("[data-import-section-count]", node))]);
    expect(labels).toEqual([
      ["final_pd", "4"],
      ["draft", "5"],
      ["transcript", "6"],
      ["supporting", "14"],
      ["company_file", "2"],
      ["unknown", "21"],
    ]);
    expect(text(one('[data-import-section="final_pd"] [data-import-section-years]'))).toBe("3 in FY 2025, 1 in FY 2024");
    // The amber note counts every file to check, so it gives way with New on.
    expect(one('[data-import-section="final_pd"] [data-import-section-note]')).toBeNull();
    // A New file's label, 10px after its name.
    const row = one('[data-import-file="np1"]')!;
    const label = one("[data-import-file-new]", row)!;
    expect(text(label)).toBe("New");
    expect(box(label).left - box(one("[data-import-file-title]", row)!).right).toBeCloseTo(board(10), 0);
    // Files still being read say so, under Not sorted yet, with its note and "Show 18 more".
    const notSorted = one('[data-import-section="unknown"]')!;
    expect(text(one("[data-import-section-label]", notSorted))).toBe("Not sorted yet");
    expect(text(one("[data-import-section-not-sorted]", notSorted))).toBe("Each file moves to its category once Banhall has read it");
    expect(all("[data-import-file-state]", notSorted).map((node) => text(node))).toEqual(["Being read", "Being read", "Being read"]);
    expect(one("[data-import-file-new]", notSorted)).toBeNull();
    expect(text(one("[data-import-show-more-files]", notSorted))).toBe("Show 18 more");
    // The closing line.
    expect(text(one("[data-import-sheet-others]"))).toBe("The other 6 companies have no new files.");
    // The status line: 16px under the toolbar, 20px over the sheet.
    const status = one("[data-import-status]")!;
    expect(text(status)).toBe("52 files added, 12 were already here. 31 read so far.");
    expect(box(status).top - box(one("[data-import-toolbar]")!).bottom).toBeCloseTo(board(16), 0);
    expect(box(one("[data-import-sheet-header]")!).top - box(status).bottom).toBeCloseTo(board(20), 0);
  });

  it("turns To check off when New goes on, and back", async () => {
    await mountFiles2(1440);
    await userEvent.click(page.getByRole("checkbox", { name: /To check/ }));
    await expect.poll(() => one("[data-import-new-filter]")?.getAttribute("data-state")).toBe("unchecked");
    expect(__activeQueryArgs("ingestion:sheetCompanies")).toEqual([{ tab: "review", onlyToCheck: true }]);
    await userEvent.click(page.getByRole("checkbox", { name: /New/ }));
    await expect.poll(() => one("[data-import-to-check]")?.getAttribute("data-state")).toBe("unchecked");
  });

  for (const width of [1440, 1280]) {
    it(`captures Files 2 at ${width}px beside the board`, async () => {
      await mountFiles2(width, 720);
      scroller().scrollTop = 0;
      await pause(400);
      await page.screenshot({ path: `${CAPTURES}/files2-just-added-${width}-top.png` });
      scroller().scrollTop = scroller().scrollHeight;
      await pause(300);
      await page.screenshot({ path: `${CAPTURES}/files2-just-added-${width}-bottom.png` });
      expect(all("[data-import-band]").length).toBe(1);
    });
  }
});

describe("Files 3: another person is uploading", () => {
  it("says who is uploading how many, and shows the New labels and pills with New off", async () => {
    await page.viewport(1440, 720);
    seedFiles3();
    await render(ImportPage);
    await userEvent.click(page.getByRole("button", { name: "Cedarline Systems" }));
    await expect.poll(() => all("[data-import-file]").length).toBe(4);
    await document.fonts.ready;
    expect(text(one("[data-import-status]"))).toBe("Sam Okafor is uploading 412 files. 180 here so far.");
    expect(text(one("[data-import-new-filter]"))).toBe("New 180");
    expect(one("[data-import-new-filter]")!.getAttribute("data-state")).toBe("unchecked");
    expect(all("[data-import-band-new-count]").map((node) => text(node))).toEqual(["96 new", "41 new"]);
    expect(all("[data-import-file-new]").map((node) => node.closest("[data-import-file]")!.getAttribute("data-import-file"))).toEqual(["pd2", "pd4"]);
    // Not sorted yet holds the 38 being read, closed.
    expect(text(one('[data-import-section="unknown"] [data-import-section-not-sorted]'))).toBe("Each file moves to its category once Banhall has read it");
    scroller().scrollTop = 0;
    await pause(400);
    await page.screenshot({ path: `${CAPTURES}/files3-from-the-uploader-1440.png` });
  });
});

describe("History", () => {
  it("lists one plain row per batch, newest first, with the old sync runs, and shows more", async () => {
    await page.viewport(1440, 900);
    seedFiles1();
    const day = Date.UTC(2026, 10, 12, 14, 0);
    __setQueryDataForArgs("ingestion:importHistory", { limit: 25 }, {
      rows: [
        { key: "b3", startedAt: day, source: "page", who: "Jordan Ellis", added: 52, alreadyHere: 12, couldNotRead: 1, notSent: 0 },
        { key: "b2", startedAt: day - 3_600_000, source: "uploader", who: null, added: 412, alreadyHere: 30, couldNotRead: 4, notSent: 0 },
        { key: "b1", startedAt: day - 7_200_000, source: "page", who: "Priya Nair", added: 9, alreadyHere: 0, couldNotRead: 0, notSent: 2 },
        { key: "r1", startedAt: day - 86_400_000, source: "onedrive", who: "Dana Whitlock", added: 1204, alreadyHere: null, couldNotRead: null, notSent: 0 },
      ],
      more: true,
    });
    await render(ImportPage);
    await userEvent.click(page.getByRole("tab", { name: "History" }));
    await expect.poll(() => all("[data-import-history-row]").length).toBe(4);
    // No toolbar or sheet on History.
    expect(one("[data-import-toolbar]")).toBeNull();
    const header = all('[data-import-history-header] [role="columnheader"]').map((node) => text(node));
    expect(header).toEqual(["When", "Who", "How it came", "Added", "Already here", "Could not be read"]);
    const cells = (key: string) =>
      all('[role="cell"]', all("[data-import-history-row]")[["b3", "b2", "b1", "r1"].indexOf(key)]).slice(1).map((node) => text(node));
    expect(cells("b3")).toEqual(["Jordan Ellis", "Added on this page", "52", "12", "1"]);
    expect(cells("b2")).toEqual(["Not recorded", "The uploader", "412", "30", "4"]);
    expect(cells("b1")).toEqual(["Priya Nair", "Added on this page", "9, 2 not sent", "0", "0"]);
    expect(cells("r1")).toEqual(["Dana Whitlock", "OneDrive sync", "1,204", "Not counted", "Not counted"]);
    // The sheet's header row: 36px on the gray-50 fill.
    expect(box(one("[data-import-history-header]")!).height).toBeCloseTo(board(36), 0);
    await page.screenshot({ path: `${CAPTURES}/history-1440.png` });
    await userEvent.click(page.getByRole("button", { name: "Show 25 more" }));
    await expect.poll(() => __activeQueryArgs("ingestion:importHistory")).toEqual([{ limit: 50 }]);
  });
});

describe("the new header and toolbar pieces at narrower windows", () => {
  for (const width of [1280, 1100]) {
    it(`never overlap or clip at ${width}px`, async () => {
      await page.viewport(width, 800);
      seedFiles2();
      await render(ImportPage);
      await expect.element(page.getByRole("checkbox", { name: /New/ })).toBeVisible();
      await userEvent.click(page.getByRole("checkbox", { name: /New/ }));
      await expect.poll(() => one("[data-import-status]")).not.toBeNull();
      await document.fonts.ready;
      const overlaps = (a: DOMRect, b: DOMRect) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
      // The top bar: title, count, Get the uploader, Add files, each whole and apart.
      const bar = one("[data-page-top-bar]")!;
      const pieces = ["[data-page-title], [data-page-breadcrumb]", "[data-page-count]", "[data-import-get-uploader]", "[data-import-add-files]"]
        .map((selector) => one(selector, bar))
        .filter((node): node is HTMLElement => node !== null);
      expect(pieces.length).toBeGreaterThanOrEqual(3);
      for (const [index, node] of pieces.entries()) {
        expect(box(node).right, node.textContent ?? "").toBeLessThanOrEqual(box(bar).right + 0.5);
        expect(box(node).left).toBeGreaterThanOrEqual(box(bar).left - 0.5);
        for (const other of pieces.slice(index + 1)) expect(overlaps(box(node), box(other)), `${text(node)} / ${text(other)}`).toBe(false);
      }
      for (const control of [one("[data-import-get-uploader]")!, one("[data-import-add-files]")!]) {
        expect(control.scrollWidth, text(control)).toBeLessThanOrEqual(control.clientWidth + 1);
      }
      // The toolbar: search, To check, New, the legend and Select, apart and inside it.
      const toolbar = one("[data-import-toolbar]")!;
      const controls = ['[role="search"]', "[data-import-to-check]", "[data-import-new-filter]", "[data-import-legend]", "[data-import-select-toggle]"].map(
        (selector) => one(selector, toolbar)!
      );
      for (const [index, node] of controls.entries()) {
        expect(box(node).right, text(node)).toBeLessThanOrEqual(box(toolbar).right + 0.5);
        expect(node.scrollWidth, text(node)).toBeLessThanOrEqual(node.clientWidth + 1);
        for (const other of controls.slice(index + 1)) expect(overlaps(box(node), box(other)), `${text(node)} / ${text(other)}`).toBe(false);
      }
      // The status line sits under the toolbar, whole.
      const status = one("[data-import-status]")!;
      expect(box(status).top).toBeGreaterThanOrEqual(box(toolbar).bottom);
      expect(box(status).right).toBeLessThanOrEqual(box(toolbar).right + 0.5);
      scroller().scrollTop = 0;
      await pause(300);
      await page.screenshot({ path: `${CAPTURES}/header-toolbar-${width}.png` });
    });
  }
});
