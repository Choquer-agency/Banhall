/**
 * Deleting and putting back files on the Import sheet (2026-11-11 phase 3b),
 * shared by a row's menu, its "Put back" and the selection bar: the calls in
 * runs of at most 100, then the app's toast. A delete's toast offers Undo,
 * which puts back exactly the files that delete changed (its changedIds).
 * Files a call left as they were are named in the toast, by reason.
 *
 * The toast and the selection bar both sit at the bottom centre, so while
 * the bar shows, these toasts are lifted above it (IMPORT_TOAST).
 */
import { toast } from "svelte-sonner";
import { userErrorMessage } from "$lib/errors";
import { boardRem } from "$lib/rootScale";
import { TOAST_BOTTOM_OFFSET } from "$lib/components/shell/AppToaster.svelte";
import type { SheetTab } from "./importFormat";
import {
  deletedText,
  NOTHING_CHANGED,
  putBackText,
  runInChunks,
  skippedText,
  stoppedText,
  TRY_AGAIN,
  type BatchResult,
  type ChunkRun,
  type FileId,
} from "./importEdit";

export type BatchCall = (args: { ids: FileId[] }) => Promise<BatchResult>;

/**
 * Where the selection bar's top sits above the window's bottom: bottom-8
 * (2rem) plus h-12 (3rem), and a 0.75rem gap (ImportSelectionBar).
 */
const ABOVE_BAR = "5.75rem";

/**
 * Per-toast options for every Import toast: a class, and how far to lift it
 * inside the app's Toaster (which already sits TOAST_BOTTOM_OFFSET above the
 * bottom) to clear the selection bar. ImportSelectionBar's style applies the
 * lift only while the bar is on the page, so a toast moves up when the bar
 * comes and back down when it goes. The app's Toaster is unchanged.
 */
export const IMPORT_TOAST = {
  class: "import-toast",
  style: `--import-toast-lift: calc(${ABOVE_BAR} - ${boardRem(TOAST_BOTTOM_OFFSET)});`,
} as const;


export type ActionOptions = {
  /** The tab the files are on, for the words of a skip. */
  tab: SheetTab;
  /**
   * Runs once the calls are done, before the toasts: the caller settles its
   * selection and says how many files stay selected (null when none stay
   * because of this action, as for a row's menu).
   */
  settle?: (run: ChunkRun) => number | null;
  /** Words for files the caller left out before sending, said in the toast. */
  leftOut?: string;
};

function notesOf(run: ChunkRun, tab: SheetTab, leftOut?: string): string | undefined {
  return [leftOut ?? "", skippedText(run.skipped, tab)].filter(Boolean).join(" ") || undefined;
}

/** Puts files back on To review; says so unless it is an Undo, and names what it left. */
export async function putBackFiles(
  ids: readonly FileId[],
  restore: BatchCall,
  options: ActionOptions & { undo?: boolean }
): Promise<ChunkRun> {
  const run = await runInChunks(ids, (part) => restore({ ids: part }));
  const stillSelected = options.settle?.(run) ?? null;
  // An Undo is about files that were on To review; a put back, about the Deleted tab.
  const description = notesOf(run, options.undo ? "review" : "deleted", options.leftOut);
  if (run.error) {
    const reason = userErrorMessage(run.error, TRY_AGAIN);
    toast.error(stoppedText("Put back", run.changedIds.length, ids.length, reason, stillSelected), { ...IMPORT_TOAST, description });
  } else if (!options.undo || description) {
    const title = run.changedIds.length > 0 ? putBackText(run.changedIds.length) : NOTHING_CHANGED;
    toast(title, { ...IMPORT_TOAST, description });
  }
  return run;
}

/**
 * Deletes files from Import, then "N files deleted" with Undo for exactly
 * the ones it changed, and the files it left with why.
 */
export async function deleteFiles(
  ids: readonly FileId[],
  remove: BatchCall,
  restore: BatchCall,
  options: ActionOptions
): Promise<ChunkRun> {
  const run = await runInChunks(ids, (part) => remove({ ids: part }));
  const stillSelected = options.settle?.(run) ?? null;
  const description = notesOf(run, options.tab, options.leftOut);
  const taken = run.changedIds;
  const undo = {
    label: "Undo",
    // Its own run: the selection it settled is not touched again.
    onClick: () => void putBackFiles(taken, restore, { tab: options.tab, undo: true }),
  };
  if (run.error) {
    const reason = userErrorMessage(run.error, TRY_AGAIN);
    toast.error(stoppedText("Deleted", taken.length, ids.length, reason, stillSelected), {
      ...IMPORT_TOAST,
      description,
      ...(taken.length > 0 ? { action: undo } : {}),
    });
  } else if (taken.length > 0) {
    toast(deletedText(taken.length), { ...IMPORT_TOAST, description, action: undo });
  } else {
    toast(NOTHING_CHANGED, { ...IMPORT_TOAST, description });
  }
  return run;
}
