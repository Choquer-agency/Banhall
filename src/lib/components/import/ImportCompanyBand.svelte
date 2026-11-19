<!--
  One company on the Import sheet (boards ao3 and ao5, Paper Files 1): a
  52px band under the sheet's strongest hairline (gray-300). The chevron
  sits in a 16px slot at the sheet's left edge, so the name (15/20, 500)
  starts 24px in; 16px after it, the company's industry in muted words when
  the app knows the company, or the green "New company" label and, on To
  review, the amber "Pick an industry" picker (2026-11-12). Once picked, the
  industry shows as muted words that can still be changed. Then "N files"
  in muted words, ending on the Science code column's rule, and on the
  review tab the status words ("38 being read", "77 ready", "12 to check" in
  amber) in the Science code column, wrapping onto a second line when that
  column is narrow. Closed by default; open, it lists its sections in their
  fixed order, closed by a line. Bands sit 14px apart, 28px after an open
  one (the boards' rhythm).

  A new company's industry is kept by company key (ingestion
  setNewCompanyIndustry), so it holds on every tab until the company is
  created on approval. There is no AI suggestion beside it: nothing in the
  app knows a new company's industry without a new AI call.

  New (2026-11-12, Paper Files 2 and 3): on To review a band with New files
  shows the green "N new" pill 12px before "N files"; with New on, its
  sections count and list only their New files.

  With Select on (board ao4) a checkbox comes first. It selects every file
  its open sections list (never the ones not loaded), shows a dash when only
  some are selected, and on a closed company opens it and selects the files
  of the section that opens, once that section lists them.
