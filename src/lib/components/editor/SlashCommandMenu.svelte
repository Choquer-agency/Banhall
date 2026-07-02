<!--
  Slash command menu (port of src/components/editor/SlashCommand.tsx).
  Rendered by Editor.svelte; opened when the writer types "/" — a fixed-position
  filterable block-type picker driven by document-level key events.
-->
<script module lang="ts">
  import type { Editor } from "@tiptap/core";

  interface SlashItem {
    title: string;
    description: string;
    icon: string;
    command: (editor: Editor) => void;
  }

  const SLASH_ITEMS: SlashItem[] = [
    {
      title: "Heading 1",
      description: "Large section heading",
      icon: "H1",
      command: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      title: "Heading 2",
      description: "Medium section heading",
      icon: "H2",
      command: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      title: "Heading 3",
      description: "Small section heading",
      icon: "H3",
      command: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      title: "Paragraph",
      description: "Plain text block",
      icon: "P",
      command: (editor) => editor.chain().focus().setParagraph().run(),
    },
    {
      title: "Divider",
      description: "Horizontal line separator",
      icon: "—",
      command: (editor) => editor.chain().focus().setHorizontalRule().run(),
    },
    {
      title: "Quote",
      description: "Block quote",
      icon: '"',
      command: (editor) => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      title: "Code Block",
      description: "Code block with syntax",
      icon: "<>",
      command: (editor) => editor.chain().focus().toggleCodeBlock().run(),
    },
    {
      title: "Bullet List",
      description: "Unordered list",
      icon: "•",
      command: (editor) => editor.chain().focus().toggleBulletList().run(),
    },
    {
      title: "Numbered List",
      description: "Ordered list",
      icon: "1.",
      command: (editor) => editor.chain().focus().toggleOrderedList().run(),
    },
  ];
</script>

<script lang="ts">
  let {
    editor,
    isOpen,
    onClose,
    position,
  }: {
    editor: Editor;
    isOpen: boolean;
    onClose: () => void;
    position: { top: number; left: number };
  } = $props();

  let filter = $state("");
  let selectedIndex = $state(0);

  const filtered = $derived(
    SLASH_ITEMS.filter(
      (item) =>
        item.title.toLowerCase().includes(filter.toLowerCase()) ||
        item.description.toLowerCase().includes(filter.toLowerCase())
    )
  );

  function executeCommand(item: SlashItem) {
    // Delete the slash and any filter text
    const { from } = editor.state.selection;
    const textBefore = editor.state.doc.textBetween(
      Math.max(0, from - filter.length - 1),
      from,
      ""
    );
    const slashPos = textBefore.lastIndexOf("/");
    if (slashPos >= 0) {
      const deleteFrom = from - filter.length - 1;
      editor.chain().focus().deleteRange({ from: deleteFrom, to: from }).run();
    }
    item.command(editor);
    onClose();
  }

  // Reset filter + selection whenever the menu closes.
  $effect(() => {
    if (!isOpen) {
      filter = "";
      selectedIndex = 0;
    }
  });

  // Keyboard navigation while open (captures before the editor).
  $effect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, filtered.length - 1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, 0);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = filtered[selectedIndex];
        if (item) {
          executeCommand(item);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Backspace" && filter === "") {
        onClose();
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        filter += e.key;
        selectedIndex = 0;
      } else if (e.key === "Backspace") {
        filter = filter.slice(0, -1);
        selectedIndex = 0;
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  });
</script>

{#if isOpen && filtered.length > 0}
  <div
    class="fixed z-50 max-h-[min(400px,calc(100vh-var(--menu-top)-16px))] w-64 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
    style={`top: ${position.top}px; left: ${position.left}px; --menu-top: ${position.top}px;`}
  >
    {#if filter}
      <div class="px-3 py-1 text-xs text-gray-400">Filter: {filter}</div>
    {/if}
    {#each filtered as item, index (item.title)}
      <button
        type="button"
        class={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
          index === selectedIndex ? "bg-gray-50 text-navy" : "text-gray-700 hover:bg-primary-wash"
        }`}
        onclick={() => executeCommand(item)}
        onmouseenter={() => (selectedIndex = index)}
      >
        <span
          class="flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 bg-white text-xs font-medium text-gray-500"
        >
          {item.icon}
        </span>
        <div>
          <p class="text-sm font-medium">{item.title}</p>
          <p class="text-xs text-gray-400">{item.description}</p>
        </div>
      </button>
    {/each}
  </div>
{/if}
