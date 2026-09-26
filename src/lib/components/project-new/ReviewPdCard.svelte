<script lang="ts">
  /**
   * The written PD on Review a written PD (board E4): a page thumbnail, the
   * file name, where the title came from, and one row per Section with its
   * form line count against the CRA limit (50, 100, 50). A Section we could
   * not find shows a warning and "Not found".
   */
  import { IconAlertCircle, IconCheck, IconClose, IconEye } from "$lib/components/icons";
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

<div data-review-pd-card class="flex gap-3.5 rounded-xl border border-line-soft bg-surface p-3.5">
  <div data-review-pd-thumb class="flex h-[52px] w-10 shrink-0 flex-col gap-1 rounded-[4px] border border-line bg-surface px-1.5 py-[7px] shadow-pd-thumb" aria-hidden="true">
    {#each [0.9, 0.7, 0.85, 0.6, 0.8] as width, index (index)}
      <span class="h-[3px] shrink-0 rounded-[2px] bg-pd-thumb-line" style={`width:${width * 100}%`}></span>
    {/each}
  </div>
  <div class="flex min-w-0 flex-1 flex-col gap-0.5">
    <p class="truncate text-sm leading-5 font-medium text-ink">{name}</p>
    <p class="text-xs leading-4 text-ink-muted" data-review-pd-uploaded>
      {titleFromFileName
        ? "Uploaded just now. We filled the project title from the file name."
        : "Uploaded just now."}
    </p>
    <ul class="flex flex-col pt-2">
      {#each rows as row (row.key)}
        <li data-review-section={row.number} data-found={row.found} class="flex h-[30px] items-center gap-2 text-[13px] leading-[18px]">
          {#if row.found}
            <IconCheck size={13} strokeWidth={2.2} class="shrink-0 text-success" />
          {:else}
            <IconAlertCircle size={13} strokeWidth={2} class="shrink-0 text-warning" />
          {/if}
          <span class="w-[220px] min-w-0 shrink truncate text-ink">{row.number} {row.title}</span>
          <span class={row.found ? "text-ink-muted" : "text-warning-ink-muted"} data-review-lines>{row.line}</span>
        </li>
      {/each}
    </ul>
  </div>
  <div class="flex shrink-0 gap-0.5 self-start">
    <Tooltip text="Preview" delayDuration={300}>
      {#snippet children({ props })}
        <button {...props} type="button" aria-label={`Preview ${name}`} onclick={onPreview} class="flex size-7 items-center justify-center rounded-md text-ink-muted hover:bg-primary-wash hover:text-ink pointer-coarse:size-11">
          <IconEye size={15} strokeWidth={1.6} />
        </button>
      {/snippet}
    </Tooltip>
    <Tooltip text="Remove" delayDuration={300}>
      {#snippet children({ props })}
        <button {...props} type="button" aria-label="Remove file" onclick={onRemove} class="flex size-7 items-center justify-center rounded-md text-ink-faint hover:bg-danger-soft hover:text-danger-ink pointer-coarse:size-11">
          <IconClose size={14} strokeWidth={1.8} />
        </button>
      {/snippet}
    </Tooltip>
  </div>
</div>
