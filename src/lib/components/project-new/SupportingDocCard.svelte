<script lang="ts">
  /**
   * One supporting document on New project (boards E1, E2): file icon, name,
   * the category chip as a small menu, and the meta line ("3 sections found",
   * "12 pages", "9,240 words") or, while the file is read, the AI-gradient bar
   * with "Reading, 40%". Eye opens the preview (E3); the cross removes it. A
   * file that could not be read takes E5's danger colours with Replace file.
   */
  import { DropdownMenu } from "bits-ui";
  import { CaretDownIcon, CheckIcon, EyeIcon, XIcon } from "phosphor-svelte";
  import FileIcon from "$lib/components/ui/FileIcon.svelte";
  import Tooltip from "$lib/components/ui/Tooltip.svelte";
  import {
    CATEGORY_LABELS,
    readingPercent,
    supportingMeta,
    type SupportingCategory,
    type SupportingDoc,
  } from "./supportingDocs.svelte";

  let {
    doc,
    categories,
    years,
    compact = false,
    onPreview,
    onRemove,
    onReplace,
    onCategory,
    onYear,
  }: {
    doc: SupportingDoc;
    /** The chip menu's choices (Transcript is added in Review a written PD). */
    categories: SupportingCategory[];
    /** Fiscal years a previous-year report can be filed under. */
    years: number[];
    /** Tablet layout: smaller icon and one-line meta. */
    compact?: boolean;
    onPreview: () => void;
    onRemove: () => void;
    onReplace: () => void;
    onCategory: (category: SupportingCategory) => void;
    onYear: (year: number) => void;
  } = $props();

  const percent = $derived(readingPercent(doc));
  const failed = $derived(doc.status === "failed");
  const chipClass =
    "flex h-5 max-w-full min-w-0 items-center gap-1 rounded-[5px] bg-chrome px-1.5 text-xs leading-[14px] font-medium whitespace-nowrap text-ink-secondary transition-colors hover:bg-primary-wash focus-visible:outline-2 focus-visible:outline-fir pointer-coarse:h-8";
  const menuClass =
    "z-[130] min-w-[200px] rounded-[10px] border border-line bg-surface p-1 shadow-popover";
  const itemClass =
    "flex min-h-8 cursor-default items-center gap-2 rounded-md px-2 text-[13px] leading-[18px] text-ink outline-none data-highlighted:bg-primary-wash pointer-coarse:min-h-11";
</script>

<div
  data-supporting-card={doc.id}
  data-status={doc.status}
  data-category={doc.category}
  class={`flex min-h-24 min-w-0 gap-3 rounded-xl border p-3.5 ${
    failed ? "border-danger-line bg-danger-surface" : "border-line-soft bg-surface"
  }`}
