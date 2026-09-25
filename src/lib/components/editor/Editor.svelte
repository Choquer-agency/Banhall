<!--
  Full writer editor (port of src/components/editor/Editor.tsx).

  Public surface
  ──────────────
  Props:
    content: string                    — report content (Tiptap JSON string; plain text falls back
                                         to a single paragraph). QA scorecard block is stripped.
    onUpdate?: (json: string) => void | Promise<void> — debounced (1s) autosave callback.
    onComment?: (sel) => void          — selection toolbar "Comment"; sel = { from, to, text (≤200
                                         chars), x?, y? (viewport coords of selection end) }.
    onAskAI?: (sel) => void            — selection toolbar "Ask AI"; sel = { from, to, text } with
                                         the FULL selected text (no cap).
    editable?: boolean = true          — fixed at mount (extensions + editability).
    readOnly?: boolean = false         - runtime lock on an editable editor: typing and the
                                         editing chrome pause (for example while the server
                                         fills Not drafted Sections); comments stay.
    commentRanges?: CommentRange[]     — comment highlight decorations (re-resolved by text).
    onHoverComment?: (id|null) => void — hover over a comment highlight.

  Exported methods — parents `bind:this` the component instance and call these
  (implements WriterEditorHandle from ./types):
    flushPendingSave(): Promise<void>           — flush visible JSON and await queued autosaves.
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
  import { NOT_GENERATED_PLACEHOLDER } from "../../../../convex/lib/tiptapReport";
  import type { CommentRange, FindReplaceMatch } from "$lib/components/editor/types";
  import {
    SECTION_HEADINGS_EXTERNAL,
    rangeTouchesHiddenHeading,
    type ReportLimitMeterSpec,
    type SectionHeadingRefusal,
  } from "$lib/components/editor/reportSectionHeadings";
  import { overflowStartOffset } from "../../../../convex/lib/lineLimits";
  import {
    reportSectionKeyForHeading,
    reportSectionMetrics,
    type ReportSectionKey,
    type ReportSectionMetricMap,
  } from "$lib/reportSections";
  import {
    buildSearchIndex,
    extractMatchedText,
    findAllOccurrencesCI,
    findOccurrencesBatch,
    normalizeForMatch,
    type Range,
  } from "./docSearch";

  const REPORT_SECTION_DEFINITIONS = [
    { key: "s242", line: "242" },
    { key: "s244", line: "244" },
    { key: "s246", line: "246" },
  ] as const;

  type LimitState = "ok" | "warning" | "over";

  function limitState(
    metric: ReportSectionMetricMap[ReportSectionKey]
  ): LimitState {
    if (metric.overLimit) return "over";
    if (
      metric.lines >= Math.floor(metric.limit * 0.95) ||
      metric.words >= Math.floor(metric.wordCap * 0.95)
    ) {
      return "warning";
    }
    return "ok";
  }

  /** Per-metric fill state so each bar reports its own limit, not the card's. */
  function meterState(value: number, cap: number): LimitState {
    if (value > cap) return "over";
    if (value >= Math.floor(cap * 0.95)) return "warning";
    return "ok";
  }

  function limitWarning(
    line: string,
    metric: ReportSectionMetricMap[ReportSectionKey]
  ): string {
    const lineOverage = Math.max(0, metric.lines - metric.limit);
    const wordOverage = Math.max(0, metric.words - metric.wordCap);
    if (lineOverage > 0 && wordOverage > 0) {
      return `Line ${line} is ${lineOverage} form lines and ${wordOverage} words over the CRA limits.`;
    }
    if (lineOverage > 0) {
      return `Line ${line} is ${lineOverage} form line${lineOverage === 1 ? "" : "s"} over the CRA limit.`;
    }
    if (wordOverage > 0) {
      return `Line ${line} is ${wordOverage} word${wordOverage === 1 ? "" : "s"} over the CRA limit.`;
    }
    return `Line ${line} is within 5% of a CRA limit.`;
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

    const { hay, posMap } = buildSearchIndex(doc);
    const normFull = hay;

    const rangeAt = (idx: number, len: number): Range | null => {
      const fromPos = posMap[idx];
      const toPos = posMap[idx + len - 1];
      if (fromPos === undefined || toPos === undefined) return null;
      let actual = needle;
      try {
        actual = extractMatchedText(doc, fromPos, toPos + 1);
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

    // 2) Leading fragment — a slightly-off tail on a long quote (the report
    // was edited after the AI quoted it). Anchor on the first 60 chars, then
    // extend the highlight across the shared prefix so the whole still-
    // matching passage lights up, not just the opening words.
    if (search.length >= 24) {
      const frag = search.slice(0, Math.min(60, search.length));
      const fi = normFull.indexOf(frag);
      if (fi !== -1) {
        let len = frag.length;
        while (
          len < search.length &&
          fi + len < normFull.length &&
          normFull[fi + len] === search[len]
        ) {
          len++;
        }
        const r = rangeAt(fi, len);
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
          actual = extractMatchedText(doc, best.from, best.to);
        } catch {
          /* keep textContent */
        }
        return [{ from: best.from, to: best.to, text: actual }];
      }
    }

    return [];
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

  /**
   * How the CRA limits show in the document. Classic: an end-of-section
   * marker for every Section plus overflow tinting, both behind the limits
   * toggle. Reading (ui-design-final.md section 8): a meter in the Section
   * heading only when the Section is near or over a limit; overflow tinting
   * still follows the toggle.
   */
  type LimitDecorationOptions = {
    metrics: ReportSectionMetricMap;
    endMarkers: boolean;
    overflow: boolean;
    headingMeters: boolean;
  };

  function limitMeterText(metric: ReportSectionMetricMap[ReportSectionKey]): string {
    const gapLineSuffix =
      metric.rawLines !== metric.lines ? ` (+${metric.rawLines - metric.lines} with gaps)` : "";
    return `${metric.lines} / ${metric.limit} lines${gapLineSuffix}, ${metric.words} / ${metric.wordCap} words`;
  }

  function buildSectionLimitDecorations(
    doc: PMNode,
    { metrics, endMarkers, overflow, headingMeters }: LimitDecorationOptions
  ): Decoration[] {
    type OverflowSpan = { from: number; to: number; text: string; start: number };
    type SectionSource = { text: string; spans: OverflowSpan[] };
    const endPositions: Partial<Record<ReportSectionKey, number>> = {};
    const headingRanges: Partial<Record<ReportSectionKey, { from: number; to: number }>> = {};
    const sectionSources: Partial<Record<ReportSectionKey, SectionSource>> = {};
    let currentSection: ReportSectionKey | null = null;
    let reachedQaTail = false;

    doc.forEach((node, offset) => {
      if (reachedQaTail) return;
      const heading = reportSectionKeyForHeading(node.toJSON());
      if (heading) {
        currentSection = heading;
        headingRanges[heading] = { from: offset, to: offset + node.nodeSize };
        endPositions[heading] = offset + node.nodeSize;
        sectionSources[heading] = { text: "", spans: [] };
        return;
      }
      if (
        currentSection === "s246" &&
        node.type.name === "heading" &&
        /^qa scorecard$/i.test(node.textContent.trim())
      ) {
        reachedQaTail = true;
        currentSection = null;
        return;
      }
      if (currentSection && node.type.name !== "horizontalRule") {
        endPositions[currentSection] = offset + node.nodeSize;
      }
      if (
        !currentSection ||
        node.type.name === "heading" ||
        node.type.name === "horizontalRule" ||
        node.type.name !== "paragraph"
      ) {
        return;
      }

      const section = currentSection;
      const source = sectionSources[section];
      if (!source) return;
      const units: Array<{ text: string; from?: number; to?: number }> = [];
      node.descendants((child, childOffset) => {
        if (child.isText && child.text) {
          units.push({
            text: child.text,
            from: offset + 1 + childOffset,
            to: offset + 1 + childOffset + child.text.length,
          });
        } else if (child.type.name === "hardBreak") {
          units.push({ text: "\n" });
        }
      });

      const rawText = units.map(({ text }) => text).join("");
      const leading = rawText.match(/^[^\S\n]+/)?.[0].length ?? 0;
      const trailing = rawText.match(/[^\S\n]+$/)?.[0].length ?? 0;
      const contentEnd = rawText.length - trailing;
      if (leading >= contentEnd) return;

      if (source.text) source.text += "\n\n";
      const paragraphStart = source.text.length;
      source.text += rawText.slice(leading, contentEnd);
      let rawOffset = 0;
      for (const unit of units) {
        const unitStart = rawOffset;
        const unitEnd = rawOffset + unit.text.length;
        const overlapStart = Math.max(unitStart, leading);
        const overlapEnd = Math.min(unitEnd, contentEnd);
        if (
          unit.from !== undefined &&
          unit.to !== undefined &&
          overlapStart < overlapEnd
        ) {
          source.spans.push({
            from: unit.from + overlapStart - unitStart,
            to: unit.to - (unitEnd - overlapEnd),
            text: unit.text.slice(overlapStart - unitStart, overlapEnd - unitStart),
            start: paragraphStart + overlapStart - leading,
          });
        }
        rawOffset = unitEnd;
      }
    });

    const markers: Decoration[] = [];
    for (const { key, line } of REPORT_SECTION_DEFINITIONS) {
      const position = endPositions[key];
      if (position === undefined) continue;
      const metric = metrics[key];
      const state = limitState(metric);
      const headingRange = headingRanges[key];
      if (headingMeters && headingRange && state !== "ok") {
        const spec: ReportLimitMeterSpec = {
          reportLimitMeter: {
            state,
            text: limitMeterText(metric),
            description: limitWarning(line, metric),
            percent: Math.max(metric.lines / metric.limit, metric.words / metric.wordCap) * 100,
          },
        };
        markers.push(Decoration.node(headingRange.from, headingRange.to, {}, spec));
      }
      if (overflow && state === "over") {
        const source = sectionSources[key];
        const overflowAt = source ? overflowStartOffset(source.text, key) : null;
        if (source && overflowAt !== null) {
          for (const span of source.spans) {
            const spanEnd = span.start + span.text.length;
            if (overflowAt < spanEnd) {
              markers.push(
                Decoration.inline(
                  span.from + Math.max(0, overflowAt - span.start),
                  span.to,
                  { class: "cra-limit-overflow" }
                )
              );
            }
          }
        }
      }
      if (!endMarkers) continue;
      markers.push(
        Decoration.widget(
          Math.min(position, doc.content.size),
          () => {
            const marker = document.createElement("div");
            marker.className = `cra-section-end cra-section-end--${state}`;
            marker.contentEditable = "false";
            marker.dataset.sectionLimitMarker = line;

            const chip = document.createElement("span");
            chip.className = "cra-section-end__chip";

            const label = document.createElement("span");
            label.className = "cra-section-end__label";
            label.textContent = `End of Line ${line}`;

            const count = document.createElement("span");
            count.className = "cra-section-end__count";
            // [GAP: …] text is excluded from the CRA counts; surface the
            // with-gaps figure so writers know what resolving gaps costs.
            count.textContent = limitMeterText(metric);

            chip.append(label, count);
            if (state !== "ok") {
              const warning = document.createElement("span");
              warning.className = "cra-section-end__warning";
              warning.textContent = state === "over" ? "Over limit" : "Near limit";
              chip.append(warning);
            }
            marker.append(chip);
            return marker;
          },
          { key: `cra-section-end-${key}`, side: 1 }
        )
      );
    }
    return markers;
  }

  function buildDecorationSet(
    doc: PMNode,
    ranges: CommentRange[],
    aiRanges: Range[] = [],
    limitOptions?: LimitDecorationOptions,
    diffs: DiffPreview[] = []
  ) {
    const decorations: Decoration[] = [];
    const docSize = doc.content.size;

    // Live proposal preview: strike the text being replaced and show the
    // proposed text inline after it (green), directly in the document.
    const previewMatches = diffs.length
      ? findOccurrencesBatch(doc, diffs.map((d) => d.find))
      : [];
    diffs.forEach((d, i) => {
      for (const m of previewMatches[i]) {
        decorations.push(
          Decoration.inline(m.from, m.to, { class: "proposal-removed" })
        );
        if (d.replaceWith.trim()) {
          const insert = d.replaceWith;
          // Multi-paragraph replacements render as real paragraphs below the
          // struck text (one <p> per blank-line-separated block, mirroring
          // the editor's own paragraph rhythm); short swaps stay inline.
          const block = /\n/.test(insert) || insert.length > 160;
          decorations.push(
            Decoration.widget(
              m.to,
              () => {
                if (!block) {
                  const el = document.createElement("span");
                  el.className = "proposal-added";
                  el.textContent = insert;
                  return el;
                }
                const wrap = document.createElement("div");
                wrap.className = "proposal-added-paragraphs";
                for (const para of insert.split(/\n{2,}/)) {
                  if (!para.trim()) continue;
                  const p = document.createElement("p");
                  p.className = "proposal-added";
                  p.textContent = para.trim();
                  wrap.appendChild(p);
                }
                return wrap;
              },
              { side: 1 }
            )
          );
        }
      }
    });

    // BNH-25: AI-referenced passages — re-resolve by text so they survive drift.
    for (const r of aiRanges) {
      let from = Math.max(1, Math.min(r.from, docSize));
      let to = Math.max(from, Math.min(r.to, docSize));
      let ok = false;
      try {
        ok = extractMatchedText(doc, from, to) === r.text;
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
    if (limitOptions) {
      decorations.push(...buildSectionLimitDecorations(doc, limitOptions));
    }
    // A Section a stopped Step-by-step draft left empty keeps one
    // "[NOT GENERATED]" paragraph; mark it "Not drafted" where it sits.
    doc.forEach((node, offset) => {
      if (node.type.name === "paragraph" && node.textContent.trim() === NOT_GENERATED_PLACEHOLDER) {
        decorations.push(
          Decoration.node(offset, offset + node.nodeSize, {
            class: "not-drafted-placeholder",
            "data-not-drafted": "true",
          })
        );
      }
    });
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
  import { onDestroy, onMount } from "svelte";
  import { createEditor, EditorContent, type Editor } from "svelte-tiptap";
  import type { Editor as CoreEditor } from "@tiptap/core";
  import { getEditorExtensions } from "$lib/tiptapConfig";
  import EditorToolbar from "$lib/components/editor/EditorToolbar.svelte";
  import SlashCommandMenu from "$lib/components/editor/SlashCommandMenu.svelte";
  import BlockHandle from "$lib/components/editor/BlockHandle.svelte";
  import type { ResearchSelection } from "$lib/components/editor/types";

  let {
    content,
    onUpdate,
    onComment,
    onAskAI,
    onResearch,
    editable = true,
    readOnly = false,
    commentRanges = [],
    onHoverComment,
    presentation = "classic",
  }: {
    content: string;
    onUpdate?: (json: string) => void | Promise<void>;
    onComment?: (selection: {
      from: number;
      to: number;
      text: string;
      x?: number;
      y?: number;
    }) => void;
    onAskAI?: (selection: { from: number; to: number; text: string }) => void;
    onResearch?: (selection: ResearchSelection) => void;
    editable?: boolean;
    readOnly?: boolean;
    commentRanges?: CommentRange[];
    onHoverComment?: (commentId: string | null) => void;
    /**
     * Fixed at mount. "reading" is the report page of ui-design-final.md
     * section 8 (board 2.1): serif body, Section headings as label plus CRA
     * question, and a limit meter in the heading only near a limit. "classic"
     * keeps the earlier look for the rollback report page.
     */
    presentation?: "classic" | "reading";
  } = $props();
  // svelte-ignore state_referenced_locally -- fixed at mount, like `editable`
  const reading = presentation === "reading";

  // A short, polite note when an edit is refused because it would change a
  // hidden Section heading (review g1): otherwise the key press does nothing.
  let headingNotice = $state<SectionHeadingRefusal | null>(null);
  let headingNoticeTimer: ReturnType<typeof setTimeout> | undefined;
  function showHeadingNotice(reason: SectionHeadingRefusal) {
    headingNotice = reason;
    clearTimeout(headingNoticeTimer);
    headingNoticeTimer = setTimeout(() => (headingNotice = null), 4000);
  }
  onDestroy(() => clearTimeout(headingNoticeTimer));

  let editor = $state<Editor>();
  let slashMenu = $state<{
    isOpen: boolean;
    position: { top: number; left: number };
  }>({ isOpen: false, position: { top: 0, left: 0 } });
  let aiHighlights = $state<Range[]>([]);
  /** Live "Show changes" preview: find → strikethrough, replaceWith → inline green widget. */
  type DiffPreview = { find: string; replaceWith: string };
  let previewDiffs = $state<DiffPreview[]>([]);

  // BNH-37: canonical Schedule 60 metrics. Recompute only when the ProseMirror
  // document identity changes; selection-only transactions reuse the result.
  let sectionLimitMetrics = $state<ReportSectionMetricMap>(reportSectionMetrics(""));
  let limitOverlayVisible = $state(true);
  let lineCount = $state(0);
  let wordCount = $state(0);
  let charCount = $state(0);
  let measuredDoc: PMNode | undefined;
  let currentDocumentJson = "";

  let saveTimeout: ReturnType<typeof setTimeout> | undefined;
  let pendingSaveChain: Promise<void> = Promise.resolve();
  let lastQueuedContent: string | null = null;
  // Apply external content changes (AI replace, restore, regenerate). Echoes
  // of our own recent autosaves are skipped; anything else is applied, so
  // restores and replaces always reflect even right after an edit.
  let lastContent = "";
  // Saves this editor has queued or has in flight (a document can appear more
  // than once), plus the newest save the server acknowledged. Only these can
  // come back from the subscription as echoes of this editor's own writes.
  // Anything else, including an older saved version being restored, is
  // external content and replaces the document.
  let outstandingSaves: string[] = [];
  let lastAcknowledgedSave: string | null = null;

  function settleOutstanding(json: string, acknowledged: boolean) {
    const index = outstandingSaves.indexOf(json);
    if (index >= 0) outstandingSaves = [...outstandingSaves.slice(0, index), ...outstandingSaves.slice(index + 1)];
    if (acknowledged) lastAcknowledgedSave = json;
  }

  function refreshDocumentMetrics(ed: Editor | CoreEditor): string {
    if (measuredDoc === ed.state.doc) return currentDocumentJson;
    measuredDoc = ed.state.doc;
    currentDocumentJson = JSON.stringify(ed.getJSON());
    sectionLimitMetrics = reportSectionMetrics(currentDocumentJson);
    lineCount = REPORT_SECTION_DEFINITIONS.reduce(
      (total, { key }) => total + sectionLimitMetrics[key].lines,
      0
    );
    wordCount = REPORT_SECTION_DEFINITIONS.reduce(
      (total, { key }) => total + sectionLimitMetrics[key].words,
      0
    );
    charCount = (
      ed.storage as unknown as { characterCount: { characters: () => number } }
    ).characterCount.characters();
    return currentDocumentJson;
  }

  // Bumped whenever external content replaces the document. A save queued
  // behind an in-flight one holds the document from before that replacement,
  // so it is dropped rather than written over the newer server content.
  let contentEpoch = 0;

  function enqueueSave(json: string): Promise<void> {
    if (!onUpdate || json === lastQueuedContent) return pendingSaveChain;
    const update = onUpdate;
    const epoch = contentEpoch;
    lastQueuedContent = json;
    outstandingSaves = [...outstandingSaves, json];
    // A save from before an external replacement never touches the tracking:
    // the replacement already cleared it, and settling late would either mark
    // a replaced document as ours or remove a newer save's entry.
    const save = pendingSaveChain.then(async () => {
      if (epoch !== contentEpoch) return;
      try {
        await update(json);
        if (epoch === contentEpoch) settleOutstanding(json, true);
      } catch (error) {
        if (epoch === contentEpoch) settleOutstanding(json, false);
        throw error;
      }
    });
    pendingSaveChain = save.catch(() => {});
    return save;
  }

  function scheduleSave(json: string) {
    if (!onUpdate) return;
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      saveTimeout = undefined;
      void enqueueSave(json).catch(() => {});
    }, 1000);
  }

  onMount(() => {
    lastContent = content;
    const editorStore = createEditor({
      extensions: getEditorExtensions({
        editable,
        sectionHeadings: reading,
        onSectionHeadingRefused: showHeadingNotice,
      }),
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

        scheduleSave(refreshDocumentMetrics(ed));
      },
    });
    // Keep the store's editor alive for the component lifetime. The document
    // identity guard avoids re-parsing metrics on selection-only transactions.
    const unsubscribe = editorStore.subscribe((e) => {
      editor = e;
      refreshDocumentMetrics(e);
    });
    return () => {
      if (saveTimeout) clearTimeout(saveTimeout);
      saveTimeout = undefined;
      unsubscribe();
    };
  });

  // Editing is live only when the editor was mounted editable and is not
  // held read-only. The toggle emits no update, so it never schedules a save.
  const canEdit = $derived(editable && !readOnly);
  $effect(() => {
    const ed = editor;
    const next = canEdit;
    if (!ed || ed.isEditable === next) return;
    ed.setEditable(next, false);
  });

  // Apply external content changes (see lastContent/outstandingSaves above).
  $effect(() => {
    const c = content;
    const ed = editor;
    if (!ed) return;
    if (c !== lastContent) {
      lastContent = c;
      // Skip re-applying the round-trip echo of our own save.
      if (outstandingSaves.includes(c) || c === lastAcknowledgedSave) return;
      const parsed = parseContent(c);
      if (parsed) {
        // The server content wins: an autosave still waiting on its debounce,
        // or queued behind an in-flight save, would write the replaced
        // document back over it (for example a redraft of Not drafted
        // Sections, a restore or an applied proposal).
        if (saveTimeout) clearTimeout(saveTimeout);
        saveTimeout = undefined;
        contentEpoch += 1;
        lastQueuedContent = null;
        // Saves from before the replacement can no longer echo as ours: a
        // later restore to one of those documents must be shown.
        outstandingSaves = [];
        lastAcknowledgedSave = null;
        // The server's copy may replace the Section headings; the reading
        // presentation otherwise refuses any change to them.
        ed.chain().setMeta(SECTION_HEADINGS_EXTERNAL, true).setContent(parsed, { emitUpdate: false }).run();
        refreshDocumentMetrics(ed);
      }
    }
  });

  // Update comment, AI-reference, and optional section-limit decorations.
  // Cache by immutable doc identity so cursor movement does not rebuild them.
  $effect(() => {
    const ed = editor;
    if (!ed) return;
    const ranges = commentRanges;
    const ai = aiHighlights;
    // Reading: heading meters always (they only show near a limit); the
    // toggle keeps owning the overflow tint. Classic: everything behind it.
    const metrics: LimitDecorationOptions | undefined = reading
      ? {
          metrics: sectionLimitMetrics,
          endMarkers: false,
          overflow: limitOverlayVisible,
          headingMeters: true,
        }
      : limitOverlayVisible
        ? { metrics: sectionLimitMetrics, endMarkers: true, overflow: true, headingMeters: false }
        : undefined;
    const diffs = previewDiffs;
    let decoratedDoc: PMNode | null = null;
    let decorations: DecorationSet | null = null;
    ed.view.setProps({
      decorations: (state) => {
        if (state.doc !== decoratedDoc || !decorations) {
          decoratedDoc = state.doc;
          decorations = buildDecorationSet(state.doc, ranges, ai, metrics, diffs);
        }
        return decorations;
      },
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

  function handleResearch() {
    if (!editor || !onResearch) return;
    const { from, to } = editor.state.selection;
    if (from === to) return;
    const text = editor.state.doc.textBetween(from, to, "\n").trim();
    if (!text) return;
    const contextRadius = 1_500;
    const before = editor.state.doc
      .textBetween(Math.max(0, from - contextRadius), from, "\n")
      .trim();
    const after = editor.state.doc
      .textBetween(to, Math.min(editor.state.doc.content.size, to + contextRadius), "\n")
      .trim();
    onResearch({
      from,
      to,
      text,
      context: [
        before ? `Before selection:\n${before}` : "",
        after ? `After selection:\n${after}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    });
  }

  /**
   * Persist the exact document currently visible in the editor, bypassing the
   * debounce and waiting for every previously queued save to finish.
   */
  export async function flushPendingSave(): Promise<void> {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = undefined;
    if (!editor || !onUpdate) {
      await pendingSaveChain;
      return;
    }
    await enqueueSave(refreshDocumentMetrics(editor));
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

  /** Locate a section's paragraph using the same non-empty Tiptap paragraph
   * nodes produced from the QA agent's blank-line-separated input. A null
   * paragraph targets the section's first paragraph without claiming precision. */
  export function locateSectionParagraph(section: string, paragraph: number | null) {
    if (!editor) return;
    const doc = editor.state.doc;
    const paras: Range[] = [];
    let inSection = false;
    doc.forEach((node, offset) => {
      if (node.type.name === "heading") {
        inSection = node.textContent.includes(section);
        return;
      }
      if (!inSection || node.type.name !== "paragraph" || !node.textContent.trim()) return;
      const from = offset + 1;
      const to = from + node.content.size;
      paras.push({ from, to, text: extractMatchedText(doc, from, to) });
    });
    if (paras.length === 0) return;
    const index = paragraph === null ? 0 : Math.min(Math.max(paragraph, 1), paras.length) - 1;
    const target = paras[index];
    aiHighlights = [target];
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
    const doc = editor.state.doc;
    const found = findOccurrencesBatch(doc, pairs.map((p) => p.find));
    pairs.forEach((p, i) => {
      for (const r of found[i]) {
        // Section headings are load-bearing and the title is hidden: neither
        // is ever edited by a proposal (review g1), so their text is no match.
        if (rangeTouchesHiddenHeading(doc, r.from, r.to)) continue;
        out.push({
          from: r.from,
          to: r.to,
          replaceWith: smartCaseReplace(r.text, p.replaceWith),
          text: r.text,
        });
      }
    });
    return out.sort((a, b) => a.from - b.from);
  }

  /** Replace one range; false when nothing changed (for example a refused edit). */
  export function replaceRange(from: number, to: number, newText: string): boolean {
    if (!editor) return false;
    const before = editor.state.doc;
    editor.chain().insertContentAt({ from, to }, newText).run();
    return !editor.state.doc.eq(before);
  }

  export function highlightRange(from: number, to: number, text: string) {
    if (!editor) return;
    aiHighlights = [{ from, to, text }];
    scrollContainerToPos(from, 120);
  }

  /** Live "Show changes": render a proposal as strikethrough + inline green
   * insertions in the document itself; scrolls to the first affected match.
   * Pass [] to clear. */
  export function previewProposal(pairs: { find: string; replaceWith: string }[]) {
    if (!editor) return;
    previewDiffs = pairs.filter((p) => p.find.trim());
    if (previewDiffs.length === 0) return;
    const first = findAllOccurrencesCI(editor.state.doc, previewDiffs[0].find)[0];
    if (first) scrollContainerToPos(first.from, 120);
  }

  export function clearProposalPreview() {
    // Re-anchor on the change site before the widgets unmount, so untoggling
    // returns the writer to the same passage instead of leaving the viewport
    // wherever the (now shorter) document happens to land.
    const anchor = previewDiffs[0]?.find;
    previewDiffs = [];
    if (editor && anchor) {
      // Two frames: decorations unmount on the next render; measure after.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (!editor) return;
          const first = findAllOccurrencesCI(editor.state.doc, anchor)[0];
          if (first) scrollContainerToPos(first.from, 120);
        })
      );
    }
  }
</script>

{#if editor}
  <div class={`group/editor relative ${reading ? "report-reading" : ""}`} data-editor-presentation={presentation}>
    <!-- Block handles -->
    {#if canEdit}
      <BlockHandle {editor} compact={reading} />
    {/if}

    <!-- Floating toolbar on text selection -->
    {#if canEdit}
      <EditorToolbar
        {editor}
        onComment={handleComment}
        onAskAI={onAskAI ? handleAskAI : undefined}
        onResearch={onResearch ? handleResearch : undefined}
      />
    {/if}

    <!-- Comment-only bubble for read-only mode -->
    {#if !canEdit && onComment}
      <EditorToolbar {editor} onComment={handleComment} commentOnly />
    {/if}

    <!-- Slash command menu -->
    {#if canEdit}
      <SlashCommandMenu
        {editor}
        isOpen={slashMenu.isOpen}
        onClose={() => (slashMenu.isOpen = false)}
        position={slashMenu.position}
      />
    {/if}

    <!-- The editor itself -->
    <EditorContent {editor} />

    {#if reading && canEdit}
      <p class="report-editor-hint" data-report-editor-hint>Type / for commands, or select text to ask the assistant</p>
    {/if}
    {#if reading}
      <!-- Always mounted, so the live region announces its message. -->
      <div class="pointer-events-none fixed inset-x-0 bottom-6 z-[85] flex justify-center px-4" role="status" aria-live="polite" data-heading-notice>
        {#if headingNotice}
          <p class="rounded-lg bg-navy px-4 py-2 font-sans text-[13px] leading-5 text-white shadow-popover">
            {headingNotice === "paste"
              ? "Section headings were left out of the paste."
              : "Section headings stay as they are. Edit the text under them."}
          </p>
        {/if}
      </div>
    {/if}

    {#if editable}
      <div class="mt-4 border-t border-line-soft pt-2.5 font-sans">
        <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <button
            type="button"
            aria-controls="editor-cra-limits"
            aria-expanded={limitOverlayVisible}
            aria-pressed={limitOverlayVisible}
            onclick={() => (limitOverlayVisible = !limitOverlayVisible)}
            class={`inline-flex min-h-8 items-center gap-1.5 rounded-md px-1.5 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none ${
              limitOverlayVisible
                ? "text-primary-dark hover:text-primary-selected"
                : "text-ink-muted hover:text-ink"
            }`}
          >
            <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 4v4m6 2v4m-8 2v4" />
            </svg>
            {limitOverlayVisible ? "Hide CRA limits" : "Show CRA limits"}
          </button>
          <span class="flex flex-wrap items-center gap-x-3 text-[11px] text-ink-muted">
            <span class="whitespace-nowrap"><strong class="font-medium text-ink-secondary">{lineCount}</strong> form lines</span>
            <span class="whitespace-nowrap"><strong class="font-medium text-ink-secondary">{wordCount}</strong> words</span>
            <span class="whitespace-nowrap"><strong class="font-medium text-ink-secondary">{charCount}</strong> characters</span>
          </span>
        </div>

        {#if limitOverlayVisible}
          <div id="editor-cra-limits" class="mt-2.5 space-y-1.5" aria-live="polite">
            {#each REPORT_SECTION_DEFINITIONS as { key, line } (key)}
              {@const metric = sectionLimitMetrics[key]}
              {@const lines = meterState(metric.lines, metric.limit)}
              {@const words = meterState(metric.words, metric.wordCap)}
              <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <span class="w-7 flex-none text-[11px] font-medium tabular-nums text-gray-700">{line}</span>
                {#each [
                  { label: "lines", value: metric.lines, cap: metric.limit, s: lines, raw: metric.rawLines },
                  { label: "words", value: metric.words, cap: metric.wordCap, s: words, raw: metric.rawWords },
                ] as m (m.label)}
                  <div class="flex min-w-0 flex-1 basis-36 items-center gap-2 not-last:mr-4">
                    <div class="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-gray-200">
                      <div
                        class={`h-full rounded-full transition-[width] duration-300 ${m.s === "over" ? "bg-red-500" : m.s === "warning" ? "bg-amber-500" : "bg-primary"}`}
                        style={`width: ${Math.min(100, (m.value / m.cap) * 100)}%`}
                      ></div>
                    </div>
                    <span class={`flex-none whitespace-nowrap text-[11px] tabular-nums ${m.s === "over" ? "font-medium text-red-700" : m.s === "warning" ? "font-medium text-amber-600" : "text-ink-muted"}`}>
                      {m.value} / {m.cap} {m.label}{m.raw !== m.value ? ` (+${m.raw - m.value} with gaps)` : ""}
                    </span>
                  </div>
                {/each}
              </div>
            {/each}

            <!-- Full sentences stay for screen readers; the cards carry the visual state -->
            {#each REPORT_SECTION_DEFINITIONS as { key, line } (key)}
              {@const metric = sectionLimitMetrics[key]}
              {@const state = limitState(metric)}
              {#if state !== "ok"}
                <p class="sr-only" role={state === "over" ? "alert" : "status"}>
                  {limitWarning(line, metric)}
                </p>
              {/if}
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  /* End-of-section marker: a centered divider caption — reads as "the form
     field ends here", with the counts as quiet metadata inside the chip. */
  :global(.cra-section-end) {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin: 1rem 0 1.5rem;
    font-family: var(--font-sans);
    /* em: tracks the fluid .tiptap-editor body size (14px cap). */
    font-size: 0.78em;
    line-height: 1;
    pointer-events: none;
    user-select: none;
  }

  /* The marker already draws its own divider line; a document <hr>
     immediately after it read as a doubled rule. */
  :global(.cra-section-end + hr) {
    display: none;
  }

  :global(.cra-section-end)::before,
  :global(.cra-section-end)::after {
    content: "";
    height: 1px;
    flex: 1;
    background: var(--color-line);
  }

  :global(.cra-section-end__chip) {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.3125rem 0.625rem;
    border: 1px solid var(--color-line);
    border-radius: 9999px;
    background: var(--color-gray-50);
    color: var(--color-ink-muted);
    white-space: nowrap;
  }

  :global(.cra-section-end__label) {
    color: var(--color-ink-secondary);
    font-weight: 500;
  }

  :global(.cra-section-end__count) {
    font-variant-numeric: tabular-nums;
  }

  :global(.cra-section-end__warning) {
    font-weight: 500;
  }

  :global(.cra-section-end--warning .cra-section-end__chip) {
    border-color: #FDE68A;
    background: var(--color-gap-bg);
    color: var(--color-gap-text);
  }
  :global(.cra-section-end--warning .cra-section-end__label) {
    color: var(--color-gap-text);
  }
  :global(.cra-section-end--warning)::before,
  :global(.cra-section-end--warning)::after {
    background: #FDE68A;
  }

  :global(.cra-section-end--over .cra-section-end__chip) {
    border-color: #fecaca;
    background: var(--color-red-50);
    color: #b91c1c;
  }
  :global(.cra-section-end--over .cra-section-end__label) {
    color: #b91c1c;
  }
  :global(.cra-section-end--over)::before,
  :global(.cra-section-end--over)::after {
    background: #fecaca;
  }
</style>
