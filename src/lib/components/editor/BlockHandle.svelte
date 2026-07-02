<!--
  Hover block handle (port of src/components/editor/BlockHandle.tsx): a "+"
  (insert paragraph after block) and drag-dots affordance floated in the left
  gutter of the hovered top-level block. Rendered by Editor.svelte inside the
  relative `.group/editor` wrapper.
-->
<script lang="ts">
  import type { Editor } from "@tiptap/core";

  let { editor }: { editor: Editor } = $props();

  let hoveredBlock = $state<{ top: number; pos: number } | null>(null);
  let dragging = $state(false);

  $effect(() => {
    const editorElement = editor.view.dom; // the `.tiptap-editor` root
    const parent = editorElement.parentElement;
    if (!parent) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (dragging) return;

      // Find the block element under the cursor
      const target = document.elementFromPoint(e.clientX, e.clientY);
      if (!target) return;

      // Walk up to find a direct child of the editor
      let blockEl: HTMLElement | null = target as HTMLElement;
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

    const handleMouseLeave = () => {
      hoveredBlock = null;
    };

    parent.addEventListener("mousemove", handleMouseMove);
    parent.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      parent.removeEventListener("mousemove", handleMouseMove);
      parent.removeEventListener("mouseleave", handleMouseLeave);
    };
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

{#if hoveredBlock}
  <div
    class="absolute -left-10 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/editor:opacity-100"
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
    <button
      type="button"
      class="flex h-6 w-6 cursor-grab items-center justify-center rounded text-gray-300 hover:bg-primary-wash hover:text-gray-500"
      title="Drag to reorder"
      onmousedown={() => (dragging = true)}
      onmouseup={() => (dragging = false)}
    >
      <svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
        <circle cx="9" cy="6" r="1.5" />
        <circle cx="15" cy="6" r="1.5" />
        <circle cx="9" cy="12" r="1.5" />
        <circle cx="15" cy="12" r="1.5" />
        <circle cx="9" cy="18" r="1.5" />
        <circle cx="15" cy="18" r="1.5" />
      </svg>
    </button>
  </div>
{/if}
