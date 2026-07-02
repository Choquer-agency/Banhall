<script module lang="ts">
  import type { Node as PMNode } from "@tiptap/pm/model";
  import { Decoration, DecorationSet } from "@tiptap/pm/view";
  import type { CommentRange } from "$lib/components/editor/types";

  function findTextInDoc(
    doc: PMNode,
    text: string,
    hintFrom: number
  ): { from: number; to: number } | null {
    const docSize = doc.content.size;
    if (!text || docSize < 2) return null;

    // Build a map of (textOffset → prosemirror pos) by walking text nodes
    // Use the same separator as textBetween uses ("\n" for blocks)
    const posMap: number[] = []; // posMap[textOffset] = pmPos
    doc.descendants((node, pos) => {
      if (node.isText && node.text) {
        for (let i = 0; i < node.text.length; i++) {
          posMap.push(pos + i);
        }
      } else if (node.isBlock && posMap.length > 0) {
        posMap.push(-1); // newline separator placeholder
      }
      return true;
    });

    // Get the full text using the same separator
    const fullText = doc.textBetween(1, docSize, "\n");

    // Search near hint position first, then anywhere
    const hintOffset = Math.max(0, hintFrom - 1);
    let idx = fullText.indexOf(text, Math.max(0, hintOffset - 500));
    if (idx === -1) idx = fullText.indexOf(text);
    if (idx === -1) return null;

    // Map text indices to ProseMirror positions
    const fromPos = posMap[idx];
    const toPos = posMap[idx + text.length - 1];
    if (fromPos === undefined || toPos === undefined || fromPos === -1 || toPos === -1) return null;

    return { from: fromPos, to: toPos + 1 }; // +1 because to is exclusive in PM
  }

  function buildDecorationSet(doc: PMNode, ranges: CommentRange[]) {
    const decorations: Decoration[] = [];
    const docSize = doc.content.size;

    for (const range of ranges) {
      let from = Math.max(1, Math.min(range.from, docSize));
      let to = Math.max(from, Math.min(range.to, docSize));

      // If we have the original text, verify the positions match — if not, search for it
      if (range.text && from < to) {
        try {
          const currentText = doc.textBetween(from, to, " ");
          if (currentText !== range.text) {
            const found = findTextInDoc(doc, range.text, range.from);
            if (found) {
              from = found.from;
              to = found.to;
            }
          }
        } catch {
          // positions out of range — try text search
          const found = range.text ? findTextInDoc(doc, range.text, range.from) : null;
          if (found) {
            from = found.from;
            to = found.to;
          }
        }
      }

      if (from >= to) continue;

      decorations.push(
        Decoration.inline(from, to, {
          class: [
            "comment-highlight",
            range.active ? "comment-highlight--active" : "",
            range.isClient ? "comment-highlight--client" : "",
          ]
            .filter(Boolean)
            .join(" "),
          "data-comment-id": range.id,
        })
      );
    }

    return DecorationSet.create(doc, decorations);
  }

  function parseContent(content: string) {
    try {
      const doc = JSON.parse(content);
      // Strip QA scorecard codeBlock from editor view (rendered by QAScorePanel instead)
      if (doc.content) {
        doc.content = doc.content.filter(
          (node: { type: string; attrs?: { language?: string }; content?: Array<{ text?: string }> }) => {
            if (node.type === "codeBlock" && node.attrs?.language === "json") {
              const text = node.content?.[0]?.text ?? "";
              try {
                const parsed = JSON.parse(text);
                if ("overall_score" in parsed) return false;
              } catch {
                /* not JSON, keep it */
              }
            }
            return true;
          }
        );
        // Also strip the "QA Scorecard" heading and preceding hr if they exist
        doc.content = doc.content.filter(
          (
            node: { type: string; content?: Array<{ text?: string }> },
            i: number,
            arr: Array<{ type: string; content?: Array<{ text?: string }> }>
          ) => {
            if (node.type === "heading" && node.content?.[0]?.text === "QA Scorecard") return false;
            if (
              node.type === "horizontalRule" &&
              arr[i + 1]?.type === "heading" &&
              arr[i + 1]?.content?.[0]?.text === "QA Scorecard"
            )
              return false;
            return true;
          }
        );
        // NOTE: We intentionally do NOT strip horizontal rules from the document
        // structure, as that shifts ProseMirror positions and breaks comment
        // highlight placement. Redundant HRs are hidden via CSS instead
        // (see layout.css: .tiptap-editor h1 + hr, .tiptap-editor hr + hr).
      }
      return doc;
    } catch {
      return {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: content ? [{ type: "text", text: content }] : [],
          },
        ],
      };
    }
  }
</script>

