/**
 * Evidence view (client request, 2026-11-02): a review aid the writer turns
 * on to see which sentences are linked to a source and which are the AI's
 * inference, so they know what to check. Off by default.
 *
 * Rendering only. It draws decorations over the report text and never
 * changes the document, its saved text, autosave, export or the counts.
 *
 * What drives each colour, and nothing else (no guessing by text matching):
 * - Inferred or not backed (red tint, dashed underline):
 *   - a sentence followed by an `[INFERRED: ...]` marker (the AI's own note,
 *     read from the text as the inference chips read it), or
 *   - every sentence of a paragraph the report's claim record marks
 *     `unsupported` (no source quote was linked when it was drafted, or a
 *     reviewer marked it so).
 * - Linked to a source (green tint, solid underline): every other sentence
 *   of a paragraph whose claim in the record has a source quote (state
 *   `needs_review`, linked but not checked yet, or `approved`, checked by a
 *   reviewer), or that a reviewer approved.
 * - Plain: everything else. A paragraph with no claim in the record (a
 *   heading, text added or changed since the record was made and not yet
 *   saved, a report with no record at all) and a claim that needs review
 *   with no source (a paragraph a person added) carry no data to tell
 *   supported from unsupported, so they are left alone.
 *
 * The claim record (`reportProvenance`) is per paragraph, so a linked
 * paragraph colours all its sentences except the ones the AI marked as
 * inferred. Its source is the quote the drafting step paired with the
 * paragraph; the record does not say which sentence the quote backs.
 *
 * Typing stays fast: on an edit the drawn ranges are only mapped through
 * the change, and the full pass runs once the writer pauses (debounced).
 */
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { findReportNotes } from "../../../../convex/lib/lineLimits";
import { reportSectionKeyForHeading, type TiptapNode } from "$lib/reportSections";
import { blockText } from "./inferenceNotes";

/** One source quote on a claim (a subset of `reportProvenance.claims[].sources[]`). */
export type EvidenceSource = {
  exactExcerpt: string;
  speaker?: string;
  timestampStart?: string;
};

/** One claim of the report's claim record (a subset of `reportProvenance.claims[]`). */
export type EvidenceClaim = {
  claimId: string;
  section: "242" | "244" | "246";
  claimText: string;
  state: "needs_review" | "approved" | "unsupported";
  sources: EvidenceSource[];
};

/** Green: linked to a source. Red: inferred, or not backed by a source. */
export type EvidenceKind = "supported" | "unsupported";

/** Why a sentence has its colour. */
export type EvidenceBasis =
  /** A reviewer approved the paragraph's source quote. */
  | "checked"
  /** The paragraph is linked to a source quote nobody has checked yet. */
  | "linked"
  /** A reviewer approved the paragraph, with no quote linked. */
  | "approved"
  /** An [INFERRED: ...] marker follows the sentence. */
  | "marker"
  /** The claim record marks the paragraph unsupported. */
  | "unsupported";

export type EvidenceSpan = {
  /** Offsets within the paragraph text, end exclusive. */
  start: number;
  end: number;
  /** Which sentence of the paragraph (a sentence split by a marker gives two spans). */
  sentence: number;
  kind: EvidenceKind;
  basis: EvidenceBasis;
  /** The plain-words reason shown on hover and at the cursor. */
  reason: string;
};

export const EVIDENCE_CLASS: Record<EvidenceKind, string> = {
  supported: "evidence-supported",
  unsupported: "evidence-unsupported",
};

/** How long typing must pause before the colours are worked out again. */
export const EVIDENCE_REBUILD_DELAY_MS = 300;

/** Claim texts are stored cut to this length (MAX_CLAIM_TEXT_LENGTH). */
const STORED_CLAIM_TEXT_LIMIT = 4_000;

/** Words a sentence may end on that are not its end (as the compression check reads them). */
const ABBREVIATION_END = /(?:^|[^A-Za-z])(?:e\.g|i\.e|approx|etc|vs|cf|ca|fig|no|nos|dr|mr|mrs|ms|st)\.$/i;

type Range = { start: number; end: number };

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function trimRange(text: string, start: number, end: number): Range | null {
  while (start < end && /\s/.test(text[start])) start += 1;
  while (end > start && /\s/.test(text[end - 1])) end -= 1;
  return end > start ? { start, end } : null;
}

