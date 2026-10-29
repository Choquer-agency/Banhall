/**
 * 2026-10-29 (owner, "We can include the ... inference marker"): each
 * `[INFERRED: what it rests on]` marker in the report shows as a highlighted
 * chip, apart from the amber gap highlight, with the accessible label
 * "Inferred, check this: <reason>". The writer accepts an inference by
 * deleting the marker (keeping or editing the sentence before it), or
 * removes the sentence.
 *
 * Rendering only: the marker stays plain text in the document, so autosave,
 * export, the CRA counts and the Assistant read it as written. A decoration
 * rather than a stored mark, so a marker the writer types, or one an
 * accepted Assistant card brings, shows the same way, and a marker the
 * writer has started to delete stops showing as a chip. Editing and the
 * keyboard work as they do on a gap: the marker is ordinary text.
 */
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { findReportNotes } from "../../../../convex/lib/lineLimits";

/** The chip's class (styled in src/routes/layout.css). */
export const INFERRED_NOTE_CLASS = "report-inferred";

/** The chip's accessible label: "Inferred, check this: <reason>". */
export function inferredNoteLabel(reason: string): string {
  const text = reason.trim();
  return text ? `Inferred, check this: ${text}` : "Inferred, check this";
}

/** One inline decoration per [INFERRED: ...] marker in each text block of `doc`. */
export function inferredNoteDecorations(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    // The block's text with each character's document position. An inline
    // leaf (a hard break) reads as a line break, as export reads it.
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
    for (const note of findReportNotes(text)) {
      if (note.kind !== "inferred") continue;
      const from = positions[note.index];
      const to = positions[note.index + note.text.length - 1] + 1;
      decorations.push(
        Decoration.inline(from, to, {
          nodeName: "mark",
          class: INFERRED_NOTE_CLASS,
          "aria-label": inferredNoteLabel(note.note),
          "data-inferred-note": "",
        })
      );
    }
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

const inferenceNotesKey = new PluginKey<DecorationSet>("reportInferenceNotes");

/** The chips for the report editor and the client review view. */
export const ReportInferenceNotes = Extension.create({
  name: "reportInferenceNotes",

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
