<!--
  One company on the Import sheet (boards ao3 and ao5): a 52px band under
  the sheet's strongest hairline with a chevron, the company name (15px,
  medium), its industry muted when the app knows the company or the green
  "New company" label when it does not, then the file count and, on the
  review tab, the status words ("38 being read", "77 ready", "12 to check"
  in amber) in the Science code column, wrapping onto a second line when
  that column is narrow. Closed by default; open, it lists its sections in
  their fixed order and leaves 28px before the next company.

  With Select on (board ao4) a checkbox comes first. It selects every file
  its open sections list (never the ones not loaded), shows a dash when only
  some are selected, and on a closed company opens it and selects the files
  of the section that opens, once that section lists them.
-->
<script lang="ts">
  import { IconChevronRight } from "$lib/components/icons";
  import Checkbox from "$lib/components/ui/Checkbox.svelte";
  import ImportCategorySection from "./ImportCategorySection.svelte";
  import {
    bandName,
    bandSections,
    bandStatusWords,
    NO_COMPANY_KEY,
    plural,
    type ImportCategory,
    type SheetBand,
    type SheetTab,
  } from "./importFormat";
  import type { ImportSelection } from "./importSelection.svelte";
  import { AMBER, ROW_TOGGLE, SELECT_CELL, sheetGrid } from "./sheetLayout";

  let {
    band,
    tab,
    onlyToCheck,
    open,
    openSections,
    onToggle,
    onToggleSection,
    selection = null,
  }: {
    band: SheetBand;
    tab: SheetTab;
    onlyToCheck: boolean;
    open: boolean;
    /** The sections open in this company. */
    openSections: ReadonlySet<ImportCategory>;
    onToggle: () => void;
    onToggleSection: (category: ImportCategory) => void;
    selection?: ImportSelection | null;
  } = $props();

  const uid = $props.id();
  const sectionsId = `${uid}-sections`;
  const name = $derived(bandName(band));
  const industry = $derived(band.company?.industry?.trim() || null);
  const words = $derived(bandStatusWords(band, tab));
  const sections = $derived(open ? bandSections(band, onlyToCheck) : []);
  /** The company's name for its files' company picker; none for "No company yet". */
  const company = $derived(band.companyKey === NO_COMPANY_KEY ? null : name);

  const selecting = $derived(Boolean(selection?.on));
  const state = $derived(selection ? selection.stateOf(selection.listed(band.companyKey)) : "none");

  /**
   * Nothing on screen to select: each section that opens now, or is open and
   * still reading, gets its own request, used up the first time it lists.
   * A closed company opens with its first section (Final PDs when it has
   * them); an open one whose open sections have all listed opens its first
   * closed section.
   */
  function toggleSelect() {
    if (!selection) return;
    if (selection.toggleRows(selection.listed(band.companyKey))) return;
    const present = bandSections(band, onlyToCheck).map((entry) => entry.category);
    const first = present[0];
    if (!first) return;
    let targets: ImportCategory[];
    if (!open) {
      // Opening a company opens its Final PDs.
      onToggle();
      if (first !== "final_pd") onToggleSection(first);
      targets = [first];
    } else {
      targets = present.filter((category) => openSections.has(category) && !selection!.isListed(band.companyKey, category));
      const closed = present.find((category) => !openSections.has(category));
      if (targets.length === 0 && closed) {
        onToggleSection(closed);
        targets = [closed];
      }
    }
    for (const category of targets) selection.selectWhenListed(band.companyKey, category);
  }
</script>

<div role="rowgroup" data-import-band={band.companyKey} data-import-band-open={open ? "" : undefined} class={open ? "pb-7" : ""}>
  <div role="row" class={`relative ${sheetGrid(selecting)} h-[3.25rem] items-center border-t border-line hover:bg-gray-50`}>
    {#if selecting}
      <div role="cell" data-import-select-cell class={`${SELECT_CELL} self-stretch`}>
        <!-- Function bindings: the box always shows the selection, even when a click only opens the company. -->
        <Checkbox
          bind:checked={() => state === "all", () => toggleSelect()}
          indeterminate={state === "some"}
          aria-label={`Select ${name}`}
          data-import-band-select={band.companyKey}
        />
      </div>
    {/if}
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
    <!-- When the Science code column is narrow, the words wrap onto a second line instead of running into "N files". -->
    <div role="cell" data-import-band-status class="flex min-w-0 flex-wrap content-center items-center justify-end gap-x-3 px-2 text-[0.8125rem] leading-[calc(16/13)]">
      {#each words as word (word.text)}
        <span class={`shrink-0 whitespace-nowrap ${word.tone === "amber" ? AMBER : "text-ink-muted"}`}>{word.text}</span>
      {/each}
    </div>
  </div>

  {#if open}
    <div id={sectionsId} data-import-band-sections class="ml-6">
      {#each sections as section (section.category)}
        <ImportCategorySection
          {tab}
          companyKey={band.companyKey}
          {company}
          {section}
          {onlyToCheck}
          {selection}
          open={openSections.has(section.category)}
          onToggle={() => onToggleSection(section.category)}
        />
      {/each}
    </div>
  {/if}
</div>
