<!--
  Dropping files or a folder anywhere on the Import page (2026-11-12, Paper
  Files 1). The page area beside the Admin sidebar (the frame's page
  column, header and all) is the drop target. While files are dragged over
  it, the area takes the primary wash, a 2px dashed outline runs 8px inside
  it (radius 12) and a dark bar sits 24px above its foot: "Drop to add 64
  files" when the browser lets the page count them (it cannot see inside a
  dragged folder), otherwise "Drop to add these files", then "Banhall sorts
  them by company, category and fiscal year". Nothing else changes, and
  nothing on the page moves: the outline and bar float over it and never
  take a pointer.

  A drop walks its folders (importIntake.ts walkDrop) and hands the files,
  with their paths, to `onFiles`. Files dragged elsewhere on the window are
  never opened by the browser; a drop there does nothing.
-->
<script lang="ts">
  import { DROP_BAR_NOTE, dragFileCount, dragHasFiles, dropBarText, dropEntries, walkDrop, type IntakeFile } from "./importIntake";

  let {
    anchor,
    onFiles,
  }: {
    /** An element inside the page; its page column is the drop target. */
    anchor: HTMLElement | null;
    onFiles: (files: IntakeFile[]) => void;
  } = $props();

  let active = $state(false);
  let count = $state<number | null>(null);
  let rect = $state<{ top: number; left: number; width: number; height: number } | null>(null);
  let quiet: ReturnType<typeof setTimeout> | undefined;

  /** The page column, or the anchor itself where the page has no frame. */
  function area(): HTMLElement | null {
    return anchor?.closest<HTMLElement>("[data-frame-main]") ?? anchor;
  }

  function inside(target: EventTarget | null): boolean {
    const element = area();
    return Boolean(element && target instanceof Node && element.contains(target));
  }

  function show(transfer: DataTransfer | null) {
    const element = area();
    if (!element) return;
    const box = element.getBoundingClientRect();
    rect = { top: box.top, left: box.left, width: box.width, height: box.height };
    count = dragFileCount(transfer);
    active = true;
  }

  function hide() {
    clearTimeout(quiet);
    active = false;
  }

  $effect(() => {
    const over = (event: DragEvent) => {
      if (!dragHasFiles(event.dataTransfer)) return;
      // Never let the browser open a file dropped on the page.
      event.preventDefault();
      if (!inside(event.target)) {
        if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
        hide();
        return;
      }
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      if (!active) show(event.dataTransfer);
      else count = dragFileCount(event.dataTransfer);
      // The browser repeats dragover while the drag stays; when it stops
      // (the drag left the window, or was cancelled) the outline goes.
      clearTimeout(quiet);
      quiet = setTimeout(hide, 600);
    };
    const leave = (event: DragEvent) => {
      // Leaving the window: nothing is under the pointer any more.
      if (event.relatedTarget === null && dragHasFiles(event.dataTransfer)) hide();
    };
    const drop = (event: DragEvent) => {
      if (!dragHasFiles(event.dataTransfer)) return;
      event.preventDefault();
      const target = inside(event.target);
      hide();
      if (!target) return;
      // The entries must be taken while the drop event runs.
      const entries = dropEntries(event.dataTransfer);
      void walkDrop(entries).then((files) => {
        if (files.length > 0) onFiles(files);
      });
    };
    document.addEventListener("dragenter", over);
    document.addEventListener("dragover", over);
    document.addEventListener("dragleave", leave);
    document.addEventListener("drop", drop);
    window.addEventListener("dragend", hide);
    window.addEventListener("blur", hide);
    return () => {
      clearTimeout(quiet);
      document.removeEventListener("dragenter", over);
      document.removeEventListener("dragover", over);
      document.removeEventListener("dragleave", leave);
      document.removeEventListener("drop", drop);
      window.removeEventListener("dragend", hide);
      window.removeEventListener("blur", hide);
    };
  });
</script>

{#if active && rect}
  {@const place = `top:${rect.top}px;left:${rect.left}px;width:${rect.width}px;height:${rect.height}px`}
  <!-- Measured from the page column (px). The wash multiplies over the page,
       so the page shows through it; it blends only as its own layer, so the
       outline and the bar sit in a second one. Neither takes the pointer. -->
  <div data-import-drop-wash class="pointer-events-none fixed z-[95] bg-primary-wash mix-blend-multiply" style={place} aria-hidden="true"></div>
  <div data-import-drop-overlay class="pointer-events-none fixed z-[95]" style={place}>
    <div data-import-drop-outline class="absolute inset-2 rounded-xl border-2 border-dashed border-import-drop-line" aria-hidden="true"></div>
    <div class="absolute inset-x-0 bottom-6 flex justify-center px-4">
      <div
        role="status"
        data-import-drop-bar
        class="flex h-12 max-w-full shrink-0 items-center gap-2 overflow-hidden rounded-xl bg-ink pr-4 pl-2 shadow-review-bar"
      >
        <span class="flex size-8 shrink-0 items-center justify-center rounded-[0.4375rem] bg-primary-selected text-white" aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 24 24" data-board-icon fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 4v11" /><path d="M7 10l5 5 5-5" /><path d="M5 20h14" />
          </svg>
        </span>
        <span data-import-drop-text class="shrink-0 whitespace-nowrap pr-1.5 pl-1 text-[0.8125rem] leading-[calc(18/13)] font-medium text-white">{dropBarText(count)}</span>
        <span class="h-6 w-px shrink-0 bg-white/20" aria-hidden="true"></span>
        <span data-import-drop-note class="min-w-0 truncate pl-1.5 text-[0.8125rem] leading-[calc(18/13)] text-on-ink-muted">{DROP_BAR_NOTE}</span>
      </div>
    </div>
  </div>
{/if}
