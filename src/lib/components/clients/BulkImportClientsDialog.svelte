<!--
  Bulk import companies dialog (Managers and Admins): paste one company name
  per line or upload a CSV/TXT file (up to 500 at a time), check every name
  against existing active and merged companies before writing, and import the
  selected companies in idempotent batches of 100.
-->
<script lang="ts">
  import { untrack } from "svelte";
  import { useMutation, useQuery } from "convex-svelte";
  import { toast } from "svelte-sonner";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import FormDialog from "$lib/components/ui/FormDialog.svelte";
  import { formCancel, formError, formLabel, formPrimary } from "$lib/components/ui/formDialog";
  import { userErrorMessage } from "$lib/errors";
  import { api } from "../../../../convex/_generated/api";
  import {
    BULK_CREATE_BATCH_MAX,
    BULK_IMPORT_MAX_LINES,
    parseBulkCompanyText,
    type BulkCompanyPreviewRow,
    type BulkCompanyStatus,
  } from "../../../../shared/bulkImportClients";

  let {
    open = $bindable(false),
    returnFocus = undefined,
    onImported = undefined,
  }: {
    open?: boolean;
    returnFocus?: () => HTMLElement | null | undefined;
    onImported?: (result: { createdCount: number; skippedCount: number }) => void;
  } = $props();

  const auth = useAuth();
  const bulkCreate = useMutation(api.clients.bulkCreateClients);

  let step = $state<"input" | "preview">("input");
  let rawText = $state("");
  let fileName = $state<string | null>(null);
  let selectedIndices = $state<Set<number>>(new Set());
  let initializedPreviewKey = $state<string | null>(null);
  let busy = $state(false);
  let progressText = $state<string | null>(null);
  let errorMessage = $state<string | null>(null);
  let textareaEl = $state<HTMLTextAreaElement | null>(null);
  let fileInputEl = $state<HTMLInputElement | null>(null);

  // Reset cleanly each time the dialog opens.
  $effect(() => {
    if (!open) return;
    untrack(() => {
      step = "input";
      rawText = "";
      fileName = null;
      selectedIndices = new Set();
      initializedPreviewKey = null;
      busy = false;
      progressText = null;
      errorMessage = null;
    });
  });

  const parsed = $derived(parseBulkCompanyText(rawText));

  const previewQ = useQuery(api.clients.previewBulkImportClients, () =>
    open && step === "preview" && auth.isAuthenticated && parsed.names.length > 0
      ? { names: parsed.names }
      : "skip"
  );

  const previewData = $derived(step === "preview" && !previewQ.error ? previewQ.data : undefined);

  // Default selection when a preview result arrives: check "new" rows, leave "similar" unchecked.
  $effect(() => {
    if (step !== "preview" || !previewData) return;
    const key = previewData.rows.map((r) => `${r.index}:${r.key}:${r.status}`).join("|");
    if (key === untrack(() => initializedPreviewKey)) return;
    initializedPreviewKey = key;
    const defaults = new Set<number>();
    for (const row of previewData.rows) {
      if (row.status === "new") defaults.add(row.index);
    }
    selectedIndices = defaults;
  });

  const selectedRows = $derived.by(() => {
    if (!previewData) return [] as BulkCompanyPreviewRow[];
    return previewData.rows.filter(
      (row) => (row.status === "new" || row.status === "similar") && selectedIndices.has(row.index)
    );
  });

  const canCheck = $derived(parsed.names.length > 0 && !busy);
  const canImport = $derived(step === "preview" && Boolean(previewData) && selectedRows.length > 0 && !busy);

  function toggleRow(index: number) {
    const next = new Set(selectedIndices);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    selectedIndices = next;
  }

  function selectAllSimilar(checked: boolean) {
    if (!previewData) return;
    const next = new Set(selectedIndices);
    for (const row of previewData.rows) {
      if (row.status === "similar") {
        if (checked) next.add(row.index);
        else next.delete(row.index);
      }
    }
    selectedIndices = next;
  }

  const allSimilarSelected = $derived.by(() => {
    if (!previewData || previewData.counts.similar === 0) return false;
    return previewData.rows
      .filter((r) => r.status === "similar")
      .every((r) => selectedIndices.has(r.index));
  });

  async function handleFilePick(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    errorMessage = null;
    try {
      const text = await file.text();
      rawText = text;
      fileName = file.name;
    } catch {
      errorMessage = "That file could not be read. Try pasting the list instead.";
    }
  }

  function goToPreview() {
    if (!canCheck) return;
    errorMessage = null;
    initializedPreviewKey = null;
    step = "preview";
  }

  function backToInput() {
    if (busy) return;
    errorMessage = null;
    step = "input";
  }

  async function runImport() {
    if (!canImport) return;
    const names = selectedRows.map((row) => row.name);
    busy = true;
    errorMessage = null;
    let totalCreated = 0;
    let totalSkipped = 0;
    let processed = 0;
    try {
      for (let start = 0; start < names.length; start += BULK_CREATE_BATCH_MAX) {
        const chunk = names.slice(start, start + BULK_CREATE_BATCH_MAX);
        progressText = `Importing ${Math.min(processed + chunk.length, names.length)} of ${names.length}...`;
        const res = await bulkCreate({ names: chunk });
        totalCreated += res.createdCount;
        totalSkipped += res.skippedExists + res.skippedMerged + res.skippedDuplicate + res.skippedInvalid;
        processed += chunk.length;
      }
      const label = totalCreated === 1 ? "1 company" : `${totalCreated} companies`;
      if (totalCreated > 0 && totalSkipped > 0) {
        toast.success(`Added ${label} (${totalSkipped} already existed or skipped).`);
      } else if (totalCreated > 0) {
        toast.success(`Added ${label}.`);
      } else {
        toast.info("No new companies were added (all already existed or were skipped).");
      }
      const done = onImported;
      open = false;
      done?.({ createdCount: totalCreated, skippedCount: totalSkipped });
    } catch (error) {
      const base = userErrorMessage(error, "Companies could not be imported. Try again.");
      errorMessage =
        totalCreated > 0
          ? `Added ${totalCreated} ${totalCreated === 1 ? "company" : "companies"} before an error stopped the rest: ${base}`
          : base;
    } finally {
      busy = false;
      progressText = null;
    }
  }

  function statusLabel(status: BulkCompanyStatus): string {
    switch (status) {
      case "new":
        return "New";
      case "similar":
        return "Similar";
      case "exists":
        return "Exists";
      case "merged":
        return "Merged";
      case "duplicate":
        return "Duplicate";
      case "invalid":
        return "Invalid";
    }
  }

  function statusPillClass(status: BulkCompanyStatus): string {
    switch (status) {
      case "new":
        return "bg-primary-wash text-primary-selected";
      case "similar":
        return "bg-gap-bg text-gap-text";
      case "exists":
      case "merged":
      case "duplicate":
        return "bg-chrome text-ink-secondary";
      case "invalid":
        return "bg-danger-wash text-danger-ink-muted";
    }
  }

  function rowDetail(row: BulkCompanyPreviewRow): string | null {
    if (row.status === "similar" && row.similarMatches?.length) {
      return `Looks like ${row.similarMatches.join(", ")}`;
    }
    if (row.status === "exists" && row.existingName) {
      return row.existingName === row.name ? "Already in your company list" : `Matches ${row.existingName}`;
    }
    if (row.status === "merged" && row.mergedInto) {
      return `Merged into ${row.mergedInto}`;
    }
    if (row.status === "duplicate" && row.existingName) {
      return `Repeats ${row.existingName} earlier in this list`;
    }
    if (row.status === "invalid") {
      return row.reason ?? "Invalid company name";
    }
    return null;
  }

  const countLabel = (n: number) => (n === 1 ? "1 company" : `${n} companies`);
