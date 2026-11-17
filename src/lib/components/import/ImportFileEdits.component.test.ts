import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import ImportSheet from "./ImportSheet.svelte";
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

/**
 * Changing one file on the Import sheet (2026-11-11 phase 3b, board ao5):
 * each cell's picker sends setSheetLabels for that file with its one label,
 * the amber pick controls, the row's "..." menu, the server's words when a
 * change is refused, and the keyboard. Made-up companies and people.
 */
const text = (node: Element | null | undefined) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();
const all = (selector: string, root: ParentNode = document) => [...root.querySelectorAll<HTMLElement>(selector)];
const one = (selector: string, root: ParentNode = document) => root.querySelector<HTMLElement>(selector);
const fileRow = (id: string) => one(`[data-import-file="${id}"]`)!;
const inRow = (id: string, selector: string) => one(selector, fileRow(id))!;

const AMBER = "rgb(168, 80, 15)"; // --color-gap-text, the drawing's amber
const MAR_31_2025 = Date.UTC(2025, 2, 31);

const CEDARLINE = {
  companyKey: "cedarline systems",
  displayName: "Cedarline Systems",
  total: 30,
  needsCheck: 3,
  ready: 26,
  beingRead: 1,
  categories: {
    final_pd: { total: 6, needsCheck: 2, fiscalYears: { "2025": 6 }, checkReasons: { no_writer: 1, no_science_code: 1 } },
    supporting: { total: 24, needsCheck: 1, fiscalYears: { "2025": 24 }, checkReasons: { could_not_read: 1 } },
  },
  company: { via: "name", clientId: "c1", name: "Cedarline Systems", industry: "Software" },
  isNew: false,
};

function row(id: string, extra: Record<string, unknown>) {
  return {
    _id: id,
    name: `${id}.docx`,
    category: "final_pd",
    status: "pending_review",
    editedLabels: [],
    needsCheck: false,
    checkReasons: [],
    size: 2048,
    ...extra,
  };
}

const FINAL_PDS = [
  row("pd1", {
    pdNumber: "1",
    pdTitle: "Route planning engine",
    fiscalYearEnd: MAR_31_2025,
    fiscalYearEndAssumed: false,
    versionCode: "T",
    versionNumber: 2,
    writerName: "Dana Whitlock",
    writerId: "w-dana",
    writerHasLogin: true,
    scienceCode: "2.02.09",
    scienceCodeSource: "document",
  }),
  // Initials two people share (2026-11-16): no writer, so a person must choose.
  row("pd2", { pdNumber: "2", pdTitle: "Yard map solver", fiscalYearEnd: MAR_31_2025, versionCode: "T", versionNumber: 1, writerInitials: "KT", scienceCode: "1.02.02", scienceCodeSource: "person", needsCheck: true, checkReasons: ["unmatched_initials"] }),
  row("pd4", {
    pdNumber: "4",
    pdTitle: "Label vision check",
    fiscalYearEnd: MAR_31_2025,
    versionCode: "T",
    versionNumber: 1,
    needsCheck: true,
    checkReasons: ["no_science_code", "no_writer"],
  }),
  row("pd5", { pdNumber: "5", pdTitle: "Shelf gap finder", status: "fetched", versionCode: "T", versionNumber: 2 }),
  // Could not be read: the reasons stay amber words, not pickers.
  row("pd6", { pdNumber: "6", pdTitle: "Pallet count camera", status: "failed", needsCheck: true, checkReasons: ["could_not_read", "no_writer"] }),
];

/** The writer picker's list (2026-11-16): team members, then writers with no login. */
const WRITER_CHOICES = {
  members: [
    { userId: "u1", label: "Dana Whitlock", writerId: "w-dana", linkedWriterId: null },
    { userId: "u2", label: "Priya Nair", writerId: null, linkedWriterId: null },
    // Sam has a writer of his own and a past writer an Admin linked to him.
    { userId: "u3", label: "Sam Okafor", writerId: "w-sam", linkedWriterId: "w-so" },
  ],
  pastWriters: [
    { writerId: "w-dw", label: "DW", initials: "DW" },
    { writerId: "w-jordan", label: "Jordan Ellis", initials: "JE" },
  ],
};
const OPTION_LABELS = ["Dana Whitlock", "Priya Nair", "Sam Okafor", "DW", "Jordan Ellis"];
const optionLabels = () => all("[data-import-name-option]").map((node) => text(node.querySelector("span")));

const SUPPORTING = [row("sup1", { name: "Site notes.pdf", category: "supporting", fiscalYearEnd: MAR_31_2025 })];

const filesArgs = (category: string) => ({ tab: "review", companyKey: "cedarline systems", category, onlyToCheck: false });
const labelCalls = () => __mutationCalls("ingestion:setSheetLabels");

