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
 * not editable inline, which also keeps the load-bearing heading strings safe.
 */
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
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
    // The view is display-only; nothing inside it maps to document content.
    ignoreMutation: () => true,
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

/**
 * The section heading shows no editable text, so a join across its edge would
 * silently pull prose into (or out of) the load-bearing "Line 24x" heading.
 * Backspace at the start of the first block after a heading, and Delete at the
 * end of the last block before one, therefore do nothing.
 */
function touchesSectionHeading(state: EditorState, direction: "backward" | "forward"): boolean {
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
  // The rule between Sections is hidden in the reading presentation; look past it.
  while (neighbour >= 0 && neighbour < doc.childCount && doc.child(neighbour).type.name === "horizontalRule") {
    neighbour += step;
  }
  if (neighbour < 0 || neighbour >= doc.childCount) return false;
  return sectionKeyForNode(doc.child(neighbour)) !== null;
}

/**
 * Plugin-level node view for `heading`, so StarterKit's Heading extension
 * (schema, commands, shortcuts) stays exactly as it is.
 */
export const ReportSectionHeadings = Extension.create({
  name: "reportSectionHeadings",
  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => touchesSectionHeading(editor.state, "backward"),
      Delete: ({ editor }) => touchesSectionHeading(editor.state, "forward"),
    };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("reportSectionHeadings"),
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