>
  <span class={`flex shrink-0 items-start justify-center ${compact ? "size-8" : "size-10"}`}>
    <FileIcon name={doc.file?.name ?? "notes.txt"} size={compact ? 32 : 40} />
  </span>
  <div class="flex min-w-0 flex-1 flex-col gap-1.5">
    <p class={`truncate text-sm leading-[18px] font-medium ${failed ? "text-danger-ink" : "text-ink"}`} title={doc.name}>{doc.name}</p>
    <div class="flex min-w-0 flex-wrap items-center gap-1.5">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger class={chipClass} aria-label={`Type: ${CATEGORY_LABELS[doc.category]}. Change type`} data-category-chip>
          <span class="min-w-0 truncate">{CATEGORY_LABELS[doc.category]}</span>
          <CaretDownIcon size={10} weight="bold" aria-hidden="true" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content class={menuClass} sideOffset={4} align="start">
            <DropdownMenu.RadioGroup
              value={doc.category}
              onValueChange={(next) => onCategory(next as SupportingCategory)}
            >
              {#each categories as category (category)}
                <DropdownMenu.RadioItem value={category} class={itemClass} data-category-option={category}>
                  {#snippet children({ checked })}
                    <span class="min-w-0 flex-1">{CATEGORY_LABELS[category]}</span>
                    {#if checked}<CheckIcon size={14} class="text-primary-selected" aria-hidden="true" />{/if}
                  {/snippet}
                </DropdownMenu.RadioItem>
              {/each}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {#if doc.category === "previous_pd"}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger class={chipClass} aria-label={`Fiscal year ${doc.year}. Change year`} data-year-chip>
            FY {doc.year}
            <CaretDownIcon size={10} weight="bold" aria-hidden="true" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content class={`${menuClass} min-w-[120px]`} sideOffset={4} align="start">
              <DropdownMenu.RadioGroup value={String(doc.year)} onValueChange={(next) => onYear(Number(next))}>
                {#each years as year (year)}
                  <DropdownMenu.RadioItem value={String(year)} class={itemClass}>
                    {#snippet children({ checked })}
                      <span class="min-w-0 flex-1">FY {year}</span>
                      {#if checked}<CheckIcon size={14} class="text-primary-selected" aria-hidden="true" />{/if}
                    {/snippet}
                  </DropdownMenu.RadioItem>
                {/each}
              </DropdownMenu.RadioGroup>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      {/if}
    </div>
    {#if doc.status === "reading"}
      <div class="flex items-center gap-2" data-reading>
        <div
          class="relative h-[3px] max-w-36 flex-1 overflow-hidden rounded-full bg-[var(--aurora-track)]"
          role="progressbar"
          aria-label={`Reading ${doc.name}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent ?? undefined}
        >
          {#if percent === null}
            <div class="reading-indeterminate absolute inset-y-0 w-2/5 rounded-full" style="background:var(--aurora-linear)"></div>
          {:else}
            <div class="h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none" style={`width:${percent}%;background:var(--aurora-linear)`}></div>
          {/if}
        </div>
        <span class="shrink-0 text-xs leading-4 text-ink-muted" data-supporting-meta>
          {percent === null ? "Reading" : `Reading, ${percent}%`}
        </span>
      </div>
    {:else if failed}
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span class="text-xs leading-4 text-danger-ink-muted" data-supporting-meta>We could not read this file.</span>
        <button
          type="button"
          data-replace-file
          onclick={onReplace}
          class="text-xs leading-4 font-medium text-danger-ink underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-danger pointer-coarse:min-h-11"
        >
          Replace file
        </button>
      </div>
    {:else}
      <span class="truncate text-xs leading-4 text-ink-muted" data-supporting-meta>{supportingMeta(doc)}</span>
    {/if}
  </div>
  <div class="flex shrink-0 gap-0.5">
    <Tooltip text="Preview" delayDuration={300}>
      {#snippet children({ props })}
        <button
          {...props}
          type="button"
          aria-label={`Preview ${doc.name}`}
          data-preview
          disabled={doc.status === "reading"}
          onclick={onPreview}
          class="flex size-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline-2 focus-visible:outline-fir disabled:opacity-40 pointer-coarse:size-11"
        >
          <EyeIcon size={16} aria-hidden="true" />
        </button>
      {/snippet}
    </Tooltip>
    <Tooltip text="Remove" delayDuration={300}>
      {#snippet children({ props })}
        <button
          {...props}
          type="button"
          aria-label={`Remove ${doc.name}`}
          data-remove
          onclick={onRemove}
          class="flex size-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-danger-soft hover:text-danger-ink focus-visible:outline-2 focus-visible:outline-fir pointer-coarse:size-11"
        >
          <XIcon size={14} aria-hidden="true" />
        </button>
      {/snippet}
    </Tooltip>
  </div>
</div>

<style>
  .reading-indeterminate {
    animation: reading-slide 1.4s ease-in-out infinite;
  }
  @keyframes reading-slide {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(250%);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .reading-indeterminate {
      animation: none;
      width: 100%;
      opacity: 0.4;
    }
  }
</style>
