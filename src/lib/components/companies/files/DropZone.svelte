<!--
  The dashed drop area of Add files and Replace file (2026-11-04, Paper
  "Modal A1", "A2", "A3" and "Replace R1", "R2"): drop files or browse for
  them. While files are dragged over it, it says how many it will take.
  `compact` is the short bar shown once files are listed under it.
-->
<script lang="ts">
  import { SUPPORTED_ACCEPT } from "$lib/parseDocument";
  import { dragHasFiles, draggedFileTypes } from "./fileMeta";

  let {
    multiple = true,
    compact = false,
    title,
    hint,
    onFiles,
  }: {
    multiple?: boolean;
    compact?: boolean;
    /** Before "or browse": "Drop files", "Drop more files", "Drop the new version". */
    title: string;
    hint: string;
    onFiles: (files: File[]) => void;
  } = $props();

  let input: HTMLInputElement | null = $state(null);
  let depth = 0;
  let dragCount = $state<number | null>(null);

  function enter(event: DragEvent) {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    depth += 1;
    dragCount = draggedFileTypes(event).length || 1;
  }

  function over(event: DragEvent) {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    // The page's own drop overlay stays out of a dialog's drop area.
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  }

  function leave() {
    depth = Math.max(0, depth - 1);
    if (depth === 0) dragCount = null;
  }

  function drop(event: DragEvent) {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    depth = 0;
    dragCount = null;
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length) onFiles(multiple ? files : files.slice(0, 1));
  }

  const dragging = $derived(dragCount !== null);
  const dragTitle = $derived(
    multiple ? `Drop to add ${dragCount} ${dragCount === 1 ? "file" : "files"}` : "Drop to use this version"
  );
</script>

<div class={`rounded-2xl p-2 ${dragging ? "bg-primary-wash ring-1 ring-primary-line-soft" : "bg-gray-50"}`}>
  <div
    role="group"
    aria-label={title}
    ondragenter={enter}
    ondragover={over}
    ondragleave={leave}
    ondrop={drop}
    data-drop-zone
    data-dragging={dragging ? "" : undefined}
    class={`flex rounded-xl border border-dashed transition-colors motion-reduce:transition-none ${dragging ? "border-primary bg-primary-wash/60" : "border-gray-300 bg-surface"} ${compact ? "items-center justify-center gap-3 px-4 py-3.5" : "flex-col items-center justify-center gap-1.5 px-6 py-12"}`}
  >
    <span
      class={`flex shrink-0 items-center justify-center rounded-lg ${compact ? "size-8" : "mb-2 size-11 rounded-[0.625rem]"} ${dragging ? "bg-primary-selected text-white" : "bg-chrome text-primary-selected"}`}
      aria-hidden="true"
    >
      {#if dragging}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>
      {:else}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V4M7 9l5-5 5 5M5 20h14" /></svg>
      {/if}
    </span>
    <span class={`flex flex-col ${compact ? "items-start" : "items-center"}`}>
      {#if dragging}
        <span class="text-sm leading-[calc(10/7)] font-medium text-primary-selected">{dragTitle}</span>
      {:else}
        <span class="text-sm leading-[calc(10/7)] text-ink">
          {title} or
          <button
            type="button"
            onclick={() => input?.click()}
            data-drop-zone-browse
            class="rounded-sm text-primary-selected hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
          >browse</button>
        </span>
      {/if}
      <span class="text-xs leading-[calc(4/3)] text-ink-muted">{hint}</span>
    </span>
  </div>
  <input
    bind:this={input}
    data-drop-zone-input
    type="file"
    {multiple}
    class="hidden"
    tabindex={-1}
    aria-hidden="true"
    accept={SUPPORTED_ACCEPT}
    onchange={(event) => {
      const element = event.currentTarget;
      if (element.files?.length) onFiles(Array.from(element.files));
      element.value = "";
    }}
  />
</div>
