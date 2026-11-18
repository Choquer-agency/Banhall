/**
 * Room to spare for a label's words (2026-11-17). Linux and Windows draw
 * text a little wider than macOS (Linux Chromium about 5%), so words that
 * just fit on a Mac can be cut on CI and on other people's laptops.
 * Component tests check that a label would still be whole drawn
 * WIDER_TEXT times wider than wherever the test runs.
 */
export const WIDER_TEXT = 1.08;

const box = (node: Element) => node.getBoundingClientRect();
const words = (node: Element) => (node.textContent ?? "").replace(/\s+/g, " ").trim();

/** The width a label's words need at their own font, measured on a canvas (cut words included). */
export function wordsWidth(label: HTMLElement): number {
  const style = getComputedStyle(label);
  const context = document.createElement("canvas").getContext("2d")!;
  context.font = style.font;
  context.letterSpacing = style.letterSpacing === "normal" ? "0px" : style.letterSpacing;
  return context.measureText(words(label)).width;
}

/**
 * The room a label's words have in their control at a given width (its
 * widest): that width less the control's padding, its gaps and its other
 * parts (a caret).
 */
export function wordsRoom(label: HTMLElement, controlWidth: number): number {
  const control = label.parentElement!;
  const style = getComputedStyle(control);
  const parts = [...control.children];
  const others = parts.filter((part) => part !== label).reduce((sum, part) => sum + box(part).width, 0);
  const gaps = (parseFloat(style.columnGap) || 0) * (parts.length - 1);
  return controlWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - gaps - others;
}

/** The width inside a cell's padding: the most a control in it can take. */
export function cellRoom(cell: HTMLElement): number {
  const style = getComputedStyle(cell);
  return cell.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
}
