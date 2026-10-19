<!--
  Bulk edit for a selection on the Projects page (Paper Z7m and Z7p,
  2026-10-19; replaces the 2026-10-14 side panel and its review step). A
  centered FormDialog, "Edit N projects", where every field starts at "No
  change": client (a listed client), fiscal year end, industry and science
  code. Picking a value marks the field as changing (the lagoon line) with a
  small Reset under it on the right. Each picker can also clear the field on
  every project: the date picker's and science code picker's Clear, and
  Industry's "Not set".

  Apply makes one `projects.bulkUpdateProjects` call, toasts the result,
  closes the dialog and hands the result to the host. A Consultant is told
  in the footer how many of the selected projects are not theirs
  (bulkUpdateProjects skips them). Nothing here offers undo.

  `rows` follows the host's live selection, so Apply sends the projects
  selected at that moment.
-->
<script lang="ts">
  import { useMutation } from "convex-svelte";
  import { toast } from "svelte-sonner";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import { IconCalendar, IconChevronDown } from "$lib/components/icons";
  import DatePicker from "$lib/components/ui/DatePicker.svelte";
  import IndustrySelect, { INDUSTRY_CLEAR } from "$lib/components/ui/IndustrySelect.svelte";
  import ClientCombobox from "$lib/components/project-new/ClientCombobox.svelte";
  import ScienceCodePicker from "$lib/components/project/details/ScienceCodePicker.svelte";
  import NewClientDialog, { type NewClientResult } from "$lib/components/clients/NewClientDialog.svelte";
  import FormDialog from "$lib/components/ui/FormDialog.svelte";
  import {
    formCancel,
    formError,
    formFieldAction,
    formLabel,
    formPicker,
    formPrimary,
    formSelect,
  } from "$lib/components/ui/formDialog";
  import { userErrorMessage } from "$lib/errors";
  import { addedClientOption, type ClientOption } from "$lib/clients/clientOptions";
  import { canCreateProjects } from "$lib/workspace/projectDuplicate";
  import type { CapabilityRole } from "../../../../shared/capabilities";
  import { dashboardFiscalYear } from "../../../../shared/dashboardProjection";
  import { formatYearEnd } from "$lib/projects/fiscalYearGroups";
  import {
    bulkMutationArgs,
    bulkResultMessage,
    changedFields,
    projectsLabel,
    reviewRows,
    scienceCodeLabel,
    sharedValueLabel,
    skipNote,
    utcDateFromInput,
    type BulkChange,
    type BulkEditRow,
  } from "$lib/projects/bulkEdit";

  type Viewer = { _id: string; role?: CapabilityRole | null; isAnonymous?: boolean } | null;
  type Mode = "none" | "set" | "clear";

  let {
    open = $bindable(false),
    rows,
    viewer,
    returnFocus = undefined,
    onApplied = undefined,
  }: {
    open?: boolean;
    /** The selected projects, as the cards hold them now (follows the selection). */
    rows: BulkEditRow[];
    viewer: Viewer;
    /** Where focus goes when the dialog closes. */
    returnFocus?: () => HTMLElement | null | undefined;
    /** After a successful apply (the dialog has closed and toasted). */
    onApplied?: (result: { updated: number; skipped: number }) => void;
  } = $props();

  const bulkUpdate = useMutation(api.projects.bulkUpdateProjects);

  let clientValue = $state("");
  let clientPicked = $state<ClientOption | null>(null);
  let clientsLoading = $state(true);
  let extraClients = $state<ClientOption[]>([]);
  let fyMode = $state<Mode>("none");
  let fyDate = $state("");
  /** "" is no change, INDUSTRY_CLEAR clears, anything else sets. */
  let industryValue = $state("");
  let scienceMode = $state<Mode>("none");
  let scienceValue = $state("");
  let applying = $state(false);
  /** Escape was pressed over unsaved changes: say how to leave instead. */
  let escapeNote = $state(false);
  let applyError = $state<string | null>(null);

  // Each opening starts from "No change".
  $effect(() => {
    if (!open) return;
    clientValue = "";
    extraClients = [];
    fyMode = "none";
    fyDate = "";
    industryValue = "";
    scienceMode = "none";
    scienceValue = "";
    applyError = null;
  });

  const clientInvalid = $derived(clientValue.trim() !== "" && !clientsLoading && !clientPicked);
  const industryMode = $derived<Mode>(
    industryValue === "" ? "none" : industryValue === INDUSTRY_CLEAR ? "clear" : "set"
  );

  const change = $derived.by((): BulkChange => {
    const next: BulkChange = {};
    if (clientValue.trim() && clientPicked) next.clientName = clientPicked.name;
    if (fyMode === "set") {
      const timestamp = utcDateFromInput(fyDate);
      if (timestamp !== null) next.fiscalYearEnd = timestamp;
    } else if (fyMode === "clear") {
      next.fiscalYearEnd = null;
    }
    if (industryMode === "set") next.industry = industryValue;
    else if (industryMode === "clear") next.industry = null;
    if (scienceMode === "set" && scienceValue) next.scienceCode = scienceValue;
    else if (scienceMode === "clear") next.scienceCode = null;
    return next;
  });

  const changedCount = $derived(changedFields(change).length);
  const dirty = $derived(changedCount > 0 || clientValue.trim() !== "");
  $effect(() => {
    if (!open || !dirty) escapeNote = false;
  });
  const rowsStatus = $derived(reviewRows(rows, change, viewer));
  const note = $derived(skipNote(rowsStatus));
  const allSkipped = $derived(rowsStatus.length > 0 && rowsStatus.every((row) => row.status === "skipped"));
  const canApply = $derived(changedCount > 0 && !clientInvalid && !allSkipped && !applying && rows.length > 0);
  const mayCreateClient = $derived(canCreateProjects(viewer));
  const isAdmin = $derived(viewer?.role === "admin");
  const setDate = $derived(utcDateFromInput(fyDate));
  // A picked day clicked again empties the date: that is no change.
  const fyShown = $derived<Mode>(fyMode === "set" && setDate === null ? "none" : fyMode);
  const scienceShown = $derived(scienceCodeLabel(scienceValue || null));
  // Before anything is picked each field shows what the projects hold now:
  // the shared value, "Not set", or "Varies" (owner, 2026-10-19).
  const shared = $derived({
    clientName: sharedValueLabel(rows, "clientName"),
    fiscalYearEnd: sharedValueLabel(rows, "fiscalYearEnd"),
    industry: sharedValueLabel(rows, "industry"),
    scienceCode: sharedValueLabel(rows, "scienceCode"),
  });
  const anyYearEnd = $derived(rows.some((row) => row.fiscalYearEnd !== undefined && row.fiscalYearEnd !== null));

  let closeButton: HTMLButtonElement | null = $state(null);

  async function apply() {
    if (!canApply) return;
    applying = true;
    applyError = null;
    try {
      const ids = rows.map((row) => row._id as Id<"projects">);
      const result = await bulkUpdate({ ...bulkMutationArgs(ids, change), projectIds: ids });
      toast.success(bulkResultMessage(result, viewer));
      open = false;
      onApplied?.(result);
    } catch (error) {
      applyError = userErrorMessage(error, "The projects could not be updated. Nothing was changed.");
    } finally {
      applying = false;
    }
  }

  function resetFiscalYear() {
    fyMode = "none";
    fyDate = "";
  }

  function resetScience() {
    scienceMode = "none";
    scienceValue = "";
  }

  let newClientOpen = $state(false);
  let newClientName = $state("");
  function openNewClient(typedName: string) {
    newClientName = typedName;
    newClientOpen = true;
  }
  function onClientCreated(client: NewClientResult) {
    extraClients = [...extraClients, addedClientOption(client)];
    clientValue = client.name;
  }

  const CLEAR_ALL = "Clear on every project";
  const QUICK_PICKS = [
    { label: "Mar 31", month: 3, day: 31 },
    { label: "Jun 30", month: 6, day: 30 },
    { label: "Sep 30", month: 9, day: 30 },
    { label: "Dec 31", month: 12, day: 31 },
  ] as const;
