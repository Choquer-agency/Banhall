<!--
  One company on the Import sheet (boards ao3 and ao5): a 52px band under
  the sheet's strongest hairline with a chevron, the company name (15px,
  medium), its industry muted when the app knows the company or the green
  "New company" label when it does not, then the file count and, on the
  review tab, the status words ("38 being read", "77 ready", "12 to check"
  in amber). Closed by default; open, it lists its sections in their fixed
  order and leaves 28px before the next company.
-->
<script lang="ts">
  import { IconChevronRight } from "$lib/components/icons";
  import ImportCategorySection from "./ImportCategorySection.svelte";
  import {
    bandName,
    bandSections,
    bandStatusWords,
    plural,
    type ImportCategory,
    type SheetBand,
    type SheetTab,
  } from "./importFormat";
  import { AMBER, ROW_TOGGLE, SHEET_GRID } from "./sheetLayout";

  let {
    band,
    tab,
    onlyToCheck,
    open,
    openSections,
    onToggle,
    onToggleSection,
  }: {
    band: SheetBand;
    tab: SheetTab;
    onlyToCheck: boolean;
    open: boolean;
    /** The sections open in this company. */
    openSections: ReadonlySet<ImportCategory>;
    onToggle: () => void;
    onToggleSection: (category: ImportCategory) => void;
  } = $props();

  const uid = $props.id();
  const sectionsId = `${uid}-sections`;
  const name = $derived(bandName(band));
  const industry = $derived(band.company?.industry?.trim() || null);
  const words = $derived(bandStatusWords(band, tab));
  const sections = $derived(open ? bandSections(band, onlyToCheck) : []);
</script>

<div role="rowgroup" data-import-band={band.companyKey} data-import-band-open={open ? "" : undefined} class={open ? "pb-7" : ""}>
  <div role="row" class={`relative ${SHEET_GRID} h-[3.25rem] items-center border-t border-line hover:bg-gray-50`}>
    <div role="cell" aria-colspan={4} class="col-span-4 flex min-w-0 items-center gap-3 pr-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? sectionsId : undefined}
        data-import-band-toggle
        onclick={onToggle}
        class={`${ROW_TOGGLE} min-w-0 shrink`}
      >
        <span class="flex w-6 shrink-0 justify-center text-ink-muted">
          <IconChevronRight size={14} strokeWidth={1.8} class={`transition-transform duration-150 motion-reduce:transition-none ${open ? "rotate-90" : ""}`} />
        </span>
        <span data-import-band-name class="truncate text-[0.9375rem] leading-[calc(4/3)] font-medium text-ink">{name}</span>
      </button>
      {#if band.isNew}
        <span
          data-import-band-new
          class="inline-flex h-5 shrink-0 items-center rounded-full bg-success-soft px-2 text-[0.6875rem] leading-[calc(14/11)] text-success-ink"
        >New company</span>
      {:else if industry}
        <span data-import-band-industry class="min-w-0 truncate text-[0.8125rem] leading-[calc(18/13)] text-ink-muted">{industry}</span>
      {/if}
      <span data-import-band-files class="ml-auto shrink-0 text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary">{plural(band.total, "file")}</span>
    </div>
    <div role="cell" data-import-band-status class="flex min-w-0 items-center justify-end gap-3 px-2 text-[0.8125rem] leading-[calc(18/13)]">
      {#each words as word (word.text)}
        <span class={`shrink-0 ${word.tone === "amber" ? AMBER : "text-ink-muted"}`}>{word.text}</span>
      {/each}
    </div>
  </div>

  {#if open}
    <div id={sectionsId} data-import-band-sections class="ml-6">
      {#each sections as section (section.category)}
        <ImportCategorySection
          {tab}
          companyKey={band.companyKey}
          {section}
          {onlyToCheck}
          open={openSections.has(section.category)}
          onToggle={() => onToggleSection(section.category)}
        />
      {/each}
    </div>
  {/if}
</div>
