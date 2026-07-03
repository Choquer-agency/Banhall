<!--
  Full writer editor (port of src/components/editor/Editor.tsx).

  Public surface
  ──────────────
  Props:
    content: string                    — report content (Tiptap JSON string; plain text falls back
                                         to a single paragraph). QA scorecard block is stripped.
    onUpdate?: (json: string) => void  — debounced (1s) autosave callback with the doc's JSON.
    onComment?: (sel) => void          — selection toolbar "Comment"; sel = { from, to, text (≤200
                                         chars), x?, y? (viewport coords of selection end) }.
    onAskAI?: (sel) => void            — selection toolbar "Ask AI"; sel = { from, to, text } with
                                         the FULL selected text (no cap).
    editable?: boolean = true          — fixed at mount (extensions + editability).
    commentRanges?: CommentRange[]     — comment highlight decorations (re-resolved by text).
    onHoverComment?: (id|null) => void — hover over a comment highlight.

  Exported methods — parents `bind:this` the component instance and call these
  (implements WriterEditorHandle from ./types):
    scrollToPosition(from, to, text?)          — select + smooth-scroll to a range.
    getYForPos(pos, text?): number | null      — y offset of a doc position within the editor.
    getEditorTop(): number                     — editor DOM top (viewport coords).
    highlightText(texts, scrollTo?)            — BNH-25: AI-reference highlights + scroll.
    clearHighlight()                           — remove all AI highlights.
    findReplaceMatches(pairs): FindReplaceMatch[] — BNH-30: all case-insensitive matches, sorted.
    replaceRange(from, to, newText)            — replace one range.
    highlightRange(from, to, text)             — highlight + scroll to one match.
