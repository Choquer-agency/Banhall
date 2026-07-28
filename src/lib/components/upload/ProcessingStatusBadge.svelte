<script lang="ts">
  import type { ReceiptStatus } from "../../../../shared/documentStatus";
  import { PROCESSING_STATUS_COPY, LOADING_COPY } from "$lib/uploads/processingStatus";
  import Spinner from "../ui/Spinner.svelte";

  /**
   * One file's outcome, as a text badge.
   *
   * The label is always rendered as words. Colour and icon are decoration on
   * top of it, never the signal itself — the status must survive greyscale,
   * colour blindness, and a screen reader (docs/product-domain.md).
   *
   * `status: null` means the file is still being read.
   */
  let {
    status,
    size = "sm",
  }: { status: ReceiptStatus | null; size?: "sm" | "md" } = $props();

  const TONE: Record<ReceiptStatus, string> = {
    ready: "bg-primary/15 text-primary-selected",
    ready_truncated: "bg-amber-50 text-amber-700",
    reference_only: "bg-chrome text-ink-secondary",
    could_not_read: "bg-gray-100 text-gray-600",
    skipped_unsupported: "bg-gray-100 text-gray-600",
    upload_failed: "bg-red-50 text-red-600",
  };

  const label = $derived(
    status === null ? LOADING_COPY.label : PROCESSING_STATUS_COPY[status].label
  );
  const tone = $derived(status === null ? "bg-chrome text-ink-secondary" : TONE[status]);
</script>

<span
  class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-medium {tone} {size ===
  'sm'
    ? 'text-xs'
    : 'text-sm'}"
>
  {#if status === null}
    <Spinner size="sm" class="h-3 w-3 border-[1.5px] motion-reduce:animate-none" />
  {:else if status === "ready"}
    <svg class="h-3.5 w-3.5" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
      <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  {:else if status === "ready_truncated"}
    <svg class="h-3.5 w-3.5" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
      <path stroke-linecap="round" stroke-linejoin="round" d="M14.121 14.121L19 19m-7-7l6.878-6.878M6 18a2 2 0 100-4 2 2 0 000 4zm0-8a2 2 0 100-4 2 2 0 000 4z" />
    </svg>
  {:else if status === "reference_only"}
    <svg class="h-3.5 w-3.5" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
      <path stroke-linecap="round" stroke-linejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  {:else if status === "could_not_read"}
    <svg class="h-3.5 w-3.5" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
      <path stroke-linecap="round" stroke-linejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
    </svg>
  {:else if status === "skipped_unsupported"}
    <svg class="h-3.5 w-3.5" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
      <path stroke-linecap="round" stroke-linejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
    </svg>
  {:else}
    <svg class="h-3.5 w-3.5" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
      <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  {/if}
  {label}
</span>
