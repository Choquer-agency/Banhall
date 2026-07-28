<script lang="ts">
  import { DENIED_COPY } from "$lib/uploads/processingStatus";
  import { summarizeReceipt, type ReceiptRow } from "$lib/uploads/receiptRows";
  import UploadReceiptRow from "./UploadReceiptRow.svelte";

  /**
   * The processing receipt: one ruled row per file, with a plain-language
   * summary of the batch.
   *
   * Presentational only — rows and callbacks arrive as props, so this renders
   * identically for a live upload batch and for a project revisited days later.
   */
  let {
    rows,
    heading = "Processing receipt",
    busy = new Set<string>(),
    emptyMessage = "No files yet.",
    denied = false,
    onRetry,
    onReplace,
    onRemove,
  }: {
    rows: ReceiptRow[];
    heading?: string;
    busy?: ReadonlySet<string>;
    emptyMessage?: string;
    denied?: boolean;
    onRetry?: (row: ReceiptRow) => void | Promise<void>;
    onReplace?: (row: ReceiptRow, file: File) => void | Promise<void>;
    onRemove?: (row: ReceiptRow) => void | Promise<void>;
  } = $props();

  const summary = $derived(denied ? "" : summarizeReceipt(rows));
</script>

<section aria-label={heading}>
  <div class="flex items-baseline justify-between gap-3">
    <h3 class="text-label">{heading}</h3>
    {#if !denied && rows.length > 0 && summary}
      <p class="text-data text-ink-muted">{summary}</p>
    {/if}
  </div>

  <!--
    Rows change from "Reading…" to their outcome asynchronously. Without a live
    region, someone using a screen reader gets no indication that anything
    happened. Always mounted, because a region added at the same time as its
    text is not reliably announced.
  -->
  <p class="sr-only" aria-live="polite">{summary}</p>

  {#if denied}
    <p class="mt-2 text-sm text-ink-muted">{DENIED_COPY.explanation}</p>
  {:else if rows.length === 0}
    <p class="mt-2 text-sm text-ink-muted">{emptyMessage}</p>
  {:else}
    <ul class="divide-y divide-line-soft">
      {#each rows as row (row.key)}
        <UploadReceiptRow {row} busy={busy.has(row.key)} {onRetry} {onReplace} {onRemove} />
      {/each}
    </ul>
  {/if}
</section>
