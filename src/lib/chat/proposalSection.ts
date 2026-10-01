/**
 * Which report Section a suggested edit targets, for the card label
 * "Suggested edit for 242" (ui-design-final.md section 8, board 2.1).
 *
 * The report page provides the live report content through Svelte context;
 * a card outside a report page (or text that matches no Section) gets null
 * and shows the plain label.
 */
import { getContext, setContext } from "svelte";
import { parseCanonicalReport } from "$lib/reportSections";

const KEY = Symbol("proposal-section-source");

type ContentSource = () => string | null | undefined;

export function setProposalSectionSource(getContent: ContentSource): void {
  setContext(KEY, getContent);
}

const normalize = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

/** "242", "244" or "246" when `text` sits inside exactly one Section. */
export function sectionForText(content: string | null | undefined, text: string | null | undefined): string | null {
  if (!content || !text) return null;
  const needle = normalize(text);
  if (!needle) return null;
  const { sections } = parseCanonicalReport(content);
  const matches = Object.values(sections).filter((section) => normalize(section.plainText).includes(needle));
  return matches.length === 1 ? matches[0].line : null;
}

/** Call during component init; returns a lookup bound to the provided report. */
export function useProposalSection(): (text: string | null | undefined) => string | null {
  const getContent = getContext<ContentSource | undefined>(KEY);
  let cachedContent: string | null | undefined;
  const cache = new Map<string, string | null>();
  return (text) => {
    if (!getContent || !text) return null;
    const content = getContent();
    if (content !== cachedContent) {
      cachedContent = content;
      cache.clear();
    }
    if (!cache.has(text)) cache.set(text, sectionForText(content, text));
    return cache.get(text) ?? null;
  };
}
