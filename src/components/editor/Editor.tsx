"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";
import { getEditorExtensions } from "@/lib/tiptapConfig";
import { EditorToolbar } from "./EditorToolbar";
import { SlashCommandMenu } from "./SlashCommand";
import { BlockHandle } from "./BlockHandle";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export interface CommentRange {
  id: string;
  from: number;
  to: number;
  text?: string;
  active?: boolean;
  isClient?: boolean;
}

interface EditorProps {
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
}

export interface EditorHandle {
  scrollToPosition: (from: number, to: number, text?: string) => void;
  getYForPos: (pos: number, text?: string) => number | null;
  getEditorTop: () => number;
  /**
   * BNH-25: highlight every occurrence of the given passages, and scroll to
   * `scrollTo` (one of the passages) — or the first occurrence if omitted.
   */
  highlightText: (texts: string[], scrollTo?: string) => void;
  clearHighlight: () => void;
}

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
function findAllInDoc(
  doc: Parameters<typeof DecorationSet.create>[0],
  text: string
): Range[] {
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

function findTextInDoc(doc: Parameters<typeof DecorationSet.create>[0], text: string, hintFrom: number): { from: number; to: number } | null {
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

function buildDecorationSet(
  doc: Parameters<typeof DecorationSet.create>[0],
  ranges: CommentRange[],
  aiRanges: Range[] = []
) {
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
        ].filter(Boolean).join(" "),
        "data-comment-id": range.id,
      })
    );
  }

  return DecorationSet.create(doc, decorations);
}

