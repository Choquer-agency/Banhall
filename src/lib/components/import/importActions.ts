/**
 * Deleting and putting back files on the Import sheet (2026-11-11 phase 3b),
 * shared by a row's menu, its "Put back" and the selection bar: the calls in
 * runs of at most 100, then the app's toast. A delete's toast offers Undo,
 * which puts back exactly the files that delete changed (its changedIds).
 * A move's toast offers Undo too (moveBack), which sets the category or
 * company each moved file had before. Saying which writer some initials
 * are (matchWriter, 2026-11-12) offers Undo the same way.
 * Files a call left as they were are named in the toast, by reason.
 *
 * The toast and the selection bar both sit at the bottom centre, so while
 * the bar shows, these toasts are lifted above it (IMPORT_TOAST).
 */
import { toast } from "svelte-sonner";
import { userErrorMessage } from "$lib/errors";
import { boardRem } from "$lib/rootScale";
import { TOAST_BOTTOM_OFFSET } from "$lib/components/shell/AppToaster.svelte";
import { plural, type ImportCategory, type SheetTab } from "./importFormat";
import {
  deletedText,
  NOTHING_CHANGED,
  putBackText,
  runInChunks,
  skippedText,
  stoppedText,
  TRY_AGAIN,
  WRITER_MATCH_MORE,
  writerMatchedText,
  type BatchResult,
  type ChunkRun,
  type FileId,
  type MoveBackGroup,
  type MovePatch,
  type WriterChoice,
} from "./importEdit";
import {
  addSendBack,
  BRAIN_COPY_UPDATED,
  editedText,
  emptySendBack,
  REOPEN_REFUSALS,
  REOPENED_BRAIN_CHECK,
  SEND_BACK_BATCH,
  sentBackDetails,
  sentBackText,
  type ApprovedEditField,
  type ReopenBrainCheckResult,
  type SendBackResult,
} from "./importApproved";

export type BatchCall = (args: { ids: FileId[] }) => Promise<BatchResult>;
export type MoveCall = (args: { ids: FileId[]; patch: MovePatch }) => Promise<BatchResult>;
export type RemoveGroupResult = {
  changedIds: FileId[];
  skippedBeingRead: number;
  skippedIds?: FileId[];
  hasMore: boolean;
  nextCursor?: string | null;
};
export type RemoveGroupCall = (args: {
  companyKey: string;
  category?: ImportCategory;
  cursor?: string | null;
}) => Promise<RemoveGroupResult>;

/**
 * Where the selection bar's top sits above the window's bottom: bottom-6
 * (1.5rem) plus h-11 (2.75rem) / touch 3.25rem, and a 0.625rem gap (ImportSelectionBar).
 */
const ABOVE_BAR = "5.375rem";

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
 * A move's Undo (live QA fixes, 2026-11-11): sets each moved file's category
 * or company back through setSheetLabels, one group per value, in runs of at
 * most 100. Like a delete's Undo it says nothing when every file went back;
 * it names the files the server left as they were, and how far it got when
 * a call failed.
 */
export async function moveBack(groups: readonly MoveBackGroup[], setLabels: MoveCall, tab: SheetTab): Promise<void> {
  const total = groups.reduce((count, group) => count + group.ids.length, 0);
  const changed: FileId[] = [];
  const skipped: ChunkRun["skipped"] = [];
  for (const group of groups) {
    const run = await runInChunks(group.ids, (part) => setLabels({ ids: part, patch: group.patch }));
    changed.push(...run.changedIds);
    skipped.push(...run.skipped);
    if (run.error) {
      const reason = userErrorMessage(run.error, TRY_AGAIN);
      toast.error(stoppedText("Changed", changed.length, total, reason), {
        ...IMPORT_TOAST,
        description: skippedText(skipped, tab) || undefined,
      });
      return;
    }
  }
  const description = skippedText(skipped, tab);
  if (description) {
    toast(changed.length > 0 ? `${plural(changed.length, "file")} moved back` : NOTHING_CHANGED, { ...IMPORT_TOAST, description });
  }
}

/** The Undo action for a move's toast, or nothing when the move cannot be undone. */
export function moveUndo(groups: readonly MoveBackGroup[] | null, setLabels: MoveCall, tab: SheetTab) {
  if (!groups || groups.length === 0) return {};
  return { action: { label: "Undo", onClick: () => void moveBack(groups, setLabels, tab) } };
}