</script>

{#snippet reset(field: string, label: string, onReset: () => void)}
  <div class="flex justify-end">
    <button type="button" data-bulk-reset={field} aria-label={`Reset ${label}`} onclick={onReset} class={formFieldAction}>Reset</button>
  </div>
{/snippet}

{#snippet footerNote()}
  {#if escapeNote}
    <p class="text-[0.8125rem] leading-[1.125rem] text-ink-muted" role="status" data-bulk-escape-note>Apply the changes, or use Cancel to discard them.</p>
  {:else if note}
    <p class="text-[0.8125rem] leading-[1.125rem] text-ink-muted" data-bulk-skip-note>{note}</p>
  {/if}
{/snippet}

{#snippet footer()}
  <button type="button" class={formCancel} disabled={applying} onclick={() => (open = false)} data-bulk-cancel>Cancel</button>
  <button type="button" class={formPrimary} disabled={!canApply} onclick={() => void apply()} data-bulk-apply>
    {applying ? "Applying..." : `Apply to ${projectsLabel(rows.length)}`}
  </button>
{/snippet}

<FormDialog
  bind:open
  bind:closeButton
  title={`Edit ${projectsLabel(rows.length)}`}
  srDescription="Each field shows what the selected projects hold now. Only the fields you change are applied."
  busy={applying}
  {dirty}
  onEscapeBlocked={() => (escapeNote = true)}
  testId="bulk-edit-panel"
  initialFocus={() => closeButton}
  {returnFocus}
  {footer}
  {footerNote}
>
  <fieldset disabled={applying} class="flex min-w-0 flex-col gap-3.5" data-bulk-fields>
    <div class="flex flex-col gap-1.5" data-bulk-field="clientName" data-changed={clientValue.trim() ? "" : undefined}>
      <label for="bulk-edit-client" class={formLabel}>Company</label>
      <ClientCombobox
        id="bulk-edit-client"
        bind:value={clientValue}
        bind:picked={clientPicked}
        bind:loading={clientsLoading}
        {extraClients}
        placeholder={shared.clientName}
        onNewClient={mayCreateClient ? openNewClient : undefined}
        inputClass="h-9 rounded-lg pl-3 text-sm! placeholder:text-ink-muted! pointer-coarse:h-11"
      />
      {#if clientInvalid}
        <p class={formError} role="alert" data-bulk-error="clientName">Pick a company from the list, or empty the field to keep each project's company.</p>
      {/if}
      {#if clientValue.trim()}
        {@render reset("clientName", "Company", () => (clientValue = ""))}
      {/if}
    </div>

    <div class="flex flex-col gap-1.5" data-bulk-field="fiscalYearEnd">
      <span class={formLabel} id="bulk-edit-fiscal-label">Fiscal year end</span>
      <DatePicker
        bind:value={fyDate}
        heading="Year end"
        quickPicks={QUICK_PICKS}
        helper="The fiscal year takes the year of its end date."
        onCommit={() => (fyMode = "set")}
      >
        {#snippet trigger({ props })}
          <button
            {...props}
            type="button"
            aria-labelledby="bulk-edit-fiscal-label"
            data-bulk-date
            data-changed={fyShown !== "none" ? "" : undefined}
            class={`field-control ${formPicker}`}
          >
            <IconCalendar size={15} strokeWidth={1.5} class="shrink-0 text-ink-muted" />
            {#if fyShown === "set" && setDate !== null}
              <span class="min-w-0 flex-1 truncate">{formatYearEnd(setDate)}</span>
              <span class="shrink-0 text-[0.8125rem] leading-4 text-ink-muted">FY {dashboardFiscalYear(setDate)}</span>
            {:else if fyShown === "clear"}
              <span class="min-w-0 flex-1 truncate">Not set</span>
            {:else}
              <span class="min-w-0 flex-1 truncate text-ink-muted">{shared.fiscalYearEnd}</span>
            {/if}
          </button>
        {/snippet}
      </DatePicker>
      {#if fyShown !== "none"}
        {@render reset("fiscalYearEnd", "Fiscal year end", resetFiscalYear)}
      {:else if anyYearEnd}
        <div class="flex justify-end">
          <button
            type="button"
            data-bulk-clear="fiscalYearEnd"
            aria-label="Clear the fiscal year end on every project"
            onclick={() => {
              fyDate = "";
              fyMode = "clear";
            }}
            class={formFieldAction}
          >{CLEAR_ALL}</button>
        </div>
      {/if}
    </div>

    <div class="flex flex-col gap-1.5" data-bulk-field="industry" data-changed={industryMode !== "none" ? "" : undefined}>
      <label for="bulk-edit-industry" class={formLabel}>Industry</label>
      <IndustrySelect ariaLabel="Industry" id="bulk-edit-industry" bind:value={industryValue} noChangeLabel={shared.industry} clearable={shared.industry !== "Not set"} canCreate={isAdmin} class={formSelect} />
      {#if industryMode !== "none"}
        {@render reset("industry", "Industry", () => (industryValue = ""))}
      {/if}
    </div>

    <div class="flex flex-col gap-1.5" data-bulk-field="scienceCode">
      <span class={formLabel} id="bulk-edit-science-label">Science code</span>
      <ScienceCodePicker
        value={scienceMode === "set" ? scienceValue || null : null}
        clearLabel={CLEAR_ALL}
        onSelect={(code) => {
          scienceValue = code ?? "";
          scienceMode = code ? "set" : "clear";
        }}
      >
        {#snippet trigger({ props })}
          <button
            {...props}
            type="button"
            aria-labelledby="bulk-edit-science-label"
            data-bulk-science
            data-changed={scienceMode !== "none" ? "" : undefined}
            class={`field-control ${formPicker}`}
          >
            {#if scienceMode === "set" && scienceShown}
              <span class="min-w-0 flex-1 truncate">{scienceShown}</span>
            {:else if scienceMode === "clear"}
              <span class="min-w-0 flex-1 truncate">Not set</span>
            {:else}
              <span class="min-w-0 flex-1 truncate text-ink-muted">{shared.scienceCode}</span>
            {/if}
            <IconChevronDown size={14} strokeWidth={1.6} class="shrink-0 text-ink-muted" />
          </button>
        {/snippet}
      </ScienceCodePicker>
      {#if scienceMode !== "none"}
        {@render reset("scienceCode", "Science code", resetScience)}
      {/if}
    </div>

    {#if applyError}
      <p class={formError} role="alert" data-bulk-apply-error>{applyError}</p>
    {/if}
  </fieldset>
</FormDialog>

{#if mayCreateClient}
  <NewClientDialog
    bind:open={newClientOpen}
    initialName={newClientName}
    description="Once created, it fills the Company field for these projects."
    canAddIndustry={isAdmin}
    onCreated={onClientCreated}
  />
{/if}