-->
<script module lang="ts">
  import type { Node as PMNode } from "@tiptap/pm/model";
  import { Decoration, DecorationSet } from "@tiptap/pm/view";
  import type { CommentRange, FindReplaceMatch } from "$lib/components/editor/types";

  type Range = { from: number; to: number; text: string };

  /**
   * Normalize for matching WITHOUT changing length (1:1) so character offsets
   * still map to ProseMirror positions: unify curly quotes, dashes, and collapse
   * every whitespace char to a single space. This makes matching tolerant of the
   * punctuation/whitespace the model tends to substitute in its references.
   */
  function normalizeForMatch(s: string): string {
    return s
      .replace(/[‘’′´`]/g, "'")
      .replace(/[“”″]/g, '"')
      .replace(/[–—−]/g, "-")
      .replace(/\s/g, " ");
  }

  const SIG_WORD = /[a-z0-9]{4,}/g;

  /**
   * BNH-25: locate every occurrence of `text` in the doc, robustly. Layers:
   *   1. normalized exact match (all occurrences),
   *   2. normalized leading-fragment match (model's quote is slightly off at the end),
   *   3. best-matching paragraph by word overlap (model paraphrased / described it).
   * Stored `text` is the ACTUAL doc substring so decorations re-resolve cleanly.
   */
  function findAllInDoc(doc: PMNode, text: string): Range[] {
    const docSize = doc.content.size;
    const needle = (text ?? "").trim();
    if (!needle || docSize < 2) return [];

    const posMap: number[] = [];
    doc.descendants((node, pos) => {
      if (node.isText && node.text) {
        for (let i = 0; i < node.text.length; i++) posMap.push(pos + i);
      } else if (node.isBlock && posMap.length > 0) {
        posMap.push(-1);
      }
      return true;
    });

    const fullText = doc.textBetween(1, docSize, "\n");
    const normFull = normalizeForMatch(fullText);

    const rangeAt = (idx: number, len: number): Range | null => {
      const fromPos = posMap[idx];
      const toPos = posMap[idx + len - 1];
      if (fromPos === undefined || toPos === undefined || fromPos === -1 || toPos === -1) {
        return null;
      }
      let actual = needle;
      try {
        actual = doc.textBetween(fromPos, toPos + 1, " ");
      } catch {
        /* keep needle */
      }
      return { from: fromPos, to: toPos + 1, text: actual };
    };

    // 1) Normalized exact — every occurrence.
    const search = normalizeForMatch(needle);
    const out: Range[] = [];
    let idx = normFull.indexOf(search);
    while (idx !== -1) {
      const r = rangeAt(idx, search.length);
      if (r) out.push(r);
      idx = normFull.indexOf(search, idx + Math.max(1, search.length));
    }
    if (out.length > 0) return out;

    // 2) Leading fragment — handles a slightly-off tail on a long quote.
    if (search.length >= 24) {
      const frag = search.slice(0, Math.min(60, search.length));
      const fi = normFull.indexOf(frag);
      if (fi !== -1) {
        const r = rangeAt(fi, frag.length);
        if (r) return [r];
      }
    }

    // 3) Best-matching paragraph by significant-word overlap (paraphrase/describe).
    const refWords = new Set(search.toLowerCase().match(SIG_WORD) ?? []);
    if (refWords.size >= 2) {
      const blocks: Range[] = [];
      doc.descendants((node, pos) => {
        if (node.isTextblock && node.textContent.trim()) {
          const from = pos + 1;
          const to = pos + node.nodeSize - 1;
          blocks.push({ from, to, text: node.textContent });
          return false;
        }
        return true;
      });
      let best: Range | null = null;
      let bestScore = 0;
      for (const b of blocks) {
        const bw = new Set(normalizeForMatch(b.text).toLowerCase().match(SIG_WORD) ?? []);
        let hit = 0;
        refWords.forEach((w) => {
          if (bw.has(w)) hit++;
        });
        const score = hit / refWords.size;
        if (score > bestScore) {
          bestScore = score;
          best = b;
        }
      }
      if (best && bestScore >= 0.5) {
        let actual = best.text;
        try {
          actual = doc.textBetween(best.from, best.to, " ");
        } catch {
          /* keep textContent */
        }
        return [{ from: best.from, to: best.to, text: actual }];
      }
    }

    return [];
  }

  /**
   * BNH-30: every occurrence of `find`, case-insensitive (so "the system" also
   * matches "The system" at sentence starts). Returns the ACTUAL matched text so
   * the replacement can preserve casing.
   */
  function findAllOccurrencesCI(doc: PMNode, find: string): Range[] {
    const docSize = doc.content.size;
    const needle = (find ?? "").trim();
    if (!needle || docSize < 2) return [];

    const posMap: number[] = [];
    doc.descendants((node, pos) => {
      if (node.isText && node.text) {
        for (let i = 0; i < node.text.length; i++) posMap.push(pos + i);
      } else if (node.isBlock && posMap.length > 0) {
        posMap.push(-1);
      }
      return true;
    });

    const hay = normalizeForMatch(doc.textBetween(1, docSize, "\n")).toLowerCase();
    const ned = normalizeForMatch(needle).toLowerCase();
    if (!ned) return [];

    const out: Range[] = [];
    let idx = hay.indexOf(ned);
    while (idx !== -1) {
      const fromPos = posMap[idx];
      const toPos = posMap[idx + ned.length - 1];
      if (fromPos !== undefined && toPos !== undefined && fromPos !== -1 && toPos !== -1) {
        let actual = needle;
        try {
          actual = doc.textBetween(fromPos, toPos + 1, " ");
        } catch {
          /* keep needle */
        }
        out.push({ from: fromPos, to: toPos + 1, text: actual });
      }
      idx = hay.indexOf(ned, idx + Math.max(1, ned.length));
    }
    return out;
  }

  /** Capitalize the replacement's first letter when the matched text was capitalized. */
  function smartCaseReplace(matched: string, replaceWith: string): string {
    const mi = matched.search(/[A-Za-z]/);
    const ri = replaceWith.search(/[a-z]/);
    if (mi >= 0 && ri >= 0) {
      const ch = matched[mi];
      const isUpper = ch === ch.toUpperCase() && ch !== ch.toLowerCase();
      if (isUpper) {
        return (
          replaceWith.slice(0, ri) + replaceWith[ri].toUpperCase() + replaceWith.slice(ri + 1)
        );
      }
    }
    return replaceWith;
  }

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

  function buildDecorationSet(doc: PMNode, ranges: CommentRange[], aiRanges: Range[] = []) {
    const decorations: Decoration[] = [];
    const docSize = doc.content.size;

    // BNH-25: AI-referenced passages — re-resolve by text so they survive drift.
    for (const r of aiRanges) {
      let from = Math.max(1, Math.min(r.from, docSize));
      let to = Math.max(from, Math.min(r.to, docSize));
      let ok = false;
      try {
        ok = doc.textBetween(from, to, " ") === r.text;
      } catch {
        ok = false;
      }
      if (!ok) {
        const found = findTextInDoc(doc, r.text, r.from);
        if (found) {
          from = found.from;
          to = found.to;
        } else {
          continue;
        }
      }
      if (from < to) {
        decorations.push(Decoration.inline(from, to, { class: "ai-ref-highlight" }));
      }
    }

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
  import SlashCommandMenu from "$lib/components/editor/SlashCommandMenu.svelte";
  import BlockHandle from "$lib/components/editor/BlockHandle.svelte";

  let {
    content,
    onUpdate,
    onComment,
    onAskAI,
    editable = true,
    commentRanges = [],
    onHoverComment,
  }: {
    content: string;
    onUpdate?: (json: string) => void;
    onComment?: (selection: {
      from: number;
      to: number;
      text: string;
      x?: number;
      y?: number;
    }) => void;
    onAskAI?: (selection: { from: number; to: number; text: string }) => void;
    editable?: boolean;
    commentRanges?: CommentRange[];
    onHoverComment?: (commentId: string | null) => void;
  } = $props();

  let editor = $state<Editor>();
  let slashMenu = $state<{
    isOpen: boolean;
    position: { top: number; left: number };
  }>({ isOpen: false, position: { top: 0, left: 0 } });
  let aiHighlights = $state<Range[]>([]);

  // Line/word/character counts, refreshed on every transaction (the store
  // emits the same Editor instance, so counts need their own reactive state).
  let lineCount = $state(0);
  let wordCount = $state(0);
  let charCount = $state(0);

  let saveTimeout: ReturnType<typeof setTimeout> | undefined;
  // Apply external content changes (AI replace, restore, regenerate). Only the
  // exact echo of our own last autosave is skipped — anything else is applied,
  // so restores/replaces always reflect even right after an edit.
  let lastContent = "";
  let lastSavedContent: string | null = null;

  onMount(() => {
    lastContent = content;
    const editorStore = createEditor({
      extensions: getEditorExtensions({ editable }),
      content: parseContent(content),
      editable,
      editorProps: {
        attributes: {
          class: "tiptap-editor outline-none",
        },
        handleKeyDown: (view, event) => {
          // Slash command trigger
          if (event.key === "/" && !slashMenu.isOpen) {
            setTimeout(() => {
              const { from } = view.state.selection;
              const coords = view.coordsAtPos(from);
              slashMenu = {
                isOpen: true,
                position: { top: coords.bottom + 4, left: coords.left },
              };
            }, 10);
          }

          if (event.key === "Escape" && slashMenu.isOpen) {
            slashMenu.isOpen = false;
            return true;
          }

          return false;
        },
      },
      onUpdate: ({ editor: ed }) => {
        const { from } = ed.state.selection;
        const textBefore = ed.state.doc.textBetween(Math.max(0, from - 20), from, "");
        if (!textBefore.includes("/") && slashMenu.isOpen) {
          slashMenu.isOpen = false;
        }

        if (onUpdate) {
          if (saveTimeout) clearTimeout(saveTimeout);
          saveTimeout = setTimeout(() => {
            const json = JSON.stringify(ed.getJSON());
            lastSavedContent = json;
            onUpdate(json);
          }, 1000);
        }
      },
    });
    // Manual subscription keeps the store's editor alive for the component's
    // lifetime; unsubscribing on unmount tears the editor down. Fires on every
    // transaction, so the counts stay live.
    const unsubscribe = editorStore.subscribe((e) => {
      editor = e;
      lineCount = e.state.doc.content.childCount;
      wordCount = e.storage.characterCount.words();
      charCount = e.storage.characterCount.characters();
    });
    return () => {
      if (saveTimeout) clearTimeout(saveTimeout);
      unsubscribe();
    };
  });

  // Apply external content changes (see lastContent/lastSavedContent above).
  $effect(() => {
    const c = content;
    const ed = editor;
    if (!ed) return;
    if (c !== lastContent) {
      lastContent = c;
      // Skip re-applying the round-trip echo of our own save.
      if (c === lastSavedContent) return;
      const parsed = parseContent(c);
      if (parsed) {
        ed.commands.setContent(parsed);
      }
    }
  });

  // Update comment + AI-reference highlight decorations when ranges change
  $effect(() => {
    const ed = editor;
    if (!ed) return;
    const ranges = commentRanges;
    const ai = aiHighlights;
    ed.view.setProps({
      decorations: (state) => buildDecorationSet(state.doc, ranges, ai),
    });
  });

  // BNH-25: clicking inside a highlighted passage clears the highlight, so it
  // gets out of the way the moment the writer goes to edit there.
  $effect(() => {
    const ed = editor;
    if (!ed) return;
    const dom = ed.view.dom;
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest?.(".ai-ref-highlight")) {
        if (aiHighlights.length) aiHighlights = [];
      }
    };
    dom.addEventListener("mousedown", handleMouseDown);
    return () => dom.removeEventListener("mousedown", handleMouseDown);
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

  // Handle comment action from toolbar
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

  // Handle "Ask AI" action from toolbar — pass the full selected text (no
  // 200-char cap; the chat needs the whole excerpt to edit it).
  function handleAskAI() {
    if (!editor || !onAskAI) return;
    const { from, to } = editor.state.selection;
    if (from === to) return;
    const text = editor.state.doc.textBetween(from, to, "\n");
    if (!text.trim()) return;
    onAskAI({ from, to, text: text.trim() });
  }

  /** Scroll the surrounding `.overflow-y-auto` container to a doc position. */
  function scrollContainerToPos(pos: number, offset: number) {
    if (!editor) return;
    try {
      const coords = editor.view.coordsAtPos(pos);
      const editorDom = editor.view.dom.closest(".overflow-y-auto");
      if (editorDom) {
        const containerRect = editorDom.getBoundingClientRect();
        const scrollTarget = coords.top - containerRect.top + editorDom.scrollTop - offset;
        editorDom.scrollTo({ top: scrollTarget, behavior: "smooth" });
      }
    } catch {
      /* position out of range */
    }
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
      scrollContainerToPos(resolvedFrom, 100);
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

  /**
   * BNH-25: highlight every occurrence of the given passages, and scroll to
   * `scrollTo` (one of the passages) — or the first occurrence if omitted.
   */
  export function highlightText(texts: string[], scrollTo?: string) {
    if (!editor) return;
    const ranges: Range[] = [];
    for (const t of texts) {
      const trimmed = (t ?? "").trim();
      if (trimmed) ranges.push(...findAllInDoc(editor.state.doc, trimmed));
    }
    aiHighlights = ranges;
    if (ranges.length === 0) return;
    // Scroll to the requested passage (don't steal focus/selection); fall
    // back to the earliest occurrence in the document.
    const target =
      (scrollTo && scrollTo.trim()
        ? findAllInDoc(editor.state.doc, scrollTo.trim())[0]
        : undefined) ?? ranges.reduce((a, b) => (b.from < a.from ? b : a), ranges[0]);
    scrollContainerToPos(target.from, 120);
  }

  export function clearHighlight() {
    aiHighlights = [];
  }

  // BNH-30: one-by-one replace stepping primitives.
  export function findReplaceMatches(
    pairs: { find: string; replaceWith: string }[]
  ): FindReplaceMatch[] {
    if (!editor) return [];
    const out: FindReplaceMatch[] = [];
    for (const p of pairs) {
      if (!p.find) continue;
      for (const r of findAllOccurrencesCI(editor.state.doc, p.find)) {
        out.push({
          from: r.from,
          to: r.to,
          replaceWith: smartCaseReplace(r.text, p.replaceWith),
          text: r.text,
        });
      }
    }
    return out.sort((a, b) => a.from - b.from);
  }

  export function replaceRange(from: number, to: number, newText: string) {
    if (!editor) return;
    editor.chain().insertContentAt({ from, to }, newText).run();
  }

  export function highlightRange(from: number, to: number, text: string) {
    if (!editor) return;
    aiHighlights = [{ from, to, text }];
    scrollContainerToPos(from, 120);
  }
</script>

{#if editor}
  <div class="group/editor relative">
    <!-- Block handles -->
    {#if editable}
      <BlockHandle {editor} />
    {/if}

    <!-- Floating toolbar on text selection -->
    {#if editable}
      <EditorToolbar {editor} onComment={handleComment} onAskAI={onAskAI ? handleAskAI : undefined} />
    {/if}

    <!-- Comment-only bubble for read-only mode -->
    {#if !editable && onComment}
      <EditorToolbar {editor} onComment={handleComment} commentOnly />
    {/if}

    <!-- Slash command menu -->
    {#if editable}
      <SlashCommandMenu
        {editor}
        isOpen={slashMenu.isOpen}
        onClose={() => (slashMenu.isOpen = false)}
        position={slashMenu.position}
      />
    {/if}

    <!-- The editor itself -->
    <EditorContent {editor} />

    <!-- Line/word/character count -->
    {#if editable}
      <div class="mt-4 flex items-center gap-4 text-xs text-gray-400">
        <span>{lineCount} lines</span>
        <span>{wordCount} words</span>
        <span>{charCount} characters</span>
      </div>
    {/if}
  </div>
{/if}
