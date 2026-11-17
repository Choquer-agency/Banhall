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

  On To review (2026-11-11 phase 3b) a read file's cells are its pickers,
  each cell's one tab stop: the year end calendar, the version menu, the
  writer (team members, past writers or a typed name) and, on a final PD,
  the science code; a final PD with no writer or code shows the amber
  "Choose writer" or "Pick a code". The "..." at the row's end moves or deletes the file, on
  any row, read or not; when that takes the row away, focus goes to the next
  row's "...". A move says so in a toast with Undo, which sets the category
  or company back. On Deleted the row ends with why the file is there and,
  for a file a person deleted or rejected, "Put back". With Select on, a
  checkbox comes first, named with the file and its company. Approved is
  read only. The row's "..." also sets the PD number on a read final PD,
  draft or review copy (Greptile fix, 2026-11-17), with or without one from
  the file name; "PD 4" then shows before the title. What a row may do is the shared rule
  (shared/importSheetRules.ts) the server follows too.

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
  import { CaretDownIcon } from "phosphor-svelte";
  import { api } from "../../../../convex/_generated/api";
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
  import { deleteFiles, IMPORT_TOAST, matchWriter, moveUndo, putBackFiles } from "./importActions";
  import {
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
  /** The New label: on To review, once the file is read (until then it says "Being read"). */
  const showNew = $derived(tab === "review" && cells.isNew && !isBeingRead(row.status));
  /** The name gives way only to the words after it: the New label and the state. */
  const titleRoom = $derived(
    cells.state && showNew
      ? "max-w-[calc(100%-7rem)]"
      : cells.state
        ? "max-w-[calc(100%-4rem)]"
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

  /** Whether the file's writer follows its name's initials: no person set one on the file itself. */
  const followsInitials = $derived(
    row.writerNameSource !== "person" && !(row.editedLabels ?? []).includes("writerName")
  );

  /**
   * A writer chosen in the Writer cell (2026-11-12, 2026-11-16). On a file
   * whose name gave initials and whose writer follows them, the choice says
   * which writer those initials are for the whole firm; otherwise it sets
   * this file's writer, which wins for it. Choosing the writer it has is nothing.
   */
  function pickWriter(picked: PickedWriter) {
    if (picked.current) return;
    const initials = followsInitials ? (cells.writer?.initials ?? null) : null;
    if (initials) void matchWriter(initials, picked, matchInitials);
    else void change({ writer: picked.choice });
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
        : cells.writer.remembered && cells.writer.initials
          ? `Writer ${cells.writer.text}, from the initials ${cells.writer.initials}. Change the writer for ${cells.writer.initials}`
          : `Writer ${cells.writer.text}. Change the writer`
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
          <span {...mergeProps({ onpointerenter: measureCode }, props)} tabindex="-1" data-import-code-title class={`min-w-0 truncate ${SHEET_SMALL} text-ink-muted`}>{cells.scienceCode?.kind === "code" ? cells.scienceCode.title : ""}</span>
        {/snippet}
      </Tooltip>
    {:else if cells.scienceCode.title}
      <span data-import-code-title class={`min-w-0 truncate ${SHEET_SMALL} text-ink-muted`}>{cells.scienceCode.title}</span>
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
  <span class="flex min-w-0 flex-1 items-center gap-2.5">
    <!-- Hover only: a tab stop on every row would make the sheet slow to cross by keyboard. -->
    <Tooltip text={nameTip} delayDuration={400} disabled={!titleIsNotName && !nameCut}>
      {#snippet children({ props })}
        <span
          {...mergeProps({ onpointerenter: measureName }, props)}
          tabindex="-1"
          data-import-file-title
          class={`min-w-0 shrink-0 truncate text-ink ${titleRoom}`}
        >{cells.title}</span>
      {/snippet}
    </Tooltip>
    {#if showNew}
      <span
        data-import-file-new
        class="inline-flex h-5 shrink-0 items-center rounded-full bg-success-soft px-2 text-[0.6875rem] leading-[calc(14/11)] text-success-ink"
      >New</span>
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
            <button {...props} type="button" aria-label={writerLabel} data-import-writer-edit class={CELL_BUTTON}>
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

  <div role="cell" data-import-cell="science-code" class={`${FIXED_CELL} gap-1.5 ${can.menu ? ROW_MENU_ROOM : ""}`}>
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
                  class={`${CELL_BUTTON} gap-1.5`}
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
              if (code && !(code === row.scienceCode && row.scienceCodeSource === "person")) void change({ scienceCode: code });
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
          onCategory={(category) => void leaveWith(() => move({ category }))}
          onCompany={(name) => void leaveWith(() => move({ company: name }))}
          onPdNumber={(pdNumber) => void change({ pdNumber })}
          onDelete={() => void leaveWith(remove)}
        />
      </span>
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
