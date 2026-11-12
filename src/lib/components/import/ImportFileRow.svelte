<!--
  One file on the Import sheet (boards ao4 and ao5): 44px, the lightest
  hairline above it, the four fixed columns each behind a light rule. File
  shows "PD 4" muted and the PD's title for a file named like a PD, else the
  file name, then "Being read" (muted), "Could not be read" (amber) or, on
  Deleted, why it is there. Fiscal year is the year alone with the year end
  in a tooltip; Version "T2"; Writer the name, or the initials muted;
  Science code the code and its title, after the AI mark when it was read
  from the document. Amber marks only what a person must fill in.

  On To review (2026-11-11 phase 3b) a read file's cells are its pickers,
  each cell's one tab stop: the year end calendar, the version menu, the
  writer (the firm's people or a typed name) and, on a final PD, the science
  code; a final PD with no writer or code shows the amber "Pick a writer" or
  "Pick a code". The "..." at the row's end moves or deletes the file, on
  any row, read or not; when that takes the row away, focus goes to the next
  row's "...". On Deleted a file a person deleted or rejected ends with "Put
  back". With Select on, a checkbox comes first, named with the file and its
  company. Approved is read only. What a row may do is the shared rule
  (shared/importSheetRules.ts) the server follows too.
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
  import ImportWriterList from "./ImportWriterList.svelte";
  import { deleteFiles, IMPORT_TOAST, putBackFiles } from "./importActions";
  import {
    dateInputFromUtcDay,
    deletedReasonText,
    fileSelectLabel,
    rowAbilities,
    settledIds,
    skippedText,
    utcDayFromDateInput,
    YEAR_END_HELPER,
    YEAR_END_QUICK_PICKS,
  } from "./importEdit";
  import { fileCells, type SheetFileRow, type SheetTab, type Tone } from "./importFormat";
  import type { ImportSelection } from "./importSelection.svelte";
  import {
    AMBER,
    CELL_BUTTON,
    CELL_CARET,
    FIXED_CELL,
    PICK_CONTROL,
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
  const can = $derived(rowAbilities(row, tab));
  const selectColumn = $derived(Boolean(selection?.on));
  const selected = $derived(selection?.has(row._id) ?? false);
  const reason = $derived(tab === "deleted" ? deletedReasonText(row.deletedReason) : null);
  const label = $derived(cells.prefix ? `${cells.prefix} ${cells.title}` : cells.title);
  const toneClass: Record<Tone, string> = { ink: "text-ink", muted: "text-ink-muted", amber: AMBER };

  const setLabels = useMutation(api.ingestion.setSheetLabels);
  const removeItems = useMutation(api.ingestion.removeItems);
  const restoreItems = useMutation(api.ingestion.restoreItems);

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
    <span data-import-year class={`truncate ${toneClass[year.tone]}`}>{year.text}{#if year.tooltip}<span class="sr-only">, {year.tooltip}</span>{/if}</span>
  {/if}
{/snippet}

{#snippet yearPicker(tip: Record<string, unknown>)}
  <!-- Bound to the stored year end: the calendar shows what is saved, never a refused pick. -->
  <DatePicker
    bind:value={() => dateInputFromUtcDay(row.fiscalYearEnd), () => {}}
    heading="Year end"
    quickPicks={YEAR_END_QUICK_PICKS}
    helper={YEAR_END_HELPER}
    onCommit={pickYear}
  >
    {#snippet trigger({ props })}
      <button {...mergeProps(tip, props)} type="button" aria-label={yearLabel} data-import-year-edit class={CELL_BUTTON}>
        {@render yearWords()}
        <CaretDownIcon size="0.75rem" aria-hidden="true" class={CELL_CARET} />
      </button>
    {/snippet}
  </DatePicker>
{/snippet}

{#snippet codeWords()}
  {#if cells.scienceCode?.kind === "code"}
    <!-- Codes line up whether or not the mark is there (ao5). -->
    {#if cells.scienceCode.fromDocument}
      <AuroraMark size={14} label="Filled in by AI" />
    {:else}
      <span class="size-[0.875rem] shrink-0" aria-hidden="true"></span>
    {/if}
    <span data-import-code class="shrink-0 text-ink">{cells.scienceCode.code}</span>
    {#if cells.scienceCode.title}
      <span data-import-code-title class={`min-w-0 truncate ${SHEET_SMALL} text-ink-muted`}>{cells.scienceCode.title}</span>
    {/if}
  {/if}
{/snippet}

<div
  bind:this={rowElement}
  role="row"
  data-import-file={row._id}
  data-import-file-category={row.category}
  data-import-file-selected={selected ? "" : undefined}
  class={`group/row relative ${sheetGrid(selectColumn)} h-11 border-t border-line-soft ${SHEET_TEXT} ${
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

  <div role="cell" class={`flex min-w-0 items-center gap-2 pr-3 ${inset === "section" ? "pl-6" : "pl-12"}`}>
    {#if cells.prefix}
      <span data-import-file-prefix class="w-[3.125rem] shrink-0 truncate text-ink-muted">{cells.prefix}</span>
    {/if}
    {#if cells.prefix && cells.title !== row.name}
      <!-- Hover only: a tab stop on every row would make the sheet slow to cross by keyboard. -->
      <Tooltip text={row.name} delayDuration={400}>
        {#snippet children({ props })}
          <span {...props} tabindex="-1" data-import-file-title class="min-w-0 truncate text-ink">{cells.title}</span>
        {/snippet}
      </Tooltip>
    {:else}
      <span data-import-file-title class="min-w-0 truncate text-ink">{cells.title}</span>
    {/if}
    {#if cells.state}
      <span data-import-file-state class={`shrink-0 ${cells.state.tone === "amber" ? AMBER : `${SHEET_SMALL} text-ink-muted`}`}>{cells.state.text}</span>
    {/if}
    {#if reason}
      <span data-import-file-deleted-reason class={`shrink-0 ${SHEET_SMALL} text-ink-muted`}>{reason}</span>
    {/if}
    {#if companyName}
      <span data-import-file-company class={`min-w-0 shrink-[2] truncate ${SHEET_SMALL} text-ink-muted`}>{companyName}</span>
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
      <ImportVersionPicker code={row.versionCode} number={row.versionNumber} onPick={(version) => void change({ version })}>
        {#snippet trigger({ props })}
          <button {...props} type="button" aria-label={cells.version ? `Version ${cells.version}. Change the version` : "Set the version"} data-import-version-edit class={CELL_BUTTON}>
            {#if cells.version}<span class="truncate text-ink">{cells.version}</span>{/if}
            <CaretDownIcon size="0.75rem" aria-hidden="true" class={CELL_CARET} />
          </button>
        {/snippet}
      </ImportVersionPicker>
    {:else if cells.version}
      <span class="truncate text-ink">{cells.version}</span>
    {/if}
  </div>

  <div role="cell" data-import-cell="writer" class={FIXED_CELL}>
    {#if can.writer}
      <ImportPickerPopover label="Writer">
        {#snippet trigger({ props })}
          {#if cells.writer?.tone === "amber"}
            <button {...props} type="button" data-import-writer-pick data-import-writer-tone="amber" class={PICK_CONTROL}>
              Pick a writer
              <CaretDownIcon size="0.6875rem" aria-hidden="true" class="shrink-0" />
            </button>
          {:else}
            <button {...props} type="button" aria-label={writerLabel} data-import-writer-edit class={CELL_BUTTON}>
              {#if cells.writer}
                <span data-import-writer-tone={cells.writer.tone} class={`truncate ${toneClass[cells.writer.tone]}`}>{cells.writer.text}</span>
              {/if}
              <CaretDownIcon size="0.75rem" aria-hidden="true" class={CELL_CARET} />
            </button>
          {/if}
        {/snippet}
        {#snippet content({ close })}
          <ImportWriterList
            current={row.writerName ?? null}
            onPick={(name) => {
              close();
              if (name !== row.writerName) void change({ writerName: name });
            }}
          />
        {/snippet}
      </ImportPickerPopover>
    {:else if cells.writer}
      <span data-import-writer-tone={cells.writer.tone} class={`truncate ${toneClass[cells.writer.tone]}`}>{cells.writer.text}</span>
    {/if}
  </div>

  <div role="cell" data-import-cell="science-code" class={`${FIXED_CELL} gap-1.5`}>
    {#if can.scienceCode}
      <ImportPickerPopover label="Science code" align="end" width="w-[22rem]">
        {#snippet trigger({ props })}
          {#if cells.scienceCode?.kind === "missing"}
            <button {...props} type="button" data-import-code-pick data-import-code-missing class={PICK_CONTROL}>
              Pick a code
              <CaretDownIcon size="0.6875rem" aria-hidden="true" class="shrink-0" />
            </button>
          {:else}
            <button {...props} type="button" aria-label={codeLabel} data-import-code-edit class={`${CELL_BUTTON} gap-1.5`}>
              {@render codeWords()}
              <CaretDownIcon size="0.75rem" aria-hidden="true" class={CELL_CARET} />
            </button>
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
      {@render codeWords()}
    {:else if cells.scienceCode?.kind === "missing"}
      <span data-import-code-missing class={`truncate ${AMBER}`}>{cells.scienceCode.text}</span>
    {/if}
    {#if can.menu}
      <span class="ml-auto flex shrink-0 items-center">
        <ImportRowMenu
          name={label}
          category={row.category}
          {company}
          canDelete={can.remove}
          onCategory={(category) => void leaveWith(() => change({ category }))}
          onCompany={(name) => void leaveWith(() => change({ company: name }))}
          onDelete={() => void leaveWith(remove)}
        />
      </span>
    {:else if can.putBack}
      <button
        type="button"
        data-import-put-back={row._id}
        onclick={() => void putBack()}
        class="relative z-[1] ml-auto shrink-0 rounded-sm px-1 text-xs leading-[calc(4/3)] text-ink-muted transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:min-h-11"
      >Put back</button>
    {/if}
  </div>
</div>
