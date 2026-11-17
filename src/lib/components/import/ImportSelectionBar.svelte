<!--
  The dark bar at the bottom of the Import page while files are selected
  (boards ao4 and ao6), in the look of a company's Files bar: "6 files
  selected", then on To review Category, Fiscal year and More (Company,
  Writer, PD number, Science code), each a menu above the bar with the same picker as
  one file and a confirm line that names the action ("Move 6 files to
  Transcripts"), and Delete, which says once that nothing changes outside
  Import. On Deleted, only Put back. The X clears the selection.

  Changes go to setSheetLabels, deletes to removeItems and put backs to
  restoreItems, at most 100 files a call, one call after another. Each
  action sends only the selected files it can change (the shared rule in
  shared/importSheetRules.ts, the server's too) and says plainly which it
  left out and why ("3 transcripts were left out: a science code only goes
  on a final PD"); files the server left as they were are named in the
  toast by reason. When a call fails the run stops, the toast says how many
  changed, the files changed or gone leave the selection and the rest stay
  selected; otherwise the selection clears. While the bar shows, the
  toasts sit above it.

  Live QA fixes (2026-11-11): the year end calendar opens on the newest
  year end among the selected files listed on screen (else last year's
  Dec 31), so its quick picks land in that year. A move to another category
  or company offers Undo when every file it took is listed on screen, so
  the value each had is known; Undo sets those back for the files it changed.
-->
<script lang="ts">
  import { Popover } from "bits-ui";
  import { useMutation } from "convex-svelte";
  import { toast } from "svelte-sonner";
  import {
    ArrowCounterClockwiseIcon,
    BuildingsIcon,
    CalendarBlankIcon,
    CaretDownIcon,
    CaretLeftIcon,
    CheckIcon,
    FlaskIcon,
    HashIcon,
    TagIcon,
    TrashIcon,
    UserIcon,
    XIcon,
  } from "phosphor-svelte";
  import { api } from "../../../../convex/_generated/api";
  import DatePicker from "$lib/components/ui/DatePicker.svelte";
  import ScienceCodeList from "$lib/components/project/details/ScienceCodeList.svelte";
  import { userErrorMessage } from "$lib/errors";
  import ImportCompanyList from "./ImportCompanyList.svelte";
  import ImportPdNumberList from "./ImportPdNumberList.svelte";
  import ImportWriterList, { type PickedWriter } from "./ImportWriterList.svelte";
  import { deleteFiles, IMPORT_TOAST, moveUndo, putBackFiles } from "./importActions";
  import {
    changedText,
    changePatch,
    confirmLine,
    DELETE_NOTE,
    deleteLine,
    leftOutText,
    MOVE_CATEGORIES,
    moveBackGroups,
    NOTHING_CHANGED,
    putBackLine,
    runInChunks,
    settledIds,
    skippedText,
    splitForChange,
    stoppedText,
    TRY_AGAIN,
    utcDayFromDateInput,
    yearEndCalendarStart,
    YEAR_END_HELPER,
    YEAR_END_QUICK_PICKS,
    type BarChange,
    type ChangeSplit,
    type ChunkRun,
    type FileId,
    type MoveBackGroup,
  } from "./importEdit";
  import { formatCount, type ImportCategory, type SheetTab } from "./importFormat";
  import type { ImportSelection, SelectedFile } from "./importSelection.svelte";
  import { CHOICE_ROW, CONFIRM_LINE, POPOVER_CARD, SHEET_SMALL } from "./sheetLayout";

  let { selection, tab }: { selection: ImportSelection; tab: SheetTab } = $props();

  type Split = ChangeSplit<SelectedFile>;

  const setLabels = useMutation(api.ingestion.setSheetLabels);
  const removeItems = useMutation(api.ingestion.removeItems);
  const restoreItems = useMutation(api.ingestion.restoreItems);

  let busy = $state(false);
  const count = $derived(selection.size);

  // ─── Menus ──────────────────────────────────────────────────────────────
  let categoryOpen = $state(false);
  let yearOpen = $state(false);
  let moreOpen = $state(false);
  let deleteOpen = $state(false);

  let pickedCategory = $state<ImportCategory | null>(null);
  let pickedDay = $state("");
  let moreView = $state<"list" | "company" | "writer" | "pdNumber" | "scienceCode">("list");
  let pickedCompany = $state<string | null>(null);
  let pickedWriter = $state<PickedWriter | null>(null);
  let pickedPdNumber = $state<string | null>(null);
  let pickedCode = $state<string | null>(null);

  // A menu that closes forgets what was picked in it.
  $effect(() => {
    if (!categoryOpen) pickedCategory = null;
  });
  $effect(() => {
    if (!yearOpen) pickedDay = "";
  });
  $effect(() => {
    if (moreOpen) return;
    moreView = "list";
    pickedCompany = null;
    pickedWriter = null;
    pickedPdNumber = null;
    pickedCode = null;
  });

  /** The category every selected file is in, checked in the menu; null when they differ. */
  const sharedCategory = $derived.by(() => {
    const categories = new Set(selection.selected.map((file) => file.category));
    return categories.size === 1 ? [...categories][0] : null;
  });
  const pickedYearEnd = $derived(pickedDay ? utcDayFromDateInput(pickedDay) : null);
  const moreChange = $derived.by((): BarChange | null => {
    if (moreView === "company" && pickedCompany) return { kind: "company", company: pickedCompany };
    if (moreView === "writer" && pickedWriter) return { kind: "writer", writer: pickedWriter.choice, writerName: pickedWriter.label };
    if (moreView === "pdNumber" && pickedPdNumber) return { kind: "pdNumber", pdNumber: pickedPdNumber };
    if (moreView === "scienceCode" && pickedCode) return { kind: "scienceCode", scienceCode: pickedCode };
    return null;
  });

  // ─── Which selected files each action takes ─────────────────────────────
  // The shared rule, so the bar never sends what the server would skip.
  const forCategory = $derived(splitForChange("category", selection.selected));
  const forYear = $derived(splitForChange("fiscalYearEnd", selection.selected));
  const forMore = $derived(moreView === "list" ? null : splitForChange(moreView, selection.selected));
  const forDelete = $derived(splitForChange("delete", selection.selected));

  function closeMenus() {
    categoryOpen = false;
    yearOpen = false;
    moreOpen = false;
    deleteOpen = false;
  }

  /** The bar goes once nothing is selected; focus goes to Select instead of the page. */
  function finish() {
    document.querySelector<HTMLElement>("[data-import-select-toggle]")?.focus();
    selection.clear();
  }

  /**
   * After a run: a run that went through clears the selection (focus to
   * Select); one that stopped drops what it changed or found gone and keeps
   * the rest. Returns how many stay selected, for the toast.
   */
  function settle(run: ChunkRun): number | null {
    if (!run.error) {
      finish();
      return null;
    }
    selection.remove(settledIds(run));
    return selection.size;
  }

  /**
   * Where the year end calendar opens (live QA fixes): on the newest year end
   * among the selected files listed on screen, else last year's Dec 31, so
   * its quick picks land in that year and not in this one.
   */
  const yearStart = $derived(yearEndCalendarStart(selection.onScreen.map((entry) => entry.file.fiscalYearEnd)));

  /**
   * A move's Undo, from what the sheet lists now (live QA fixes): every
   * file the move takes must be listed on screen, so its category, or the
   * company whose band lists it, is known. Otherwise, or when a file has no
   * company yet (which a change cannot set back), the toast has no Undo.
   */
  function moveBackFor(change: BarChange, taken: readonly SelectedFile[]): MoveBackGroup[] | null {
    if (change.kind !== "category" && change.kind !== "company") return null;
    const shown = new Map(selection.onScreen.map((entry) => [entry.file._id, entry]));
    const files = [];
    for (const file of taken) {
      const entry = shown.get(file._id);
      if (!entry) return null;
      files.push({ _id: file._id, before: change.kind === "category" ? entry.file.category : entry.company });
    }
    return moveBackGroups(change.kind, files);
  }

  /** Only the files the move changed go back. */
  function onlyChanged(groups: MoveBackGroup[] | null, changed: readonly FileId[]): MoveBackGroup[] | null {
    if (!groups) return null;
    const moved = new Set(changed);
    return groups.map((group) => ({ ...group, ids: group.ids.filter((id) => moved.has(id)) })).filter((group) => group.ids.length > 0);
  }

  // ─── Actions ────────────────────────────────────────────────────────────
  async function apply(change: BarChange) {
    if (busy) return;
    closeMenus();
    const { taken, leftOut } = splitForChange(change.kind, selection.selected);
    const ids = taken.map((file) => file._id);
    if (ids.length === 0) return;
    // Read before the move: once it is saved, the rows list their new values.
    const back = moveBackFor(change, taken);
    busy = true;
    try {
      const patch = changePatch(change);
      const run = await runInChunks(ids, (part) => setLabels({ ids: part, patch }));
      const stillSelected = settle(run);
      const description = [leftOutText(leftOut), skippedText(run.skipped, tab)].filter(Boolean).join(" ") || undefined;
      const undo = moveUndo(onlyChanged(back, run.changedIds), setLabels, tab);
      if (run.error) {
        const reason = userErrorMessage(run.error, TRY_AGAIN);
        toast.error(stoppedText("Changed", run.changedIds.length, ids.length, reason, stillSelected), {
          ...IMPORT_TOAST,
          description,
          ...undo,
        });
        return;
      }
      toast(run.changedIds.length > 0 ? changedText(change, run.changedIds.length) : NOTHING_CHANGED, {
        ...IMPORT_TOAST,
        description,
        ...undo,
      });
    } finally {
      busy = false;
    }
  }

  async function remove() {
    if (busy) return;
    closeMenus();
    const ids = forDelete.taken.map((file) => file._id);
    if (ids.length === 0) return;
    busy = true;
    try {
      await deleteFiles(ids, removeItems, restoreItems, { tab, settle, leftOut: leftOutText(forDelete.leftOut) });
    } finally {
      busy = false;
    }
  }

  async function putBack() {
    if (busy) return;
    const ids = selection.ids;
    if (ids.length === 0) return;
    busy = true;
    try {
      await putBackFiles(ids, restoreItems, { tab, settle });
    } finally {
      busy = false;
    }
  }

  const barButton =
    "inline-flex h-8 items-center gap-1.5 rounded-[0.4375rem] px-3 text-[0.8125rem] leading-[calc(18/13)] font-medium whitespace-nowrap transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-light disabled:opacity-50 motion-reduce:transition-none pointer-coarse:h-11";
  const plainButton = `${barButton} bg-white/10 text-white hover:bg-white/15 data-[state=open]:bg-white/15`;
  const menuContent = `${POPOVER_CARD} max-w-[calc(100vw-1.5rem)] overflow-hidden`;
</script>

{#snippet caret()}
  <CaretDownIcon size="0.75rem" aria-hidden="true" class="text-ink-faint" />
{/snippet}

{#snippet leftOutNote(split: Split)}
  {#if split.leftOut.length > 0}
    <p data-import-bar-left-out class="px-1.5 pb-1.5 text-xs leading-[1.5] text-ink-muted">{leftOutText(split.leftOut)}</p>
  {/if}
{/snippet}

{#snippet confirmButton(change: BarChange, split: Split)}
  {#if split.taken.length > 0}
    <button type="button" disabled={busy} data-import-bar-confirm onclick={() => void apply(change)} class={CONFIRM_LINE}>
      {confirmLine(change, split.taken.length)}
    </button>
  {/if}
{/snippet}

{#snippet confirm(change: BarChange | null, split: Split | null)}
  {#if change && split}
    <div class="border-t border-line-soft p-1.5">
      {@render leftOutNote(split)}
      {@render confirmButton(change, split)}
    </div>
  {/if}
{/snippet}

{#snippet back(title: string)}
  <div class="flex items-center gap-1 border-b border-line-soft px-1.5 py-1">
    <button
      type="button"
      aria-label="Back"
      data-import-bar-back
      onclick={() => (moreView = "list")}
      class="flex size-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none"
    >
      <CaretLeftIcon size="0.75rem" aria-hidden="true" />
    </button>
    <span class={`${SHEET_SMALL} text-ink-muted`}>{title}</span>
  </div>
{/snippet}

<div
  role="toolbar"
  aria-label="Selected files"
  data-import-selection-bar
  data-menu-open={categoryOpen || yearOpen || moreOpen || deleteOpen ? "" : undefined}
  class="fixed bottom-8 left-1/2 z-[90] flex h-12 max-w-[calc(100vw-1.5rem)] -translate-x-1/2 items-center gap-1.5 overflow-x-auto rounded-xl bg-ink pr-1.5 pl-4 shadow-review-bar"
>
  <span data-import-bar-count class="flex h-6 items-center border-r border-white/20 pr-3.5 text-[0.8125rem] leading-[calc(18/13)] font-medium whitespace-nowrap text-white" aria-live="polite">
    {formatCount(count)} {count === 1 ? "file" : "files"} selected
  </span>

  {#if tab === "review"}
    <Popover.Root bind:open={categoryOpen}>
      <Popover.Trigger disabled={busy} data-import-bar-category class={`ml-1.5 ${plainButton}`}>
        <TagIcon size="0.875rem" aria-hidden="true" class="text-on-ink-muted" />
        Category
        {@render caret()}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="top" align="start" sideOffset={8} collisionPadding={12} aria-label="Category" class={`${menuContent} w-[14.5rem]`}>
          <div role="group" aria-label="Move to" class="flex flex-col p-1.5">
            {#each MOVE_CATEGORIES as entry (entry.category)}
              <button
                type="button"
                aria-pressed={pickedCategory === entry.category}
                data-import-bar-category-choice={entry.category}
                onclick={() => (pickedCategory = entry.category)}
                class={CHOICE_ROW}
              >
                <span class="min-w-0 flex-1">{entry.label}</span>
                {#if sharedCategory === entry.category}<CheckIcon size="0.875rem" aria-label="Now" class="shrink-0 text-primary-selected" />{/if}
              </button>
            {/each}
          </div>
          {@render confirm(pickedCategory ? { kind: "category", category: pickedCategory } : null, forCategory)}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>

    <DatePicker
      bind:value={pickedDay}
      bind:open={yearOpen}
      openOn={yearStart}
      side="top"
      closeOnPick={false}
      heading="Year end"
      quickPicks={YEAR_END_QUICK_PICKS}
      helper={YEAR_END_HELPER}
    >
      {#snippet trigger({ props })}
        <button {...props} type="button" disabled={busy} data-import-bar-year class={plainButton}>
          <CalendarBlankIcon size="0.875rem" aria-hidden="true" class="text-on-ink-muted" />
          Fiscal year
          {@render caret()}
        </button>
      {/snippet}
      {#snippet footer()}
        {#if pickedYearEnd !== null}
          {@render leftOutNote(forYear)}
          {@render confirmButton({ kind: "fiscalYearEnd", fiscalYearEnd: pickedYearEnd }, forYear)}
        {/if}
      {/snippet}
    </DatePicker>

    <Popover.Root bind:open={moreOpen}>
      <Popover.Trigger disabled={busy} data-import-bar-more class={plainButton}>
        More
        {@render caret()}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          aria-label="More changes"
          class={`${menuContent} ${moreView === "scienceCode" ? "w-[22rem]" : moreView === "list" ? "w-[13.5rem]" : "w-[17.5rem]"}`}
        >
          {#if moreView === "list"}
            <div role="group" aria-label="Change" class="flex flex-col p-1.5">
              <button type="button" data-import-bar-more-choice="company" onclick={() => (moreView = "company")} class={CHOICE_ROW}>
                <BuildingsIcon size="0.875rem" aria-hidden="true" class="shrink-0 text-ink-muted" />Company
              </button>
              <button type="button" data-import-bar-more-choice="writer" onclick={() => (moreView = "writer")} class={CHOICE_ROW}>
                <UserIcon size="0.875rem" aria-hidden="true" class="shrink-0 text-ink-muted" />Writer
              </button>
              <button type="button" data-import-bar-more-choice="pdNumber" onclick={() => (moreView = "pdNumber")} class={CHOICE_ROW}>
                <HashIcon size="0.875rem" aria-hidden="true" class="shrink-0 text-ink-muted" />PD number
              </button>
              <button type="button" data-import-bar-more-choice="scienceCode" onclick={() => (moreView = "scienceCode")} class={CHOICE_ROW}>
                <FlaskIcon size="0.875rem" aria-hidden="true" class="shrink-0 text-ink-muted" />Science code
              </button>
            </div>
          {:else if moreView === "company"}
            {@render back("Company")}
            <ImportCompanyList current={pickedCompany} onPick={(name) => (pickedCompany = name)} />
          {:else if moreView === "writer"}
            {@render back("Writer")}
            <ImportWriterList currentValue={pickedWriter?.value ?? null} onPick={(picked) => (pickedWriter = picked)} />
          {:else if moreView === "pdNumber"}
            {@render back("PD number")}
            <ImportPdNumberList current={pickedPdNumber} onPick={(value) => (pickedPdNumber = value)} />
          {:else}
            {@render back("Science code")}
            <ScienceCodeList value={pickedCode} clearable={false} maxHeight="max-h-[min(20rem,calc(100dvh-10rem))]" onSelect={(code) => (pickedCode = code)} />
          {/if}
          {@render confirm(moreChange, forMore)}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>

    <Popover.Root bind:open={deleteOpen}>
      <Popover.Trigger disabled={busy || forDelete.taken.length === 0} data-import-bar-delete class={`${barButton} bg-danger/15 text-danger-border hover:bg-danger/25 data-[state=open]:bg-danger/25`}>
        <TrashIcon size="0.875rem" aria-hidden="true" class="text-danger-line" />
        Delete
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="top" align="center" sideOffset={8} collisionPadding={12} aria-label="Delete" class={`${menuContent} w-[18.5rem] p-3`}>
          <p data-import-delete-note class="text-xs leading-[1.5] text-ink-muted">{DELETE_NOTE}</p>
          {#if forDelete.leftOut.length > 0}
            <p data-import-delete-left-out class="mt-1.5 text-xs leading-[1.5] text-ink-muted">{leftOutText(forDelete.leftOut)}</p>
          {/if}
          <button
            type="button"
            disabled={busy}
            data-import-bar-confirm
            onclick={() => void remove()}
            class="mt-2.5 flex min-h-9 w-full items-center justify-center rounded-md bg-danger-surface px-3 text-[0.8125rem] leading-[calc(18/13)] font-medium text-danger-ink-muted transition-colors hover:bg-danger-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir disabled:opacity-60 motion-reduce:transition-none pointer-coarse:min-h-11"
          >{deleteLine(forDelete.taken.length)}</button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  {:else if tab === "deleted"}
    <button type="button" disabled={busy} data-import-bar-put-back onclick={() => void putBack()} class={`ml-1.5 ${plainButton}`} aria-label={putBackLine(count)}>
      <ArrowCounterClockwiseIcon size="0.875rem" aria-hidden="true" class="text-on-ink-muted" />
      Put back
    </button>
  {/if}

  <span class="ml-1.5 flex h-6 w-[2.375rem] shrink-0 items-center justify-center border-l border-white/20 pl-1">
    <button
      type="button"
      aria-label="Clear selection"
      data-import-bar-clear
      onclick={finish}
      class="flex size-7 items-center justify-center rounded-md text-on-ink-muted transition-colors hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-light motion-reduce:transition-none pointer-coarse:size-11"
    >
      <XIcon size="0.875rem" aria-hidden="true" />
    </button>
  </span>
</div>

<style>
  /*
   * The bar and the app's toasts share the bottom centre. While the bar is on
   * the page, the Import page's own toasts (class import-toast, importActions
   * IMPORT_TOAST, which carries how far to lift) sit above it; when it goes,
   * they drop back. Other toasts, and the app's Toaster, are unchanged.
   */
  :global(body:has([data-import-selection-bar]) [data-sonner-toast].import-toast) {
    bottom: var(--import-toast-lift, 0);
  }

  /* A menu over the bar opens into that space: the toasts step out of its way until it closes. */
  :global(body:has([data-import-selection-bar][data-menu-open]) [data-sonner-toast].import-toast) {
    visibility: hidden;
  }
</style>
