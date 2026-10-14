<!--
  Bulk edit for a selection on the Projects page (Paper W3 and W4;
  2026-10-14 amendment, "Select and bulk edit"). A side panel where every
  field starts at "No change", with a "Now:" line that sums up what the
  selection holds today: client (a listed client), fiscal year end (set or
  clear), industry (set or clear) and science code (set or clear).

  "Review changes" turns the panel into the review dialog (W4): one sentence
  per changed field, then each project's current and new values for the
  changed fields only, "No change" where a project already matches. A
  Consultant is told up front how many of the selected projects are not
  theirs (bulkUpdateProjects skips them). Apply makes one
  `projects.bulkUpdateProjects` call, toasts the result, closes the panel
  and hands the result to the host. Nothing here offers undo.

  `rows` follows the host's live selection. If the set of projects changes
  while the review shows, the panel goes back to the edit step and says so,
  so Apply only ever sends the set the person reviewed.
-->
<script lang="ts">
  import { tick, untrack } from "svelte";
  import { Dialog, RadioGroup } from "bits-ui";
  import { useMutation } from "convex-svelte";
  import { toast } from "svelte-sonner";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import { IconArrowRight, IconCalendar, IconChevronDown, IconClose } from "$lib/components/icons";
  import DatePicker from "$lib/components/ui/DatePicker.svelte";
  import IndustrySelect from "$lib/components/ui/IndustrySelect.svelte";
  import ClientCombobox from "$lib/components/project-new/ClientCombobox.svelte";
  import ScienceCodePicker from "$lib/components/project/details/ScienceCodePicker.svelte";
  import NewClientDialog, { type NewClientResult } from "$lib/components/clients/NewClientDialog.svelte";
  import { userErrorMessage } from "$lib/errors";
  import { addedClientOption, type ClientOption } from "$lib/clients/clientOptions";
  import { canCreateProjects } from "$lib/workspace/projectDuplicate";
  import type { CapabilityRole } from "../../../../shared/capabilities";
  import { dashboardFiscalYear } from "../../../../shared/dashboardProjection";
  import { formatYearEnd } from "$lib/projects/fiscalYearGroups";
  import {
    BULK_FIELD_LABELS,
    bulkMutationArgs,
    bulkResultMessage,
    changeSentences,
    changedFields,
    changedFieldsLabel,
    currentSummary,
    projectsLabel,
    reviewCountSentence,
    reviewRows,
    scienceCodeLabel,
    skipNote,
    utcDateFromInput,
    type BulkChange,
    type BulkEditRow,
  } from "$lib/projects/bulkEdit";
  import ProjectsSidePanel from "./ProjectsSidePanel.svelte";

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
    /** Where focus goes when the panel closes. */
    returnFocus?: () => HTMLElement | null | undefined;
    /** After a successful apply (the panel has closed and toasted). */
    onApplied?: (result: { updated: number; skipped: number }) => void;
  } = $props();

  const bulkUpdate = useMutation(api.projects.bulkUpdateProjects);

  let step = $state<"edit" | "review">("edit");
  let clientValue = $state("");
  let clientPicked = $state<ClientOption | null>(null);
  let clientsLoading = $state(true);
  let extraClients = $state<ClientOption[]>([]);
  let fyMode = $state<Mode>("none");
  let fyDate = $state("");
  let industryMode = $state<Mode>("none");
  let industryValue = $state("");
  let scienceMode = $state<Mode>("none");
  let scienceValue = $state("");
  let applying = $state(false);
  /** Escape was pressed over unsaved changes: say how to leave instead. */
  let escapeNote = $state(false);
  let applyError = $state<string | null>(null);
  /** The projects the review showed, as a key of their ids. */
  let reviewedKey = $state<string | null>(null);
  /** The selection changed under the review: the person reviews again. */
  let selectionChanged = $state(false);
  const rowsKey = $derived(rows.map((row) => row._id).join("\n"));

  // Each opening starts from "No change".
  $effect(() => {
    if (!open) return;
    step = "edit";
    clientValue = "";
    extraClients = [];
    fyMode = "none";
    fyDate = "";
    industryMode = "none";
    industryValue = "";
    scienceMode = "none";
    scienceValue = "";
    applyError = null;
    reviewedKey = null;
    selectionChanged = false;
  });

  // A project left the selection (or the set otherwise changed) while the
  // review showed: back to the edit step, so Apply never sends a set that
  // was not reviewed. Not while an apply runs; its ids are already sent.
  $effect(() => {
    if (!open || step !== "review" || applying || reviewedKey === null || rowsKey === reviewedKey) return;
    untrack(() => {
      step = "edit";
      reviewedKey = null;
      selectionChanged = true;
      applyError = null;
      void tick().then(() => reviewButton?.focus());
    });
  });

  const clientInvalid = $derived(clientValue.trim() !== "" && !clientsLoading && !clientPicked);

  const change = $derived.by((): BulkChange => {
    const next: BulkChange = {};
    if (clientValue.trim() && clientPicked) next.clientName = clientPicked.name;
    if (fyMode === "set") {
      const timestamp = utcDateFromInput(fyDate);
      if (timestamp !== null) next.fiscalYearEnd = timestamp;
    } else if (fyMode === "clear") {
      next.fiscalYearEnd = null;
    }
    if (industryMode === "set" && industryValue) next.industry = industryValue;
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
  const canReview = $derived(changedCount > 0 && !clientInvalid);
  const review = $derived(step === "review" ? reviewRows(rows, change, viewer) : []);
  const note = $derived(skipNote(review));
  const allSkipped = $derived(review.length > 0 && review.every((row) => row.status === "skipped"));
  const mayCreateClient = $derived(canCreateProjects(viewer));
  const isAdmin = $derived(viewer?.role === "admin");
  const setDate = $derived(utcDateFromInput(fyDate));
  const scienceShown = $derived(scienceCodeLabel(scienceValue || null));

  let reviewButton: HTMLButtonElement | null = $state(null);
  let applyButton: HTMLButtonElement | null = $state(null);
  let closeButton: HTMLButtonElement | null = $state(null);

  async function toReview() {
    if (!canReview) return;
    applyError = null;
    reviewedKey = rowsKey;
    selectionChanged = false;
    step = "review";
    await tick();
    applyButton?.focus();
  }

  async function back() {
    step = "edit";
    reviewedKey = null;
    applyError = null;
    await tick();
    reviewButton?.focus();
  }

  async function apply() {
    if (applying || allSkipped || changedCount === 0 || rowsKey !== reviewedKey) return;
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

  function openNewClient(typedName: string) {
    newClientName = typedName;
    newClientOpen = true;
  }
  let newClientOpen = $state(false);
  let newClientName = $state("");
  function onClientCreated(client: NewClientResult) {
    extraClients = [...extraClients, addedClientOption(client)];
    clientValue = client.name;
  }

  const labelClass = "text-xs leading-4 text-ink-secondary";
  const nowClass = "text-xs leading-4 text-ink-muted";
  const pickerClass =
    "field-control flex h-[2.125rem] w-full items-center gap-2 rounded-[0.4375rem] px-2.5 text-left text-[0.8125rem] leading-[1.125rem] text-ink pointer-coarse:h-11";
  const selectClass =
    "[&_input]:h-[2.125rem]! [&_input]:rounded-[0.4375rem]! [&_input]:px-2.5! [&_input]:text-[0.8125rem]! pointer-coarse:[&_input]:h-11! [&_button]:right-[0.1875rem]!";
  const segment =
    "flex h-[1.625rem] items-center rounded-md px-2.5 text-xs leading-4 text-ink-secondary transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-navy data-[state=checked]:bg-primary-selected data-[state=checked]:font-medium data-[state=checked]:text-white motion-reduce:transition-none pointer-coarse:h-11";
  const quietButton =
    "flex h-8 items-center rounded-[0.4375rem] px-3 text-[0.8125rem] leading-[1.125rem] text-ink-secondary transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none pointer-coarse:h-11";
  const primaryButton =
    "flex h-8 items-center rounded-[0.4375rem] bg-primary-selected px-3.5 text-[0.8125rem] leading-[1.125rem] font-medium text-white transition-colors hover:bg-navy focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none pointer-coarse:h-11";
  const QUICK_PICKS = [
    { label: "Mar 31", month: 3, day: 31 },
    { label: "Jun 30", month: 6, day: 30 },
    { label: "Sep 30", month: 9, day: 30 },
    { label: "Dec 31", month: 12, day: 31 },
  ] as const;
</script>

{#snippet modes(name: string, value: Mode, setLabel: string, onChange: (next: Mode) => void)}
  <RadioGroup.Root
    value={value}
    onValueChange={(next) => onChange(next as Mode)}
    orientation="horizontal"
    aria-label={name}
    data-bulk-mode={name}
    class="flex w-fit gap-0.5 rounded-lg bg-gray-50 p-0.5"
  >
    <RadioGroup.Item value="none" class={segment}>No change</RadioGroup.Item>
    <RadioGroup.Item value="set" class={segment}>{setLabel}</RadioGroup.Item>
    <RadioGroup.Item value="clear" class={segment}>Clear</RadioGroup.Item>
  </RadioGroup.Root>
{/snippet}

{#snippet escapeHint()}
  {#if escapeNote}
    <p class="shrink-0 px-5 pb-2 text-xs leading-4 text-ink-muted" role="status" data-bulk-escape-note>
      {step === "review" ? "Apply the changes, or go Back and use Cancel to discard them." : "Review the changes, or use Cancel to discard them."}
    </p>
  {/if}
{/snippet}

<ProjectsSidePanel
  bind:open
  layout={step === "review" ? "center" : "side"}
  busy={applying}
  {dirty}
  onEscapeBlocked={() => (escapeNote = true)}
  testId="bulk-edit-panel"
  initialFocus={() => closeButton}
  {returnFocus}
>
  {#if step === "edit"}
    <header class="flex h-[4.5rem] shrink-0 flex-col justify-center gap-0.5 border-b border-line-soft px-5">
      <div class="flex items-center gap-2">
        <Dialog.Title class="min-w-0 truncate text-[0.9375rem] leading-5 font-medium text-ink">Edit {projectsLabel(rows.length)}</Dialog.Title>
        <div class="flex-1"></div>
        <Dialog.Close
          bind:ref={closeButton}
          aria-label="Close"
          class="-mr-2 flex size-8 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-navy motion-reduce:transition-none pointer-coarse:size-11"
        >
          <IconClose size={16} strokeWidth={1.5} />
        </Dialog.Close>
      </div>
      <Dialog.Description class="text-xs leading-4 text-ink-muted">Only the fields you change are applied.</Dialog.Description>
    </header>

    <div class="flex min-h-0 flex-1 flex-col gap-[1.125rem] overflow-y-auto p-5 [scrollbar-gutter:stable]" data-bulk-fields>
      <div class="flex flex-col gap-1.5" data-bulk-field="clientName">
        <label for="bulk-edit-client" class={labelClass}>Client</label>
        <ClientCombobox
          id="bulk-edit-client"
          bind:value={clientValue}
          bind:picked={clientPicked}
          bind:loading={clientsLoading}
          {extraClients}
          placeholder="No change"
          onNewClient={mayCreateClient ? openNewClient : undefined}
          inputClass="h-[2.125rem] rounded-[0.4375rem] pl-2.5 text-[0.8125rem]! pointer-coarse:h-11"
        />
        {#if clientInvalid}
          <p class="text-xs leading-4 text-danger-ink-muted" role="alert" data-bulk-error="clientName">
            Pick a client from the list, or empty the field for no change.
          </p>
        {/if}
        <p class={nowClass} data-bulk-now="clientName">Now: {currentSummary(rows, "clientName")}</p>
      </div>

      <div class="flex flex-col gap-1.5" data-bulk-field="fiscalYearEnd">
        <span class={labelClass} id="bulk-edit-fiscal-label">Fiscal year end</span>
        {@render modes("Fiscal year end", fyMode, "Set date", (next) => (fyMode = next))}
        {#if fyMode === "set"}
          <DatePicker bind:value={fyDate} heading="Year end" quickPicks={QUICK_PICKS} helper="The fiscal year takes the year of its end date.">
            {#snippet trigger({ props })}
              <button {...props} type="button" aria-labelledby="bulk-edit-fiscal-label" data-bulk-date class={pickerClass}>
                <IconCalendar size={13} strokeWidth={1.4} class="shrink-0 text-ink-secondary" />
                {#if setDate !== null}
                  <span class="min-w-0 flex-1 truncate">{formatYearEnd(setDate)}</span>
                  <span class="shrink-0 text-xs leading-4 text-ink-muted">FY {dashboardFiscalYear(setDate)}</span>
                {:else}
                  <span class="min-w-0 flex-1 truncate text-ink-faint">Choose the year end</span>
                {/if}
              </button>
            {/snippet}
          </DatePicker>
        {/if}
        <p class={nowClass} data-bulk-now="fiscalYearEnd">Now: {currentSummary(rows, "fiscalYearEnd")}</p>
      </div>

      <div class="flex flex-col gap-1.5" data-bulk-field="industry">
        <span class={labelClass}>Industry</span>
        {@render modes("Industry", industryMode, "Set", (next) => (industryMode = next))}
        {#if industryMode === "set"}
          <IndustrySelect id="bulk-edit-industry" bind:value={industryValue} canCreate={isAdmin} class={selectClass} />
        {/if}
        <p class={nowClass} data-bulk-now="industry">Now: {currentSummary(rows, "industry")}</p>
      </div>

      <div class="flex flex-col gap-1.5" data-bulk-field="scienceCode">
        <span class={labelClass} id="bulk-edit-science-label">Science code</span>
        {@render modes("Science code", scienceMode, "Set", (next) => (scienceMode = next))}
        {#if scienceMode === "set"}
          <ScienceCodePicker value={scienceValue || null} onSelect={(code) => {
            scienceValue = code ?? "";
          }}>
            {#snippet trigger({ props })}
              <button {...props} type="button" aria-labelledby="bulk-edit-science-label" data-bulk-science class={pickerClass}>
                {#if scienceShown}
                  <span class="min-w-0 flex-1 truncate">{scienceShown}</span>
                {:else}
                  <span class="min-w-0 flex-1 truncate text-ink-faint">Choose a science code</span>
                {/if}
                <IconChevronDown size={12} strokeWidth={1.4} class="shrink-0 text-ink-muted" />
              </button>
            {/snippet}
          </ScienceCodePicker>
        {/if}
        <p class={nowClass} data-bulk-now="scienceCode">Now: {currentSummary(rows, "scienceCode")}</p>
      </div>
    </div>

    {#if selectionChanged}
      <p class="shrink-0 px-5 pb-2 text-xs leading-4 text-ink-secondary" role="status" data-bulk-selection-changed>
        The selection changed. Review the changes again.
      </p>
    {/if}
    {@render escapeHint()}
    <footer class="flex h-[3.75rem] shrink-0 items-center gap-2 border-t border-line-soft px-5">
      <p class="text-xs leading-4 text-ink-muted" aria-live="polite" data-bulk-count>{changedFieldsLabel(changedCount)}</p>
      <div class="flex-1"></div>
      <button type="button" class={quietButton} disabled={applying} onclick={() => (open = false)} data-bulk-cancel>Cancel</button>
      <button
        bind:this={reviewButton}
        type="button"
        class={primaryButton}
        disabled={!canReview}
        onclick={() => void toReview()}
        data-bulk-review
      >Review changes</button>
    </footer>
  {:else}
    <header class="flex shrink-0 flex-col gap-0.5 border-b border-line-soft px-[1.375rem] pb-3.5 pt-[1.125rem]">
      <Dialog.Title class="text-[0.9375rem] leading-5 font-medium text-ink">Review changes to {projectsLabel(rows.length)}</Dialog.Title>
      <Dialog.Description class="text-[0.8125rem] leading-[1.125rem] text-ink-muted" data-bulk-summary>
        {[...changeSentences(change), reviewCountSentence(review)].join(" ")}
      </Dialog.Description>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto px-[1.375rem] py-2">
      <table class="w-full table-fixed border-collapse text-[0.8125rem] leading-[1.125rem]" data-bulk-review-table>
        <thead>
          <tr class="h-[1.875rem] text-left text-xs leading-4 text-ink-muted">
            <th scope="col" class="w-[2.25rem] font-normal"><span class="sr-only">Number</span></th>
            <th scope="col" class="font-normal">Project</th>
            <th scope="col" class="w-[10.5rem] font-normal">Now</th>
            <th scope="col" class="w-6 font-normal"><span class="sr-only">Changes to</span></th>
            <th scope="col" class="w-[10.5rem] font-normal">After</th>
          </tr>
        </thead>
        <tbody>
          {#each review as row (row.id)}
            <tr class="border-t border-line-soft align-top" data-bulk-review-row={row.id} data-status={row.status}>
              <td class="py-3 pr-2 font-mono text-xs leading-[1.125rem] text-ink-muted">{row.projectNumber ? `#${row.projectNumber}` : ""}</td>
              <td class="break-words py-3 pr-3 text-ink">{row.title}</td>
              <td class="py-3 pr-2 text-ink-secondary" data-bulk-now-cell>
                {#each row.cells as cell (cell.field)}
                  <span class="block break-words">{row.cells.length > 1 ? `${BULK_FIELD_LABELS[cell.field]}: ` : ""}{cell.now}</span>
                {/each}
              </td>
              <td class="py-3 text-ink-muted">
                {#if row.status === "change"}<IconArrowRight size={14} strokeWidth={1.5} />{/if}
              </td>
              <td class="py-3" data-bulk-after-cell>
                {#if row.status === "skipped"}
                  <span class="text-ink-faint">Skipped, not yours</span>
                {:else if row.status === "match"}
                  <span class="text-ink-faint">No change</span>
                {:else}
                  {#each row.cells as cell (cell.field)}
                    <span class={`block break-words ${cell.after === null ? "text-ink-faint" : "font-medium text-primary-selected"}`}>
                      {row.cells.length > 1 ? `${BULK_FIELD_LABELS[cell.field]}: ` : ""}{cell.after ?? "No change"}
                    </span>
                  {/each}
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    {#if applyError}
      <p class="mx-[1.375rem] mb-2 text-xs leading-4 text-danger-ink-muted" role="alert" data-bulk-apply-error>{applyError}</p>
    {/if}
    {@render escapeHint()}
    <footer class="flex min-h-[3.75rem] shrink-0 items-center gap-2 border-t border-line-soft px-[1.375rem] py-3">
      {#if note}
        <p class="min-w-0 flex-1 text-xs leading-4 text-ink-muted" data-bulk-skip-note>{note}</p>
      {:else}
        <div class="flex-1"></div>
      {/if}
      <button type="button" class={quietButton} disabled={applying} onclick={() => void back()} data-bulk-back>Back</button>
      <button
        bind:this={applyButton}
        type="button"
        class={primaryButton}
        disabled={applying || allSkipped}
        onclick={() => void apply()}
        data-bulk-apply
      >{applying ? "Applying..." : `Apply to ${projectsLabel(rows.length)}`}</button>
    </footer>
  {/if}
</ProjectsSidePanel>

{#if mayCreateClient}
  <NewClientDialog
    bind:open={newClientOpen}
    initialName={newClientName}
    description="Once created, it fills the Client field for these projects."
    canAddIndustry={isAdmin}
    onCreated={onClientCreated}
  />
{/if}
