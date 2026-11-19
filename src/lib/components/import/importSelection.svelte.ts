/**
 * Which files are selected on the Import sheet (2026-11-11 phase 3b, board
 * ao4). ImportPage keeps one, above the sheet, so a selection survives "To
 * check" and opening and closing companies and sections; the page clears it
 * on a tab change, when Select is turned off, and after an action.
 *
 * Each open section lists its loaded rows here once its read has answered,
 * so a company's or section's checkbox can select what is on screen and show
 * whether all, some or none of it is selected. Nothing beyond the loaded
 * rows is ever selected: the bar's count is the truth.
 *
 * The selection stays honest (phase 3b fixes): when a section reads again
 * with the same arguments and a selected file it listed is gone (approved
 * or deleted elsewhere, moved out of what is open), and no other open section
 * lists it, the file leaves the selection; actions drop what the server
 * changed or found gone (remove). A "select when it opens" request belongs
 * to one company and category, is used up the first time that section lists
 * (even with nothing to select), goes when the section closes first, and
 * all of them go when the selection is cleared.
 */
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { checkState, type CheckState } from "./importEdit";
import type { ImportCategory, SheetFileRow } from "./importFormat";

export type SelectedFile = Pick<SheetFileRow, "_id" | "name" | "status" | "category" | "fiscalYearEnd"> &
  Partial<Pick<SheetFileRow, "deletedReason">>;
type FileId = SheetFileRow["_id"];

const sectionKey = (companyKey: string, category: ImportCategory) => JSON.stringify([companyKey, category]);

function slim(row: SelectedFile): SelectedFile {
  return {
    _id: row._id,
    name: row.name,
    status: row.status,
    category: row.category,
    fiscalYearEnd: row.fiscalYearEnd,
    ...(row.deletedReason !== undefined ? { deletedReason: row.deletedReason } : {}),
  };
}

function same(a: SelectedFile, b: SelectedFile): boolean {
  return (
    a.name === b.name &&
    a.status === b.status &&
    a.category === b.category &&
    a.fiscalYearEnd === b.fiscalYearEnd &&
    a.deletedReason === b.deletedReason
  );
}

type Listing = {
  companyKey: string;
  /** The company's name ("Halden Foods"), or null for "No company yet". */
  company: string | null;
  /** The read the rows came from (its arguments): a new read may list other rows without any leaving. */
  read: string;
  rows: SelectedFile[];
};

/** A selected file as an open section lists it now, with its company. */
export type OnScreen = { file: SelectedFile; companyKey: string; company: string | null };

export class ImportSelection {
  /** Select is on: the checkbox column shows. */
  on = $state(false);
  /** The selected files, as they were when last listed. */
  readonly files = new SvelteMap<FileId, SelectedFile>();
  /** The selectable rows each open section lists. */
  readonly #listed = new SvelteMap<string, Listing>();
  /** Sections whose rows are selected the first time they list. */
  readonly #pending = new SvelteSet<string>();
  /** Selected files a section stopped listing, checked once every section has listed. */
  #vanished = new Set<FileId>();
  #checkScheduled = false;

  get size(): number {
    return this.files.size;
  }

  get ids(): FileId[] {
    return [...this.files.keys()];
  }

  /** The selected files, in the order they were selected. */
  get selected(): SelectedFile[] {
    return [...this.files.values()];
  }

  has(id: FileId): boolean {
    return this.files.has(id);
  }

  set(row: SelectedFile, value: boolean) {
    if (value) this.files.set(row._id, slim(row));
    else this.files.delete(row._id);
  }

  setMany(rows: readonly SelectedFile[], value: boolean) {
    for (const row of rows) this.set(row, value);
  }

  /** What the selection holds about a selected file, after a change made to it (a move from its menu). */
  update(id: FileId, change: Partial<Pick<SelectedFile, "category" | "status">>) {
    const held = this.files.get(id);
    if (held) this.files.set(id, { ...held, ...change });
  }

  /** Drops these files from the selection (the ones an action changed or found gone). */
  remove(ids: readonly FileId[]) {
    for (const id of ids) this.files.delete(id);
  }

  /** Nothing selected, and nothing waiting to be. Select stays as it is. */
  clear() {
    this.files.clear();
    this.#pending.clear();
  }

  /** Turns Select on or off; off clears the selection. */
  setOn(value: boolean) {
    this.on = value;
    if (!value) this.clear();
  }

