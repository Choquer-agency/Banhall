<!--
  Hover block handle (port of src/components/editor/BlockHandle.tsx): a "+"
  (insert paragraph after block) floated in the left gutter of the hovered
  top-level block. The drag grip was removed (owner, 2026-10-21): it never
  moved a block. Rendered by Editor.svelte inside the
  relative `.group/editor` wrapper.
-->
<script lang="ts">
  import type { Editor } from "@tiptap/core";

  let {
    editor,
    compact = false,
  }: {
    editor: Editor;
    /** Reading presentation (board 2.1): a small + level with the first line. */
    compact?: boolean;
  } = $props();

  let hoveredBlock = $state<{ top: number; pos: number } | null>(null);

  let handleEl = $state<HTMLDivElement | null>(null);

  // Listen on the document: when this effect first runs, svelte-tiptap has not
  // yet moved the editor DOM into place, so its parent does not exist yet.
  $effect(() => {
    const editorElement = editor.view.dom; // the `.tiptap-editor` root

    const handleMouseMove = (e: MouseEvent) => {
      const wrapper = editorElement.parentElement?.closest(".group\\/editor") ?? editorElement.parentElement;
      const target = e.target instanceof Node ? e.target : null;
      if (!wrapper || !target || !wrapper.contains(target)) {
        hoveredBlock = null;
        return;
      }
      // Keep the handle while the pointer travels onto it.
      if (handleEl?.contains(target)) return;

      // Find the block element under the cursor
      const pointTarget = document.elementFromPoint(e.clientX, e.clientY);
      if (!pointTarget) return;

      // Walk up to find a direct child of the editor
      let blockEl: HTMLElement | null = pointTarget as HTMLElement;
      while (blockEl && blockEl.parentElement !== editorElement) {
        blockEl = blockEl.parentElement;
      }

      if (!blockEl || blockEl === (editorElement as HTMLElement)) {
        hoveredBlock = null;
        return;
      }

      const rect = blockEl.getBoundingClientRect();
      const editorRect = editorElement.getBoundingClientRect();

      // Get the ProseMirror position for this DOM node
      const pos = editor.view.posAtDOM(blockEl, 0);

      hoveredBlock = {
        top: rect.top - editorRect.top,
        pos,
      };
    };

    document.addEventListener("mousemove", handleMouseMove);
    return () => document.removeEventListener("mousemove", handleMouseMove);
  });

  function handleAddBlock() {
    if (!hoveredBlock) return;
    // Insert a new paragraph after the current block
    const resolvedPos = editor.state.doc.resolve(hoveredBlock.pos);
    const endOfBlock = resolvedPos.end(1);
    editor
      .chain()
      .focus()
      .insertContentAt(endOfBlock + 1, { type: "paragraph" })
      .run();
  }
</script>

{#if hoveredBlock && compact}
  <!-- The + keeps its place 34px left of the text; the right padding runs
       the hit area to the text edge, so the pointer never leaves the editor
       on its way from a heading to the handle. -->
  <div
    bind:this={handleEl}
    data-block-handle
    class="absolute -left-[2.125rem] flex items-center pr-[1.125rem] opacity-0 transition-opacity group-hover/editor:opacity-100 motion-reduce:transition-none"
    style={`top: ${hoveredBlock.top + 3}px;`}
  >
    <button
      type="button"
      onclick={handleAddBlock}
      class="flex h-5 w-4 items-center justify-center rounded text-ink-muted transition-colors hover:bg-primary-wash hover:text-ink"
      title="Add block"
      aria-label="Add block"
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true">
        <path d="M6 2v8M2 6h8" />
      </svg>
    </button>
  </div>
{:else if hoveredBlock}
  <div
    bind:this={handleEl}
    class="absolute -left-10 flex items-center pr-4 opacity-0 transition-opacity group-hover/editor:opacity-100"
    style={`top: ${hoveredBlock.top}px;`}
  >
    <button
      type="button"
      onclick={handleAddBlock}
      class="flex h-6 w-6 items-center justify-center rounded text-gray-300 hover:bg-primary-wash hover:text-gray-500"
      title="Add block"
    >
      <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
      </svg>
    </button>
  </div>
{/if}
