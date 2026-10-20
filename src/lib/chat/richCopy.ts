/**
 * Report chat parity, Phase C (2026-10-20), W3: Copy on a reply copies what
 * the writer sees, not its markdown. The rendered answer goes on the
 * clipboard as `text/html` (headings, lists, bold and links survive a paste
 * into Word or an email) and as `text/plain`, each citation pill written as
 * "[n]". Where the browser has no `ClipboardItem`, or refuses it, the plain
 * text goes through `writeText`.
 */

/** A rendered citation pill (svelte-streamdown's inline citation preview). */
const CITATION_PILL = "[data-streamdown-citation-preview]";
/** Controls and popovers inside the answer that are not part of its text. */
const NOT_TEXT = "button, [data-citation-popover], [role='dialog'], [role='tooltip'], .sr-only, script, style";

/** The numbers a citation pill shows, as "[1][2]". */
export function citationLabel(pill: Element): string {
  const visible = pill.cloneNode(true) as Element;
  for (const hidden of visible.querySelectorAll(".sr-only")) hidden.remove();
  const numbers = (visible.textContent ?? "").match(/\d+/g) ?? [];
  return numbers.map((n) => `[${n}]`).join("");
}

/**
 * A copy of the rendered answer ready for the clipboard: each citation pill
 * replaced by its "[n]" text, controls and screen reader text removed.
 */
export function clipboardFragment(answer: Element): HTMLElement {
  const clone = answer.cloneNode(true) as HTMLElement;
  for (const pill of clone.querySelectorAll(CITATION_PILL)) {
    // The pill may be the popover's button or sit inside it.
    const control = pill.closest("button");
    const target = control && clone.contains(control) ? control : pill;
    target.replaceWith(clone.ownerDocument.createTextNode(citationLabel(pill)));
  }
  for (const node of clone.querySelectorAll(NOT_TEXT)) node.remove();
  for (const node of clone.querySelectorAll("[id]")) node.removeAttribute("id");
  return clone;
}

/**
 * The fragment's text as laid out (paragraphs and list items on their own
 * lines). `innerText` needs the node in the document, so it is placed out
 * of sight for the read.
 */
export function plainText(fragment: HTMLElement): string {
  const host = fragment.ownerDocument.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:40rem;white-space:normal;";
  host.append(fragment);
  fragment.ownerDocument.body.append(host);
  try {
    return fragment.innerText.replace(/\n{3,}/g, "\n\n").trim();
  } finally {
    host.remove();
  }
}

/**
 * Copy a rendered answer. Rejects only when the browser refuses every way
 * to write to the clipboard.
 */
export async function copyRenderedAnswer(answer: Element | null, fallbackText: string): Promise<void> {
  const fragment = answer ? clipboardFragment(answer) : null;
  const text = fragment ? plainText(fragment) || fallbackText : fallbackText;
  if (fragment && typeof ClipboardItem !== "undefined" && typeof navigator.clipboard?.write === "function") {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([fragment.innerHTML], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
      return;
    } catch {
      // Some browsers refuse rich writes but take plain text.
    }
  }
  await navigator.clipboard.writeText(text);
}