  /**
   * What an open section lists once its read has answered: its selectable
   * rows, from the read `read` (its arguments, such as "To check"), in the
   * company named `company` (null for "No company yet"). Refreshes
   * what the selection holds about those files; uses up the section's
   * "select when it opens" request (selecting its rows, if any); and when the
   * same read no longer lists a selected file it listed, that file leaves
   * the selection unless another open section lists it. Call it untracked:
   * it reads and writes the selection.
   */
  list(
    companyKey: string,
    category: ImportCategory,
    read: string,
    rows: readonly SelectedFile[],
    company: string | null = null
  ) {
    const key = sectionKey(companyKey, category);
    const before = this.#listed.get(key);
    this.#listed.set(key, { companyKey, company, read, rows: rows.map(slim) });
    for (const row of rows) {
      const held = this.files.get(row._id);
      if (held && !same(held, row)) this.files.set(row._id, slim(row));
    }
    if (before && before.read === read) {
      const now = new Set(rows.map((row) => row._id));
      for (const row of before.rows) if (!now.has(row._id) && this.files.has(row._id)) this.#vanished.add(row._id);
      this.#checkVanished();
    }
    if (this.#pending.delete(key)) this.setMany(rows, true);
  }

  /** A section closed or left the sheet: what it listed, and any request for it, go. */
  unlist(companyKey: string, category: ImportCategory) {
    const key = sectionKey(companyKey, category);
    this.#listed.delete(key);
    this.#pending.delete(key);
  }

  /**
   * Once every section has listed what one update brought (a file moved
   * from one open section to another is in the second by then), drop the
   * vanished files no section lists.
   */
  #checkVanished() {
    if (this.#checkScheduled) return;
    this.#checkScheduled = true;
    queueMicrotask(() => {
      this.#checkScheduled = false;
      const vanished = this.#vanished;
      this.#vanished = new Set();
      const listed = new Set<FileId>();
      for (const entry of this.#listed.values()) for (const row of entry.rows) listed.add(row._id);
      for (const id of vanished) if (!listed.has(id)) this.files.delete(id);
    });
  }

  /** The loaded rows of one section, or of every open section of a company. */
  listed(companyKey: string, category?: ImportCategory): SelectedFile[] {
    if (category !== undefined) return this.#listed.get(sectionKey(companyKey, category))?.rows ?? [];
    const rows: SelectedFile[] = [];
    for (const entry of this.#listed.values()) if (entry.companyKey === companyKey) rows.push(...entry.rows);
    return rows;
  }

  /** Whether a section's read has answered while it is open. */
  isListed(companyKey: string, category: ImportCategory): boolean {
    return this.#listed.has(sectionKey(companyKey, category));
  }

  /**
   * The selected files an open section lists now, as it lists them, with
   * their company (live QA fixes): what the bar knows for sure about each
   * file, for where the year end calendar opens and a move's Undo.
   */
  get onScreen(): OnScreen[] {
    const found = new Map<FileId, OnScreen>();
    for (const entry of this.#listed.values()) {
      for (const row of entry.rows) {
        if (this.files.has(row._id) && !found.has(row._id)) {
          found.set(row._id, { file: row, companyKey: entry.companyKey, company: entry.company });
        }
      }
    }
    return [...found.values()];
  }

  /** Selects one section's rows the first time it lists (it is opening, or still reading). */
  selectWhenListed(companyKey: string, category: ImportCategory) {
    this.#pending.add(sectionKey(companyKey, category));
  }

  /** Whether a section is waiting for its rows to be selected. */
  waiting(companyKey: string, category: ImportCategory): boolean {
    return this.#pending.has(sectionKey(companyKey, category));
  }

  /** All, some or none of these loaded rows selected. */
  stateOf(rows: readonly SelectedFile[]): CheckState {
    return checkState(
      rows.map((row) => row._id),
      (id) => this.files.has(id as FileId)
    );
  }

  /**
   * A company's or section's checkbox: with rows on screen, selects them
   * all, or clears them when they all are. Returns false when there is
   * nothing on screen to select, so the caller can open it first.
   */
  toggleRows(rows: readonly SelectedFile[]): boolean {
    if (rows.length === 0) return false;
    this.setMany(rows, this.stateOf(rows) !== "all");
    return true;
  }
}
