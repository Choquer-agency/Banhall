<!--
  One file being added or replaced (2026-11-04, Paper "Modal A3", "A4",
  "Replace R3" and "R4"): its icon, name and step, a fill for the share
  sent, its size, and Stop, Try again or Dismiss. A file over 50 MB says
  "Too large, up to 50 MB" and was never sent.
-->
<script lang="ts">
  import { ArrowClockwiseIcon, CheckIcon, XIcon } from "phosphor-svelte";
  import FileIcon from "$lib/components/ui/FileIcon.svelte";
  import { bytesLabel } from "./fileMeta";
  import { inFlight, uploadFill, uploadStatus, type UploadEntry } from "./uploads";

  let {
    upload,
    doneLabel = "Added",
    variant = "card",
    onStop,
    onRetry,
    onDismiss,
  }: {
    upload: Pick<UploadEntry, "id" | "name" | "size" | "phase" | "fraction" | "error">;
    /** What a finished file says ("Uploaded and read" for a replacement). */
    doneLabel?: string;
    /** A bordered card (dialogs), or a list row (the page's Just added). */
    variant?: "card" | "row";
    onStop?: () => void;
    onRetry?: () => void;
    onDismiss?: () => void;
  } = $props();

  const refused = $derived(upload.phase === "failed" || upload.phase === "too_large");
  const status = $derived(upload.phase === "done" ? doneLabel : uploadStatus(upload));
  const fill = $derived(uploadFill(upload));

  const iconButton =
    "flex size-8 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-navy motion-reduce:transition-none pointer-coarse:size-11";
</script>

<li
  class={`relative flex min-h-[3.375rem] min-w-0 items-center gap-3.5 overflow-hidden px-3.5 py-2.5 ${variant === "card" ? "rounded-xl border border-line-soft bg-surface" : ""}`}
  role={refused ? "alert" : "status"}
  data-upload-row={upload.id}
  data-upload-phase={upload.phase}
>
  {#if variant === "card" && fill > 0 && upload.phase !== "done"}
    <span
      class="absolute inset-y-0 left-0 bg-primary-wash transition-[width] duration-200 motion-reduce:transition-none"
      style:width={`${Math.round(fill * 100)}%`}
      aria-hidden="true"
    ></span>
  {/if}
  <span class="relative flex w-6 shrink-0 justify-center"><FileIcon name={upload.name} size={28} /></span>
  <div class="relative min-w-0 flex-1">
    <p class="truncate text-[0.8125rem] leading-[calc(18/13)] text-ink">{upload.name}</p>
    {#if variant === "row" && upload.phase === "uploading"}
      <div class="mt-1 flex items-center gap-2.5">
        <span class="h-1 w-40 overflow-hidden rounded-full bg-line-soft" aria-hidden="true">
          <span class="block h-full rounded-full bg-primary-selected" style:width={`${Math.round(fill * 100)}%`}></span>
        </span>
        <span class="text-xs leading-[calc(4/3)] text-ink-muted" data-upload-status>{status}</span>
      </div>
    {:else}
      <p class={`truncate text-xs leading-[calc(4/3)] ${refused ? "text-danger-ink-muted" : "text-ink-muted"}`} data-upload-status>{status}</p>
    {/if}
  </div>
  <span class={`relative shrink-0 text-xs leading-[calc(4/3)] tabular-nums ${upload.phase === "too_large" ? "text-danger-ink-muted" : "text-ink-muted"}`}>{bytesLabel(upload.size)}</span>
  <span class="relative flex shrink-0 items-center gap-1">
    {#if upload.phase === "done"}
      <span class="flex size-8 items-center justify-center text-primary-selected" aria-hidden="true"><CheckIcon size="1rem" weight="bold" /></span>
    {:else if upload.phase === "failed"}
      {#if onRetry}
        <button type="button" aria-label={`Try ${upload.name} again`} onclick={onRetry} class={`${iconButton} bg-danger-soft text-danger-ink hover:bg-danger-surface`}>
          <ArrowClockwiseIcon size="0.9375rem" aria-hidden="true" />
        </button>
      {/if}
      {#if onDismiss}
        <button type="button" aria-label={`Dismiss ${upload.name}`} onclick={onDismiss} class={`${iconButton} text-ink-muted hover:bg-primary-wash hover:text-ink`}>
          <XIcon size="0.875rem" aria-hidden="true" />
        </button>
      {/if}
    {:else if upload.phase === "too_large"}
      {#if onDismiss}
        <button type="button" aria-label={`Dismiss ${upload.name}`} onclick={onDismiss} class={`${iconButton} text-danger-ink-muted hover:bg-danger-surface`}>
          <XIcon size="0.875rem" aria-hidden="true" />
        </button>
      {/if}
    {:else if inFlight(upload) && onStop}
      <button type="button" aria-label={`Stop adding ${upload.name}`} onclick={onStop} class={`${iconButton} bg-gray-50 text-ink-muted hover:bg-primary-wash hover:text-ink`}>
        <XIcon size="0.875rem" aria-hidden="true" />
      </button>
    {/if}
  </span>
</li>
