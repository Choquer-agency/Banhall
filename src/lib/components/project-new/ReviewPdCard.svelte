<script lang="ts">
  /**
   * The written PD on Review a written PD (board E4): a page thumbnail, the
   * file name, where the title came from, and one row per Section with its
   * form line count against the CRA limit (50, 100, 50). A Section we could
   * not find shows a warning and "Not found".
   */
  import { CheckIcon, EyeIcon, WarningCircleIcon, XIcon } from "phosphor-svelte";
  import Tooltip from "$lib/components/ui/Tooltip.svelte";
  import { sectionMetrics } from "../../../../convex/lib/lineLimits";
  import {
    detectPdSections,
    detectedSectionText,
    type PdSectionKey,
  } from "../../../../shared/pdSectionDetect";

  let {
    name,
    content,
    pageOffsets,
    titleFromFileName = false,
    onPreview,
    onRemove,
  }: {
    name: string;
    content: string;
    pageOffsets?: number[];
    titleFromFileName?: boolean;
    onPreview: () => void;
    onRemove: () => void;
  } = $props();

  const EXPECTED: ReadonlyArray<{ key: PdSectionKey; number: string; title: string }> = [
    { key: "s242", number: "242", title: "Technological uncertainty" },
    { key: "s244", number: "244", title: "Work performed" },
    { key: "s246", number: "246", title: "Technological advancement" },
  ];

  const rows = $derived.by(() => {
    const found = detectPdSections(content, pageOffsets);
    return EXPECTED.map((expected) => {
      const section = found.find((item) => item.section === expected.key);
      if (!section) return { ...expected, found: false as const, line: "Not found" };
      const metrics = sectionMetrics(detectedSectionText(content, section), expected.key);
      return {
        ...expected,
        found: true as const,
        line: `${metrics.lines} of ${metrics.limit} lines`,
      };
    });
  });
</script>

<div data-review-pd-card class="flex gap-3.5 rounded-xl border border-line-soft bg-surface p-4">
  <div class="flex h-[52px] w-10 shrink-0 flex-col gap-1 rounded-[3px] border border-line bg-surface px-1.5 pt-2" aria-hidden="true">
    {#each [1, 0.8, 1, 0.9, 0.6] as width, index (index)}
      <span class="h-0.5 rounded-full bg-gray-200" style={`width:${width * 100}%`}></span>
    {/each}
  </div>
  <div class="flex min-w-0 flex-1 flex-col gap-1">
    <p class="truncate text-sm leading-5 font-medium text-ink">{name}</p>
    <p class="text-[13px] leading-[18px] text-ink-muted" data-review-pd-uploaded>
      {titleFromFileName
        ? "Uploaded just now. We filled the project title from the file name."
        : "Uploaded just now."}
    </p>
    <ul class="mt-2 flex flex-col gap-1.5">
      {#each rows as row (row.key)}
        <li data-review-section={row.number} data-found={row.found} class="flex min-h-6 items-center gap-2.5 text-[13px] leading-[18px]">
          {#if row.found}
            <CheckIcon size={13} class="shrink-0 text-success" aria-hidden="true" />
          {:else}
            <WarningCircleIcon size={14} class="shrink-0 text-warning" aria-hidden="true" />
          {/if}
          <span class="w-56 shrink-0 truncate text-ink">{row.number} {row.title}</span>
          <span class={row.found ? "text-ink-muted" : "text-warning-ink-muted"} data-review-lines>{row.line}</span>
        </li>
      {/each}
    </ul>
  </div>
  <div class="flex shrink-0 gap-0.5">
    <Tooltip text="Preview" delayDuration={300}>
      {#snippet children({ props })}
        <button {...props} type="button" aria-label={`Preview ${name}`} onclick={onPreview} class="flex size-7 items-center justify-center rounded-md text-ink-muted hover:bg-primary-wash hover:text-ink pointer-coarse:size-11">
          <EyeIcon size={16} aria-hidden="true" />
        </button>
      {/snippet}
    </Tooltip>
    <Tooltip text="Remove" delayDuration={300}>
      {#snippet children({ props })}
        <button {...props} type="button" aria-label="Remove file" onclick={onRemove} class="flex size-7 items-center justify-center rounded-md text-ink-muted hover:bg-danger-soft hover:text-danger-ink pointer-coarse:size-11">
          <XIcon size={14} aria-hidden="true" />
        </button>
      {/snippet}
    </Tooltip>
  </div>
</div>