/**
 * The sentences of one paragraph, as offset ranges with the surrounding
 * spaces left out. A `[GAP: ...]` or `[INFERRED: ...]` marker belongs to
 * the sentence before it when it follows the full stop; a full stop inside a
 * marker, or after "e.g." and the like, never ends a sentence.
 */
export function sentenceRanges(text: string): Range[] {
  const notes = findReportNotes(text).map((note) => ({ start: note.index, end: note.index + note.text.length }));
  const inNote = (at: number) => notes.some((note) => at >= note.start && at < note.end);
  const skipSpace = (at: number) => {
    while (at < text.length && /\s/.test(text[at])) at += 1;
    return at;
  };
  const cuts = new Set<number>();
  for (const match of text.matchAll(/[.!?]["'”’)\]]*(?=\s)/g)) {
    const end = match.index + match[0].length;
    if (inNote(match.index)) continue;
    if (ABBREVIATION_END.test(text.slice(Math.max(0, end - 16), end))) continue;
    // Markers straight after the full stop stay with the sentence; the
    // next sentence starts after the last of them. A marker inside a
    // sentence ("We tested [GAP: how many] samples.") never ends it.
    let next = skipSpace(end);
    for (let note = notes.find((candidate) => candidate.start === next); note; note = notes.find((candidate) => candidate.start === next)) {
      next = skipSpace(note.end);
    }
    if (next < text.length) cuts.add(next);
  }
  const bounds = [0, ...[...cuts].sort((a, b) => a - b), text.length];
  const ranges: Range[] = [];
  for (let index = 0; index < bounds.length - 1; index += 1) {
    const range = trimRange(text, bounds[index], bounds[index + 1]);
    if (range) ranges.push(range);
  }
  return ranges;
}

function shorten(text: string, limit: number): string {
  const flat = normalize(text);
  return flat.length > limit ? `${flat.slice(0, limit - 3).trimEnd()}...` : flat;
}

function quoteLabel(sources: readonly EvidenceSource[]): string {
  const [first] = sources;
  const where = [first.speaker, first.timestampStart].filter(Boolean).join(", ");
  const more = sources.length > 1 ? ` and ${sources.length - 1} more` : "";
  return `“${shorten(first.exactExcerpt, 160)}”${where ? ` (${where})` : ""}${more}`;
}

/** The colour and reason a claim gives its paragraph's sentences, or null to leave them plain. */
export function claimEvidence(claim: EvidenceClaim | null): Pick<EvidenceSpan, "kind" | "basis" | "reason"> | null {
  if (!claim) return null;
  if (claim.state === "unsupported") {
    return {
      kind: "unsupported",
      basis: "unsupported",
      reason:
        claim.sources.length > 0
          ? "Not backed by a source: a reviewer marked this paragraph unsupported."
          : "Not backed by a source: no source quote is linked to this paragraph.",
    };
  }
  if (claim.state === "approved") {
    return claim.sources.length > 0
      ? { kind: "supported", basis: "checked", reason: `Source checked by a reviewer: ${quoteLabel(claim.sources)}` }
      : { kind: "supported", basis: "approved", reason: "Approved by a reviewer. No source quote is linked." };
  }
  if (claim.sources.length > 0) {
    return {
      kind: "supported",
      basis: "linked",
      reason: `Linked to a source quote, not checked yet: ${quoteLabel(claim.sources)}`,
    };
  }
  // Needs review with no source: text a person added. Nothing to tell.
  return null;
}

/**
 * The coloured stretches of one paragraph. Each sentence with words of its
 * own is coloured apart from its markers (the chips keep their own look);
 * a sentence followed by an [INFERRED: ...] marker is inferred whatever its
 * paragraph's claim says.
 */
export function classifyParagraph(text: string, claim: EvidenceClaim | null): EvidenceSpan[] {
  const notes = findReportNotes(text).map((note) => ({
    start: note.index,
    end: note.index + note.text.length,
    kind: note.kind,
    note: note.note,
  }));
  const paragraph = claimEvidence(claim);
  const spans: EvidenceSpan[] = [];
  sentenceRanges(text).forEach((sentence, sentenceIndex) => {
    const inside = notes.filter((note) => note.start >= sentence.start && note.end <= sentence.end);
    const inferred = inside.find((note) => note.kind === "inferred");
    const evidence = inferred
      ? {
          kind: "unsupported" as const,
          basis: "marker" as const,
          reason: `Inferred: not stated in the sources. The AI's reason: ${shorten(inferred.note, 200)}`,
        }
      : paragraph;
    if (!evidence) return;
    // The sentence's own words, around its markers.
    let at = sentence.start;
    for (const piece of [...inside, { start: sentence.end, end: sentence.end }]) {
      const range = trimRange(text, at, piece.start);
      if (range && /[\p{L}\p{N}]/u.test(text.slice(range.start, range.end))) {
        spans.push({ ...range, sentence: sentenceIndex, ...evidence });
      }
      at = piece.end;
    }
  });
  return spans;
}

/** One paragraph of the report, with its Line (null outside the three Lines). */
export type EvidenceParagraph = { section: EvidenceClaim["section"] | null; text: string };

/**
 * The claim each paragraph carries, by exact wording within its Line (spaces
 * evened out), in order, so two paragraphs with the same words each take
 * their own claim. A claim text the record cut short matches a paragraph
 * that starts with it. Null where no claim has the paragraph's wording.
 */
export function matchClaims(paragraphs: readonly EvidenceParagraph[], claims: readonly EvidenceClaim[]): Array<EvidenceClaim | null> {
  const byText = new Map<string, EvidenceClaim[]>();
  const cut: EvidenceClaim[] = [];
  for (const claim of claims) {
    const key = `${claim.section}\u0000${normalize(claim.claimText)}`;
    const queue = byText.get(key);
    if (queue) queue.push(claim);
    else byText.set(key, [claim]);
    if (claim.claimText.length >= STORED_CLAIM_TEXT_LIMIT) cut.push(claim);
  }
  const used = new Set<EvidenceClaim>();
  return paragraphs.map(({ section, text }) => {
    if (!section) return null;
    const words = normalize(text);
    if (!words) return null;
    const exact = byText.get(`${section}\u0000${words}`)?.find((claim) => !used.has(claim));
    const claim =
      exact ??
      cut.find((candidate) => !used.has(candidate) && candidate.section === section && words.startsWith(normalize(candidate.claimText)));
    if (!claim) return null;
    used.add(claim);
    return claim;
  });
}

/** A coloured range in the document, with why. */
export type EvidenceRange = {
  from: number;
  to: number;
  kind: EvidenceKind;
  basis: EvidenceBasis;
  reason: string;
  /** Names the sentence: its paragraph and its place there. */
  sentenceKey: string;
};

/**
 * Every coloured range of `doc`. Lines come from the Section heading nodes
 * (as the claim record finds them); a legacy QA Scorecard heading ends Line
 * 246. [INFERRED: ...] markers are read everywhere; claims only inside the
 * three Lines. `claims` null: the report has no claim record.
 */
export function evidenceRanges(doc: PMNode, claims: readonly EvidenceClaim[] | null): EvidenceRange[] {
  const blocks: Array<EvidenceParagraph & { positions: number[] }> = [];
  let section: EvidenceClaim["section"] | null = null;
  doc.forEach((top, offset) => {
    if (top.type.name === "heading") {
      const key = reportSectionKeyForHeading(top.toJSON() as TiptapNode);
      if (key) section = key.slice(1) as EvidenceClaim["section"];
      else if (section === "246" && /^qa scorecard$/i.test(top.textContent.trim())) section = null;
      return;
    }
    if (top.isTextblock) {
      blocks.push({ section, ...blockText(top, offset) });
      return;
    }
    top.descendants((node, inner) => {
      if (!node.isTextblock) return true;
      if (node.type.name !== "heading") blocks.push({ section, ...blockText(node, offset + 1 + inner) });
      return false;
    });
  });
  const matched = claims ? matchClaims(blocks, claims) : blocks.map(() => null);
  const ranges: EvidenceRange[] = [];
  blocks.forEach(({ text, positions }, index) => {
    for (const span of classifyParagraph(text, matched[index])) {
      ranges.push({
        from: positions[span.start],
        to: positions[span.end - 1] + 1,
        kind: span.kind,
        basis: span.basis,
        reason: span.reason,
        sentenceKey: `${index}:${span.sentence}`,
      });
    }
  });
  return ranges;
}

export type EvidenceCounts = Record<EvidenceKind, number>;

type EvidenceState = {
  enabled: boolean;
  claims: readonly EvidenceClaim[] | null;
  decorations: DecorationSet;
  counts: EvidenceCounts;
  /** The document changed since the last full pass. */
  stale: boolean;
};

/** Turn the view on or off, or give it a new claim record. */
export type EvidenceViewSettings = { enabled: boolean; claims: readonly EvidenceClaim[] | null };
type EvidenceMeta = EvidenceViewSettings | { rebuild: true };

export const evidenceViewKey = new PluginKey<EvidenceState>("reportEvidenceView");

const OFF: EvidenceState = {
  enabled: false,
  claims: null,
  decorations: DecorationSet.empty,
  counts: { supported: 0, unsupported: 0 },
  stale: false,
};

function build(doc: PMNode, enabled: boolean, claims: readonly EvidenceClaim[] | null): EvidenceState {
  if (!enabled) return { ...OFF, claims };
  const counts: EvidenceCounts = { supported: 0, unsupported: 0 };
  const counted = new Set<string>();
  const decorations: Decoration[] = [];
  for (const range of evidenceRanges(doc, claims)) {
    if (!counted.has(range.sentenceKey)) {
      counted.add(range.sentenceKey);
      counts[range.kind] += 1;
    }
    decorations.push(
      Decoration.inline(
        range.from,
        range.to,
        { class: EVIDENCE_CLASS[range.kind], "data-evidence": range.kind, "data-evidence-basis": range.basis, title: range.reason },
        { evidence: range.kind, reason: range.reason }
      )
    );
  }
  return { enabled, claims, decorations: DecorationSet.create(doc, decorations), counts, stale: false };
}

function applyEvidence(tr: Transaction, previous: EvidenceState): EvidenceState {
  const meta = tr.getMeta(evidenceViewKey) as EvidenceMeta | undefined;
  if (meta && "enabled" in meta) return build(tr.doc, meta.enabled, meta.claims);
  if (meta && "rebuild" in meta) return previous.enabled ? build(tr.doc, true, previous.claims) : previous;
  if (!tr.docChanged || !previous.enabled) return previous;
  // While typing, only move what is drawn; the full pass waits for a pause.
  return { ...previous, decorations: previous.decorations.map(tr.mapping, tr.doc), stale: true };
}

/** Apply new settings to a mounted editor's view. A no-op when nothing changed. */
export function setEvidenceView(view: EditorView, settings: EvidenceViewSettings): void {
  const current = evidenceViewKey.getState(view.state);
  if (!current) return;
  if (current.enabled === settings.enabled && current.claims === settings.claims) return;
  view.dispatch(view.state.tr.setMeta(evidenceViewKey, settings).setMeta("addToHistory", false));
}

/** Whether the view is on, and how many sentences have each colour. */
export function evidenceSummary(state: EditorState): { enabled: boolean; counts: EvidenceCounts } {
  const current = evidenceViewKey.getState(state) ?? OFF;
  return { enabled: current.enabled, counts: current.counts };
}

/** The coloured stretch at `pos`, with its reason, or null. */
export function evidenceAt(state: EditorState, pos: number): { kind: EvidenceKind; reason: string } | null {
  const current = evidenceViewKey.getState(state);
  if (!current?.enabled) return null;
  const [found] = current.decorations.find(pos, pos, (spec) => typeof spec.reason === "string");
  return found ? { kind: found.spec.evidence as EvidenceKind, reason: found.spec.reason as string } : null;
}

/** The evidence view's plugin: off until `setEvidenceView` turns it on. */
export function evidenceViewPlugin(): Plugin<EvidenceState> {
  return new Plugin<EvidenceState>({
    key: evidenceViewKey,
    state: {
      init: () => OFF,
      apply: (tr, previous) => applyEvidence(tr, previous),
    },
    props: {
      decorations(state) {
        return evidenceViewKey.getState(state)?.decorations ?? DecorationSet.empty;
      },
    },
    view: () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      return {
        update(view, previousState) {
          if (view.state.doc === previousState.doc || !evidenceViewKey.getState(view.state)?.stale) return;
          clearTimeout(timer);
          timer = setTimeout(() => {
            if (view.isDestroyed || !evidenceViewKey.getState(view.state)?.stale) return;
            view.dispatch(view.state.tr.setMeta(evidenceViewKey, { rebuild: true }).setMeta("addToHistory", false));
          }, EVIDENCE_REBUILD_DELAY_MS);
        },
        destroy() {
          clearTimeout(timer);
        },
      };
    },
  });
}

/** The evidence view for the report editor. Off until the editor turns it on. */
export const ReportEvidenceView = Extension.create({
  name: "reportEvidenceView",

  addProseMirrorPlugins() {
    return [evidenceViewPlugin()];
  },
});
