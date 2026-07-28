<script lang="ts">
  import { SUPPORTED_ACCEPT } from "../../../../shared/documentStatus";
  import { statusAction, statusExplanation } from "$lib/uploads/processingStatus";
  import type { ReceiptRow } from "$lib/uploads/receiptRows";
  import ProcessingStatusBadge from "./ProcessingStatusBadge.svelte";
  import Button from "../ui/Button.svelte";

  /**
   * One file in the processing receipt: what happened to it, what that means,
   * and the one thing worth doing about it.
   *
   * Presentational by design — data and callbacks come in as props so this can
   * be tested in a real browser without a Convex client.
   */
  let {
    row,
    busy = false,
    onRetry,
    onReplace,
    onRemove,
  }: {
    row: ReceiptRow;
    busy?: boolean;
    onRetry?: (row: ReceiptRow) => void | Promise<void>;
    onReplace?: (row: ReceiptRow, file: File) => void | Promise<void>;
    onRemove?: (row: ReceiptRow) => void | Promise<void>;
  } = $props();

  let fileInput: HTMLInputElement | null = $state(null);

  // An archived file is already excluded from AI, and a file still being read
  // has nothing to explain yet. A ready file needs no advice.
  const quiet = $derived(row.archived === true || row.status === null || row.status === "ready");
  const explanation = $derived(quiet ? null : statusExplanation(row.status));
  const action = $derived(
    quiet
      ? null
      : statusAction(row.status!, { canRetry: row.canRetry, canReplace: row.canReplace })
  );

  function handlePick(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file && onReplace) onReplace(row, file);
    // Cleared so picking the same file again still fires a change event.
    input.value = "";
  }
</script>

<li
  class="flex min-h-11 items-start gap-3 py-2.5 transition-colors hover:bg-primary-wash {row.archived
    ? 'opacity-60'
    : ''}"
>
  <div class="min-w-0 flex-1">
    <div class="flex flex-wrap items-center gap-2">
      <p class="text-body truncate">{row.fileName}</p>
      {#if row.archived}
        <span
          class="flex-shrink-0 rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-medium text-gray-500"
        >
          Archived
        </span>
      {:else}
        <ProcessingStatusBadge status={row.status} />
      {/if}
    </div>
    {#if explanation}
      <p class="mt-0.5 text-xs text-ink-muted">
        {explanation}{action ? ` ${action}` : ""}
      </p>
    {/if}
  </div>

  {#if row.canRetry && onRetry}
    <Button
      variant="ghost"
      size="sm"
      class="min-h-11 flex-shrink-0"
      disabled={busy}
      aria-busy={busy}
      aria-label="Retry — {row.fileName}"
      onclick={() => onRetry(row)}
    >
      Retry
    </Button>
  {/if}
  {#if row.canReplace && onReplace}
    <Button
      variant="ghost"
      size="sm"
      class="min-h-11 flex-shrink-0"
      disabled={busy}
      aria-busy={busy}
      aria-label="Replace file… — {row.fileName}"
      onclick={() => fileInput?.click()}
    >
      Replace file…
    </Button>
    <!-- Kept out of the tab order and the a11y tree: the visible button above
         is the control, this is only the mechanism it drives. -->
    <input
      bind:this={fileInput}
      type="file"
      class="hidden"
      tabindex={-1}
      aria-hidden="true"
      accept={SUPPORTED_ACCEPT}
      onchange={handlePick}
    />
  {/if}
  {#if row.canRemove && onRemove}
    <Button
      variant="danger-ghost"
      size="sm"
      class="min-h-11 flex-shrink-0"
      disabled={busy}
      aria-busy={busy}
      aria-label="Remove — {row.fileName}"
      onclick={() => onRemove(row)}
    >
      Remove
    </Button>
  {/if}
</li>
