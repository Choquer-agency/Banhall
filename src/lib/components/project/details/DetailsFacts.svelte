<!--
  Details facts (ui-design-final.md section 8, board 5.1y A1 to A3): a 104px
  label column and 34px rows. Industry, Fiscal year, Science code and Project
  number edit in place where the viewer may edit details; Owner, Created and
  Edited are read only. The fiscal year reads on one line as
  "2026 (June 30, 2026)" with its calendar icon always visible.
-->
<script lang="ts">
  import { tick } from "svelte";
  import { CalendarBlankIcon, CaretDownIcon, PencilSimpleIcon } from "phosphor-svelte";
  import DatePicker from "$lib/components/ui/DatePicker.svelte";
  import EditableText from "$lib/components/project/EditableText.svelte";
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
  let industryHost = $state<HTMLDivElement | null>(null);
  let fieldError = $state<{ field: string; message: string } | null>(null);
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

  const valueButton =
    "group/value flex min-h-[26px] w-full min-w-0 items-center gap-2 rounded-md px-1.5 -mx-1.5 text-left transition-colors hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir data-[state=open]:bg-gray-50 pointer-coarse:min-h-11";
</script>

{#snippet notSet()}
  <span class="text-ink-faint">Not set</span>
{/snippet}

{#snippet errorFor(field: string)}
  {#if fieldError?.field === field}
    <dd class="col-start-2 pb-1 text-xs text-red-700" role="alert">{fieldError.message}</dd>
  {/if}
{/snippet}

<dl data-details-facts class="grid grid-cols-[104px_minmax(0,1fr)] items-center text-[13px]">
  <dt class="flex min-h-[34px] items-center text-ink-muted">Industry</dt>
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
        <PencilSimpleIcon size={13} aria-hidden="true" class="shrink-0 text-ink-faint opacity-0 transition-opacity group-hover/value:opacity-100 group-focus-visible/value:opacity-100" />
      </button>
    {:else}
      <span class="truncate">{#if data.industry}{industryLabel(data.industry)}{:else}{@render notSet()}{/if}</span>
    {/if}
  </dd>
  {@render errorFor("industry")}

  <dt class="flex min-h-[34px] items-center text-ink-muted">Fiscal year</dt>
  <dd data-details-fact="fiscal-year" class="flex min-h-[34px] min-w-0 items-center text-ink">
    {#snippet fiscalValue()}
      <span data-fiscal-year-value class="min-w-0 flex-1 truncate whitespace-nowrap">
        {#if fiscal}
          {fiscal.year} <span class="text-ink-muted">({fiscal.date})</span>
        {:else}
          {@render notSet()}
        {/if}
      </span>
      <CalendarBlankIcon size={15} aria-hidden="true" class="shrink-0 text-ink-muted" />
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
      <span class="flex w-full min-w-0 items-center gap-2">{@render fiscalValue()}</span>
    {/if}
  </dd>
  {@render errorFor("fiscal")}

  <dt class="flex min-h-[34px] items-center text-ink-muted">Science code</dt>
  <dd data-details-fact="science-code" class="flex min-h-[34px] min-w-0 items-center text-ink">
    {#snippet scienceValue()}
      <span class="min-w-0 flex-1 truncate">
        {#if science}
          {science.label} <span class="ml-1 font-mono text-xs text-ink-muted">{science.code}</span>
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
          <button {...props} type="button" class={valueButton} aria-label="Edit science code">
            {@render scienceValue()}
            <CaretDownIcon size={12} aria-hidden="true" class="shrink-0 text-ink-faint opacity-0 transition-opacity group-hover/value:opacity-100 group-focus-visible/value:opacity-100" />
          </button>
        {/snippet}
      </ScienceCodePicker>
    {:else}
      {@render scienceValue()}
    {/if}
  </dd>
  {@render errorFor("science")}
  {#if suggestionNote}
    <dd class="col-start-2 pb-1 text-xs text-ink-muted" aria-live="polite">{suggestionNote}</dd>
  {/if}

  <dt class="flex min-h-[34px] items-center text-ink-muted">Project number</dt>
  <dd data-details-fact="project-number" class="flex min-h-[34px] min-w-0 items-center text-ink">
    {#if editable}
      <EditableText
        value={data.projectNumber ?? ""}
        placeholder="Not set"
        label="project number"
        onSave={(value) => run("project-number", async () => onSaveProjectNumber?.(value))}
      />
    {:else}
      <span class="truncate">{#if data.projectNumber}{data.projectNumber}{:else}{@render notSet()}{/if}</span>
    {/if}
  </dd>
  {@render errorFor("project-number")}

  <dt class="flex min-h-[34px] items-center text-ink-muted">Owner</dt>
  <dd data-details-fact="owner" class="flex min-h-[34px] min-w-0 items-center gap-2 text-ink">
    {#if data.owner}
      <PersonAvatar initials={data.owner.initials} seed={String(data.owner.userId)} isYou={data.owner.isYou} />
      <span class="truncate">{data.owner.label}{data.owner.isYou ? " (you)" : ""}</span>
    {:else}
      <span class="text-ink-faint">No owner recorded</span>
    {/if}
  </dd>
</dl>

<div class="my-2 border-t border-line-soft"></div>

<dl class="grid grid-cols-[104px_minmax(0,1fr)] items-center text-[13px] text-ink-secondary">
  <dt class="flex min-h-[34px] items-center text-ink-muted">Created</dt>
  <dd data-details-fact="created" class="flex min-h-[34px] items-center">{formatCreated(data.createdAt)}</dd>
  <dt class="flex min-h-[34px] items-center text-ink-muted">Edited</dt>
  <dd data-details-fact="edited" class="flex min-h-[34px] items-center">{formatEdited(data.editedAt, now)}</dd>
</dl>