<script lang="ts">
  import { onMount } from "svelte";
  import { createEditor, EditorContent, type Editor } from "svelte-tiptap";
  import { getEditorExtensions } from "$lib/tiptapConfig";
  import EditorToolbar from "$lib/components/editor/EditorToolbar.svelte";

  /**
   * Read-only tiptap editor for client review (port of the `editable={false}`
   * slice of src/components/editor/Editor.tsx). Clients can select text and
   * comment, but cannot edit the document.
   */
  let {
    content,
    onComment,
    commentRanges = [],
    onHoverComment,
  }: {
    content: string;
    onComment?: (selection: {
      from: number;
      to: number;
      text: string;
      x?: number;
      y?: number;
    }) => void;
    commentRanges?: CommentRange[];
    onHoverComment?: (commentId: string | null) => void;
  } = $props();

  let editor = $state<Editor>();
  let lastContent = "";

  onMount(() => {
    lastContent = content;
    const editorStore = createEditor({
      extensions: getEditorExtensions({ editable: false }),
      content: parseContent(content),
      editable: false,
      editorProps: {
        attributes: {
          class: "tiptap-editor outline-none",
        },
      },
    });
    // Manual subscription keeps the store's editor alive for the component's
    // lifetime; unsubscribing on unmount tears the editor down.
    return editorStore.subscribe((e) => (editor = e));
  });

  // Apply external content changes (writer edits while the client is viewing).
  $effect(() => {
    const c = content;
    const ed = editor;
    if (!ed) return;
    if (c !== lastContent) {
      lastContent = c;
      const parsed = parseContent(c);
      if (parsed) {
        ed.commands.setContent(parsed);
      }
    }
  });

  // Update comment highlight decorations when ranges change
  $effect(() => {
    const ed = editor;
    if (!ed) return;
    const ranges = commentRanges;
    ed.view.setProps({
      decorations: (state) => buildDecorationSet(state.doc, ranges),
    });
  });

  // Detect hover over comment highlights
  $effect(() => {
    const ed = editor;
    const hover = onHoverComment;
    if (!ed || !hover) return;
    const dom = ed.view.dom;
    const handleMouseOver = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest?.("[data-comment-id]");
      hover(el ? el.getAttribute("data-comment-id") : null);
    };
    const handleMouseOut = (e: MouseEvent) => {
      const related = e.relatedTarget as HTMLElement | null;
      if (!related?.closest?.("[data-comment-id]")) {
        hover(null);
      }
    };
    dom.addEventListener("mouseover", handleMouseOver);
    dom.addEventListener("mouseout", handleMouseOut);
    return () => {
      dom.removeEventListener("mouseover", handleMouseOver);
      dom.removeEventListener("mouseout", handleMouseOut);
    };
  });

  // Handle comment action from the selection toolbar
  function handleComment() {
    if (!editor || !onComment) return;
    const { from, to } = editor.state.selection;
    if (from === to) return;
    const text = editor.state.doc.textBetween(from, to, " ");
    if (!text.trim()) return;
    let x: number | undefined;
    let y: number | undefined;
    try {
      const coords = editor.view.coordsAtPos(to);
      x = coords.left;
      y = coords.bottom;
    } catch {
      /* position out of range */
    }
    onComment({
      from,
      to,
      text: text.trim().slice(0, 200),
      x,
      y,
    });
  }

  export function scrollToPosition(from: number, to: number, text?: string) {
    if (!editor) return;
    try {
      const docSize = editor.state.doc.content.size;
      let resolvedFrom = Math.min(from, docSize);
      let resolvedTo = Math.min(to, docSize);

      // Verify positions match the text — if not, search for it
      if (text) {
        try {
          const currentText = editor.state.doc.textBetween(resolvedFrom, resolvedTo, " ");
          if (currentText !== text) {
            const found = findTextInDoc(editor.state.doc, text, from);
            if (found) {
              resolvedFrom = found.from;
              resolvedTo = found.to;
            }
          }
        } catch {
          const found = findTextInDoc(editor.state.doc, text, from);
          if (found) {
            resolvedFrom = found.from;
            resolvedTo = found.to;
          }
        }
      }

      editor.chain().focus().setTextSelection({ from: resolvedFrom, to: resolvedTo }).run();
      const coords = editor.view.coordsAtPos(resolvedFrom);
      const editorDom = editor.view.dom.closest(".overflow-y-auto");
      if (editorDom) {
        const containerRect = editorDom.getBoundingClientRect();
        const scrollTarget = coords.top - containerRect.top + editorDom.scrollTop - 100;
        editorDom.scrollTo({ top: scrollTarget, behavior: "smooth" });
      }
    } catch {
      /* position out of range */
    }
  }

  export function getYForPos(pos: number, text?: string): number | null {
    if (!editor) return null;
    try {
      const docSize = editor.state.doc.content.size;
      let clamped = Math.min(pos, docSize);

      // If text provided, verify position and search if needed
      if (text) {
        const found = findTextInDoc(editor.state.doc, text, pos);
        if (found) clamped = found.from;
      }

      const coords = editor.view.coordsAtPos(clamped);
      const editorRect = editor.view.dom.getBoundingClientRect();
      return coords.top - editorRect.top;
    } catch {
      return null;
    }
  }

  export function getEditorTop(): number {
    if (!editor) return 0;
    return editor.view.dom.getBoundingClientRect().top;
  }
</script>

{#if editor}
  <div class="group/editor relative">
    <!-- Comment-only bubble for read-only mode -->
    {#if onComment}
      <EditorToolbar {editor} onComment={handleComment} commentOnly />
    {/if}

    <!-- The editor itself -->
    <EditorContent {editor} />
  </div>
{/if}
