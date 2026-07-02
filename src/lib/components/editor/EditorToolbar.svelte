<script lang="ts">
  import type { Editor } from "@tiptap/core";
  import ToolbarButton from "./ToolbarButton.svelte";
  import ChatIcon from "$lib/components/ui/ChatIcon.svelte";

  let {
    editor,
    onComment,
    onAskAI,
    commentOnly = false,
  }: {
    editor: Editor;
    onComment?: () => void;
    onAskAI?: () => void;
    commentOnly?: boolean;
  } = $props();

  let menuEl: HTMLDivElement | null = $state(null);
  let mouse = { x: 0, y: 0 };
  let mouseDownInEditor = false;
  let coords = $state<{ top: number; left: number } | null>(null);

  // Track actual mouse position + whether mouse is down inside the editor
  $effect(() => {
    const editorDom = editor.view.dom;

    const handleMouseMove = (e: MouseEvent) => {
      mouse = { x: e.clientX, y: e.clientY };
    };
    const handleMouseDown = () => {
      mouseDownInEditor = true;
    };
    const handleMouseUp = () => {
      // Small delay so selectionUpdate fires first
      setTimeout(() => {
        mouseDownInEditor = false;
      }, 50);
    };

    document.addEventListener("mousemove", handleMouseMove);
    editorDom.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      editorDom.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  });

  function updatePosition() {
    const { from, to } = editor.state.selection;
    if (from === to) {
      coords = null;
      return;
    }

    // Only show toolbar for user-initiated selections (mouse drag in editor),
    // not for programmatic selections (e.g., clicking a comment card)
    if (!mouseDownInEditor) {
      return;
    }

    const editorRect = editor.view.dom.getBoundingClientRect();

    const mouseY = Math.max(editorRect.top, Math.min(mouse.y, editorRect.bottom));
    const mouseX = Math.max(editorRect.left, Math.min(mouse.x, editorRect.right));

    coords = {
      top: mouseY - editorRect.top - 45,
      left: mouseX - editorRect.left,
    };
  }

  function handleBlur({ event }: { event: FocusEvent }) {
    const relatedTarget = event.relatedTarget as Node | null;
    if (menuEl && relatedTarget && menuEl.contains(relatedTarget)) {
      return;
    }
    coords = null;
  }

  $effect(() => {
    editor.on("selectionUpdate", updatePosition);
    editor.on("blur", handleBlur);

    return () => {
      editor.off("selectionUpdate", updatePosition);
      editor.off("blur", handleBlur);
    };
  });
</script>

{#if coords}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    bind:this={menuEl}
    class="absolute z-50 flex items-center gap-0.5 rounded-lg border border-gray-200 bg-white px-1 py-1 shadow-lg"
    style={`top: ${coords.top}px; left: ${coords.left}px; transform: translateX(-50%);`}
    onmousedown={(e) => {
      // Prevent toolbar clicks from stealing focus from the editor
      e.preventDefault();
    }}
  >
    {#if !commentOnly}
      <ToolbarButton
        active={editor.isActive("bold")}
        onclick={() => editor.chain().focus().toggleBold().run()}
        title="Bold (Cmd+B)"
      >
        <span class="font-bold">B</span>
      </ToolbarButton>

      <ToolbarButton
        active={editor.isActive("italic")}
        onclick={() => editor.chain().focus().toggleItalic().run()}
        title="Italic (Cmd+I)"
      >
        <span class="italic">I</span>
      </ToolbarButton>

      <ToolbarButton
        active={editor.isActive("underline")}
        onclick={() => editor.chain().focus().toggleUnderline().run()}
        title="Underline (Cmd+U)"
      >
        <span class="underline">U</span>
      </ToolbarButton>

      <ToolbarButton
        active={editor.isActive("strike")}
        onclick={() => editor.chain().focus().toggleStrike().run()}
        title="Strikethrough"
      >
        <span class="line-through">S</span>
      </ToolbarButton>
    {/if}

    {#if onComment}
      {@const comment = onComment}
      {#if !commentOnly}
        <div class="mx-0.5 h-5 w-px bg-gray-200"></div>
      {/if}
      <ToolbarButton active={false} onclick={comment} title="Comment">
        <svg
          class="h-3.5 w-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="2"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"
          />
        </svg>
      </ToolbarButton>
    {/if}

    {#if onAskAI}
      {@const askAI = onAskAI}
      <ToolbarButton active={false} onclick={askAI} title="Ask AI about this">
        <ChatIcon class="h-3.5 w-3.5" />
      </ToolbarButton>
    {/if}
  </div>
{/if}
