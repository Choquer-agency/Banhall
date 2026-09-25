<!--
  Details facts (ui-design-final.md section 8, board 5.1y A1 to A3): 34px rows
  with an 8px inset, a 104px label column and a 12px gap. Industry, Fiscal
  year, Science code and Project number edit in place where the viewer may
  edit details: the whole row takes the primary wash on hover and while its
  picker is open, and a click anywhere on it opens the editor. Owner, Created
  and Edited are read only. The fiscal year reads on one line as
  "2026 (June 30, 2026)" with its calendar icon always visible.
-->
<script lang="ts">
  import { tick } from "svelte";
  import { CalendarBlankIcon, CaretDownIcon, PencilSimpleIcon } from "phosphor-svelte";
  import DatePicker from "$lib/components/ui/DatePicker.svelte";
  import IndustrySelect from "$lib/components/ui/IndustrySelect.svelte";
  import { industryLabel } from "$lib/industries";
  import ScienceCodePicker from "./ScienceCodePicker.svelte";
  import PersonAvatar from "./PersonAvatar.svelte";
  import {
    fiscalYearParts,
    formatCreated,
    formatEdited,
    fromDateInput,
    scienceCodeDisplay,
    toDateInput,
  } from "./detailsFormat";
  import type { DetailsFieldSavers, DetailsPanelData } from "./types";

  let {
    data,
    now,
    canCreateIndustry = false,
    onSaveIndustry,
    onSaveFiscalYear,
    onSaveScienceCode,
    onSaveProjectNumber,
    onSuggestScienceCode,
  }: {
    data: DetailsPanelData;
    now: number;
    /** Admins may add a new industry from the picker. */
    canCreateIndustry?: boolean;
  } & DetailsFieldSavers = $props();

  const editable = $derived(data.permissions.canEditDetails);
  const fiscal = $derived(fiscalYearParts(data.fiscalYearEnd));
  const science = $derived(scienceCodeDisplay(data.scienceCode));

  let editingIndustry = $state(false);
  let editingNumber = $state(false);
  let savingNumber = $state(false);
  let numberDraft = $state("");
  let numberInput = $state<HTMLInputElement | null>(null);
  let numberButton = $state<HTMLButtonElement | null>(null);
  // The last number whose save failed; blur and close do not repeat it.
  let failedNumber: string | null = null;
  let numberSave: Promise<boolean> | null = null;
  let closeBlocked = $state(false);
  const uid = $props.id();
  const numberErrorId = `${uid}-project-number-error`;
  let industryHost = $state<HTMLDivElement | null>(null);
  let fieldError = $state<{ field: string; message: string } | null>(null);
  const numberError = $derived(fieldError?.field === "project-number" ? fieldError.message : null);
  let suggestionNote = $state("");

  async function run(field: string, action: () => Promise<unknown>) {
    fieldError = null;
    try {
      await action();
    } catch (error) {
      fieldError = {
        field,
        message: error instanceof Error && error.message ? error.message : "The change could not be saved.",
      };
    }
  }

  async function beginIndustry() {
    editingIndustry = true;
    await tick();
    industryHost?.querySelector<HTMLInputElement>("input")?.focus();
  }

  async function beginNumber() {
    numberDraft = data.projectNumber ?? "";
    fieldError = null;
    closeBlocked = false;
    failedNumber = null;
    editingNumber = true;
    await tick();
    numberInput?.focus();
    numberInput?.select();
  }

  /**
   * What set off a project number save. Enter is an explicit save: it retries
   * a number that failed before and keeps focus in the field on failure. A
   * blur (the writer moved on) never pulls focus back and never repeats a
   * write that already failed for the same number. A close (Close details or
   * Hand off) saves first and tells the panel whether it may go on.
   */
  type NumberSaveSource = "enter" | "blur" | "close";

  function saveNumber(source: NumberSaveSource): Promise<boolean> {
    // One write at a time: a blur that fires while a save is running (the
    // field is disabled, or Close details was pressed) joins that save.
    numberSave ??= runNumberSave(source).finally(() => (numberSave = null));
    return numberSave;
  }

  async function runNumberSave(source: NumberSaveSource): Promise<boolean> {
    if (!editingNumber) return true;
    if (numberDraft === (data.projectNumber ?? "")) {
      await endNumberEdit(source === "enter");
      return true;
    }
    if (source !== "enter" && numberDraft === failedNumber) {
      if (source === "close") await blockClose();
      return false;
    }
    savingNumber = true;
    fieldError = null;
    closeBlocked = false;
    let saved = false;
    try {
      await onSaveProjectNumber?.(numberDraft);
      saved = true;
    } catch (error) {
      failedNumber = numberDraft;
      fieldError = {
        field: "project-number",
        message: error instanceof Error && error.message ? error.message : "The change could not be saved.",
      };
    } finally {
      savingNumber = false;
    }
    if (saved) {
      failedNumber = null;
      await endNumberEdit(source === "enter");
      return true;
    }
    if (source === "close") await blockClose();
    else if (source === "enter") await focusNumberInput();
    return false;
  }

  async function endNumberEdit(returnFocus: boolean) {
    editingNumber = false;
    closeBlocked = false;
    failedNumber = null;
    if (fieldError?.field === "project-number") fieldError = null;
    if (returnFocus) {
      await tick();
      numberButton?.focus();
    }
  }

  async function focusNumberInput() {
    await tick();
    numberInput?.focus();
  }

  async function blockClose() {
    closeBlocked = true;
    await focusNumberInput();
  }

  function onNumberKeydown(event: KeyboardEvent) {
    if (event.key === "Enter") {
      event.preventDefault();
      void saveNumber("enter");
    } else if (event.key === "Escape") {
      event.preventDefault();
      void endNumberEdit(true);
    }
  }

  /**
   * Called by the panel before it closes or switches to Hand off, so a
   * project number edit is never lost silently: it saves (true when there is
   * nothing left to save), and on failure the edit stays open with its error
   * and the field takes focus.
   */
  export async function commitPendingEdits(): Promise<boolean> {
    if (numberSave) await numberSave;
    return saveNumber("close");
  }

  async function suggest() {
    suggestionNote = "Suggesting a code...";
    await run("science", async () => {
      const result = await onSuggestScienceCode?.();
      if (!result) return;
      // A code chosen by hand while the suggestion was pending stands.
      suggestionNote =
        result.status === "suggested"
          ? `Suggested ${result.label}`
          : result.status === "none"
            ? "No suggestion available."
            : "";
    });
  }

  const QUICK_PICKS = [
    { label: "Mar 31", month: 3, day: 31 },
    { label: "Jun 30", month: 6, day: 30 },
    { label: "Sep 30", month: 9, day: 30 },
    { label: "Dec 31", month: 12, day: 31 },
  ] as const;

  const row = "relative grid min-h-[34px] grid-cols-[104px_minmax(0,1fr)] items-center gap-x-3 rounded-md px-2";
  const editableRow = `${row} group/row transition-colors hover:bg-primary-wash has-[[data-state=open]]:bg-primary-wash motion-reduce:transition-none`;
  // The value button runs to the row's right edge (so pickers align with the
  // row) and stretches its hit area and focus ring over the whole row.
  const valueButton =
    "-mr-2 flex min-h-[34px] w-[calc(100%+0.5rem)] min-w-0 items-center gap-1.5 pr-2 text-left outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-fir pointer-coarse:min-h-11";
  const hoverIcon =
    "shrink-0 text-ink-muted opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 [[data-state=open]_&]:opacity-100 motion-reduce:transition-none";
