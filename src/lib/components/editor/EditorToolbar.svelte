<script module lang="ts">
  import type { Editor } from "@tiptap/core";

  /** Block types the "Paragraph" menu offers (the slash menu's text blocks). */
  const BLOCK_TYPES: Array<{
    label: string;
    isActive: (editor: Editor) => boolean;
    apply: (editor: Editor) => void;
  }> = [
    {
      label: "Paragraph",
      isActive: (editor) => editor.isActive("paragraph"),
      apply: (editor) => editor.chain().focus().setParagraph().run(),
    },
    {
      label: "Heading 2",
      isActive: (editor) => editor.isActive("heading", { level: 2 }),
      apply: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      label: "Heading 3",
      isActive: (editor) => editor.isActive("heading", { level: 3 }),
      apply: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      label: "Bullet list",
      isActive: (editor) => editor.isActive("bulletList"),
      apply: (editor) => editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: "Numbered list",
      isActive: (editor) => editor.isActive("orderedList"),
      apply: (editor) => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      label: "Quote",
      isActive: (editor) => editor.isActive("blockquote"),
      apply: (editor) => editor.chain().focus().toggleBlockquote().run(),
    },
  ];
</script>

<!--
  Selection toolbar (ui-design-final.md section 8, board 2.1): block type,
  B, I, U, link, then "Ask assistant" with the Aurora mark. Comment and
  Research stay as quiet icons after it (decision 19 keeps features the
  boards do not show).
-->
<script lang="ts">
  import { tick } from "svelte";
  import ToolbarButton from "./ToolbarButton.svelte";
  import { rangeTouchesSectionHeading } from "./reportSectionHeadings";
  import AuroraMark from "$lib/components/ui/AuroraMark.svelte";

  let {
    editor,
    onComment,
    onAskAI,
    onResearch,
    commentOnly = false,
  }: {
    editor: Editor;
    onComment?: () => void;
    onAskAI?: () => void;
    onResearch?: () => void;
    commentOnly?: boolean;
  } = $props();

  let menuEl: HTMLDivElement | null = $state(null);
  let linkInput: HTMLInputElement | null = $state(null);
  let mouse = { x: 0, y: 0 };
  let mouseDownInEditor = false;
  let coords = $state<{ top: number; left: number } | null>(null);
  let toolbarWidth = $state(0);
  let editorWidth = $state(0);
  let blockMenuOpen = $state(false);
  let linkEditing = $state(false);
  let linkDraft = $state("");

  // The Editor instance never changes, so editor state read in the template
  // needs its own signal: bumped on every transaction (review f1).
  let revision = $state(0);
  $effect(() => {
    const bump = () => (revision += 1);
    editor.on("transaction", bump);
    return () => {
      editor.off("transaction", bump);
    };
  });
  const active = $derived.by(() => {
    void revision;
    const { from, to } = editor.state.selection;
    return {
      block: BLOCK_TYPES.find((type) => type.label !== "Paragraph" && type.isActive(editor))?.label ?? "Paragraph",
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      underline: editor.isActive("underline"),
      strike: editor.isActive("strike"),
      link: editor.isActive("link"),
      // A block-type change over a Section heading would convert or wrap it.
      touchesSectionHeading: rangeTouchesSectionHeading(editor.state.doc, from, to),
    };
  });
  const blockLabel = $derived(active.block);

  // Keep the toolbar inside the editor column instead of clipping at its edge.
  const left = $derived.by(() => {
    if (!coords) return 0;
    if (!toolbarWidth || !editorWidth) return coords.left;
    const half = toolbarWidth / 2;
    return Math.min(Math.max(coords.left, half), Math.max(half, editorWidth - half));
  });

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

  function close() {
    coords = null;
    blockMenuOpen = false;
    linkEditing = false;
  }

  function updatePosition() {
    const { from, to } = editor.state.selection;
    if (from === to) {
      close();
      return;
    }

    // Only show toolbar for user-initiated selections (mouse drag in editor),
    // not for programmatic selections (e.g., clicking a comment card)
    if (!mouseDownInEditor) {
      return;
    }

    const editorRect = editor.view.dom.getBoundingClientRect();
    editorWidth = editorRect.width;

    const mouseY = Math.max(editorRect.top, Math.min(mouse.y, editorRect.bottom));
    const mouseX = Math.max(editorRect.left, Math.min(mouse.x, editorRect.right));

    blockMenuOpen = false;
    linkEditing = false;
    revision += 1;
    coords = {
      top: mouseY - editorRect.top - 48,
      left: mouseX - editorRect.left,
    };
  }

  function handleBlur({ event }: { event: FocusEvent }) {
    const relatedTarget = event.relatedTarget as Node | null;
    if (menuEl && relatedTarget && menuEl.contains(relatedTarget)) {
      return;
    }
    close();
  }

  $effect(() => {
    editor.on("selectionUpdate", updatePosition);
    editor.on("blur", handleBlur);

    return () => {
      editor.off("selectionUpdate", updatePosition);
      editor.off("blur", handleBlur);
    };
  });

  async function toggleLink() {
    if (editor.isActive("link")) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    blockMenuOpen = false;
    linkDraft = "";
    linkEditing = true;
    await tick();
    linkInput?.focus();
  }

  function applyLink() {
    const href = linkDraft.trim();
    linkEditing = false;
    if (!href) {
      editor.commands.focus();
      return;
    }
    const url = /^[a-z][a-z0-9+.-]*:/i.test(href) ? href : `https://${href}`;
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }

  function handleLinkKey(event: KeyboardEvent) {
    if (event.key === "Enter") {
      event.preventDefault();
      applyLink();
    } else if (event.key === "Escape") {
      event.preventDefault();
      linkEditing = false;
      editor.commands.focus();
    }
  }

  function handleMenuKey(event: KeyboardEvent) {
    if (event.key === "Escape" && blockMenuOpen) {
      event.preventDefault();
      blockMenuOpen = false;
    }
  }