</script>

{#snippet footerNote()}
  {#if progressText}
    <span data-bulk-import-progress class="text-xs leading-[calc(4/3)] text-ink-secondary">{progressText}</span>
  {:else if step === "preview" && previewData}
    <span data-bulk-import-selected-count class="text-xs leading-[calc(4/3)] text-ink-secondary">
      {countLabel(selectedRows.length)} selected to add
    </span>
  {:else if parsed.names.length > 0}
    <span data-bulk-import-parsed-count class="text-xs leading-[calc(4/3)] text-ink-secondary">
      {countLabel(parsed.names.length)} ready to check
    </span>
  {/if}
{/snippet}

{#snippet footer()}
  {#if step === "preview"}
    <button type="button" disabled={busy} onclick={backToInput} data-bulk-import-back class={formCancel}>Back</button>
  {/if}
  <button type="button" disabled={busy} onclick={() => (open = false)} class={formCancel}>Cancel</button>
  {#if step === "input"}
    <button type="button" data-bulk-import-check disabled={!canCheck} onclick={goToPreview} class={formPrimary}>
      Check list
    </button>
  {:else}
    <button
      type="button"
      data-bulk-import-submit
      disabled={!canImport}
      onclick={() => void runImport()}
      class={formPrimary}
    >
      {#if busy}
        Importing...
      {:else}
        Import {countLabel(selectedRows.length)}
      {/if}
    </button>
  {/if}
{/snippet}

<FormDialog
  bind:open
  title="Import companies"
  description="Paste your official company list or upload a CSV to add companies before importing historical PDs."
  width={640}
  {busy}
  initialFocus={() => textareaEl}
  {returnFocus}
  testId="bulk-import-companies-dialog"
  {footerNote}
  {footer}
>
  {#if step === "input"}
    <div class="flex flex-col gap-3.5">
      <div class="flex items-center justify-between gap-2">
        <label for="bulk-import-companies-text" class={formLabel}>Company names (one per line or CSV)</label>
        <div class="flex items-center gap-2">
          {#if fileName}
            <span class="max-w-[12rem] truncate text-xs text-ink-muted" title={fileName}>{fileName}</span>
          {/if}
          <button
            type="button"
            data-bulk-import-upload
            disabled={busy}
            onclick={() => fileInputEl?.click()}
            class="inline-flex h-8 items-center rounded-md border border-line bg-surface px-2.5 text-xs font-medium text-ink transition-colors hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-navy"
          >
            Upload CSV or TXT
          </button>
          <input
            bind:this={fileInputEl}
            type="file"
            hidden
            tabindex="-1"
            data-bulk-import-file-input
            accept=".csv,.txt,text/csv,text/plain"
            onchange={(event) => void handleFilePick(event.currentTarget)}
          />
        </div>
      </div>

      <textarea
        id="bulk-import-companies-text"
        bind:this={textareaEl}
        bind:value={rawText}
        rows={10}
        data-bulk-import-textarea
        placeholder={"Acme Robotics Inc.\nBirch Foods Ltd.\nNorthwind Sensors"}
        oninput={() => {
          errorMessage = null;
          fileName = null;
        }}
        class="field-control w-full resize-y rounded-lg px-3 py-2.5 text-sm leading-[1.5] text-ink placeholder:text-ink-muted"
      ></textarea>

      <p class="text-xs leading-[1.45] text-ink-muted">
        Up to {BULK_IMPORT_MAX_LINES} companies per import. CSV headers like "Company Name" are detected automatically,
        and names with commas like "Acme, Inc." are kept intact.
      </p>

      {#if parsed.truncated}
        <div role="status" data-bulk-import-truncated class="rounded-lg bg-gap-bg px-3 py-2 text-xs leading-[1.45] text-gap-text">
          Found {parsed.totalLines} lines. Only the first {BULK_IMPORT_MAX_LINES} will be checked in this pass - import
          the remaining lines in a second batch.
        </div>
      {/if}

      {#if errorMessage}
        <p role="alert" data-bulk-import-error class={formError}>{errorMessage}</p>
      {/if}
    </div>
  {:else}
    <div class="flex flex-col gap-3.5">
      {#if previewQ.error}
        <div role="alert" data-bulk-import-preview-error class="rounded-lg bg-danger-wash px-3 py-2.5 text-sm text-danger-ink-muted">
          {userErrorMessage(previewQ.error, "The company list could not be checked. Go back and try again.")}
        </div>
      {:else if !previewData}
        <div data-bulk-import-loading class="py-10 text-center text-sm text-ink-muted">
          Checking {countLabel(parsed.names.length)} against your company list...
        </div>
      {:else}
        <div data-bulk-import-summary class="flex flex-wrap items-center gap-1.5 text-xs">
          {#if previewData.counts.new > 0}
            <span class="rounded-full bg-primary-wash px-2.5 py-0.5 font-medium text-primary-selected">
              {previewData.counts.new} new
            </span>
          {/if}
          {#if previewData.counts.similar > 0}
            <span class="rounded-full bg-gap-bg px-2.5 py-0.5 font-medium text-gap-text">
              {previewData.counts.similar} similar
            </span>
          {/if}
          {#if previewData.counts.exists > 0}
            <span class="rounded-full bg-chrome px-2.5 py-0.5 font-medium text-ink-secondary">
              {previewData.counts.exists} already exist
            </span>
          {/if}
          {#if previewData.counts.merged > 0}
            <span class="rounded-full bg-chrome px-2.5 py-0.5 font-medium text-ink-secondary">
              {previewData.counts.merged} merged
            </span>
          {/if}
          {#if previewData.counts.duplicate > 0}
            <span class="rounded-full bg-chrome px-2.5 py-0.5 font-medium text-ink-secondary">
              {previewData.counts.duplicate} duplicates
            </span>
          {/if}
          {#if previewData.counts.invalid > 0}
            <span class="rounded-full bg-danger-wash px-2.5 py-0.5 font-medium text-danger-ink-muted">
              {previewData.counts.invalid} invalid
            </span>
          {/if}
        </div>

        {#if previewData.counts.similar > 0}
          <div class="flex items-center justify-between gap-2 rounded-lg bg-gap-bg px-3 py-2 text-xs leading-[1.45] text-gap-text">
            <span>
              Similar names are unchecked by default to avoid duplicates. Check any that are truly separate companies.
            </span>
            <button
              type="button"
              data-bulk-import-toggle-similar
              disabled={busy}
              onclick={() => selectAllSimilar(!allSimilarSelected)}
              class="shrink-0 font-medium underline-offset-2 hover:underline"
            >
              {allSimilarSelected ? "Uncheck similar" : "Check all similar"}
            </button>
          </div>
        {/if}

        {#if previewData.truncated}
          <div role="status" class="rounded-lg bg-gap-bg px-3 py-2 text-xs leading-[1.45] text-gap-text">
            Your company list exceeds the preview check limit, so some look-alike matches may not be flagged here. Exact
            duplicates are still prevented when importing.
          </div>
        {/if}

        <div
          data-bulk-import-rows
          class="max-h-[19rem] overflow-y-auto divide-y divide-line-soft rounded-lg border border-line bg-surface"
        >
          {#each previewData.rows as row (row.index)}
            {@const selectable = row.status === "new" || row.status === "similar"}
            {@const checked = selectable && selectedIndices.has(row.index)}
            {@const detail = rowDetail(row)}
            <label
              data-bulk-import-row={row.status}
              class={`flex items-start gap-2.5 px-3 py-2 text-sm ${selectable ? "cursor-pointer hover:bg-primary-wash/40" : "opacity-75"}`}
            >
              <input
                type="checkbox"
                class="mt-0.5 size-4 shrink-0 rounded border-line accent-primary-selected"
                disabled={!selectable || busy}
                {checked}
                onchange={() => toggleRow(row.index)}
              />
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span class="truncate font-medium text-ink">{row.name || "(blank line)"}</span>
                  <span class={`shrink-0 rounded px-1.5 py-0.5 text-[0.6875rem] leading-tight font-medium ${statusPillClass(row.status)}`}>
                    {statusLabel(row.status)}
                  </span>
                </div>
                {#if detail}
                  <p class="mt-0.5 text-xs leading-[1.4] text-ink-muted">{detail}</p>
                {/if}
              </div>
            </label>
          {/each}
        </div>
      {/if}

      {#if errorMessage}
        <p role="alert" data-bulk-import-error class={formError}>{errorMessage}</p>
      {/if}
    </div>
  {/if}
</FormDialog>
