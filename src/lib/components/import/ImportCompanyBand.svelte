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

  "Approve N ready" (2026-11-17): on To review, a company (not "No company
  yet") with files ready shows "Approve 77 ready" in place of "77 ready". It
  opens a confirm that says what Approve does (each file goes on the
  company's page, final PDs then wait in Brain check, files to check stay)
  and, for a new company, that it is made with the industry picked here.
  Approving runs on the server; the line under the toolbar shows how far.
  On Approved, the status words say how many final PDs wait for their
  Brain check.

  With Select on (board ao4) a checkbox comes first. It selects every file
  its open sections list (never the ones not loaded), shows a dash when only
  some are selected, and on a closed company opens it and selects the files
  of the section that opens, once that section lists them.
-->
<script lang="ts">
  import { Popover } from "bits-ui";
  import { useMutation } from "convex-svelte";
  import { toast } from "svelte-sonner";
  import { CaretDownIcon, TrashIcon } from "phosphor-svelte";
  import { api } from "../../../../convex/_generated/api";
  import { IconChevronDown } from "$lib/components/icons";
  import Checkbox from "$lib/components/ui/Checkbox.svelte";
  import { userErrorMessage } from "$lib/errors";
  import { industryLabel } from "$lib/industries";
  import ImportCategorySection from "./ImportCategorySection.svelte";
  import ImportIndustryList from "./ImportIndustryList.svelte";
  import ImportPickerPopover from "./ImportPickerPopover.svelte";
  import { deleteGroupFiles, IMPORT_TOAST } from "./importActions";
  import { alreadyRunningText, APPROVE_NOTES, approveCompanyTitle, approveLine, approveReadyText, mergedNote, newCompanyNote } from "./importApprove";
  import { DELETE_NOTE, deleteLine } from "./importEdit";
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
  import {
    AMBER,
    CONFIRM_LINE,
    DANGER_CONFIRM_LINE,
    PICK_CARET_SIZE,
    PICK_CONTROL,
    POPOVER_CARD,
    ROW_TOGGLE,
    SELECT_GUTTER,
    SHEET_GRID,
    SHEET_SMALL,
  } from "./sheetLayout";

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

  // ─── Canonical client matching ("Similar to X?" vs. keep separate) ──────
  const snapBand = useMutation(api.ingestion.snapBandToCompany);
  const confirmDistinct = useMutation(api.ingestion.confirmNewCompanyDistinct);
  let similarOpen = $state(false);
  let matchingBusy = $state(false);
  const suggestedCompanies = $derived(
    band.isNew && tab === "review" && !band.confirmedDistinct ? (band.suggestedCompanies ?? []) : []
  );

  async function moveToSuggested(target: (typeof suggestedCompanies)[number]) {
    if (matchingBusy) return;
    matchingBusy = true;
    try {
      const result = await snapBand({ fromCompanyKey: band.companyKey, targetClientId: target.id });
      similarOpen = false;
      toast(
        result.hasMore
          ? `Moved ${plural(result.moved, "file")} to ${result.targetName} so far`
          : `Moved ${plural(result.moved, "file")} to ${result.targetName}`,
        result.hasMore ? { ...IMPORT_TOAST, description: "The remaining files follow in a moment." } : IMPORT_TOAST
      );
    } catch (error) {
      toast.error(userErrorMessage(error, "Could not move files to that company."), IMPORT_TOAST);
    } finally {
      matchingBusy = false;
    }
  }

  async function keepSeparateCompany() {
    if (matchingBusy) return;
    matchingBusy = true;
    try {
      await confirmDistinct({ companyKey: band.companyKey, distinct: true });
      similarOpen = false;
      toast(`Kept ${name} as a separate company`, IMPORT_TOAST);
    } catch (error) {
      toast.error(userErrorMessage(error, "Could not save that choice."), IMPORT_TOAST);
    } finally {
      matchingBusy = false;
    }
  }

  // ─── Quick delete company group (To review) ─────────────────────────────
  const removeGroupItems = useMutation(api.ingestion.removeGroupItems);
  const restoreItems = useMutation(api.ingestion.restoreItems);
  let deleteOpen = $state(false);
  let deleting = $state(false);
  const deletableCount = $derived(Math.max(0, band.total - band.beingRead));
  const canDeleteBand = $derived(tab === "review" && deletableCount > 0);

  async function deleteBand() {
    if (deleting) return;
    deleting = true;
    deleteOpen = false;
    try {
      await deleteGroupFiles({ companyKey: band.companyKey }, removeGroupItems, restoreItems, {
        onRemoved: (ids) => selection?.remove(ids),
      });
    } finally {
      deleting = false;
    }
  }

  // ─── Approve N ready (2026-11-17) ────────────────────────────────────────
  const approvable = $derived(tab === "review" && band.companyKey !== NO_COMPANY_KEY && band.ready > 0);
  const approveCompany = useMutation(api.ingestion.approveCompanyReady);
  let approveOpen = $state(false);
  let approving = $state(false);
  const readyWord = $derived(`${band.ready.toLocaleString("en-US")} ready`);
  /** A company merged into another one: Approve refuses its files, so the confirm says where to move them. */
  const mergedInto = $derived(band.company?.via === "merge" ? band.company.name : null);
  const newNote = $derived(
    band.isNew
      ? newCompanyNote(name, shownIndustry ? industryLabel(shownIndustry) : null, (band.categories.final_pd?.total ?? 0) > 0)
      : null
  );

  async function approveReady() {
    if (approving) return;
    approving = true;
    try {
      const { ready, alreadyRunningBy } = await approveCompany({ companyKey: band.companyKey });
      approveOpen = false;
      toast(alreadyRunningBy ? alreadyRunningText(alreadyRunningBy) : `Approving ${plural(ready, "file")} of ${name}`, IMPORT_TOAST);
    } catch (error) {
      toast.error(userErrorMessage(error, "The files could not be approved."), IMPORT_TOAST);
    } finally {
      approving = false;
    }
  }

  /**
   * Clicking the left-gutter checkbox auto-enables bulk select with zero
   * layout shift, then selects loaded files (or opens the company's first
   * section and selects its files once listed).
   */
  function toggleSelect() {
    if (!selection) return;
    if (!selection.on) selection.setOn(true);
    if (selection.toggleRows(selection.listed(band.companyKey))) return;
    const present = bandSections(band, onlyToCheck, onlyNew).map((entry) => entry.category);
    const first = present[0];
    if (!first) return;
    let targets: ImportCategory[];
    if (!open) {
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
  class={`@container/band [[data-import-band]+&]:mt-2.5 ${open ? "pb-2.5" : ""}`}
>
  <div
    role="row"
    class={`group/band relative ${SHEET_GRID} h-[2.75rem] items-center border-t border-gray-300 transition-colors duration-150 ease-out hover:bg-gray-50 motion-reduce:transition-none`}
  >
    {#if selection}
      <div
        data-import-select-cell
        class={`${SELECT_GUTTER} ${
          selecting || boxState !== "none"
            ? "opacity-100"
            : "opacity-0 pointer-fine:group-hover/band:opacity-100 pointer-fine:group-has-[:focus-visible]/band:opacity-100 focus-within:opacity-100"
        }`}
      >
        <Checkbox
          bind:checked={() => boxState === "all", () => toggleSelect()}
          indeterminate={boxState === "some"}
          aria-label={`Select ${name}`}
          data-import-band-select={band.companyKey}
        />
      </div>
    {/if}
    <div role="cell" aria-colspan={5} class="col-span-5 flex min-w-0 items-center gap-2 pl-9 @max-[56rem]/band:col-span-4">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? sectionsId : undefined}
        data-import-band-toggle
        onclick={onToggle}
        class={`${ROW_TOGGLE} min-w-0 shrink gap-2`}
      >
        <span data-import-band-name class="truncate text-sm leading-[calc(18/14)] font-medium text-ink">{name}</span>
      </button>
      {#if band.isNew || industry}
        <span class="ml-1.5 flex min-w-0 shrink items-center gap-2">
          {#if band.isNew}
            <span
              data-import-band-new
              class="inline-flex h-5 shrink-0 items-center rounded-full bg-success-soft px-2 text-[0.6875rem] leading-[calc(14/11)] text-success-ink"
            >New company</span>
            {#if tab === "review"}
              <span class="relative z-[1] flex min-w-0">
                <ImportPickerPopover label="Industry">
                  {#snippet trigger({ props })}
                    {#if shownIndustry}
                      <button
                        {...props}
                        type="button"
                        aria-label={`Industry ${industryLabel(shownIndustry)}. Change the industry`}
                        data-import-band-industry-edit
                        class="group/cell -mx-1.5 flex h-[1.5rem] min-w-0 items-center gap-1.5 rounded-lg px-1.5 text-left outline-none transition-colors duration-150 ease-out hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-fir data-[state=open]:bg-primary-wash motion-reduce:transition-none pointer-coarse:h-11"
                      >
                        <span data-import-band-industry class="truncate text-[0.8125rem] leading-[calc(18/13)] text-ink-muted">{industryLabel(shownIndustry)}</span>
                        <CaretDownIcon
                          size={PICK_CARET_SIZE}
                          aria-hidden="true"
                          class="shrink-0 text-ink-muted opacity-0 transition-opacity duration-150 ease-out group-hover/cell:opacity-100 group-focus-visible/cell:opacity-100 group-data-[state=open]/cell:opacity-100 motion-reduce:transition-none"
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
              {#if suggestedCompanies.length > 0}
                <span class="relative z-[1] flex min-w-0">
                  <Popover.Root bind:open={similarOpen}>
                    <Popover.Trigger
                      type="button"
                      data-import-band-similar={band.companyKey}
                      class={PICK_CONTROL}
                    >
                      <span class="truncate">
                        Similar to {suggestedCompanies[0].name}{suggestedCompanies.length > 1 ? ` (+${suggestedCompanies.length - 1})` : ""}?
                      </span>
                      <CaretDownIcon size={PICK_CARET_SIZE} aria-hidden="true" class="shrink-0" />
                    </Popover.Trigger>
                    <Popover.Portal>
                      <Popover.Content
                        side="bottom"
                        align="start"
                        sideOffset={6}
                        collisionPadding={12}
                        aria-label="Possible existing company match"
                        data-import-band-similar-popover
                        class={`${POPOVER_CARD} w-[20rem] max-w-[calc(100vw-1.5rem)] p-3`}
                      >
                        <p class="text-[0.8125rem] leading-[calc(18/13)] font-medium text-ink">Existing company match?</p>
                        <p class={`mt-1 ${SHEET_SMALL} text-ink-muted`}>
                          This folder name looks similar to an existing company. Move its files there, or keep it as a separate new company.
                        </p>
                        <div class="mt-2.5 flex flex-col gap-1.5">
                          {#each suggestedCompanies as suggestion (suggestion.id)}
                            <button
                              type="button"
                              disabled={matchingBusy}
                              data-import-band-snap={suggestion.id}
                              onclick={() => void moveToSuggested(suggestion)}
                              class="flex w-full items-center justify-between gap-2 rounded-md border border-line-soft bg-surface px-2.5 py-2 text-left text-[0.8125rem] leading-[calc(18/13)] text-ink transition-colors duration-150 ease-out hover:bg-primary-wash disabled:opacity-50 motion-reduce:transition-none"
                            >
                              <span class="min-w-0 flex-1 truncate font-medium">{suggestion.name}</span>
                              <span class="shrink-0 text-xs font-medium text-primary-selected">Move files here</span>
                            </button>
                          {/each}
                        </div>
                        <button
                          type="button"
                          disabled={matchingBusy}
                          data-import-band-keep-separate
                          onclick={() => void keepSeparateCompany()}
                          class="mt-2.5 w-full rounded-md bg-chrome px-2.5 py-1.5 text-center text-xs leading-[calc(4/3)] font-medium text-ink transition-colors duration-150 ease-out hover:bg-primary-wash disabled:opacity-50 motion-reduce:transition-none"
                        >Keep as a separate company</button>
                      </Popover.Content>
                    </Popover.Portal>
                  </Popover.Root>
                </span>
              {/if}
            {:else if picked}
              <span data-import-band-industry class="min-w-0 truncate text-[0.8125rem] leading-[calc(18/13)] text-ink-muted">{industryLabel(picked)}</span>
            {/if}
          {:else if industry}
            <span data-import-band-industry class="min-w-0 truncate text-[0.8125rem] leading-[calc(18/13)] text-ink-muted">{industryLabel(industry)}</span>
          {/if}
        </span>
      {/if}
      <span class="ml-auto flex shrink-0 items-center gap-2.5 pl-2">
        {#if newFiles > 0}
          <span
            data-import-band-new-count
            class="inline-flex h-5 shrink-0 items-center rounded-full bg-success-soft px-2 text-[0.6875rem] leading-[calc(14/11)] text-success-ink"
          >{newCountText(newFiles)}</span>
        {/if}
        <span data-import-band-files class="shrink-0 text-[0.8125rem] leading-[calc(18/13)] text-ink-muted">{plural(band.total, "file")}</span>
      </span>
    </div>
    <div role="cell" class="flex min-w-0 items-center justify-end gap-2.5 pr-2.5 pl-2 text-[0.8125rem] leading-[calc(16/13)] @max-[56rem]/band:col-span-2">
      <div data-import-band-status class="flex min-w-0 flex-wrap content-center items-center justify-end gap-x-3">
        {#each words as word (word.text)}
          {#if approvable && word.text === readyWord}
            <Popover.Root bind:open={approveOpen}>
              <Popover.Trigger
                data-import-band-approve={band.companyKey}
                class="relative z-[1] shrink-0 rounded-sm font-medium whitespace-nowrap text-primary-selected transition-colors duration-150 ease-out hover:text-primary-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir data-[state=open]:text-primary-dark motion-reduce:transition-none pointer-coarse:min-h-11"
              >{approveReadyText(band.ready)}</Popover.Trigger>
              <Popover.Portal>
                <Popover.Content
                  side="bottom"
                  align="end"
                  sideOffset={6}
                  collisionPadding={12}
                  aria-label={approveCompanyTitle(band.ready, name)}
                  data-import-approve-confirm
                  class={`${POPOVER_CARD} w-[20rem] max-w-[calc(100vw-1.5rem)] p-3`}
                >
                  <p class="text-[0.8125rem] leading-[calc(18/13)] font-medium text-ink">{approveCompanyTitle(band.ready, name)}</p>
                  <ul class={`mt-1.5 flex flex-col gap-1 ${SHEET_SMALL} text-ink-muted`}>
                    {#each APPROVE_NOTES as line (line)}<li>{line}</li>{/each}
                    {#if newNote}<li data-import-approve-new-company class={!shownIndustry && (band.categories.final_pd?.total ?? 0) > 0 ? AMBER : ""}>{newNote}</li>{/if}
                  </ul>
                  {#if mergedInto}
                    <p data-import-approve-merged class={`mt-2 ${SHEET_SMALL} ${AMBER}`}>{mergedNote(name, mergedInto)}</p>
                  {:else}
                    <button
                      type="button"
                      disabled={approving}
                      data-import-approve-go
                      onclick={() => void approveReady()}
                      class={`mt-2.5 ${CONFIRM_LINE}`}
                    >{approving ? "Approving..." : approveLine(band.ready)}</button>
                  {/if}
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          {:else}
            <span class={`shrink-0 whitespace-nowrap ${word.tone === "amber" ? AMBER : "text-ink-muted"}`}>{word.text}</span>
          {/if}
        {/each}
      </div>
      {#if canDeleteBand}
        <Popover.Root bind:open={deleteOpen}>
          <Popover.Trigger
            type="button"
            disabled={deleting}
            aria-label="Delete company files"
            title={`Delete all files in ${name}`}
            data-import-band-delete={band.companyKey}
            class={`relative z-[1] flex size-7 shrink-0 items-center justify-center rounded-md text-ink-muted transition-[opacity,background-color,color] duration-150 ease-out hover:bg-danger-surface hover:text-danger-ink-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir data-[state=open]:bg-danger-surface data-[state=open]:text-danger-ink-muted motion-reduce:transition-none pointer-coarse:size-11 ${
              deleteOpen
                ? "opacity-100"
                : "opacity-0 group-hover/band:opacity-100 group-has-[:focus-visible]/band:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
            }`}
          >
            <TrashIcon size="0.875rem" aria-hidden="true" />
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              side="bottom"
              align="end"
              sideOffset={6}
              collisionPadding={12}
              aria-label={`Delete ${name}`}
              data-import-band-delete-confirm
              class={`${POPOVER_CARD} w-[18.5rem] max-w-[calc(100vw-1.5rem)] p-3`}
            >
              <p class="text-[0.8125rem] leading-[calc(18/13)] font-medium text-ink">
                Delete {plural(deletableCount, "file")} in {name}?
              </p>
              <p class={`mt-1 ${SHEET_SMALL} text-ink-muted`}>{DELETE_NOTE}</p>
              {#if band.beingRead > 0}
                <p class={`mt-1 ${SHEET_SMALL} text-ink-muted`}>
                  {plural(band.beingRead, "file")} still being read will stay until finished.
                </p>
              {/if}
              <button
                type="button"
                disabled={deleting}
                data-import-band-delete-go
                onclick={() => void deleteBand()}
                class={`mt-2.5 ${DANGER_CONFIRM_LINE}`}
              >{deleting ? "Deleting..." : deleteLine(deletableCount)}</button>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      {/if}
      <span
        data-import-band-chevron
        data-chevron-state={open ? "up" : "down"}
        aria-hidden="true"
        class="flex size-5 shrink-0 items-center justify-center text-ink-muted"
      >
        <span
          class={`flex size-3.5 items-center justify-center transition-transform duration-200 ease-out motion-reduce:transition-none ${
            open ? "rotate-180" : "rotate-0"
          }`}
        >
          <IconChevronDown size={14} strokeWidth={1.8} class="shrink-0" />
        </span>
      </span>
    </div>
  </div>

  {#if open}
    <div id={sectionsId} data-import-band-sections>
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