</script>

{#if coords}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    bind:this={menuEl}
    bind:offsetWidth={toolbarWidth}
    data-selection-toolbar
    class="absolute z-50 flex h-[34px] items-center gap-0.5 whitespace-nowrap rounded-md border border-line bg-surface px-1.5 font-sans shadow-toolbar"
    style={`top: ${coords.top}px; left: ${left}px; transform: translateX(-50%);`}
    onmousedown={(e) => {
      // Prevent toolbar clicks from stealing focus from the editor (the link
      // field takes focus on purpose).
      if (e.target !== linkInput) e.preventDefault();
    }}
    onkeydown={handleMenuKey}
  >
    {#if linkEditing}
      <label class="sr-only" for="selection-link-url">Link address</label>
      <input
        bind:this={linkInput}
        bind:value={linkDraft}
        id="selection-link-url"
        type="url"
        placeholder="Paste or type a link"
        onkeydown={handleLinkKey}
        class="input-chromeless h-[26px] w-56 bg-transparent px-2 text-xs text-ink placeholder:text-ink-faint"
      />
      <button
        type="button"
        onclick={applyLink}
        class="flex h-[26px] items-center rounded-[5px] px-2 text-xs text-primary-selected transition-colors hover:bg-primary-wash"
      >Add link</button>
    {:else}
      {#if !commentOnly && !active.touchesSectionHeading}
        <div class="relative">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={blockMenuOpen}
            title="Block type"
            onclick={() => (blockMenuOpen = !blockMenuOpen)}
            class="flex h-[26px] items-center gap-1 rounded-[5px] px-2 text-xs text-ink transition-colors hover:bg-primary-wash"
          >
            {blockLabel}
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.2" class="text-ink-muted" aria-hidden="true">
              <path d="M2.5 4l2.5 2.5L7.5 4" />
            </svg>
          </button>
          {#if blockMenuOpen}
            <div
              role="menu"
              aria-label="Block type"
              class="absolute left-0 top-full z-10 mt-1.5 flex w-40 flex-col rounded-md border border-line bg-surface p-1 shadow-toolbar"
            >
              {#each BLOCK_TYPES as type (type.label)}
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={type.label === blockLabel}
                  onclick={() => {
                    type.apply(editor);
                    blockMenuOpen = false;
                  }}
                  class={`flex h-7 items-center rounded-[5px] px-2 text-left text-xs transition-colors hover:bg-primary-wash ${type.label === blockLabel ? "text-primary-selected" : "text-ink"}`}
                >{type.label}</button>
              {/each}
            </div>
          {/if}
        </div>
        <div class="h-4 w-px shrink-0 bg-line" aria-hidden="true"></div>
      {/if}
      {#if !commentOnly}

        <ToolbarButton
          active={active.bold}
          onclick={() => editor.chain().focus().toggleBold().run()}
          title="Bold (Cmd+B)"
        >
          <span class="font-medium">B</span>
        </ToolbarButton>

        <ToolbarButton
          active={active.italic}
          onclick={() => editor.chain().focus().toggleItalic().run()}
          title="Italic (Cmd+I)"
        >
          <span class="font-serif text-[13px] italic">I</span>
        </ToolbarButton>

        <ToolbarButton
          active={active.underline}
          onclick={() => editor.chain().focus().toggleUnderline().run()}
          title="Underline (Cmd+U)"
        >
          <span class="underline decoration-1">U</span>
        </ToolbarButton>

        <ToolbarButton active={active.link} onclick={toggleLink} title={active.link ? "Remove link" : "Link"}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
          </svg>
        </ToolbarButton>
      {/if}

      {#if onAskAI}
        {@const askAI = onAskAI}
        {#if !commentOnly}
          <div class="h-4 w-px shrink-0 bg-line" aria-hidden="true"></div>
        {/if}
        <button
          type="button"
          onclick={askAI}
          title="Ask assistant"
          class="flex h-[26px] items-center gap-1.5 rounded-[5px] bg-primary-wash px-2 text-xs text-primary-selected transition-colors hover:bg-chrome"
        >
          <AuroraMark size={14} />
          Ask assistant
        </button>
      {/if}

      {#if !commentOnly || onComment || onResearch}
        {#if !commentOnly}
          <div class="h-4 w-px shrink-0 bg-line" aria-hidden="true"></div>
          <!-- Kept from the old toolbar (decision 19); quiet, after the board's set. -->
          <ToolbarButton
            active={active.strike}
            onclick={() => editor.chain().focus().toggleStrike().run()}
            title="Strikethrough"
          >
            <span class="text-ink-secondary line-through">S</span>
          </ToolbarButton>
        {/if}
        {#if onComment}
          <ToolbarButton active={false} onclick={onComment} title="Comment">
            <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"
              />
            </svg>
          </ToolbarButton>
        {/if}
        {#if onResearch}
          <ToolbarButton active={false} onclick={onResearch} title="Research this selection">
            <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path stroke-linecap="round" d="m20 20-3.4-3.4M11 8v6M8 11h6" />
            </svg>
          </ToolbarButton>
        {/if}
      {/if}
    {/if}
  </div>
{/if}
