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
/**
 * Controls, popovers and anything active inside the answer: removed with
 * their content, as none of it is the answer's text.
 */
const NOT_TEXT = [
  "button", "[data-citation-popover]", "[role='dialog']", "[role='tooltip']", ".sr-only",
  "script", "style", "template", "noscript", "iframe", "frame", "object", "embed",
  "svg", "math", "img", "picture", "video", "audio", "canvas", "source", "track",
  "input", "textarea", "select", "form", "link", "meta", "base",
].join(", ");

/**
 * Review R2 P3-6: the elements a pasted answer keeps. Any other element is
 * replaced by its children, and every attribute is dropped except a safe
 * link's `href`.
 */
const KEPT_ELEMENTS = new Set([
  "a", "b", "strong", "i", "em", "u", "s", "del", "ins", "mark", "small", "sub", "sup", "code", "kbd",
  "p", "br", "hr", "div", "span", "blockquote", "pre",
  "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "dl", "dt", "dd",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption",
]);

/** A link a pasted answer may keep: web and mail links only. */
export function safeHref(href: string | null): string | null {
  if (!href) return null;
  try {
    const url = new URL(href, "https://invalid.example/");
    if (url.origin === "https://invalid.example") return null;
    return url.protocol === "https:" || url.protocol === "http:" || url.protocol === "mailto:" ? url.href : null;
  } catch {
    return null;
  }
}

/** Strips every element and attribute a paste must not carry, in place. */
function sanitize(root: HTMLElement) {
  for (const node of root.querySelectorAll(NOT_TEXT)) node.remove();
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  const comments: Node[] = [];
  while (walker.nextNode()) comments.push(walker.currentNode);
  for (const comment of comments) comment.parentNode?.removeChild(comment);
  // Deepest first, so an unwrapped element's children are already clean.
  for (const element of [...root.querySelectorAll("*")].reverse()) {
    const tag = element.tagName.toLowerCase();
    if (!KEPT_ELEMENTS.has(tag)) {
      element.replaceWith(...element.childNodes);
      continue;
    }
    const href = tag === "a" ? safeHref(element.getAttribute("href")) : null;
    for (const name of element.getAttributeNames()) element.removeAttribute(name);
    if (href) element.setAttribute("href", href);
  }
  for (const name of root.getAttributeNames()) root.removeAttribute(name);
}

/** The numbers a citation pill shows, as "[1][2]". */
export function citationLabel(pill: Element): string {
  const visible = pill.cloneNode(true) as Element;
  for (const hidden of visible.querySelectorAll(".sr-only")) hidden.remove();
  const numbers = (visible.textContent ?? "").match(/\d+/g) ?? [];
  return numbers.map((n) => `[${n}]`).join("");
}

/**
 * A copy of the rendered answer ready for the clipboard: each citation pill
 * replaced by its "[n]" text; controls, screen reader text, active content
 * and every attribute but a safe link's `href` removed.
 */
export function clipboardFragment(answer: Element): HTMLElement {
  const clone = answer.cloneNode(true) as HTMLElement;
  for (const pill of clone.querySelectorAll(CITATION_PILL)) {
    // The pill may be the popover's button or sit inside it.
    const control = pill.closest("button");
    const target = control && clone.contains(control) ? control : pill;
    target.replaceWith(clone.ownerDocument.createTextNode(citationLabel(pill)));
  }
  sanitize(clone);
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