/** The Undo of the newest toast that says `words`: several toasts may be on screen at once. */
function undoIn(words: string): HTMLElement {
  const toasts = all("[data-sonner-toast]").filter((node) => text(node).includes(words));
  const button = toasts[0]?.querySelector<HTMLElement>("[data-button]");
  if (!button) throw new Error(`No Undo in a toast saying "${words}"`);
  return button;
}

/** The server's answer to a batch call that changed every file it was sent. */
const changedAll = (args: unknown) => {
  const ids = (args as { ids: string[] }).ids;
  return { changed: ids.length, changedIds: ids, skipped: [] };
};

async function mount() {
  __setPaginatedRows("ingestion:sheetCompanies", [CEDARLINE]);
  __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("final_pd"), FINAL_PDS);
  __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("supporting"), SUPPORTING);
  for (const name of ["ingestion:setSheetLabels", "ingestion:removeItems", "ingestion:restoreItems"]) {
    __setMutationHandler(name, changedAll);
  }
  await render(ToastHarness);
  await render(ImportSheet, { tab: "review", onlyToCheck: false });
  await userEvent.click(page.getByRole("button", { name: "Cedarline Systems" }));
  await expect.poll(() => all("[data-import-file]").length).toBe(FINAL_PDS.length);
}

describe("changing one file on the Import sheet", () => {
  beforeEach(() => {
    __resetConvexStub();
    __setQueryData("ingestion:writerChoices", WRITER_CHOICES);
  });

  it("opens the year end calendar under the fiscal year cell and sends the UTC day picked", async () => {
    await mount();
    await userEvent.click(inRow("pd1", "[data-import-year-edit]"));
    const picks = page.getByRole("button", { name: "Jun 30" });
    await expect.element(picks).toBeVisible();
    // The app's calendar: its heading, the four quick picks and the helper line.
    expect(all("[data-date-quick-picks] button").map((node) => text(node))).toEqual(["Mar 31", "Jun 30", "Sep 30", "Dec 31"]);
    await expect.element(page.getByText("Year end", { exact: true })).toBeVisible();
    await expect.element(page.getByText("The fiscal year takes the year of its end date.")).toBeVisible();
    // It opens on the file's own year end, March 2025.
    expect(one('[role="gridcell"][data-value="2025-03-31"] [data-selected]')).not.toBeNull();

    await userEvent.click(picks);
    await expect.poll(labelCalls).toEqual([{ ids: ["pd1"], patch: { fiscalYearEnd: Date.UTC(2025, 5, 30) } }]);
    await expect.poll(() => one("[data-date-quick-picks]")).toBeNull();

    // A day in the grid: the UTC midnight of that day, whatever the time zone.
    await userEvent.click(inRow("pd1", "[data-import-year-edit]"));
    await userEvent.click(one('[role="gridcell"][data-value="2025-03-15"] [role="button"]')!);
    await expect.poll(() => labelCalls().at(-1)).toEqual({ ids: ["pd1"], patch: { fiscalYearEnd: Date.UTC(2025, 2, 15) } });
    // The cell still shows the year alone; the date stays in the tooltip and for screen readers.
    expect(one("[data-import-year]", fileRow("pd1"))!.firstChild!.textContent).toBe("2025");
    expect(inRow("pd1", "[data-import-year-edit]").getAttribute("aria-label")).toBe(
      "Fiscal year 2025, Year ended Mar 31, 2025. Change the year end"
    );
    await userEvent.hover(inRow("pd1", "[data-import-year]"));
    await expect.poll(() => text(one("[data-tooltip-content]"))).toBe("Year ended Mar 31, 2025");
  });

  it("sets the version's stage and number from its menu, on final PDs, drafts and review copies only", async () => {
    await mount();
    await userEvent.click(inRow("pd1", "[data-import-version-edit]"));
    const menu = one("[data-import-version-menu]")!;
    expect(all("[data-import-version-code]", menu).map((node) => text(node))).toEqual([
      "T - to be submitted",
      "S - submitted",
      "R - in review",
    ]);
    expect(all("[data-import-version-number]", menu).map((node) => text(node))).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    // It starts on the file's own T2.
    expect(one('[data-import-version-code="T"]', menu)!.getAttribute("aria-pressed")).toBe("true");
    expect(one('[data-import-version-number="2"]', menu)!.getAttribute("aria-pressed")).toBe("true");
    // A stage alone saves at once with the file's number, and the menu stays open (live QA fixes).
    await userEvent.click(one('[data-import-version-code="S"]', menu)!);
    await expect.poll(labelCalls).toEqual([{ ids: ["pd1"], patch: { version: { code: "S", number: 2 } } }]);
    expect(one("[data-import-version-menu]")).toBe(menu);
    expect(one('[data-import-version-code="S"]', menu)!.getAttribute("aria-pressed")).toBe("true");
    // A number then saves the stage shown with it, and closes the menu.
    await userEvent.click(page.getByRole("button", { name: "S3" }));
    await expect.poll(() => labelCalls().at(-1)).toEqual({ ids: ["pd1"], patch: { version: { code: "S", number: 3 } } });
    await expect.poll(() => one("[data-import-version-menu]")).toBeNull();
    expect(labelCalls()).toHaveLength(2);

    // Clicking away after a stage keeps it: it was already saved.
    await userEvent.click(inRow("pd2", "[data-import-version-edit]"));
    await userEvent.click(one('[data-import-version-code="R"]')!);
    await expect.poll(() => labelCalls().at(-1)).toEqual({ ids: ["pd2"], patch: { version: { code: "R", number: 1 } } });
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => one("[data-import-version-menu]")).toBeNull();
    expect(labelCalls()).toHaveLength(3);

    // Two stages picked one after the other: the tick stays on the last one
    // while saves read back, and a number saves that last stage.
    await userEvent.click(inRow("pd2", "[data-import-version-edit]"));
    await userEvent.click(one('[data-import-version-code="S"]')!);
    await userEvent.click(one('[data-import-version-code="R"]')!);
    await expect.poll(() => labelCalls().at(-1)).toEqual({ ids: ["pd2"], patch: { version: { code: "R", number: 1 } } });
    expect(one('[data-import-version-code="R"]')!.getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(page.getByRole("button", { name: "R4" }));
    await expect.poll(() => labelCalls().at(-1)).toEqual({ ids: ["pd2"], patch: { version: { code: "R", number: 4 } } });
    await expect.poll(() => one("[data-import-version-menu]")).toBeNull();

    // A file with no version yet takes number 1 with its stage.
    __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("final_pd"), [
      ...FINAL_PDS,
      row("pd7", { pdNumber: "7", pdTitle: "Cold room alarm", fiscalYearEnd: MAR_31_2025, writerName: "Sam Okafor", scienceCode: "2.02.09", scienceCodeSource: "person" }),
    ]);
    await expect.poll(() => one('[data-import-file="pd7"]')).not.toBeNull();
    await userEvent.click(inRow("pd7", "[data-import-version-edit]"));
    await userEvent.click(one('[data-import-version-code="T"]')!);
    await expect.poll(() => labelCalls().at(-1)).toEqual({ ids: ["pd7"], patch: { version: { code: "T", number: 1 } } });
    await userEvent.keyboard("{Escape}");

    // A stage the server refuses goes back to the file's own.
    __setMutationHandler("ingestion:setSheetLabels", () => {
      throw Object.assign(new Error("[CONVEX M(ingestion:setSheetLabels)] Server Error"), {
        data: { code: "INVALID_INPUT", message: "That file can no longer take this change." },
      });
    });
    await userEvent.click(inRow("pd1", "[data-import-version-edit]"));
    await userEvent.click(one('[data-import-version-code="R"]')!);
    await expect.element(page.getByText("That file can no longer take this change.")).toBeVisible();
    await expect.poll(() => one('[data-import-version-code="T"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(one('[data-import-version-code="R"]')!.getAttribute("aria-pressed")).toBe("false");
    await userEvent.keyboard("{Escape}");
    __setMutationHandler("ingestion:setSheetLabels", changedAll);

    // A supporting file has no version to set.
    await userEvent.click(page.getByRole("button", { name: /^Supporting files/ }));
    await expect.poll(() => one('[data-import-file="sup1"]')).not.toBeNull();
    expect(one("[data-import-version-edit]", fileRow("sup1"))).toBeNull();
    expect(one("[data-import-writer-edit]", fileRow("sup1"))).toBeNull();
    expect(one("[data-import-code-edit], [data-import-code-pick]", fileRow("sup1"))).toBeNull();
    // Its year can still be set.
    expect(one("[data-import-year-edit]", fileRow("sup1"))).not.toBeNull();
  });

  it("lists team members, then past writers with a quiet No login tag, and sends the one picked or a typed name", async () => {
    await mount();
    // A file with no initials: the pick sets that file alone.
    await userEvent.click(inRow("pd1", "[data-import-writer-edit]"));
    await expect.poll(optionLabels).toEqual(OPTION_LABELS);
    expect(all("[data-import-name-group]").map((node) => node.dataset.importNameGroup)).toEqual(["Team members", "Past writers"]);
    expect(all('[data-import-name-group="Past writers"] [data-import-name-detail]').map((node) => text(node))).toEqual(["No login", "No login"]);
    expect(one('[data-import-name-group="Team members"] [data-import-name-detail]')).toBeNull();
    // Its writer now is checked.
    expect(one('[data-import-name-option="user:u1"]')?.getAttribute("aria-current")).toBe("true");
    await userEvent.click(one('[data-import-name-option="user:u2"]')!);
    await expect.poll(labelCalls).toEqual([{ ids: ["pd1"], patch: { writer: { kind: "user", userId: "u2" } } }]);

    // A past writer, on a file with no writer and no initials.
    await userEvent.click(inRow("pd4", "[data-import-writer-pick]"));
    await userEvent.click(await vi.waitFor(() => one('[data-import-name-option="writer:w-jordan"]')!));
    await expect.poll(() => labelCalls().at(-1)).toEqual({ ids: ["pd4"], patch: { writer: { kind: "writer", writerId: "w-jordan" } } });

    // Someone not listed: type the name and take it (a new writer with no login).
    await userEvent.click(inRow("pd4", "[data-import-writer-pick]"));
    await userEvent.fill(page.getByRole("combobox", { name: "Writer" }), "Kim Tran");
    await expect.element(page.getByText('Use "Kim Tran"')).toBeVisible();
    expect(all("[data-import-name-option]")).toHaveLength(0);
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => labelCalls().at(-1)).toEqual({ ids: ["pd4"], patch: { writer: { kind: "name", name: "Kim Tran" } } });
  });

  it("refuses a typed email address as a writer, and picking the writer a file has changes nothing", async () => {
    await mount();
    await userEvent.click(inRow("pd2", "[data-import-writer-pick]"));
    await expect.poll(optionLabels).toEqual(OPTION_LABELS);
    await userEvent.fill(page.getByRole("combobox", { name: "Writer" }), "jordan.ellis@example.com");
    await expect.element(page.getByText("Type the writer's name, not an email address.")).toBeVisible();
    expect(one("[data-import-name-new]")).toBeNull();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{Escape}");
    await userEvent.click(inRow("pd1", "[data-import-writer-edit]"));
    await userEvent.click(await vi.waitFor(() => one('[data-import-name-option="user:u1"]')!));
    expect(labelCalls()).toEqual([]);
    // A file whose writer is the past writer linked to Sam checks Sam.
    __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("final_pd"), [
      { ...FINAL_PDS[0], writerId: "w-so", writerName: "Sam Okafor" },
      ...FINAL_PDS.slice(1),
    ]);
    await expect.poll(() => text(one("[data-import-writer-tone]", fileRow("pd1")))).toBe("Sam Okafor");
    await userEvent.click(inRow("pd1", "[data-import-writer-edit]"));
    await expect.poll(() => one('[data-import-name-option="user:u3"]')?.getAttribute("aria-current")).toBe("true");
    expect(__mutationCalls("ingestion:matchWriterInitials")).toEqual([]);
  });

  it("asks a person to choose on initials that could be more than one person, holds the pick for every file with them, and Undo takes it back (2026-11-16)", async () => {
    __setMutationHandler("ingestion:matchWriterInitials", (args) => {
      const { initials, writer } = args as { initials: string; writer: { kind: string; userId?: string } | null };
      const label = writer?.userId === "u3" ? "Sam Okafor" : writer ? "Priya Nair" : null;
      return { initials, writerId: writer ? "w-x" : null, writerName: label, previous: null, changed: 9, more: false };
    });
    await mount();
    const pick = inRow("pd2", "[data-import-writer-pick]");
    // Just the two words: no initials in them.
    expect(text(pick)).toBe("Choose writer");
    expect(getComputedStyle(pick).color).toBe(AMBER);
    await userEvent.click(pick);
    await userEvent.click(await vi.waitFor(() => one('[data-import-name-option="user:u2"]')!));
    // The pick says who KT is for the whole firm: never a label on this file alone.
    await expect.poll(() => __mutationCalls("ingestion:matchWriterInitials")).toEqual([
      { initials: "KT", writer: { kind: "user", userId: "u2" } },
    ]);
    expect(labelCalls()).toEqual([]);
    await expect.element(page.getByText("KT is Priya Nair on 9 files")).toBeVisible();
    await userEvent.click(undoIn("KT is Priya Nair on 9 files"));
    await expect.poll(() => __mutationCalls("ingestion:matchWriterInitials").at(-1)).toEqual({ initials: "KT", writer: null });

    // A writer that came from the initials shows like any name, with no AI
    // mark and no amber; a pick there says who KT is for every file again.
    __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("final_pd"), [
      { ...FINAL_PDS[1], writerName: "Priya Nair", writerId: "w-x", writerNameSource: "initials", needsCheck: false, checkReasons: [] },
      // A writer a person set on this file: a pick changes this file alone.
      { ...FINAL_PDS[0], writerInitials: "KT", writerNameSource: "person", editedLabels: ["writerName"] },
      ...FINAL_PDS.slice(2),
    ]);
    await expect.poll(() => text(one("[data-import-writer-tone]", fileRow("pd2")))).toBe("Priya Nair");
    const named = inRow("pd2", "[data-import-writer-edit]");
    expect(named.getAttribute("aria-label")).toBe("Writer Priya Nair, from the initials KT. Change the writer for KT");
    expect(getComputedStyle(one("[data-import-writer-tone]", fileRow("pd2"))!).color).not.toBe(AMBER);
    expect(one('[data-import-cell="writer"] [data-ai-mark]', fileRow("pd2"))).toBeNull();
    await userEvent.click(named);
    await userEvent.click(await vi.waitFor(() => one('[data-import-name-option="user:u3"]')!));
    await expect.poll(() => __mutationCalls("ingestion:matchWriterInitials").at(-1)).toEqual({
      initials: "KT",
      writer: { kind: "user", userId: "u3" },
    });
    await userEvent.click(inRow("pd1", "[data-import-writer-edit]"));
    await userEvent.click(await vi.waitFor(() => one('[data-import-name-option="writer:w-dw"]')!));
    await expect.poll(labelCalls).toEqual([{ ids: ["pd1"], patch: { writer: { kind: "writer", writerId: "w-dw" } } }]);
    expect(__mutationCalls("ingestion:matchWriterInitials")).toHaveLength(3);
  });

  it("says when a match could not be saved", async () => {
    __setMutationHandler("ingestion:matchWriterInitials", () => {
      throw Object.assign(new Error("[CONVEX M(ingestion:matchWriterInitials)] Server Error"), {
        data: { code: "INVALID_INPUT", message: "Initials are two or three letters, such as KT." },
      });
    });
    await mount();
    await userEvent.click(inRow("pd2", "[data-import-writer-pick]"));
    await userEvent.click(await vi.waitFor(() => one('[data-import-name-option="user:u1"]')!));
    await expect.element(page.getByText("Initials are two or three letters, such as KT.")).toBeVisible();
  });

  it("finds a science code by number or words and sends a real code; a person's pick drops the AI mark", async () => {
    await mount();
    const pick = inRow("pd4", "[data-import-code-pick]");
    expect(text(pick)).toBe("Pick a code");
    await userEvent.click(pick);
    const search = page.getByRole("combobox", { name: "Science code" });
    await userEvent.fill(search, "2.02.09");
    await expect.poll(() => all("[data-science-code]").map((node) => node.dataset.scienceCode)).toEqual(["2.02.09"]);
    await userEvent.fill(search, "software engineering");
    await expect.poll(() => all("[data-science-code]").map((node) => node.dataset.scienceCode)).toContain("2.02.09");
    // No Clear: a file's code can be changed, not taken away.
    expect(page.getByRole("button", { name: "Clear" }).query()).toBeNull();
    await userEvent.click(one('[data-science-code="2.02.09"]')!);
    await expect.poll(labelCalls).toEqual([{ ids: ["pd4"], patch: { scienceCode: "2.02.09" } }]);

    // The AI's code, picked by a person, becomes theirs.
    expect(one('[data-ai-mark="aurora"]', fileRow("pd1"))).not.toBeNull();
    await userEvent.click(inRow("pd1", "[data-import-code-edit]"));
    await expect.poll(() => one("[data-science-code-current]")?.dataset.scienceCode).toBe("2.02.09");
    await userEvent.click(one('[data-science-code="2.02.09"]')!);
    await expect.poll(() => labelCalls().at(-1)).toEqual({ ids: ["pd1"], patch: { scienceCode: "2.02.09" } });
    // When the sheet reads it back with the person as its source, the mark is gone.
    __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("final_pd"), [
      { ...FINAL_PDS[0], scienceCodeSource: "person", editedLabels: ["scienceCode"] },
      ...FINAL_PDS.slice(1),
    ]);
    await expect.poll(() => one('[data-ai-mark="aurora"]', fileRow("pd1"))).toBeNull();
  });

  it("shows the amber pick controls only where a person must pick, and none on a file that could not be read", async () => {
    await mount();
    // pd4: a final PD with no writer and no code.
    for (const selector of ["[data-import-writer-pick]", "[data-import-code-pick]"]) {
      const control = inRow("pd4", selector);
      expect(getComputedStyle(control).color, selector).toBe(AMBER);
      expect(control.tagName, selector).toBe("BUTTON");
    }
    // pd1 has a writer and a code: no pick controls. pd2 has a code, and
    // initials two people share: only the writer is asked for.
    expect(one("[data-import-writer-pick], [data-import-code-pick]", fileRow("pd1"))).toBeNull();
    expect(one("[data-import-code-pick]", fileRow("pd2"))).toBeNull();
    expect(text(inRow("pd2", "[data-import-writer-pick]"))).toBe("Choose writer");
    expect(text(inRow("pd4", "[data-import-writer-pick]"))).toBe("Choose writer");
    // Still being read: nothing to pick yet, and its cells are empty.
    expect(one("[data-import-writer-pick], [data-import-code-pick], [data-import-year-edit]", fileRow("pd5"))).toBeNull();
    // Could not be read: the amber words stay, but nothing opens.
    const failed = fileRow("pd6");
    expect(one("[data-import-writer-pick], [data-import-year-edit], [data-import-version-edit]", failed)).toBeNull();
    expect(text(one("[data-import-writer-tone]", failed))).toBe("No writer");
    expect(text(one("[data-import-file-state]", failed))).toBe("Could not be read");
  });

  it("moves a file to another category and company from its menu, and deletes it with Undo", async () => {
    const HALDEN = { companyKey: "halden foods", displayName: "Halden Foods", total: 98, needsCheck: 98 };
    __setQueryDataForArgs("ingestion:sheetSearch", { tab: "review", text: "hal" }, { files: [], companies: [HALDEN] });
    __setQueryDataForArgs("ingestion:sheetSearch", { tab: "review", text: "halden foods" }, { files: [], companies: [HALDEN] });
    __setQueryDataForArgs("ingestion:sheetSearch", { tab: "review", text: "Northgate Labs" }, { files: [], companies: [] });
    await mount();

    await userEvent.hover(fileRow("pd2"));
    await userEvent.click(inRow("pd2", "[data-import-row-menu]"));
    await userEvent.click(page.getByRole("menuitem", { name: "Move to another category" }));
    // The six categories; the file's own is checked and cannot be picked.
    await expect.poll(() => all("[data-import-move-category]").map((node) => text(node))).toEqual([
      "Final PD",
      "Draft",
      "Review copy",
      "Transcript",
      "Supporting file",
      "Company file",
    ]);
    expect(one('[data-import-move-category="final_pd"]')!.hasAttribute("data-disabled")).toBe(true);
    await userEvent.click(one('[data-import-move-category="transcript"]')!);
    await expect.poll(labelCalls).toEqual([{ ids: ["pd2"], patch: { category: "transcript" } }]);
    // It says so, with Undo, which sets the category it had back (live QA fixes).
    await expect.element(page.getByText("Moved to Transcripts")).toBeVisible();
    await userEvent.click(undoIn("Moved to Transcripts"));
    await expect.poll(() => labelCalls().at(-1)).toEqual({ ids: ["pd2"], patch: { category: "final_pd" } });

    // Another company: the companies on the sheet, found with sheetSearch.
    await userEvent.click(inRow("pd2", "[data-import-row-menu]"));
    await userEvent.click(page.getByRole("menuitem", { name: "Move to another company" }));
    const companySearch = page.getByRole("combobox", { name: "Company" });
    await expect.element(companySearch).toHaveFocus();
    await userEvent.fill(companySearch, "hal");
    await expect.poll(() => all("[data-import-name-option]").map((node) => text(node))).toEqual(["Halden Foods"]);
    await userEvent.click(one('[data-import-name-option="Halden Foods"]')!);
    await expect.poll(() => labelCalls().at(-1)).toEqual({ ids: ["pd2"], patch: { company: "Halden Foods" } });
    // Focus goes back to the row's "...".
    await expect.poll(() => document.activeElement).toBe(inRow("pd2", "[data-import-row-menu]"));
    await expect.element(page.getByText("Moved to Halden Foods")).toBeVisible();
    await userEvent.click(undoIn("Moved to Halden Foods"));
    await expect.poll(() => labelCalls().at(-1)).toEqual({ ids: ["pd2"], patch: { company: "Cedarline Systems" } });

    // A company's name typed in other capitals is that company, never a new one:
    // Enter picks it as it is spelled.
    await userEvent.click(inRow("pd2", "[data-import-row-menu]"));
    await userEvent.click(page.getByRole("menuitem", { name: "Move to another company" }));
    await userEvent.fill(page.getByRole("combobox", { name: "Company" }), "halden foods");
    await expect.poll(() => all("[data-import-name-option]").map((node) => text(node))).toEqual(["Halden Foods"]);
    expect(one("[data-import-name-new]")).toBeNull();
    const calls = labelCalls().length;
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => labelCalls().slice(calls)).toEqual([{ ids: ["pd2"], patch: { company: "Halden Foods" } }]);

    // While the search for what is typed has not answered, "New company" is not offered and Enter picks nothing.
    await userEvent.click(inRow("pd2", "[data-import-row-menu]"));
    await userEvent.click(page.getByRole("menuitem", { name: "Move to another company" }));
    await userEvent.fill(page.getByRole("combobox", { name: "Company" }), "Brightwell");
    await expect.element(page.getByText("Searching...")).toBeVisible();
    expect(one("[data-import-name-new]")).toBeNull();
    const before = labelCalls().length;
    await userEvent.keyboard("{Enter}");
    expect(labelCalls()).toHaveLength(before);

    // Or a new company, typed, once the search has found none.
    await userEvent.fill(page.getByRole("combobox", { name: "Company" }), "Northgate Labs");
    await userEvent.click(page.getByText('New company "Northgate Labs"'));
    await expect.poll(() => labelCalls().at(-1)).toEqual({ ids: ["pd2"], patch: { company: "Northgate Labs" } });

    // Delete: gone from To review, with "1 file deleted" and Undo.
    await userEvent.click(inRow("pd2", "[data-import-row-menu]"));
    await userEvent.click(page.getByRole("menuitem", { name: "Delete" }));
    await expect.poll(() => __mutationCalls("ingestion:removeItems")).toEqual([{ ids: ["pd2"] }]);
    await expect.element(page.getByText("1 file deleted")).toBeVisible();
    await userEvent.click(undoIn("1 file deleted"));
    await expect.poll(() => __mutationCalls("ingestion:restoreItems")).toEqual([{ ids: ["pd2"] }]);

    // A file still being read can be moved but not deleted yet.
    await userEvent.click(inRow("pd5", "[data-import-row-menu]"));
    await expect.element(page.getByRole("menuitem", { name: "Delete" })).toHaveAttribute("aria-disabled", "true");
    await expect.element(page.getByText("It can be deleted once it is read.")).toBeVisible();
    await expect.element(page.getByRole("menuitem", { name: "Move to another company" })).not.toHaveAttribute("aria-disabled", "true");
  });

  it("moves focus to the next row's menu, else the previous row's, else the section, when a menu action takes the row away", async () => {
    await mount();
    const rowsWithout = (...gone: string[]) => FINAL_PDS.filter((entry) => !gone.includes(entry._id));

    // Delete pd2: the row goes, and focus goes to the next row's "...".
    inRow("pd2", "[data-import-row-menu]").focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.click(page.getByRole("menuitem", { name: "Delete" }));
    await expect.poll(() => __mutationCalls("ingestion:removeItems")).toEqual([{ ids: ["pd2"] }]);
    __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("final_pd"), rowsWithout("pd2"));
    await expect.poll(() => one('[data-import-file="pd2"]')).toBeNull();
    await expect.poll(() => document.activeElement).toBe(inRow("pd4", "[data-import-row-menu]"));

    // Move the last row to another category: focus goes to the row before it.
    inRow("pd6", "[data-import-row-menu]").focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.click(page.getByRole("menuitem", { name: "Move to another category" }));
    await userEvent.click(one('[data-import-move-category="draft"]')!);
    await expect.poll(() => labelCalls().at(-1)).toEqual({ ids: ["pd6"], patch: { category: "draft" } });
    __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("final_pd"), rowsWithout("pd2", "pd6"));
    await expect.poll(() => one('[data-import-file="pd6"]')).toBeNull();
    await expect.poll(() => document.activeElement).toBe(inRow("pd5", "[data-import-row-menu]"));

    // The only row of a section: focus goes to the section's label.
    await userEvent.click(page.getByRole("button", { name: /^Supporting files/ }));
    await expect.poll(() => one('[data-import-file="sup1"]')).not.toBeNull();
    inRow("sup1", "[data-import-row-menu]").focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.click(page.getByRole("menuitem", { name: "Delete" }));
    await expect.poll(() => __mutationCalls("ingestion:removeItems").length).toBe(2);
    __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("supporting"), []);
    await expect.poll(() => one('[data-import-file="sup1"]')).toBeNull();
    await expect
      .poll(() => document.activeElement)
      .toBe(one('[data-import-section="supporting"] [data-import-section-toggle]'));

    // A change that left the row where it was moves nothing.
    __setMutationHandler("ingestion:setSheetLabels", (args) => ({
      changed: 0,
      changedIds: [],
      skipped: [{ id: (args as { ids: string[] }).ids[0], reason: "not_on_tab" }],
    }));
    inRow("pd1", "[data-import-row-menu]").focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.click(page.getByRole("menuitem", { name: "Move to another category" }));
    await userEvent.click(one('[data-import-move-category="transcript"]')!);
    await expect.element(page.getByText("The change was not saved.")).toBeVisible();
    await expect.element(page.getByText("1 file is no longer on To review.")).toBeVisible();
  });

  it("sets or corrects the PD number from the row's menu, also on a file whose name gave none, by the server's rule (Greptile fix)", async () => {
    await mount();
    // A final PD whose file name gave no number.
    __setPaginatedRowsForArgs("ingestion:sheetFiles", filesArgs("final_pd"), [
      ...FINAL_PDS,
      row("pd8", { name: "route notes.docx", fiscalYearEnd: MAR_31_2025, writerName: "Priya Nair", scienceCode: "2.02.09", scienceCodeSource: "person" }),
    ]);
    await expect.poll(() => all("[data-import-file]").length).toBe(FINAL_PDS.length + 1);
    expect(one("[data-import-file-prefix]", fileRow("pd8"))).toBeNull();
    const search = () => one("[data-import-pd-number-picker] [data-import-name-search]") as HTMLInputElement;

    await userEvent.hover(fileRow("pd8"));
    await userEvent.click(inRow("pd8", "[data-import-row-menu]"));
    await userEvent.click(page.getByRole("menuitem", { name: "Set the PD number" }));
    await expect.poll(() => document.activeElement).toBe(search());
    await expect.poll(() => all("[data-import-pd-number-picker] [data-import-name-option]").length).toBe(20);
    // A number the server would refuse is refused here, in its words, and nothing is sent.
    await userEvent.fill(search(), "25");
    await expect.element(page.getByText("A PD number is 1 to 20, with an optional letter, for example 4 or 12a.")).toBeVisible();
    expect(one("[data-import-name-new]")).toBeNull();
    // "07" is PD 7, one of the list.
    await userEvent.fill(search(), "07");
    await expect.poll(() => all("[data-import-pd-number-picker] [data-import-name-option]").map((node) => text(node))).toEqual(["PD 7"]);
    await userEvent.keyboard("{Enter}");
    await expect.poll(labelCalls).toEqual([{ ids: ["pd8"], patch: { pdNumber: "7" } }]);
    await expect.poll(() => document.activeElement).toBe(inRow("pd8", "[data-import-row-menu]"));

    // A wrong number is corrected the same way; a letter is typed.
    await userEvent.click(inRow("pd4", "[data-import-row-menu]"));
    await expect.element(page.getByRole("menuitem", { name: /^Change the PD number/ })).toBeVisible();
    expect(text(one('[data-import-row-action="pd-number"]'))).toBe("Change the PD number PD 4");
    await userEvent.click(page.getByRole("menuitem", { name: /^Change the PD number/ }));
    await expect.poll(() => one('[data-import-pd-number-picker] [data-import-name-option="4"]')?.getAttribute("aria-current")).toBe("true");
    await userEvent.fill(search(), "12A");
    await userEvent.click(page.getByText('Use "PD 12A"'));
    await expect.poll(() => labelCalls().at(-1)).toEqual({ ids: ["pd4"], patch: { pdNumber: "12A" } });

    // Only where a PD number goes: not on a supporting file, nor one still being read.
    await userEvent.click(page.getByRole("button", { name: /^Supporting files/ }));
    await expect.poll(() => one('[data-import-file="sup1"]')).not.toBeNull();
    await userEvent.click(inRow("sup1", "[data-import-row-menu]"));
    await expect.element(page.getByRole("menuitem", { name: "Delete" })).toBeVisible();
    expect(one('[data-import-row-action="pd-number"]')).toBeNull();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(inRow("pd5", "[data-import-row-menu]"));
    await expect.element(page.getByRole("menuitem", { name: "Delete" })).toBeVisible();
    expect(one('[data-import-row-action="pd-number"]')).toBeNull();
  });

  it("shows the server's words when a change is refused", async () => {
    await mount();
    __setMutationHandler("ingestion:setSheetLabels", () => {
      throw Object.assign(new Error("[CONVEX M(ingestion:setSheetLabels)] Server Error"), {
        data: { code: "INVALID_INPUT", message: "A version number is a whole number from 0 to 99." },
      });
    });
    await userEvent.click(inRow("pd1", "[data-import-version-edit]"));
    await userEvent.click(page.getByRole("button", { name: "T5" }));
    await expect.element(page.getByText("A version number is a whole number from 0 to 99.")).toBeVisible();
  });

  it("opens a cell's menu and the calendar with Enter or Space, closes them with Escape, and returns focus to the cell", async () => {
    await mount();
    const version = inRow("pd1", "[data-import-version-edit]");
    version.focus();
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => one("[data-import-version-menu]")).not.toBeNull();
    // Tab moves through the menu's choices.
    await expect.poll(() => one("[data-import-version-menu]")!.contains(document.activeElement)).toBe(true);
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => one("[data-import-version-menu]")).toBeNull();
    expect(document.activeElement).toBe(version);

    const year = inRow("pd1", "[data-import-year-edit]");
    year.focus();
    await userEvent.keyboard(" ");
    await expect.poll(() => one("[data-date-quick-picks]")).not.toBeNull();
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => one("[data-date-quick-picks]")).toBeNull();
    expect(document.activeElement).toBe(year);

    const writer = inRow("pd1", "[data-import-writer-edit]");
    writer.focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByRole("combobox", { name: "Writer" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => document.activeElement).toBe(writer);

    // The row's "..." opens with Enter too, and is shown on keyboard focus.
    const menu = inRow("pd1", "[data-import-row-menu]");
    menu.focus();
    await expect.poll(() => getComputedStyle(menu).opacity).toBe("1");
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByRole("menuitem", { name: "Move to another category" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => document.activeElement).toBe(menu);
  });

  it("captures the writer picker, with team members and past writers, at 1280 and 1100 wide (2026-11-16)", async () => {
    for (const width of [1280, 1100]) {
      document.body.innerHTML = "";
      await page.viewport(width, 900);
      await mount();
      await userEvent.click(inRow("pd2", "[data-import-writer-pick]"));
      await expect.poll(optionLabels).toEqual(OPTION_LABELS);
      // The list sits inside the window.
      for (const node of [one("[data-import-name-search]")!, ...all("[data-import-name-option]")]) {
        expect(node.getBoundingClientRect().right).toBeLessThanOrEqual(width);
      }
      await page.screenshot({ path: `../../../../.vitest-attachments/import-writers/import-picker-${width}.png` });
      await userEvent.keyboard("{Escape}");
    }
    await page.viewport(1280, 800);
  });
});