-->
<script lang="ts">
  import { useMutation } from "convex-svelte";
  import { toast } from "svelte-sonner";
  import { CaretDownIcon } from "phosphor-svelte";
  import { api } from "../../../../convex/_generated/api";
  import { IconChevronRight } from "$lib/components/icons";
  import Checkbox from "$lib/components/ui/Checkbox.svelte";
  import { userErrorMessage } from "$lib/errors";
  import { industryLabel } from "$lib/industries";
  import ImportCategorySection from "./ImportCategorySection.svelte";
  import ImportIndustryList from "./ImportIndustryList.svelte";
  import ImportPickerPopover from "./ImportPickerPopover.svelte";
  import { IMPORT_TOAST } from "./importActions";
  import {
    bandName,
    bandSections,
    bandStatusWords,
    newCountText,
    NO_COMPANY_KEY,
    plural,
    type ImportCategory,
    type SheetBand,
    type SheetTab,
  } from "./importFormat";
  import type { ImportSelection } from "./importSelection.svelte";
  import { AMBER, PICK_CARET_SIZE, PICK_CONTROL, ROW_TOGGLE, SELECT_CELL, sheetGrid } from "./sheetLayout";

  let {
    band,
    tab,
    onlyToCheck,
    onlyNew = false,
    open,
    openSections,
    onToggle,
    onToggleSection,
    selection = null,
  }: {
    band: SheetBand;
    tab: SheetTab;
    onlyToCheck: boolean;
    /** The New filter (2026-11-12). */
    onlyNew?: boolean;
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
  const picked = $derived(band.pickedIndustry?.trim() || null);
  const words = $derived(bandStatusWords(band, tab));
  const sections = $derived(open ? bandSections(band, onlyToCheck, onlyNew) : []);
  const newFiles = $derived(tab === "review" ? (band.newFiles ?? 0) : 0);
  /** The company's name for its files' company picker; none for "No company yet". */
  const company = $derived(band.companyKey === NO_COMPANY_KEY ? null : name);

  const selecting = $derived(Boolean(selection?.on));
  const boxState = $derived(selection ? selection.stateOf(selection.listed(band.companyKey)) : "none");

  // ─── A new company's industry ───────────────────────────────────────────
  const setIndustry = useMutation(api.ingestion.setNewCompanyIndustry);
  /** The industry just picked, shown until the band reads it back. */
  let saving = $state<string | null>(null);
  const shownIndustry = $derived(saving ?? picked);

  async function pickIndustry(slug: string) {
    if (slug === shownIndustry) return;
    saving = slug;
    try {
      await setIndustry({ companyKey: band.companyKey, industry: slug });
    } catch (error) {
      toast.error(userErrorMessage(error, "The industry could not be saved."), IMPORT_TOAST);
    } finally {
      saving = null;
    }
  }

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
    const present = bandSections(band, onlyToCheck, onlyNew).map((entry) => entry.category);
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

<div
  role="rowgroup"
  data-import-band={band.companyKey}
  data-import-band-open={open ? "" : undefined}
  class={`[[data-import-band]+&]:mt-3.5 ${open ? "pb-3.5" : ""}`}
>
  <div role="row" class={`relative ${sheetGrid(selecting)} h-[3.25rem] items-center border-t border-gray-300 hover:bg-gray-50`}>
    {#if selecting}
      <div role="cell" data-import-select-cell class={`${SELECT_CELL} self-stretch`}>
        <!-- Function bindings: the box always shows the selection, even when a click only opens the company. -->
        <Checkbox
          bind:checked={() => boxState === "all", () => toggleSelect()}
          indeterminate={boxState === "some"}
          aria-label={`Select ${name}`}
          data-import-band-select={band.companyKey}
        />
      </div>
    {/if}
    <div role="cell" aria-colspan={4} class="col-span-4 flex min-w-0 items-center gap-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? sectionsId : undefined}
        data-import-band-toggle
        onclick={onToggle}
        class={`${ROW_TOGGLE} min-w-0 shrink gap-2`}
      >
        <!-- The chevron turns inside a square, so turned it stays inside the sheet's edge. -->
        <span data-import-band-chevron class="flex w-4 shrink-0 items-center text-ink-muted">
          <span class={`flex size-[0.875rem] items-center justify-center transition-transform duration-150 motion-reduce:transition-none ${open ? "rotate-90" : ""}`}>
            <IconChevronRight size={14} strokeWidth={1.8} class="shrink-0" />
          </span>
        </span>
        <span data-import-band-name class="truncate text-[0.9375rem] leading-[calc(4/3)] font-medium text-ink">{name}</span>
      </button>
      {#if band.isNew || industry}
        <span class="ml-2 flex min-w-0 shrink items-center gap-2">
          {#if band.isNew}
            <span
              data-import-band-new
              class="inline-flex h-5 shrink-0 items-center rounded-full bg-success-soft px-2 text-[0.6875rem] leading-[calc(14/11)] text-success-ink"
            >New company</span>
            {#if tab === "review"}
              <!-- Above the row's whole-row toggle. -->
              <span class="relative z-[1] flex min-w-0">
                <ImportPickerPopover label="Industry">
                  {#snippet trigger({ props })}
                    {#if shownIndustry}
                      <button
                        {...props}
                        type="button"
                        aria-label={`Industry ${industryLabel(shownIndustry)}. Change the industry`}
                        data-import-band-industry-edit
                        class="group/cell -mx-1.5 flex h-[1.625rem] min-w-0 items-center gap-1.5 rounded-lg px-1.5 text-left outline-none transition-colors hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-fir data-[state=open]:bg-primary-wash motion-reduce:transition-none pointer-coarse:h-11"
                      >
                        <span data-import-band-industry class="truncate text-[0.8125rem] leading-[calc(18/13)] text-ink-muted">{industryLabel(shownIndustry)}</span>
                        <CaretDownIcon
                          size={PICK_CARET_SIZE}
                          aria-hidden="true"
                          class="shrink-0 text-ink-muted opacity-0 transition-opacity group-hover/cell:opacity-100 group-focus-visible/cell:opacity-100 group-data-[state=open]/cell:opacity-100 motion-reduce:transition-none"
                        />
                      </button>
                    {:else}
                      <button {...props} type="button" data-import-band-industry-pick class={PICK_CONTROL}>
                        <span class="truncate">Pick an industry</span>
                        <CaretDownIcon size={PICK_CARET_SIZE} aria-hidden="true" class="shrink-0" />
                      </button>
                    {/if}
                  {/snippet}
                  {#snippet content({ close })}
                    <ImportIndustryList
                      current={shownIndustry}
                      onPick={(slug) => {
                        close();
                        void pickIndustry(slug);
                      }}
                    />
                  {/snippet}
                </ImportPickerPopover>
              </span>
            {:else if picked}
              <span data-import-band-industry class="min-w-0 truncate text-[0.8125rem] leading-[calc(18/13)] text-ink-muted">{industryLabel(picked)}</span>
            {/if}
          {:else if industry}
            <span data-import-band-industry class="min-w-0 truncate text-[0.8125rem] leading-[calc(18/13)] text-ink-muted">{industryLabel(industry)}</span>
          {/if}
        </span>
      {/if}
      <span class="ml-auto flex shrink-0 items-center gap-3 pl-2">
        {#if newFiles > 0}
          <span
            data-import-band-new-count
            class="inline-flex h-5 shrink-0 items-center rounded-full bg-success-soft px-2 text-[0.6875rem] leading-[calc(14/11)] text-success-ink"
          >{newCountText(newFiles)}</span>
        {/if}
        <span data-import-band-files class="shrink-0 text-[0.8125rem] leading-[calc(18/13)] text-ink-muted">{plural(band.total, "file")}</span>
      </span>
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
          {onlyNew}
          beingRead={band.beingRead}
          {selection}
          open={openSections.has(section.category)}
          onToggle={() => onToggleSection(section.category)}
        />
      {/each}
      <div class="border-t border-line" aria-hidden="true"></div>
    </div>
  {/if}
</div>
