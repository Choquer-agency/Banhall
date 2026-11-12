<!--
  One file on the Import sheet (board ao5): 44px, the lightest hairline
  above it, the four fixed columns each behind a light rule. File shows
  "PD 4" muted and the PD's title for a file named like a PD, else the file
  name, then "Being read" (muted) or "Could not be read" (amber). Fiscal
  year is the year alone with the year end in a tooltip; Version "T2";
  Writer the name, or the initials muted; Science code the code and its
  title, after the AI mark when it was read from the document. Amber marks
  only what a person must fill in. Read only in this phase: the cell menus,
  the year end calendar and selection come next.
-->
<script lang="ts">
  import Tooltip from "$lib/components/ui/Tooltip.svelte";
  import AuroraMark from "$lib/components/ui/AuroraMark.svelte";
  import { fileCells, type SheetFileRow, type Tone } from "./importFormat";
  import { AMBER, FIXED_CELL, SHEET_GRID, SHEET_SMALL, SHEET_TEXT } from "./sheetLayout";

  let {
    row,
    companyName = null,
    inset = "section",
  }: {
    row: SheetFileRow;
    /** Search results name the file's company after it. */
    companyName?: string | null;
    /** `section`: inside a section's 24px indent. `sheet`: a top-level row (search results). */
    inset?: "section" | "sheet";
  } = $props();

  const cells = $derived(fileCells(row));
  const toneClass: Record<Tone, string> = { ink: "text-ink", muted: "text-ink-muted", amber: AMBER };
</script>

<div
  role="row"
  data-import-file={row._id}
  data-import-file-category={row.category}
  class={`${SHEET_GRID} h-11 border-t border-line-soft ${SHEET_TEXT}`}
>
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
    {#if companyName}
      <span data-import-file-company class={`min-w-0 shrink-[2] truncate ${SHEET_SMALL} text-ink-muted`}>{companyName}</span>
    {/if}
  </div>

  <div role="cell" data-import-cell="fiscal-year" class={FIXED_CELL}>
    {#if cells.fiscalYear?.tooltip}
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
    {#if cells.version}<span class="truncate text-ink">{cells.version}</span>{/if}
  </div>

  <div role="cell" data-import-cell="writer" class={FIXED_CELL}>
    {#if cells.writer}
      <span data-import-writer-tone={cells.writer.tone} class={`truncate ${toneClass[cells.writer.tone]}`}>{cells.writer.text}</span>
    {/if}
  </div>

  <div role="cell" data-import-cell="science-code" class={`${FIXED_CELL} gap-1.5`}>
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
    {:else if cells.scienceCode?.kind === "missing"}
      <span data-import-code-missing class={`truncate ${AMBER}`}>{cells.scienceCode.text}</span>
    {/if}
  </div>
</div>