export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(
  {
    content,
    onUpdate,
    onComment,
    onAskAI,
    editable = true,
    commentRanges = [],
    onHoverComment,
  },
  ref
) {
  const [slashMenu, setSlashMenu] = useState<{
    isOpen: boolean;
    position: { top: number; left: number };
  }>({ isOpen: false, position: { top: 0, left: 0 } });

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [aiHighlights, setAiHighlights] = useState<Range[]>([]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: getEditorExtensions({ editable }),
    content: parseContent(content),
    editable,
    editorProps: {
      attributes: {
        class: "tiptap-editor outline-none",
      },
      handleKeyDown: (_view, event) => {
        // Slash command trigger
        if (event.key === "/" && !slashMenu.isOpen) {
          setTimeout(() => {
            const { from } = _view.state.selection;
            const coords = _view.coordsAtPos(from);
            setSlashMenu({
              isOpen: true,
              position: { top: coords.bottom + 4, left: coords.left },
            });
          }, 10);
        }

        if (event.key === "Escape" && slashMenu.isOpen) {
          setSlashMenu((s) => ({ ...s, isOpen: false }));
          return true;
        }

        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      const { from } = ed.state.selection;
      const textBefore = ed.state.doc.textBetween(
        Math.max(0, from - 20),
        from,
        ""
      );
      if (!textBefore.includes("/")) {
        setSlashMenu((s) => (s.isOpen ? { ...s, isOpen: false } : s));
      }

      if (onUpdate) {
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = setTimeout(() => {
          const json = JSON.stringify(ed.getJSON());
          lastSavedContentRef.current = json;
          onUpdate(json);
        }, 1000);
      }
    },
  });

  useImperativeHandle(ref, () => ({
    scrollToPosition: (from: number, to: number, text?: string) => {
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
        const editorDom = editor.view.dom.closest('.overflow-y-auto');
        if (editorDom) {
          const containerRect = editorDom.getBoundingClientRect();
          const scrollTarget = coords.top - containerRect.top + editorDom.scrollTop - 100;
          editorDom.scrollTo({ top: scrollTarget, behavior: 'smooth' });
        }
      } catch { /* position out of range */ }
    },
    getYForPos: (pos: number, text?: string) => {
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
    },
    getEditorTop: () => {
      if (!editor) return 0;
      return editor.view.dom.getBoundingClientRect().top;
    },
    highlightText: (texts: string[], scrollTo?: string) => {
      if (!editor) return;
      const ranges: Range[] = [];
      for (const t of texts) {
        const trimmed = (t ?? "").trim();
        if (trimmed) ranges.push(...findAllInDoc(editor.state.doc, trimmed));
      }
      setAiHighlights(ranges);
      if (ranges.length === 0) return;
      // Scroll to the requested passage (don't steal focus/selection); fall
      // back to the earliest occurrence in the document.
      const target =
        (scrollTo && scrollTo.trim()
          ? findAllInDoc(editor.state.doc, scrollTo.trim())[0]
          : undefined) ??
        ranges.reduce((a, b) => (b.from < a.from ? b : a), ranges[0]);
      try {
        const coords = editor.view.coordsAtPos(target.from);
        const editorDom = editor.view.dom.closest(".overflow-y-auto");
        if (editorDom) {
          const containerRect = editorDom.getBoundingClientRect();
          const scrollTarget =
            coords.top - containerRect.top + editorDom.scrollTop - 120;
          editorDom.scrollTo({ top: scrollTarget, behavior: "smooth" });
        }
      } catch {
        /* position out of range */
      }
    },
    clearHighlight: () => setAiHighlights([]),
  }), [editor]);

  // Handle comment action from toolbar
  const handleComment = useCallback(() => {
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
  }, [editor, onComment]);

  // Handle "Ask AI" action from toolbar — pass the full selected text (no
  // 200-char cap; the chat needs the whole excerpt to edit it).
  const handleAskAI = useCallback(() => {
    if (!editor || !onAskAI) return;
    const { from, to } = editor.state.selection;
    if (from === to) return;
    const text = editor.state.doc.textBetween(from, to, "\n");
    if (!text.trim()) return;
    onAskAI({ from, to, text: text.trim() });
  }, [editor, onAskAI]);

  // Apply external content changes (AI replace, restore, regenerate). Only the
  // exact echo of our own last autosave is skipped — anything else is applied,
  // so restores/replaces always reflect even right after an edit.
  const lastContentRef = useRef(content);
  const lastSavedContentRef = useRef<string | null>(null);
  useEffect(() => {
    if (!editor) return;
    if (content !== lastContentRef.current) {
      lastContentRef.current = content;
      // Skip re-applying the round-trip echo of our own save.
      if (content === lastSavedContentRef.current) return;
      const parsed = parseContent(content);
      if (parsed) {
        editor.commands.setContent(parsed);
      }
    }
  }, [content, editor]);

  // Update comment + AI-reference highlight decorations when ranges change
  useEffect(() => {
    if (!editor) return;
    editor.view.setProps({
      decorations: (state) => {
        return buildDecorationSet(state.doc, commentRanges, aiHighlights);
      },
    });
  }, [editor, commentRanges, aiHighlights]);

  // BNH-25: clicking inside a highlighted passage clears the highlight, so it
  // gets out of the way the moment the writer goes to edit there.
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest?.(".ai-ref-highlight")) {
        setAiHighlights((cur) => (cur.length ? [] : cur));
      }
    };
    dom.addEventListener("mousedown", handleMouseDown);
    return () => dom.removeEventListener("mousedown", handleMouseDown);
  }, [editor]);

  // Detect hover over comment highlights
  useEffect(() => {
    if (!editor || !onHoverComment) return;
    const dom = editor.view.dom;
    const handleMouseOver = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest?.("[data-comment-id]");
      onHoverComment(el ? el.getAttribute("data-comment-id") : null);
    };
    const handleMouseOut = (e: MouseEvent) => {
      const related = e.relatedTarget as HTMLElement | null;
      if (!related?.closest?.("[data-comment-id]")) {
        onHoverComment(null);
      }
    };
    dom.addEventListener("mouseover", handleMouseOver);
    dom.addEventListener("mouseout", handleMouseOut);
    return () => {
      dom.removeEventListener("mouseover", handleMouseOver);
      dom.removeEventListener("mouseout", handleMouseOut);
    };
  }, [editor, onHoverComment]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  if (!editor) return null;

  return (
    <div className="group/editor relative">
      {/* Block handles */}
      {editable && <BlockHandle editor={editor} />}

      {/* Floating toolbar on text selection */}
      {editable && (
        <EditorToolbar
          editor={editor}
          onComment={handleComment}
          onAskAI={onAskAI ? handleAskAI : undefined}
        />
      )}

      {/* Comment-only bubble for read-only mode */}
      {!editable && onComment && (
        <EditorToolbar
          editor={editor}
          onComment={handleComment}
          commentOnly
        />
      )}

      {/* Slash command menu */}
      {editable && (
        <SlashCommandMenu
          editor={editor}
          isOpen={slashMenu.isOpen}
          onClose={() => setSlashMenu((s) => ({ ...s, isOpen: false }))}
          position={slashMenu.position}
        />
      )}

      {/* The editor itself */}
      <EditorContent editor={editor} />

      {/* Line/word/character count */}
      {editable && editor && (
        <div className="mt-4 flex items-center gap-4 text-xs text-gray-400">
          <span>
            {editor.state.doc.content.childCount} lines
          </span>
          <span>
            {editor.storage.characterCount.words()} words
          </span>
          <span>
            {editor.storage.characterCount.characters()} characters
          </span>
        </div>
      )}
    </div>
  );
});

function parseContent(content: string) {
  try {
    const doc = JSON.parse(content);
    // Strip QA scorecard codeBlock from editor view (rendered by QAScorePanel instead)
    if (doc.content) {
      doc.content = doc.content.filter((node: { type: string; attrs?: { language?: string }; content?: Array<{ text?: string }> }) => {
        if (node.type === "codeBlock" && node.attrs?.language === "json") {
          const text = node.content?.[0]?.text ?? "";
          try {
            const parsed = JSON.parse(text);
            if ("overall_score" in parsed) return false;
          } catch { /* not JSON, keep it */ }
        }
        return true;
      });
      // Also strip the "QA Scorecard" heading and preceding hr if they exist
      doc.content = doc.content.filter((node: { type: string; content?: Array<{ text?: string }> }, i: number, arr: Array<{ type: string; content?: Array<{ text?: string }> }>) => {
        if (node.type === "heading" && node.content?.[0]?.text === "QA Scorecard") return false;
        if (node.type === "horizontalRule" && arr[i + 1]?.type === "heading" && arr[i + 1]?.content?.[0]?.text === "QA Scorecard") return false;
        return true;
      });
      // NOTE: We intentionally do NOT strip horizontal rules from the document
      // structure, as that shifts ProseMirror positions and breaks comment
      // highlight placement. Redundant HRs are hidden via CSS instead
      // (see globals.css: .tiptap-editor h1 + hr, .tiptap-editor hr + hr).
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