</script>

{#snippet notSet()}
  <span class="text-ink-faint">Not set</span>
{/snippet}

{#snippet errorFor(field: string)}
  {#if fieldError?.field === field}
    <dd class="col-start-2 pb-1.5 text-xs leading-[18px] text-red-700" role="alert">{fieldError.message}</dd>
  {/if}
{/snippet}

<dl data-details-facts class="flex flex-col text-[13px] leading-[18px]">
  <div class={editable && !editingIndustry ? editableRow : row}>
    <dt class="text-ink-muted">Industry</dt>
    <dd data-details-fact="industry" class="flex min-h-[34px] min-w-0 items-center text-ink">
      {#if editable && editingIndustry}
        <div bind:this={industryHost} class="w-full">
          <IndustrySelect
            value={data.industry ?? ""}
            size="sm"
            canCreate={canCreateIndustry}
            class="w-full"
            onValueChange={(next) => {
              editingIndustry = false;
              void run("industry", async () => onSaveIndustry?.(next || null));
            }}
          />
        </div>
      {:else if editable}
        <button type="button" class={valueButton} aria-label="Edit industry" onclick={beginIndustry}>
          <span class="min-w-0 flex-1 truncate">
            {#if data.industry}{industryLabel(data.industry)}{:else}{@render notSet()}{/if}
          </span>
          <PencilSimpleIcon size={13} aria-hidden="true" class={hoverIcon} />
        </button>
      {:else}
        <span class="truncate">{#if data.industry}{industryLabel(data.industry)}{:else}{@render notSet()}{/if}</span>
      {/if}
    </dd>
    {@render errorFor("industry")}
  </div>

  <div class={editable ? editableRow : row}>
    <dt class="text-ink-muted">Fiscal year</dt>
    <dd data-details-fact="fiscal-year" class="flex min-h-[34px] min-w-0 items-center text-ink">
      {#snippet fiscalValue()}
        <span data-fiscal-year-value class="flex min-w-0 flex-1 items-center gap-1.5 truncate whitespace-nowrap">
          {#if fiscal}
            <span>{fiscal.year}</span> <span class="truncate text-ink-muted">({fiscal.date})</span>
          {:else}
            {@render notSet()}
          {/if}
        </span>
        <CalendarBlankIcon size={14} aria-hidden="true" class="shrink-0 text-ink-muted" />
      {/snippet}
      {#if editable}
        <DatePicker
          value={toDateInput(data.fiscalYearEnd)}
          heading="Year end"
          quickPicks={QUICK_PICKS}
          helper="The fiscal year takes the year of its end date."
          align="end"
          onCommit={(next) => void run("fiscal", async () => onSaveFiscalYear?.(fromDateInput(next)))}
        >
          {#snippet trigger({ props })}
            <button {...props} type="button" class={valueButton} aria-label="Edit fiscal year">
              {@render fiscalValue()}
            </button>
          {/snippet}
        </DatePicker>
      {:else}
        <span class="flex w-full min-w-0 items-center gap-1.5">{@render fiscalValue()}</span>
      {/if}
    </dd>
    {@render errorFor("fiscal")}
  </div>

  <div class={editable ? editableRow : row}>
    <dt class="text-ink-muted">Science code</dt>
    <dd data-details-fact="science-code" class="flex min-h-[34px] min-w-0 items-center text-ink">
      {#snippet scienceValue()}
        <span class="flex min-w-0 flex-1 items-center gap-1.5">
          {#if science}
            <span class="min-w-0 truncate">{science.label}</span> <span class="shrink-0 font-mono text-xs leading-[18px] text-ink-muted">{science.code}</span>
          {:else}
            {@render notSet()}
          {/if}
        </span>
      {/snippet}
      {#if editable}
        <ScienceCodePicker
          value={data.scienceCode}
          onSelect={(code) => run("science", async () => onSaveScienceCode?.(code))}
          onSuggest={onSuggestScienceCode ? suggest : undefined}
        >
          {#snippet trigger({ props })}
            <!-- The caret overlays the row end, so a full name and its code
                 keep the whole value column until the row is hovered or open. -->
            <button
              {...props}
              type="button"
              class={`${valueButton} group-hover/row:pr-6 data-[state=open]:pr-6`}
              aria-label="Edit science code"
            >
              {@render scienceValue()}
              <CaretDownIcon size={12} aria-hidden="true" class={`absolute right-2 top-1/2 -translate-y-1/2 ${hoverIcon}`} />
            </button>
          {/snippet}
        </ScienceCodePicker>
      {:else}
        {@render scienceValue()}
      {/if}
    </dd>
    {@render errorFor("science")}
    {#if suggestionNote}
      <dd class="col-start-2 pb-1.5 text-xs leading-[18px] text-ink-muted" aria-live="polite">{suggestionNote}</dd>
    {/if}
  </div>

  <div class={editable && !editingNumber ? editableRow : row}>
    <dt class="text-ink-muted">Project number</dt>
    <dd data-details-fact="project-number" class="flex min-h-[34px] min-w-0 items-center text-ink">
      {#if editable && editingNumber}
        <input
          bind:this={numberInput}
          bind:value={numberDraft}
          onkeydown={onNumberKeydown}
          onblur={() => void saveNumber("blur")}
          disabled={savingNumber}
          aria-label="Edit project number"
          aria-invalid={numberError ? "true" : undefined}
          aria-describedby={numberError ? numberErrorId : undefined}
          placeholder="Not set"
          class="field-control h-[26px] w-full min-w-0 rounded-md px-2 text-[13px] leading-[18px] text-ink placeholder:text-ink-faint"
        />
      {:else if editable}
        <button bind:this={numberButton} type="button" class={valueButton} aria-label="Edit project number" onclick={beginNumber}>
          <span class="min-w-0 flex-1 truncate">
            {#if data.projectNumber}{data.projectNumber}{:else}{@render notSet()}{/if}
          </span>
          <PencilSimpleIcon size={13} aria-hidden="true" class={hoverIcon} />
        </button>
      {:else}
        <span class="truncate">{#if data.projectNumber}{data.projectNumber}{:else}{@render notSet()}{/if}</span>
      {/if}
    </dd>
    {#if numberError}
      <dd id={numberErrorId} class="col-start-2 pb-1.5 text-xs leading-[18px] text-red-700" role="alert">
        {numberError}{#if closeBlocked}{" "}Fix the number, or press Escape to discard it.{/if}
      </dd>
    {/if}
  </div>

  <div class={row}>
    <dt class="text-ink-muted">Owner</dt>
    <dd data-details-fact="owner" class="flex min-h-[34px] min-w-0 items-center gap-1.5 text-ink">
      {#if data.owner}
        <PersonAvatar initials={data.owner.initials} seed={String(data.owner.userId)} isYou={data.owner.isYou} />
        <span class="truncate">{data.owner.label}{data.owner.isYou ? " (you)" : ""}</span>
      {:else}
        <span class="text-ink-faint">No owner recorded</span>
      {/if}
    </dd>
  </div>
</dl>

<div aria-hidden="true" class="mx-2 my-2.5 h-px bg-line-soft"></div>

<dl class="flex flex-col text-[13px] leading-[18px] text-ink-secondary">
  <div class={row}>
    <dt class="text-ink-muted">Created</dt>
    <dd data-details-fact="created" class="flex min-h-[34px] items-center">{formatCreated(data.createdAt)}</dd>
  </div>
  <div class={row}>
    <dt class="text-ink-muted">Edited</dt>
    <dd data-details-fact="edited" class="flex min-h-[34px] items-center">{formatEdited(data.editedAt, now)}</dd>
  </div>
</dl>