export type WriterMatch = {
  initials: string;
  writerName: string | null;
  /** The pick before, as a choice an Undo sends back (null: there was none). */
  previous: WriterChoice | null;
  changed: number;
  more: boolean;
};
export type WriterMatchCall = (args: { initials: string; writer: WriterChoice | null }) => Promise<WriterMatch>;

/**
 * Says which writer some initials are for the whole firm (2026-11-12; since
 * 2026-11-16 a pick that wins over the check on saved initials,
 * ingestion.matchWriterInitials), then "KT is Kim Tran on 9 files" with
 * Undo, which puts back the pick there was before (or none, so the check
 * decides again). Like the other Undos, it says nothing unless it fails.
 * True when the pick was saved.
 */
export async function matchWriter(
  initials: string,
  picked: { choice: WriterChoice; label: string },
  match: WriterMatchCall,
  role: "writer" | "reviewer" = "writer"
): Promise<boolean> {
  // The cell it came from (2026-11-17: a pick from the Reviewer cell says "reviewer").
  const who = role === "reviewer" ? "reviewer" : "writer";
  let result: WriterMatch;
  try {
    result = await match({ initials, writer: picked.choice });
  } catch (error) {
    toast.error(userErrorMessage(error, `The ${who} could not be saved.`), IMPORT_TOAST);
    return false;
  }
  const undo = async () => {
    try {
      await match({ initials, writer: result.previous });
    } catch (error) {
      toast.error(userErrorMessage(error, `The ${who} could not be set back.`), IMPORT_TOAST);
    }
  };
  toast(writerMatchedText(initials, result.writerName ?? picked.label, result.changed, result.more), {
    ...IMPORT_TOAST,
    description: result.more ? WRITER_MATCH_MORE : undefined,
    action: { label: "Undo", onClick: () => void undo() },
  });
  return true;
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

/**
 * Soft-deletes all staged ("To review") files in a company band or category
 * section via `removeGroupItems` (looping while `hasMore`), removes them from
 * any active selection, and offers Undo via `restoreItems`.
 */
export async function deleteGroupFiles(
  target: { companyKey: string; category?: ImportCategory },
  removeGroup: RemoveGroupCall,
  restore: BatchCall,
  options?: { onRemoved?: (ids: FileId[]) => void }
): Promise<{ changedIds: FileId[]; skippedBeingRead: number; error: unknown }> {
  const MAX_PASSES = 50;
  const changedIds: FileId[] = [];
  const skippedIdSet = new Set<FileId>();
  let fallbackSkipped = 0;
  let sawSkippedIds = false;
  let cursor: string | null | undefined = undefined;
  let error: unknown = null;
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    try {
      const res = await removeGroup(cursor !== undefined ? { ...target, cursor } : target);
      changedIds.push(...res.changedIds);
      if (res.skippedIds) {
        sawSkippedIds = true;
        for (const id of res.skippedIds) skippedIdSet.add(id);
      } else {
        fallbackSkipped += res.skippedBeingRead;
      }
      if (!res.hasMore) break;
      if (res.nextCursor !== undefined) {
        if (res.nextCursor === null || res.nextCursor === cursor) break;
        cursor = res.nextCursor;
      }
    } catch (failure) {
      error = failure;
      break;
    }
  }
  const skippedBeingRead = sawSkippedIds ? skippedIdSet.size : fallbackSkipped;
  if (changedIds.length > 0) options?.onRemoved?.(changedIds);
  const beingReadNote =
    skippedBeingRead > 0
      ? `${plural(skippedBeingRead, "file")} left out because ${skippedBeingRead === 1 ? "it is" : "they are"} still being read.`
      : undefined;
  const undo =
    changedIds.length > 0
      ? {
          label: "Undo",
          onClick: () => void putBackFiles(changedIds, restore, { tab: "review", undo: true }),
        }
      : undefined;
  if (error) {
    const reason = userErrorMessage(error, TRY_AGAIN);
    toast.error(changedIds.length > 0 ? `${deletedText(changedIds.length)}. ${reason}` : reason, {
      ...IMPORT_TOAST,
      description: beingReadNote,
      ...(undo ? { action: undo } : {}),
    });
  } else if (changedIds.length > 0) {
    toast(deletedText(changedIds.length), {
      ...IMPORT_TOAST,
      description: beingReadNote,
      ...(undo ? { action: undo } : {}),
    });
  } else {
    toast(NOTHING_CHANGED, { ...IMPORT_TOAST, description: beingReadNote });
  }
  return { changedIds, skippedBeingRead, error };
}

