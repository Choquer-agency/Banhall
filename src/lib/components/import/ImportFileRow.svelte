<!--
  One file on the Import sheet (boards ao4 and ao5): 44px, the lightest
  hairline above it, the four fixed columns each behind a light rule. File
  shows "PD 4" muted and the PD's title for a file named like a PD, else the
  file name, then "Being read" (muted) or "Could not be read" (amber). A
  file that arrived in the last 24 hours has the soft green "New" label
  10px after its name (2026-11-12, Paper Files 2 and 3); a file still being
  read says that instead.
  Fiscal year is the year alone with the year end in a tooltip; Version
  "T2"; Writer the name, or the file name's initials; Science code the code
  and its title, after the AI mark when it was read from the document. The
  cells' words are secondary ink (Paper Files 1). Amber marks only what a
  person must fill in. A cell whose label the file's category does not take
  stays empty (fileCells).

  Writers from initials (2026-11-12, 2026-11-16): a file whose name gave
  initials shows the writer they give (a team member, or a writer with no
  login such as "DW") as plain words, with no AI mark. A final PD whose
  initials could be more than one person, or that has no writer at all,
  shows the amber "Choose writer"; a draft or review copy shows the
  initials muted. A writer chosen on a file whose writer follows its
  initials says "KT is Kim Tran" for the whole firm (matchWriter, with
  Undo); on any other file it sets that file alone, and that wins for it.

  Reviewers (2026-11-17): the Reviewer cell after Writer shows who reviewed
  the PD, from the file name's reviewer initials by the same check, as plain
  words. With no reviewer (initials that could be more than one person, or
  none) an editable cell says "Choose reviewer" in quiet words, never
  amber: a reviewer is never required. The same picker as Writer; a choice
  on a file whose reviewer follows its initials is a pick for those
  initials for the whole firm (matchWriter, with Undo, which moves writers
  and reviewers alike); on any other file it sets that file alone
  (setFileReviewers). It is editable on To review and Deleted, and on
  Approved for one file at a time (below). A final PD an Admin marked as
  reviewed by CRA shows a quiet "Reviewed by CRA" tag after its name, on
  every tab; the "..." sets and clears it.

  On To review (2026-11-11 phase 3b) a read file's cells are its pickers,
  each cell's one tab stop: the year end calendar, the version menu, the
  writer (team members, past writers or a typed name) and, on a final PD,
  the science code; a final PD with no writer or code shows the amber
  "Choose writer" or "Pick a code". The "..." at the row's end moves or deletes the file, on
  any row, read or not; when that takes the row away, focus goes to the next
  row's "...". A move says so in a toast with Undo, which sets the category
  or company back. On Deleted the row ends with why the file is there and,
  for a file a person deleted or rejected, "Put back". With Select on, a
  checkbox comes first, named with the file and its company. On Approved
  only metadata changes (below). The row's "..." also sets the PD number on a read final PD,
  draft or review copy (Greptile fix, 2026-11-17), with or without one from
  the file name; "PD 4" then shows before the title. What a row may do is the shared rule
  (shared/importSheetRules.ts) the server follows too.

  Approve on Import (2026-11-17): the file's name opens the file view (its
  labels and text, read only; importFileView.ts), and so does Open in the
  row's menu. On Approved a final PD's name is followed by a small icon in
  a fixed 20px slot for what became of it in the Brain, its words ("In the
  Brain", "Waiting for its Brain check", "Kept out of the Brain", "Removed
  from the Brain") on hover and for screen readers, so the name keeps its
  room; the Brain check icon has the primary wash. The row ends with a
  small link to the company page its file is on, or a muted mark when it
  is on none (removed there since, or approved on the old page).

  Edit after approval and Send back (2026-11-17): on Approved the Writer,
  Reviewer and Science code cells are the same pickers as on To review, and
  a choice sets this file alone (editApprovedFile): never a firm-wide pick
  for its initials. The row's own "..." (after the company page link) has
  Open, "Reviewed by CRA" on a final PD and Send back to review, with its
  confirm; once a file is sent back its row leaves the tab and focus goes
  on, as after a move.

  Narrow windows (live QA fixes, 2026-11-11): the name keeps its room and
  the words after it give way first; a name or science code title cut short
  shows in full in a tooltip on hover (and on keyboard focus of the code's
  control), with no new tab stops. The "..." sits over the end of the
  Science code cell on hover and focus instead of keeping room there all
  the time. In search results the company is a second line under the name.
-->
<script lang="ts">
  import { mergeProps } from "bits-ui";
  import type { FunctionArgs } from "convex/server";
  import { useMutation } from "convex-svelte";
  import { toast } from "svelte-sonner";
  import { BrainIcon, BuildingsIcon, CaretDownIcon, HourglassMediumIcon, ProhibitIcon, SealCheckIcon, TrashIcon } from "phosphor-svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import Tooltip from "$lib/components/ui/Tooltip.svelte";
  import AuroraMark from "$lib/components/ui/AuroraMark.svelte";
  import Checkbox from "$lib/components/ui/Checkbox.svelte";
  import DatePicker from "$lib/components/ui/DatePicker.svelte";
  import ScienceCodeList from "$lib/components/project/details/ScienceCodeList.svelte";
  import { userErrorMessage } from "$lib/errors";
  import ImportPickerPopover from "./ImportPickerPopover.svelte";
  import ImportRowMenu from "./ImportRowMenu.svelte";
  import ImportVersionPicker from "./ImportVersionPicker.svelte";
  import ImportWriterList, { type PickedWriter } from "./ImportWriterList.svelte";
  import { resolve } from "$app/paths";
  import { companiesPath } from "$lib/companies/companies";
  import { deleteFiles, editApproved, IMPORT_TOAST, matchWriter, moveUndo, putBackFiles, sendBackFiles, type ApprovedEditPatch } from "./importActions";
  import type { ApprovedEditField } from "./importApproved";
  import ImportApprovedRowMenu from "./ImportApprovedRowMenu.svelte";
  import { BRAIN_STATE_TEXT, NOT_ON_COMPANY_PAGE } from "./importApprove";
  import { useFileView } from "./importFileView";
  import {
    CHOOSE_REVIEWER,
    CRA_REVIEWED,
    dateInputFromUtcDay,
    deletedReasonText,
    fileSelectLabel,
    moveBackGroups,
    movedText,
    CHOOSE_WRITER,
    rowAbilities,
    settledIds,
    skippedText,
    utcDayFromDateInput,
    yearEndCalendarStart,
    YEAR_END_HELPER,
    YEAR_END_QUICK_PICKS,
    type BatchResult,
    type MovePatch,
  } from "./importEdit";
  import { fileCells, isBeingRead, type SheetFileRow, type SheetTab, type Tone } from "./importFormat";
  import type { ImportSelection } from "./importSelection.svelte";
  import {
    AMBER,
    CELL_BUTTON,
    CELL_CARET,
    CELL_INK,
    CELL_WORDS,
    FIXED_CELL,
    PICK_CARET_SIZE,
    PICK_CONTROL,
    ROW_MENU_ROOM,
    SELECT_CELL,
    SELECT_CELL_NESTED,
    sheetGrid,
    SHEET_SMALL,
    SHEET_TEXT,
  } from "./sheetLayout";

  type LabelPatch = FunctionArgs<typeof api.ingestion.setSheetLabels>["patch"];

  let {
    row,
    tab,
    companyName = null,
    company = null,
    inset = "section",
    selection = null,
  }: {
    row: SheetFileRow;
    tab: SheetTab;
    /** Search results name the file's company after it. */
    companyName?: string | null;
    /** The company the file is in, for the company picker. */
    company?: string | null;
    /** `section`: inside a section's 24px indent. `sheet`: a top-level row (search results). */
    inset?: "section" | "sheet";
    /** The page's selection; none in search results. */
    selection?: ImportSelection | null;
  } = $props();

  const cells = $derived(fileCells(row));
  const fileView = useFileView();
  /** On Approved: what the file became (2026-11-17). */
  const approved = $derived(tab === "approved" && row.status === "approved");
  const brainWords = $derived(approved && row.brain ? BRAIN_STATE_TEXT[row.brain] : null);
  const BRAIN_ICONS = { in_brain: BrainIcon, brain_check: HourglassMediumIcon, kept_out: ProhibitIcon, removed: TrashIcon } as const;
  /** The New label: on To review, once the file is read (until then it says "Being read"). */
  const showNew = $derived(tab === "review" && cells.isNew && !isBeingRead(row.status));
  /** The name gives way only to the words after it: the New label, the CRA tag and the state. */
  const titleRoom = $derived(
    brainWords
      ? cells.craReviewed
        ? "max-w-[calc(100%-3.75rem)]"
        : "max-w-[calc(100%-1.75rem)]"
      : cells.craReviewed
      ? showNew
        ? "max-w-[calc(100%-6rem)]"
        : cells.state
          ? "max-w-[calc(100%-6.5rem)]"
          : "max-w-[calc(100%-2rem)]"
      : cells.state && showNew
      ? "max-w-[calc(100%-7rem)]"
      : cells.state
        ? "max-w-[calc(100%-3.25rem)]"
        : showNew
          ? "max-w-[calc(100%-3rem)]"
          : "max-w-full"
  );
  const can = $derived(rowAbilities(row, tab));
  const selectColumn = $derived(Boolean(selection?.on));
  const selected = $derived(selection?.has(row._id) ?? false);
  const reason = $derived(tab === "deleted" ? deletedReasonText(row.deletedReason) : null);
  const label = $derived(cells.prefix ? `${cells.prefix} ${cells.title}` : cells.title);
  const toneClass: Record<Tone, string> = { ink: CELL_INK, muted: "text-ink-muted", amber: AMBER };
  /** The same inside a cell's control, where the words turn ink while its picker is open. */
  const wordsClass: Record<Tone, string> = { ink: CELL_WORDS, muted: "truncate text-ink-muted", amber: `truncate ${AMBER}` };

  const setLabels = useMutation(api.ingestion.setSheetLabels);
  const removeItems = useMutation(api.ingestion.removeItems);
  const restoreItems = useMutation(api.ingestion.restoreItems);
  const matchInitials = useMutation(api.ingestion.matchWriterInitials);
  const confirmName = useMutation(api.ingestion.confirmWriterName);
  const setReviewers = useMutation(api.ingestion.setFileReviewers);
  const setCraReviewed = useMutation(api.ingestion.setCraReviewed);
  const editApprovedFile = useMutation(api.ingestion.editApprovedFile);
  const sendBackToReview = useMutation(api.ingestion.sendBackToReview);
  let editing = $state(false);

  /** One edit to this approved file (2026-11-17): it sets this file alone. */
  async function editThis(field: ApprovedEditField, patch: ApprovedEditPatch): Promise<boolean> {
    if (editing) return false;
    editing = true;
    try {
      return await editApproved(row._id, field, patch, editApprovedFile);
    } finally {
      editing = false;
    }
  }

  /** Send back to review from the row's menu; the file leaves the tab, and the selection. */
  async function sendBack(): Promise<boolean> {
    const { result } = await sendBackFiles([row._id], sendBackToReview);
    // A file refused because it is gone or no longer approved leaves the
    // selection; one that stays approved (an approval running, a widely
    // shared Brain copy) stays in it.
    selection?.remove([
      ...result.sentBack,
      ...result.refused.filter((entry) => entry.reason === "missing" || entry.reason === "not_approved").map((entry) => entry.id),
    ]);
    return result.sentBack.includes(row._id);
  }

  /** Whether the file's writer follows its name's initials: no person set one on the file itself. */
  const followsInitials = $derived(
    row.writerNameSource !== "person" && !(row.editedLabels ?? []).includes("writerName")
  );

  /**
   * A writer chosen in the Writer cell (2026-11-12, 2026-11-16). On a file
   * whose name gave initials and whose writer follows them, the choice says
   * which writer those initials are for the whole firm; otherwise it sets
   * this file's writer, which wins for it. Choosing the writer it has
   * changes no file; when that writer's name came from a PD, the choice
   * makes the name a person's (Greptile fix, 2026-11-17), so a later PD
   * never takes it back. Otherwise it is nothing.
   */
  function pickWriter(picked: PickedWriter) {
    if (picked.current) {
      if (picked.nameFromDocument && picked.choice.kind === "writer") void confirmWriter(picked.choice.writerId);
      return;
    }
    // An approved file keeps skipping picks for its initials: a choice there is for it alone.
    if (approved) {
      void editThis("writer", { writer: picked.choice });
      return;
    }
    const initials = followsInitials ? (cells.writer?.initials ?? null) : null;
    if (initials) void matchWriter(initials, picked, matchInitials);
    else void change({ writer: picked.choice });
  }

  /** A writer's name from a PD made a person's; it says nothing unless it fails. */
  async function confirmWriter(writerId: Id<"pdWriters">) {
    try {
      await confirmName({ writerId });
    } catch (error) {
      toast.error(userErrorMessage(error, "The writer could not be saved."), IMPORT_TOAST);
    }
  }

  /**
   * A reviewer chosen in the Reviewer cell (2026-11-17), as for the writer:
   * on a file whose reviewer follows its name's initials the choice is a
   * pick for those initials for the whole firm (writers and reviewers);
   * otherwise it sets this file's reviewer alone, which wins for it.
   */
  function pickReviewer(picked: PickedWriter) {
    if (picked.current) return;
    // On Approved (2026-11-17) a choice sets this file alone, never a pick for its initials.
    if (approved) {
      void editThis("reviewer", { reviewer: picked.choice });
      return;
    }
    const initials = row.reviewerSource !== "person" ? (cells.reviewer?.initials ?? null) : null;
    if (initials) void matchWriter(initials, picked, matchInitials, "reviewer");
    else void oneFile(() => setReviewers({ ids: [row._id], reviewer: picked.choice }), "The reviewer could not be saved.");
  }

  /** Marks this final PD as reviewed by CRA, or clears the mark (2026-11-17). */
  function markCra(reviewed: boolean) {
    void oneFile(() => setCraReviewed({ ids: [row._id], reviewed }), "The change could not be saved.").then((done) => {
      if (done) toast(reviewed ? "Marked as reviewed by CRA" : `Cleared "${CRA_REVIEWED}"`, IMPORT_TOAST);
    });
  }

  /** One call for this file alone; a refusal or a skip says why. True when the file changed. */
  async function oneFile(call: () => Promise<BatchResult>, fallback: string): Promise<boolean> {
    try {
      const result = await call();
      if (result.skipped.length > 0) {
        toast.error("The change was not saved.", { ...IMPORT_TOAST, description: skippedText(result.skipped, tab) });
        selection?.remove(settledIds({ changedIds: [], skipped: result.skipped }));
      }
      return result.changedIds.includes(row._id);
    } catch (error) {
      toast.error(userErrorMessage(error, fallback), IMPORT_TOAST);
      return false;
    }
  }

  /**
   * One label on this file; a refusal shows the server's words, and a file
   * the server left as it was (approved elsewhere meanwhile) says why.
   * True when the file changed.
   */
  async function change(patch: LabelPatch): Promise<boolean> {
    try {
      const result = await setLabels({ ids: [row._id], patch });
      if (result.skipped.length > 0) {
        toast.error("The change was not saved.", { ...IMPORT_TOAST, description: skippedText(result.skipped, tab) });
        selection?.remove(settledIds({ changedIds: [], skipped: result.skipped }));
      }
      return result.changedIds.includes(row._id);
    } catch (error) {
      toast.error(userErrorMessage(error, "The change could not be saved."), IMPORT_TOAST);
      return false;
    }
  }

  /**
   * A move from the row's menu (live QA fixes): once it is saved, "Moved to
   * Drafts" or "Moved to Halden Foods" with Undo, which sets back the
   * category or company the file had. A file with no company yet cannot be
   * set back to none, so that move's toast has no Undo.
   */
  async function move(patch: MovePatch): Promise<boolean> {
    const id = row._id;
    const back =
      "category" in patch
        ? moveBackGroups("category", [{ _id: id, before: row.category }])
        : moveBackGroups("company", [{ _id: id, before: company }]);
    const moved = await change(patch);
    if (moved) toast(movedText(patch), { ...IMPORT_TOAST, ...moveUndo(back, setLabels, tab) });
    return moved;
  }

  /** Delete from the row's menu; a deleted or gone file leaves the selection, so the bar never sends it. */
  async function remove(): Promise<boolean> {
    const run = await deleteFiles([row._id], removeItems, restoreItems, {
      tab,
      settle: (done) => {
        selection?.remove(settledIds(done));
        return null;
      },
    });
    return run.changedIds.includes(row._id);
  }

  /** "Put back" on a Deleted row; the file leaves the tab, and the selection. */
  async function putBack() {
    await putBackFiles([row._id], restoreItems, {
      tab,
      settle: (done) => {
        selection?.remove(settledIds(done));
        return null;
      },
    });
  }

  // ─── Focus when the row goes (phase 3b fixes) ───────────────────────────
  // A move or delete from the row's menu takes the row off this list, and
  // focus, which the menu gave back to its "...", would fall to the page.
  // It goes to the next row's "...", else the previous row's, else the
  // section's label (else the company's), whichever is still there.
  let rowElement = $state<HTMLElement | null>(null);
  let focusAfter: HTMLElement[] | null = null;

  function rowMenuOf(element: Element | null): HTMLElement | null {
    return element?.matches("[data-import-file]") ? element.querySelector<HTMLElement>("[data-import-row-menu]") : null;
  }

  /** Runs a move or delete from the menu; if the file changed, focus moves on when its row goes. */
  async function leaveWith(action: () => Promise<boolean>) {
    const element = rowElement;
    const targets = element
      ? [
          rowMenuOf(element.nextElementSibling),
          rowMenuOf(element.previousElementSibling),
          element.closest("[data-import-section]")?.querySelector<HTMLElement>("[data-import-section-toggle]") ?? null,
          element.closest("[data-import-band]")?.querySelector<HTMLElement>("[data-import-band-toggle]") ?? null,
        ].filter((target): target is HTMLElement => target !== null)
      : [];
    focusAfter = targets;
    if (!(await action())) focusAfter = null;
  }

  // A row that stays after its change (a search result moved within the tab) has nothing to hand focus on to.
  $effect(() => {
    void row;
    focusAfter = null;
  });

  $effect(() => {
    return () => {
      const targets = focusAfter;
      if (!targets) return;
      // After the row's nodes are gone; only when focus was lost with them.
      queueMicrotask(() => {
        const active = document.activeElement;
        if (active && active !== document.body && active.isConnected) return;
        targets.find((target) => target.isConnected)?.focus();
      });
    };
  });

  function pickYear(value: string) {
    const end = utcDayFromDateInput(value);
    if (end === null) return;
    // The same day confirms a year end that was only assumed from the folder.
    if (end === row.fiscalYearEnd && !row.fiscalYearEndAssumed) return;
    void change({ fiscalYearEnd: end });
  }

  // ─── Words cut short (live QA fixes) ────────────────────────────────────
  // Measured as the pointer (or keyboard focus) arrives, so a tooltip only
  // repeats a name or title the cell had to cut.
  let nameCut = $state(false);
  let codeCut = $state(false);

  function isCut(event: Event, selector: string): boolean {
    const target = event.currentTarget as HTMLElement | null;
    const node = target?.matches(selector) ? target : target?.querySelector<HTMLElement>(selector);
    return node ? node.scrollWidth > node.clientWidth : false;
  }
  const measureName = (event: Event) => (nameCut = isCut(event, "[data-import-file-title]"));
  const measureCode = (event: Event) => (codeCut = isCut(event, "[data-import-code-title]"));

  /** A PD's title stands for its file name, which the tooltip gives (and the whole title, when cut). */
  const titleIsNotName = $derived(Boolean(cells.prefix) && cells.title !== row.name);
  const nameTip = $derived(titleIsNotName ? (nameCut ? `${cells.title} (${row.name})` : row.name) : cells.title);
  const codeTip = $derived(
    cells.scienceCode?.kind === "code" && cells.scienceCode.title ? `${cells.scienceCode.code} ${cells.scienceCode.title}` : ""
  );

  // Each name starts with the words the cell shows.
  const yearLabel = $derived(
    !cells.fiscalYear
      ? "Set the year end"
      : cells.fiscalYear.tooltip
        ? `Fiscal year ${cells.fiscalYear.text}, ${cells.fiscalYear.tooltip}. Change the year end`
        : `${cells.fiscalYear.text}. Set the year end`
  );
  const writerLabel = $derived(
    !cells.writer || cells.writer.tone === "amber"
      ? "Set the writer"
      : cells.writer.tone === "muted"
        ? `Writer ${cells.writer.text}, initials only. Set the writer's name`
        : cells.writer.remembered && cells.writer.initials && !approved
          ? `Writer ${cells.writer.text}, from the initials ${cells.writer.initials}. Change the writer for ${cells.writer.initials}`
          : `Writer ${cells.writer.text}. Change the writer`
  );
  const reviewerLabel = $derived(
    !cells.reviewer || cells.reviewer.missing
      ? cells.reviewer?.initials
        ? `${CHOOSE_REVIEWER}, initials ${cells.reviewer.initials}`
        : CHOOSE_REVIEWER
      : cells.reviewer.remembered && cells.reviewer.initials && row.reviewerSource !== "person" && !approved
        ? `Reviewer ${cells.reviewer.text}, from the initials ${cells.reviewer.initials}. Change the reviewer for ${cells.reviewer.initials}`
        : `Reviewer ${cells.reviewer.text}. Change the reviewer`
  );
  const codeLabel = $derived(
    cells.scienceCode?.kind === "code"
      ? `Science code ${cells.scienceCode.code}${cells.scienceCode.title ? ` ${cells.scienceCode.title}` : ""}${cells.scienceCode.fromDocument ? ", filled in by AI" : ""}. Change the science code`
      : "Set the science code"
  );
</script>

{#snippet yearWords()}
  {#if cells.fiscalYear}
    {@const year = cells.fiscalYear}
    <span data-import-year class={wordsClass[year.tone]}>{year.text}{#if year.tooltip}<span class="sr-only">, {year.tooltip}</span>{/if}</span>
  {/if}
{/snippet}

{#snippet yearPicker(tip: Record<string, unknown>)}
  <!-- Bound to the stored year end: the calendar shows what is saved, never a refused pick. -->
  <!-- With no year end yet it opens on last year's Dec 31, so a quick pick never lands in this year by default. -->
  <DatePicker
    bind:value={() => dateInputFromUtcDay(row.fiscalYearEnd), () => {}}
    openOn={yearEndCalendarStart([row.fiscalYearEnd])}
    heading="Year end"
    quickPicks={YEAR_END_QUICK_PICKS}
    helper={YEAR_END_HELPER}
    onCommit={pickYear}
  >
    {#snippet trigger({ props })}
      <button {...mergeProps(tip, props)} type="button" aria-label={yearLabel} data-import-year-edit class={CELL_BUTTON}>
        {@render yearWords()}
        <CaretDownIcon size={PICK_CARET_SIZE} aria-hidden="true" class={CELL_CARET} />
      </button>
    {/snippet}
  </DatePicker>
{/snippet}

{#snippet codeWords(readOnly: boolean)}
  {#if cells.scienceCode?.kind === "code"}
    <!-- Codes line up whether or not the mark is there (ao5). -->
    {#if cells.scienceCode.fromDocument}
      <AuroraMark size={14} label="Filled in by AI" />
    {:else}
      <span class="size-[0.875rem] shrink-0" aria-hidden="true"></span>
    {/if}
    <span data-import-code class={`shrink-0 ${readOnly ? CELL_INK : "text-ink-secondary group-data-[state=open]/cell:text-ink"}`}>{cells.scienceCode.code}</span>
    {#if cells.scienceCode.title && readOnly}
      <!-- Read only: the whole title on hover when it is cut; not a tab stop. -->
      <Tooltip text={codeTip} delayDuration={400} disabled={!codeCut}>
        {#snippet children({ props })}
          <span {...mergeProps({ onpointerenter: measureCode }, props)} tabindex="-1" data-import-code-title class={`min-w-0 truncate ${SHEET_SMALL} text-ink-muted @max-[8rem]:hidden`}>{cells.scienceCode?.kind === "code" ? cells.scienceCode.title : ""}</span>
        {/snippet}
      </Tooltip>
    {:else if cells.scienceCode.title}
      <span data-import-code-title class={`min-w-0 truncate ${SHEET_SMALL} text-ink-muted @max-[8rem]:hidden`}>{cells.scienceCode.title}</span>
    {/if}
  {/if}
{/snippet}

{#snippet nameLine()}
  {#if cells.prefix}
    <!-- 40px, then 10px to the title (Paper Files 1). -->
    <span data-import-file-prefix class="w-10 shrink-0 truncate text-ink-muted">{cells.prefix}</span>
  {/if}
  <!--
    The name never shrinks to make room for the words after it: they give way
    first, down to a few letters (the name may take all but 4rem of the line).
  -->
  <span class="@container flex min-w-0 flex-1 items-center gap-2.5">
    <!-- Hover only: a tab stop on every row would make the sheet slow to cross by keyboard. -->
    <Tooltip text={nameTip} delayDuration={400} disabled={!titleIsNotName && !nameCut}>
      {#snippet children({ props })}
        {#if fileView}
          <!-- Opens the file view. On To review the row's menu has Open, so the name is not a tab stop there. -->
          <button
            {...mergeProps({ onpointerenter: measureName, onclick: () => fileView.open(row._id) }, props)}
            type="button"
            tabindex={can.menu ? -1 : 0}
            aria-label={`Open ${label}`}
            data-import-file-title
            data-import-file-open={row._id}
            class={`relative z-[1] min-w-0 shrink-0 cursor-pointer truncate rounded-sm text-left text-ink underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir ${titleRoom}`}
          >{cells.title}</button>
        {:else}
          <span
            {...mergeProps({ onpointerenter: measureName }, props)}
            tabindex="-1"
            data-import-file-title
            class={`min-w-0 shrink-0 truncate text-ink ${titleRoom}`}
          >{cells.title}</span>
        {/if}
      {/snippet}
    </Tooltip>
    {#if showNew}
      <span
        data-import-file-new
        class="inline-flex h-5 shrink-0 items-center rounded-full bg-success-soft px-2 text-[0.6875rem] leading-[calc(14/11)] text-success-ink"
      >New</span>
    {/if}
    {#if brainWords && row.brain}
      {@const BrainStateIcon = BRAIN_ICONS[row.brain]}
      <!-- A fixed 20px slot, its words on hover and for screen readers, so the name keeps its room. -->
      <Tooltip text={brainWords} delayDuration={300}>
        {#snippet children({ props })}
          <span
            {...props}
            role="img"
            tabindex="-1"
            aria-label={brainWords}
            data-import-file-brain={row.brain}
            class={`flex size-5 shrink-0 items-center justify-center rounded-full ${
              row.brain === "brain_check" ? "bg-primary-wash text-fir" : "bg-gray-100 text-ink-muted"
            }`}
          ><BrainStateIcon size="0.75rem" aria-hidden="true" /></span>
        {/snippet}
      </Tooltip>
    {/if}
    {#if cells.craReviewed}
      <!-- A quiet neutral tag (2026-11-17): a fact an Admin recorded, nothing to do. -->
      <!--
        Just the seal while the name's line is narrow, as it is on laptop
        windows, so the name keeps its room; the seal and the words where the
        line has room. The words on hover and for screen readers always.
      -->
      <span
        data-import-file-cra
        title={CRA_REVIEWED}
        class="inline-flex h-5 max-w-max min-w-5 shrink items-center justify-center gap-1 overflow-hidden rounded-full bg-gray-100 px-1 text-[0.6875rem] leading-[calc(14/11)] whitespace-nowrap text-ink-muted @min-[18rem]:px-2"
      >
        <SealCheckIcon size="0.75rem" aria-hidden="true" class="shrink-0" />
        <span aria-hidden="true" data-import-file-cra-words class="hidden min-w-0 truncate @min-[18rem]:inline">{CRA_REVIEWED}</span>
        <span class="sr-only">{CRA_REVIEWED}</span>
      </span>
    {/if}
    {#if cells.state}
      <span
        data-import-file-state
        title={cells.state.text}
        class={`min-w-0 truncate ${SHEET_SMALL} ${cells.state.tone === "amber" ? AMBER : "text-ink-muted"}`}
      >{cells.state.text}</span>
    {/if}
  </span>
{/snippet}

<div
  bind:this={rowElement}
  role="row"
  data-import-file={row._id}
  data-import-file-category={row.category}
  data-import-file-selected={selected ? "" : undefined}
  class={`group/row relative ${sheetGrid(selectColumn, inset === "section")} h-11 border-t border-line-soft ${SHEET_TEXT} ${
    selected ? "bg-primary-wash" : can.menu || can.putBack ? "hover:bg-gray-50" : ""
  }`}
>
  {#if selectColumn}
    <div role="cell" data-import-select-cell class={`${inset === "section" ? SELECT_CELL_NESTED : SELECT_CELL} self-stretch ${selected ? "bg-primary-wash" : ""}`}>
      {#if can.select && selection}
        <Checkbox
          bind:checked={() => selected, (value) => selection?.set(row, value)}
          aria-label={fileSelectLabel(label, row.name, company)}
          data-import-file-select={row._id}
        />
      {/if}
    </div>
  {/if}

  <div role="cell" data-import-cell="file" class={`flex min-w-0 flex-col justify-center pr-3 ${inset === "section" ? "pl-6" : "pl-12"}`}>
    <span class="flex min-w-0 items-center gap-2.5">{@render nameLine()}</span>
    {#if companyName}
      <!-- Search results: the company on its own line, under the name, so neither squeezes the other. -->
      <span
        data-import-file-company
        title={companyName}
        class={`min-w-0 truncate ${SHEET_SMALL} text-ink-muted ${cells.prefix ? "pl-[3.125rem]" : ""}`}
      >{companyName}</span>
    {/if}
  </div>

  <div role="cell" data-import-cell="fiscal-year" class={FIXED_CELL}>
    {#if can.edit}
      {#if cells.fiscalYear?.tooltip}
        <!-- The year end on hover, as when read only; the control is the cell's tab stop. -->
        <Tooltip text={cells.fiscalYear.tooltip} delayDuration={300} ignoreNonKeyboardFocus>
          {#snippet children({ props })}
            {@render yearPicker(props)}
          {/snippet}
        </Tooltip>
      {:else}
        {@render yearPicker({})}
      {/if}
    {:else if cells.fiscalYear?.tooltip}
      {@const year = cells.fiscalYear}
      <!-- Hover only, like the title; screen readers get the date from the hidden words. -->
      <Tooltip text={year.tooltip ?? ""} delayDuration={300}>
        {#snippet children({ props })}
          <span {...props} tabindex="-1" data-import-year class={`truncate ${toneClass[year.tone]}`}>{year.text}<span class="sr-only">, {year.tooltip}</span></span>
        {/snippet}
      </Tooltip>
    {:else if cells.fiscalYear}
      <span data-import-year class={`truncate ${toneClass[cells.fiscalYear.tone]}`}>{cells.fiscalYear.text}</span>
    {/if}
  </div>

  <div role="cell" data-import-cell="version" class={FIXED_CELL}>
    {#if can.version}
      <ImportVersionPicker code={row.versionCode} number={row.versionNumber} onPick={(version) => change({ version })}>
        {#snippet trigger({ props })}
          <button {...props} type="button" aria-label={cells.version ? `Version ${cells.version}. Change the version` : "Set the version"} data-import-version-edit class={CELL_BUTTON}>
            {#if cells.version}<span class={CELL_WORDS}>{cells.version}</span>{/if}
            <CaretDownIcon size={PICK_CARET_SIZE} aria-hidden="true" class={CELL_CARET} />
          </button>
        {/snippet}
      </ImportVersionPicker>
    {:else if cells.version}
      <span class={`truncate ${CELL_INK}`}>{cells.version}</span>
    {/if}
  </div>

  <div role="cell" data-import-cell="writer" class={FIXED_CELL}>
    {#if can.writer}
      <ImportPickerPopover label="Writer">
        {#snippet trigger({ props })}
          {#if cells.writer?.tone === "amber"}
            <!-- It may shrink on a narrow window: its words are cut, and given whole on hover. -->
            <button
              {...props}
              type="button"
              title={CHOOSE_WRITER}
              data-import-writer-pick
              data-import-writer-tone="amber"
              data-import-writer-initials={cells.writer.initials ?? undefined}
              class={PICK_CONTROL}
            >
              <span class="truncate">{CHOOSE_WRITER}</span>
              <CaretDownIcon size={PICK_CARET_SIZE} aria-hidden="true" class="shrink-0" />
            </button>
          {:else}
            <button {...props} type="button" aria-label={writerLabel} data-import-writer-edit disabled={approved && editing} class={CELL_BUTTON}>
              {#if cells.writer}
                <span
                  data-import-writer-tone={cells.writer.tone}
                  data-import-writer-remembered={cells.writer.remembered ? "" : undefined}
                  class={wordsClass[cells.writer.tone]}
                >{cells.writer.text}</span>
              {/if}
              <CaretDownIcon size={PICK_CARET_SIZE} aria-hidden="true" class={CELL_CARET} />
            </button>
          {/if}
        {/snippet}
        {#snippet content({ close })}
          <ImportWriterList
            currentWriterId={row.writerId ?? null}
            onPick={(picked) => {
              close();
              pickWriter(picked);
            }}
          />
        {/snippet}
      </ImportPickerPopover>
    {:else if cells.writer}
      <!-- Read only: an amber writer cell says what is missing. -->
      <span data-import-writer-tone={cells.writer.tone} class={`truncate ${toneClass[cells.writer.tone]}`}>{
        cells.writer.tone === "amber" ? "No writer" : cells.writer.text
      }</span>
    {/if}
  </div>

  <div role="cell" data-import-cell="reviewer" class={FIXED_CELL}>
    {#if can.reviewer}
      <ImportPickerPopover label="Reviewer">
        {#snippet trigger({ props })}
          <button {...props} type="button" aria-label={reviewerLabel} data-import-reviewer-edit disabled={approved && editing} class={CELL_BUTTON}>
            {#if cells.reviewer && !cells.reviewer.missing}
              <!-- Cut on a narrow window: the whole name on hover. -->
              <span
                title={cells.reviewer.text}
                data-import-reviewer-tone={cells.reviewer.tone}
                data-import-reviewer-remembered={cells.reviewer.remembered ? "" : undefined}
                class={wordsClass[cells.reviewer.tone]}
              >{cells.reviewer.text}</span>
            {:else}
              <span title={CHOOSE_REVIEWER} data-import-reviewer-choose class="truncate text-ink-muted group-data-[state=open]/cell:text-ink">{CHOOSE_REVIEWER}</span>
            {/if}
            <CaretDownIcon size={PICK_CARET_SIZE} aria-hidden="true" class={CELL_CARET} />
          </button>
        {/snippet}
        {#snippet content({ close })}
          <ImportWriterList
            role="reviewer"
            currentWriterId={row.reviewerId ?? null}
            onPick={(picked) => {
              close();
              pickReviewer(picked);
            }}
          />
        {/snippet}
      </ImportPickerPopover>
    {:else if cells.reviewer && cells.reviewer.text}
      <!-- Read only: the reviewer, or the file name's initials, muted, when they give none. -->
      <span title={cells.reviewer.text} data-import-reviewer-tone={cells.reviewer.tone} class={`truncate ${toneClass[cells.reviewer.tone]}`}>{cells.reviewer.text}</span>
    {/if}
  </div>

  <!-- A container: on a narrow window (the column at its 108px) the code shows alone, never a sliver of its title. -->
  <div role="cell" data-import-cell="science-code" class={`@container ${FIXED_CELL} gap-1.5 ${can.menu || can.approvedMenu ? ROW_MENU_ROOM : ""}`}>
    {#if can.scienceCode}
      <ImportPickerPopover label="Science code" align="end" width="w-[22rem]">
        {#snippet trigger({ props })}
          {#if cells.scienceCode?.kind === "missing"}
            <button {...props} type="button" data-import-code-pick data-import-code-missing class={PICK_CONTROL}>
              <span class="truncate">Pick a code</span>
              <CaretDownIcon size={PICK_CARET_SIZE} aria-hidden="true" class="shrink-0" />
            </button>
          {:else}
            <!-- The whole title in a tooltip when it is cut, on hover and on keyboard focus of the control. -->
            <Tooltip text={codeTip} delayDuration={400} ignoreNonKeyboardFocus disabled={!codeCut}>
              {#snippet children({ props: tip })}
                <button
                  {...mergeProps({ onpointerenter: measureCode, onfocus: measureCode }, tip, props)}
                  type="button"
                  aria-label={codeLabel}
                  data-import-code-edit
                  disabled={approved && editing}
                  class={`${CELL_BUTTON} gap-1.5 overflow-hidden`}
                >
                  {@render codeWords(false)}
                  <CaretDownIcon size={PICK_CARET_SIZE} aria-hidden="true" class={CELL_CARET} />
                </button>
              {/snippet}
            </Tooltip>
          {/if}
        {/snippet}
        {#snippet content({ close })}
          <ScienceCodeList
            value={row.scienceCode ?? null}
            clearable={false}
            onSelect={(code) => {
              close();
              // The same code a person already set changes nothing; the AI's
              // code picked by a person becomes theirs, and loses the mark.
              if (!code || (code === row.scienceCode && row.scienceCodeSource === "person")) return;
              if (approved) void editThis("scienceCode", { scienceCode: code });
              else void change({ scienceCode: code });
            }}
          />
        {/snippet}
      </ImportPickerPopover>
    {:else if cells.scienceCode?.kind === "code"}
      {@render codeWords(true)}
    {:else if cells.scienceCode?.kind === "missing"}
      <span data-import-code-missing class={`truncate ${AMBER}`}>{cells.scienceCode.text}</span>
    {/if}
    {#if can.menu}
      <!-- Over the cell's end, in the room the cell makes on hover and focus (ROW_MENU_ROOM). -->
      <span data-import-row-end class="absolute inset-y-0 right-2 flex items-center pointer-coarse:right-1.5">
        <ImportRowMenu
          name={label}
          category={row.category}
          {company}
          canDelete={can.remove}
          pdNumber={row.pdNumber ?? null}
          canPdNumber={can.pdNumber}
          craReviewed={can.craReviewed ? cells.craReviewed : null}
          onCra={markCra}
          onOpen={fileView ? () => fileView.open(row._id) : undefined}
          onCategory={(category) => void leaveWith(() => move({ category }))}
          onCompany={(name) => void leaveWith(() => move({ company: name }))}
          onPdNumber={(pdNumber) => void change({ pdNumber })}
          onDelete={() => void leaveWith(remove)}
        />
      </span>
    {:else if approved}
      <!-- Approved: the company page its file is on; the row's own menu sits over the cell's end, as on To review. -->
      <span data-import-row-end class="ml-auto flex shrink-0 items-center pl-1.5">
        {#if row.companyPage}
          <a
            href={companiesPath(resolve("/"), row.companyPage.key)}
            data-import-file-company-page={row.companyPage.key}
            aria-label={`Open ${row.companyPage.name}'s company page`}
            title={`On ${row.companyPage.name}'s company page`}
            class="relative z-[1] flex size-7 shrink-0 items-center justify-center rounded-md text-primary-selected transition-colors hover:bg-primary-wash hover:text-primary-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:size-11"
          ><BuildingsIcon size="0.875rem" aria-hidden="true" /></a>
        {:else}
          <span
            role="img"
            aria-label={NOT_ON_COMPANY_PAGE}
            title={NOT_ON_COMPANY_PAGE}
            data-import-file-no-company-page
            class="flex size-7 shrink-0 items-center justify-center text-ink-faint"
          ><BuildingsIcon size="0.875rem" aria-hidden="true" /></span>
        {/if}
      </span>
      {#if can.approvedMenu}
        <!-- In the room the cell makes on hover and focus (ROW_MENU_ROOM). -->
        <span data-import-row-menu-slot class="absolute inset-y-0 right-2 flex items-center pointer-coarse:right-1.5">
          <ImportApprovedRowMenu
            name={label}
            canMarkCra={can.craReviewed}
            craReviewed={cells.craReviewed}
            busy={editing}
            onOpen={fileView ? () => fileView.open(row._id) : undefined}
            onCra={(value) => void editThis("craReviewed", { craReviewed: value })}
            onSendBack={() => void leaveWith(sendBack)}
          />
        </span>
      {/if}
    {:else if reason || can.putBack}
      <!-- Deleted: why the file is here, where the empty cells leave room, then "Put back". -->
      <span data-import-row-end class="ml-auto flex min-w-0 items-center gap-3 pl-1.5">
        {#if reason}
          <span data-import-file-deleted-reason title={reason} class={`min-w-0 truncate ${SHEET_SMALL} text-ink-muted`}>{reason}</span>
        {/if}
        {#if can.putBack}
          <button
            type="button"
            data-import-put-back={row._id}
            onclick={() => void putBack()}
            class="relative z-[1] shrink-0 rounded-sm px-1 text-xs leading-[calc(4/3)] text-ink-muted transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:min-h-11"
          >Put back</button>
        {/if}
      </span>
    {/if}
  </div>
</div>
