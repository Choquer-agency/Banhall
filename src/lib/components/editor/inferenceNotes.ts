/**
 * 2026-10-29 (owner, "We can include the ... inference marker"): each
 * `[INFERRED: what it rests on]` marker in the report shows as a highlighted
 * chip, apart from the amber gap highlight, read by assistive technology as
 * "Inferred, check this: <reason>". The writer accepts an inference by
 * deleting the marker (keeping or editing the sentence before it), or
 * removes the sentence.
 *
 * Rendering only: the marker stays plain text in the document, so autosave,
 * export, the CRA counts and the Assistant read it as written. A decoration
 * rather than a stored mark, so a marker the writer types, or one an
 * accepted Assistant card brings, shows the same way.
 *
 * Review round 1: Backspace or Delete at the chip, or inside it, removes the
 * whole marker in one step (P2-5), so a half-deleted "[INFERRED: ..." is not
 * left behind as report text; and a visually hidden "Inferred, check this:"
 * prefix, a non-editable widget, names the chip for screen readers, since
 * an aria-label on an inline mark in an editable area is not read reliably
 * (P3-9).
 */
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { findReportNotes } from "../../../../convex/lib/lineLimits";
import { reportSectionKeyForHeading, type ReportNote, type TiptapNode } from "$lib/reportSections";

/** The chip's class (styled in src/routes/layout.css). */
export const INFERRED_NOTE_CLASS = "report-inferred";

/**
 * The words a screen reader hears before the marker, so the chip reads
 * "Inferred, check this: [INFERRED: <reason>]".
 */
export const INFERRED_NOTE_PREFIX = "Inferred, check this:";

type Range = { from: number; to: number };

/**
 * A text block's text with each character's document position. An inline
 * leaf (a hard break) reads as a line break, as export reads it.
 */
function blockText(node: PMNode, pos: number): { text: string; positions: number[] } {
  let text = "";
  const positions: number[] = [];
  node.forEach((child, offset) => {
    const start = pos + 1 + offset;
    if (child.isText && child.text) {
      for (let index = 0; index < child.text.length; index += 1) positions.push(start + index);
      text += child.text;
    } else {
      positions.push(start);
      text += "\n";
    }
  });
  return { text, positions };
}

/** Each text block of `doc` in document order, with its text and positions. */
function textBlocks(doc: PMNode): Array<{ text: string; positions: number[]; top: number }> {
  const blocks: Array<{ text: string; positions: number[]; top: number }> = [];
  doc.forEach((top, offset, index) => {
    if (top.isTextblock) {
      blocks.push({ ...blockText(top, offset), top: index });
      return;
    }
    top.descendants((node, inner) => {
      if (!node.isTextblock) return true;
      blocks.push({ ...blockText(node, offset + 1 + inner), top: index });
      return false;
    });
  });
  return blocks;
}

/** Every [INFERRED: ...] marker in `doc`, with its range and what it says. */
export function inferredNoteRanges(doc: PMNode): Array<Range & { note: string }> {
  return textBlocks(doc).flatMap(({ text, positions }) =>
    findReportNotes(text)
      .filter((match) => match.kind === "inferred")
      .map((match) => ({
        from: positions[match.index],
        to: positions[match.index + match.text.length - 1] + 1,
        note: match.note,
      }))
  );
}

/**
 * Review round 1 (P2-4): the range of one listed note, the
 * `occurrence`-th marker with exactly its text inside its own Line, so two
 * notes with the same words each jump to their own place. Null when the
 * report no longer holds it there.
 */
export function reportNoteRange(doc: PMNode, note: Pick<ReportNote, "section" | "text" | "occurrence">): Range | null {
  // The Line each top-level node belongs to, from the Section headings.
  const lineOf: Array<ReportNote["section"] | null> = [];
  let line: ReportNote["section"] | null = null;
  doc.forEach((top) => {
    const key = top.type.name === "heading" ? reportSectionKeyForHeading(top.toJSON() as TiptapNode) : null;
    if (key) line = key;
    lineOf.push(key ? null : line);
  });
  let seen = 0;
  for (const { text, positions, top } of textBlocks(doc)) {
    if (lineOf[top] !== note.section) continue;
    for (const match of findReportNotes(text)) {
      if (match.text !== note.text) continue;
      if (seen === note.occurrence) {
        return { from: positions[match.index], to: positions[match.index + match.text.length - 1] + 1 };
      }
      seen += 1;
    }
  }
  return null;
}

/** The chip and its hidden prefix for each [INFERRED: ...] marker of `doc`. */
export function inferredNoteDecorations(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];
  for (const { from, to, note } of inferredNoteRanges(doc)) {
    decorations.push(
      Decoration.widget(
        from,
        () => {
          const prefix = document.createElement("span");
          prefix.className = "sr-only";
          prefix.dataset.inferredNotePrefix = "";
          prefix.textContent = `${INFERRED_NOTE_PREFIX} `;
          return prefix;
        },
        { side: -1, ignoreSelection: true, key: `inferred-prefix-${from}` }
      ),
      Decoration.inline(from, to, {
        nodeName: "mark",
        class: INFERRED_NOTE_CLASS,
        "data-inferred-note": note,
      })
    );
  }
  return DecorationSet.create(doc, decorations);
}

/**
 * The marker a key would delete into: for Backspace, one whose inside or end
 * the empty cursor is at; for Delete, one whose start or inside it is at.
 * The space before the marker goes with it, so no doubled space is left.
 */
function markerToRemove(state: EditorState, key: "Backspace" | "Delete"): Range | null {
  const { selection } = state;
  if (!selection.empty) return null;
  const at = selection.from;
  for (const range of inferredNoteRanges(state.doc)) {
    const touches = key === "Backspace" ? at > range.from && at <= range.to : at >= range.from && at < range.to;
    if (!touches) continue;
    const before = range.from > 0 ? state.doc.textBetween(range.from - 1, range.from) : "";
    return { from: before === " " ? range.from - 1 : range.from, to: range.to };
  }
  return null;
}

const inferenceNotesKey = new PluginKey<DecorationSet>("reportInferenceNotes");

/** The chips for the report editor and the client review view. */
export const ReportInferenceNotes = Extension.create({
  name: "reportInferenceNotes",
  // Before the default Backspace and Delete handling.
  priority: 1000,

  addKeyboardShortcuts() {
    const accept = (key: "Backspace" | "Delete") => () => {
      if (!this.editor.isEditable) return false;
      const range = markerToRemove(this.editor.state, key);
      if (!range) return false;
      return this.editor.commands.deleteRange(range);
    };
    return { Backspace: accept("Backspace"), Delete: accept("Delete") };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: inferenceNotesKey,
        state: {
          init: (_config, state) => inferredNoteDecorations(state.doc),
          // Rebuilt only when the document changes; a selection move reuses it.
          apply: (tr, previous) => (tr.docChanged ? inferredNoteDecorations(tr.doc) : previous),
        },
        props: {
          decorations(state) {
            return inferenceNotesKey.getState(state);
          },
        },
      }),
    ];
  },
});