// ─── The Approved tab (2026-11-17) ──────────────────────────────────────────

export type SendBackCall = (args: { ids: FileId[] }) => Promise<SendBackResult>;

/**
 * Send back to review: the files in calls of up to 50, one after another,
 * stopping at the first call that fails, then one toast that says how many
 * went back, what became of their Brain copies, and what was left as it
 * was. Returns what the calls that went through did.
 */
export async function sendBackFiles(
  ids: readonly FileId[],
  call: SendBackCall
): Promise<{ result: SendBackResult; error: unknown }> {
  let result = emptySendBack();
  let error: unknown = null;
  // Up to 50 a call; a call that spent its read budget hands back the files
  // it did not reach, and they go first in the next one, until none is left.
  let queue = [...ids];
  while (queue.length > 0) {
    const batch = queue.slice(0, SEND_BACK_BATCH);
    try {
      result = addSendBack(result, await call({ ids: batch }));
    } catch (failure) {
      error = failure;
      break;
    }
    const notReached = result.notReached;
    // Every call looks at its first file, so a call that reached nothing would loop: stop.
    if (notReached.length >= batch.length) break;
    queue = [...notReached, ...queue.slice(batch.length)];
  }
  const description = sentBackDetails(result) || undefined;
  if (error) {
    const reason = userErrorMessage(error, TRY_AGAIN);
    const done = result.sentBack.length;
    toast.error(done > 0 ? `${sentBackText(done)}. ${reason}` : reason, { ...IMPORT_TOAST, description });
  } else {
    toast(sentBackText(result.sentBack.length), { ...IMPORT_TOAST, description });
  }
  return { result, error };
}

export type ReopenBrainCheckCall = (args: { ids: FileId[] }) => Promise<ReopenBrainCheckResult>;

/**
 * "Put back in Brain check" for one kept out final PD (2026-11-18): it waits
 * for its Brain check again. Says so, or why not, in a toast. True when it
 * was put back.
 */
export async function reopenBrainCheckFile(id: FileId, call: ReopenBrainCheckCall): Promise<boolean> {
  try {
    const result = await call({ ids: [id] });
    if (result.reopened.includes(id)) {
      toast(REOPENED_BRAIN_CHECK, IMPORT_TOAST);
      return true;
    }
    const refused = result.refused.find((entry) => entry.id === id);
    toast.error(refused ? REOPEN_REFUSALS[refused.reason] : TRY_AGAIN, IMPORT_TOAST);
    return false;
  } catch (error) {
    toast.error(userErrorMessage(error, TRY_AGAIN), IMPORT_TOAST);
    return false;
  }
}

export type ApprovedEditCall = (args: {
  id: FileId;
  patch: ApprovedEditPatch;
}) => Promise<{ changed: ApprovedEditField[]; brainUpdated: boolean }>;
export type ApprovedEditPatch = {
  writer?: WriterChoice;
  reviewer?: WriterChoice | null;
  scienceCode?: string;
  pdTitle?: string;
  craReviewed?: boolean;
};

/**
 * One edit to an approved file (2026-11-17): saved, then a toast that names
 * what changed ("Writer changed"), and says when its Brain copy followed. A
 * refusal shows the server's words. True when the file changed.
 */
export async function editApproved(
  id: FileId,
  field: ApprovedEditField,
  patch: ApprovedEditPatch,
  call: ApprovedEditCall
): Promise<boolean> {
  try {
    const result = await call({ id, patch });
    if (result.changed.length === 0) return false;
    toast(editedText(field, patch.craReviewed), {
      ...IMPORT_TOAST,
      ...(result.brainUpdated ? { description: BRAIN_COPY_UPDATED } : {}),
    });
    return true;
  } catch (error) {
    toast.error(userErrorMessage(error, "The change could not be saved."), IMPORT_TOAST);
    return false;
  }
}
