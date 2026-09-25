/**
 * Reading presentation of the report's Section headings (ui-design-final.md
 * section 8, board 2.1): the stored heading "Line 242 — Scientific/
 * Technological Uncertainty" renders as a small sans label ("242
 * Technological uncertainty") over the serif CRA question, with the limit
 * meter at the right of the label when the Section is near or over a limit.
 *
 * Rendering only. The document keeps its exact "Line 24x" heading nodes, so
 * autosave, export (parseCanonicalReport), QA and section detection read the
 * same JSON as before. The node view has no contentDOM: the heading text is
 * not editable inline.
 *
 * Because the writer cannot see those strings, no edit of theirs may change
 * them (review f1, 2026-09-25): a transaction filter refuses any user change
 * to the ordered list of top-level Section headings (key and exact text), and
 * the caret is kept out of them. The server's copy still replaces the
 * document through `SECTION_HEADINGS_EXTERNAL`, and undo and redo pass.
 */

/** Transaction meta for a replacement from outside the editor (the server's copy). */
export const SECTION_HEADINGS_EXTERNAL = "reportSectionHeadings/external";
import { Extension, type Editor as CoreEditor } from "@tiptap/core";
import { Plugin, PluginKey, Selection, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { isHistoryTransaction } from "@tiptap/pm/history";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { Decoration, NodeView } from "@tiptap/pm/view";
import { reportSectionKeyForHeading, type ReportSectionKey } from "$lib/reportSections";
import { PD_SECTION_HEADINGS } from "../../../../shared/pdSubsections";

/** Limit meter data a node decoration hands to a Section heading view. */
export interface ReportLimitMeterSpec {
  reportLimitMeter: {
    state: "warning" | "over";
    /** "96 / 100 lines, 668 / 700 words" */
    text: string;
    /** Full sentence for assistive technology and the tooltip. */
    description: string;
    /** Fill of the small band bar, 0 to 100. */
    percent: number;
  };
}

export function sectionKeyForNode(node: PMNode): ReportSectionKey | null {
  if (node.type.name !== "heading") return null;
  return reportSectionKeyForHeading(
    node.toJSON() as Parameters<typeof reportSectionKeyForHeading>[0]
  );
}

function meterFrom(decorations: readonly Decoration[]): ReportLimitMeterSpec["reportLimitMeter"] | null {
  for (const decoration of decorations) {
    const spec = (decoration as unknown as { spec?: Partial<ReportLimitMeterSpec> }).spec;
    if (spec?.reportLimitMeter) return spec.reportLimitMeter;
  }
  return null;
}

function renderMeter(slot: HTMLElement, meter: ReportLimitMeterSpec["reportLimitMeter"] | null) {
  slot.replaceChildren();
  if (!meter) {
    slot.hidden = true;
    delete slot.dataset.limitState;
    slot.removeAttribute("title");
    return;
  }
  slot.hidden = false;
  slot.dataset.limitState = meter.state;
  slot.title = meter.description;
  const text = document.createElement("span");
  text.className = "report-limit-meter__text";
  text.textContent = meter.text;
  const bar = document.createElement("span");
  bar.className = "report-limit-meter__bar";
  bar.setAttribute("aria-hidden", "true");
  const fill = document.createElement("span");
  fill.className = "report-limit-meter__fill";
  fill.style.width = `${Math.max(0, Math.min(100, meter.percent))}%`;
  bar.append(fill);
  const sr = document.createElement("span");
  sr.className = "sr-only";
  sr.textContent = `. ${meter.description}`;
  slot.append(text, bar, sr);
}

function sectionHeadingView(
  node: PMNode,
  key: ReportSectionKey,
  decorations: readonly Decoration[]
): NodeView {
  const display = PD_SECTION_HEADINGS[key];
  const dom = document.createElement("div");
  dom.className = "report-section-heading";
  dom.contentEditable = "false";
  dom.dataset.reportSectionHeading = display.number;

  const label = document.createElement("p");
  label.className = "report-section-heading__label";
  const number = document.createElement("span");
  number.className = "report-section-heading__number";
  number.textContent = display.number;
  const name = document.createElement("span");
  name.className = "report-section-heading__name";
  name.textContent = display.title;
  const meter = document.createElement("span");
  meter.className = "report-limit-meter";
  meter.dataset.reportLimitMeter = display.number;
  label.append(number, document.createTextNode(" "), name, meter);

  const question = document.createElement("h3");
  question.className = "report-section-heading__question";
  question.textContent = display.question;

  dom.append(label, question);
  renderMeter(meter, meterFrom(decorations));

  let current = node;
  return {
    dom,
    update(next, nextDecorations) {
      if (next.type !== current.type || sectionKeyForNode(next) !== key) return false;
      current = next;
      renderMeter(meter, meterFrom(nextDecorations));
      return true;
    },
    // Display only: DOM changes inside never map to content, but selection
    // changes still reach ProseMirror, so a click there moves the real caret
    // (which the plugin then places just after the heading).
    ignoreMutation: (mutation) => mutation.type !== "selection",
    stopEvent: () => false,
  };
}

function plainHeadingView(node: PMNode): NodeView {
  const level = Number(node.attrs.level) || 1;
  const dom = document.createElement(`h${Math.min(6, Math.max(1, level))}`);
  return {
    dom,
    contentDOM: dom,
    update(next) {
      return (
        next.type === node.type &&
        Number(next.attrs.level) === level &&
        sectionKeyForNode(next) === null
      );
    },
  };
}

/** Key, level and exact text of each top-level Section heading, in document order. */
function sectionHeadingSignature(doc: PMNode): string {
  const parts: string[] = [];
  doc.forEach((node) => {
    const key = sectionKeyForNode(node);
    if (key) parts.push(`${key}\u0000${String(node.attrs.level)}\u0000${node.textContent}`);
  });
  return parts.join("\u0001");
}

function userMayChange(tr: Transaction, state: EditorState): boolean {
  if (!tr.docChanged) return true;
  if (tr.getMeta(SECTION_HEADINGS_EXTERNAL) || isHistoryTransaction(tr)) return true;
  return sectionHeadingSignature(tr.doc) === sectionHeadingSignature(state.doc);
}

/**
 * The heading that holds `pos` and has no visible text to edit, as its node
 * range, or null: a Section heading, or the report's own title heading,
 * which the reading page hides (its serif title comes from the project).
 */
function sectionHeadingAt(doc: PMNode, pos: number): { from: number; to: number } | null {
  const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
  if ($pos.depth < 1) return null;
  const node = $pos.node(1);
  const hiddenTitle = $pos.index(0) === 0 && node.type.name === "heading" && Number(node.attrs.level) === 1;
  if (!hiddenTitle && !sectionKeyForNode(node)) return null;
  return { from: $pos.before(1), to: $pos.after(1) };
}

/** The nearest text position outside every Section heading, searching `dir` first. */
function outsideSectionHeading(doc: PMNode, pos: number, dir: 1 | -1): number {
  let at = pos;
  for (const direction of [dir, -dir as 1 | -1]) {
    at = pos;
    for (let guard = 0; guard < doc.childCount + 1; guard++) {
      const heading = sectionHeadingAt(doc, at);
      if (!heading) return at;
      const found = Selection.findFrom(doc.resolve(direction > 0 ? heading.to : heading.from), direction, true);
      if (!found) break;
      at = found.head;
    }
  }
  // No text outside the headings in either direction: the document edge.
  return dir > 0 ? doc.content.size : 0;
}

/** True when the range touches a top-level Section heading. */
export function rangeTouchesSectionHeading(doc: PMNode, from: number, to: number): boolean {
  let touches = false;
  doc.nodesBetween(Math.max(0, from), Math.min(to, doc.content.size), (node) => {
    if (touches) return false;
    if (sectionKeyForNode(node)) touches = true;
    return false; // top-level nodes only
  });
  return touches;
}

/**
 * Backspace or Delete at the edge of the block beside a Section heading (the
 * hidden rule between Sections is looked past). An empty block there is
 * removed; any other join is refused, and the transaction filter backs this
 * up for every other key and command.
 */
function edgeBesideSectionHeading(editor: CoreEditor, direction: "backward" | "forward"): boolean {
  const { state } = editor;
  const { selection, doc } = state;
  if (!selection.empty) return false;
  const $pos = selection.$from;
  // Only a top-level textblock can join into a heading; Backspace at the start
  // of a list item or quote lifts it out instead.
  if ($pos.depth !== 1 || !$pos.parent.isTextblock) return false;
  const atEdge =
    direction === "backward" ? $pos.parentOffset === 0 : $pos.parentOffset === $pos.parent.content.size;
  if (!atEdge) return false;
  const step = direction === "backward" ? -1 : 1;
  let neighbour = $pos.index(0) + step;
  while (neighbour >= 0 && neighbour < doc.childCount && doc.child(neighbour).type.name === "horizontalRule") {
    neighbour += step;
  }
  if (neighbour < 0 || neighbour >= doc.childCount) return false;
  if (!sectionKeyForNode(doc.child(neighbour))) return false;
  if ($pos.parent.content.size === 0 && doc.childCount > 1) {
    // An accidental blank line beside a heading: remove it, caret on the
    // same side of the heading.
    const from = $pos.before(1);
    const tr = state.tr.delete(from, $pos.after(1));
    const target = outsideSectionHeading(tr.doc, Math.min(from, tr.doc.content.size), step > 0 ? -1 : 1);
    tr.setSelection(TextSelection.near(tr.doc.resolve(target), step > 0 ? -1 : 1));
    editor.view.dispatch(tr.scrollIntoView());
  }
  return true;
}

const BACKWARD_KEYS = ["Backspace", "Shift-Backspace", "Mod-Backspace", "Alt-Backspace", "Ctrl-h"] as const;
const FORWARD_KEYS = ["Delete", "Mod-Delete", "Alt-Delete", "Ctrl-d", "Alt-d", "Ctrl-Alt-Backspace"] as const;

/**
 * Plugin-level node view for `heading`, so StarterKit's Heading extension
 * (schema, commands, shortcuts) stays exactly as it is.
 */
export const ReportSectionHeadings = Extension.create({
  name: "reportSectionHeadings",
  addKeyboardShortcuts() {
    const shortcuts: Record<string, (props: { editor: CoreEditor }) => boolean> = {};
    for (const key of BACKWARD_KEYS) shortcuts[key] = ({ editor }) => edgeBesideSectionHeading(editor, "backward");
    for (const key of FORWARD_KEYS) shortcuts[key] = ({ editor }) => edgeBesideSectionHeading(editor, "forward");
    return shortcuts;
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("reportSectionHeadings"),
        filterTransaction: (tr, state) => userMayChange(tr, state),
        appendTransaction: (_transactions, oldState, newState) => {
          const { selection, doc } = newState;
          if (!(selection instanceof TextSelection)) {
            // A node selection of a heading (for example a modified click).
            if (selection.from + 1 === selection.to && sectionHeadingAt(doc, selection.from + 1)) {
              const at = outsideSectionHeading(doc, selection.to, 1);
              return newState.tr.setSelection(TextSelection.near(doc.resolve(at))).setMeta("addToHistory", false);
            }
            return null;
          }
          const anchorIn = sectionHeadingAt(doc, selection.anchor);
          const headIn = sectionHeadingAt(doc, selection.head);
          if (!anchorIn && !headIn) return null;
          let anchor: number;
          let head: number;
          if (selection.empty) {
            // Keep travelling the way the caret was going.
            const dir: 1 | -1 = selection.head >= oldState.selection.head ? 1 : -1;
            anchor = head = outsideSectionHeading(doc, selection.head, dir);
          } else {
            // Pull each end inward, so the selection stops short of the heading.
            const forward = selection.anchor <= selection.head;
            anchor = anchorIn ? outsideSectionHeading(doc, selection.anchor, forward ? 1 : -1) : selection.anchor;
            head = headIn ? outsideSectionHeading(doc, selection.head, forward ? -1 : 1) : selection.head;
            if (forward ? anchor > head : anchor < head) head = anchor;
          }
          const next = TextSelection.between(doc.resolve(anchor), doc.resolve(head));
          if (next.eq(selection)) return null;
          return newState.tr.setSelection(next).setMeta("addToHistory", false);
        },
        props: {
          nodeViews: {
            heading: (node, _view, _getPos, decorations) => {
              const key = sectionKeyForNode(node);
              return key ? sectionHeadingView(node, key, decorations) : plainHeadingView(node);
            },
          },
        },
      }),
    ];
  },
});
