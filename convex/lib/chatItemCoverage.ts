import type { CompletionReportSection } from "./completionReport";

/**
 * Report chat parity, Phase A review P2-2 (2026-10-19): the Completion Report
 * moved onto the card, so the replies no longer carry item ids and statuses,
 * and the model's history leaves tool rows out. What this conversation already
 * did with each Deviation is read back from `chatProposalItems` instead, so
 * the inventory can mark it and the model revises what is left.
 *
 * Round 2 (N1): a mark is guidance, not a ban. It names the item's status and
 * what reopens it, because the writer may supply the missing fact, decide a
 * conflict, refine a pending card or ask for a redo, and the inventory is the
 * model's only source of the ids.
 *
 * Round 3 (P2-A): item ids are positional (kind, section, paragraph,
 * position). A rule Deviation (`r-`) comes from the stored Compliance Notes,
 * so its id names the same Deviation for the whole conversation. A content
 * (`c-`) or reference (`x-`) id names whatever the writer, or the Reference
 * PD, put at that position in one request, so a card records a fingerprint of
 * what the item is (`itemFingerprint`).
 *
 * Round 4 (N1): a card covers a content or reference item when EITHER its
 * fingerprint equals the item's (whatever the positional id, whatever the
 * job), OR it belongs to the current job and has the same id (with or
 * without a fingerprint). The first carries marks across a refine, a
 * question or a typed continue; the second keeps a Continue chain stable when
 * the model re-extracts the writer's instructions with other wording or in
 * another order. A fresh request with a different instruction at the same
 * position matches neither, so it starts clean.
 */

/** One `chatProposalItems` row with the state of the card that carries it. */
export type ItemCoverageRow = {
  itemId: string;
  section?: CompletionReportSection;
  status: "resolved" | "blocked" | "conflicting";
  proposalState: "pending" | "applied" | "rejected" | "stale";
  createdAt: number;
  /** What a content or reference item was, when its card recorded it. */
  fingerprint?: string;
  /** The card belongs to the current job (fallback for cards without a fingerprint). */
  inCurrentJob: boolean;
  /** The 1-based paragraph of the Line the item sits in, when the card recorded it. */
  paragraph?: number;
};

/**
 * What the conversation did with one item. `handled` items are skipped by
 * default and left out of the Continue offer; `reopen` says when the model
 * revises one anyway. An item whose card the writer rejected, or whose card
 * went stale, is labelled but not handled.
 */
export type ItemCoverage = {
  itemId: string;
  section?: CompletionReportSection;
  label: string;
  handled: boolean;
  reopen: string;
  fingerprint?: string;
  inCurrentJob: boolean;
  createdAt: number;
};

/** The item fields a fingerprint is made of. */
export type FingerprintedItem = {
  kind: "rule" | "content" | "reference";
  section: CompletionReportSection;
  paragraph: number;
  instruction: string;
};

function normalizedInstruction(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim().replace(/[\s.!?;:,]+$/, "");
}

/** FNV-1a, 32 bits, as eight hex digits. */
function fnv1a(text: string, seed: number): string {
  let hash = seed >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * What a content or reference item is: its kind, Line, paragraph and
 * instruction (the writer's correction verbatim, or the structural
 * difference), normalized and hashed. Undefined for a rule item, whose id is
 * already stable.
 */
export function itemFingerprint(item: FingerprintedItem): string | undefined {
  if (item.kind === "rule") return undefined;
  const text = `${item.kind}|${item.section}|${item.paragraph}|${normalizedInstruction(item.instruction)}`;
  return `${fnv1a(text, 0x811c9dc5)}${fnv1a(text, 0x01234567)}`;
}

/** A rule item's coverage lasts the whole conversation, keyed by its id. */
export function coverageLastsWholeConversation(itemId: string): boolean {
  return itemId.startsWith("r-");
}

/**
 * A writer message that carries on the job before it rather than starting a
 * new one: the Continue button's "Continue with Line N." and "Continue.", or
 * the same typed by hand. Used only for cards saved without a fingerprint.
 */
export function isContinuePrompt(text: string): boolean {
  return /^\s*continue(\s+with\s+line\s+(242|244|246))?\s*[.!]?\s*$/i.test(text);
}

function coverageOf(row: ItemCoverageRow): ItemCoverage {
  const base = {
    itemId: row.itemId,
    ...(row.section ? { section: row.section } : {}),
    ...(row.fingerprint ? { fingerprint: row.fingerprint } : {}),
    inCurrentJob: row.inCurrentJob,
    createdAt: row.createdAt,
  };
  if (row.status === "blocked") {
    return {
      ...base,
      label: "blocked: needs a missing fact from the writer",
      handled: true,
      reopen: "revise it once the writer supplies that fact",
    };
  }
  if (row.status === "conflicting") {
    return {
      ...base,
      label: "conflicting: needs the writer's decision",
      handled: true,
      reopen: "revise it once the writer decides",
    };
  }
  switch (row.proposalState) {
    case "pending":
      return {
        ...base,
        label: "already on a pending card",
        handled: true,
        reopen:
          "revise it if the writer asks to refine or redo that card; to refine a pending proposeBulkEdits card, propose its whole set again, this item included",
      };
    case "applied":
      return { ...base, label: "applied", handled: true, reopen: "revise it if the writer asks for it to be redone" };
    case "rejected":
      return { ...base, label: "the writer rejected the card that carried it", handled: false, reopen: "it may be revised again" };
    case "stale":
      return { ...base, label: "the card that carried it went stale", handled: false, reopen: "it may be revised again" };
  }
}

/**
 * One entry per item id and fingerprint (and, for a card without one, per
 * job): the newest row decides. `rows` come newest card first, so on equal
 * times the row seen first wins.
 */
export function itemCoverage(rows: ReadonlyArray<ItemCoverageRow>): ItemCoverage[] {
  const newest = new Map<string, ItemCoverageRow>();
  for (const row of rows) {
    const key = coverageLastsWholeConversation(row.itemId)
      ? row.itemId
      : `${row.itemId}|${row.fingerprint ?? `nofp:${row.inCurrentJob}`}`;
    const seen = newest.get(key);
    if (!seen || row.createdAt > seen.createdAt) newest.set(key, row);
  }
  return [...newest.values()].map(coverageOf);
}

/** Whether one card entry covers one current item (the rule above). */
export function entryCovers(
  entry: ItemCoverage,
  item: { id: string; fingerprint?: string | undefined }
): boolean {
  if (coverageLastsWholeConversation(item.id)) return entry.itemId === item.id;
  if (coverageLastsWholeConversation(entry.itemId)) return false;
  if (entry.fingerprint !== undefined && item.fingerprint !== undefined && entry.fingerprint === item.fingerprint) {
    return true;
  }
  return entry.inCurrentJob && entry.itemId === item.id;
}

/**
 * The coverage that applies to one current item: a rule item by its id; a
 * content or reference item by its fingerprint, or by its id within the
 * current job (`entryCovers`). The newest wins.
 */
export function coverageFor(
  coverage: ReadonlyArray<ItemCoverage>,
  item: { id: string; fingerprint?: string | undefined }
): ItemCoverage | undefined {
  let best: ItemCoverage | undefined;
  for (const entry of coverage) {
    if (entryCovers(entry, item) && (!best || entry.createdAt > best.createdAt)) best = entry;
  }
  return best;
}

/**
 * The per-turn note line: handled items per Line, or null when there are none.
 * Round 4 (N3): counted before the turn's list exists, so only what the list
 * is sure to mark: rule items, and content or reference items of the current
 * job. An earlier job's item still gets its mark if it comes back with the
 * same fingerprint; the note leaves it out rather than count it unseen.
 */
export function handledItemsNote(coverage: ReadonlyArray<ItemCoverage>): string | null {
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  for (const item of coverage) {
    if (!item.handled) continue;
    if (!coverageLastsWholeConversation(item.itemId) && !item.inCurrentJob) continue;
    if (seen.has(item.itemId)) continue;
    seen.add(item.itemId);
    const line = item.section ?? "other";
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  const parts = (["242", "244", "246", "other"] as const)
    .filter((line) => counts.has(line))
    .map((line) => `${line === "other" ? "other items" : `Line ${line}`} ${counts.get(line)}`);
  return `Deviations already handled in this conversation (on a pending or applied card, or blocked or conflicting): ${parts.join(", ")}. deviationInventory and compareReferencePd mark each one still in the list; skip them unless the writer's message reopens one.`;
}

// ─── Items waiting on a pending card (Phase B, W2 round 2) ──────────────────

/**
 * A paragraph of a Line: `section` and its 1-based `paragraph`, the number
 * the writer sees (`chatProposalItems.paragraphNumber`).
 */
export type LineParagraph = { section: CompletionReportSection; paragraph: number };

/** A Deviation not handled yet that sits in a paragraph a pending card rewrites. */
export type WaitingItem = LineParagraph & { itemId: string };

function paragraphKey(place: LineParagraph): string {
  return `${place.section}:${place.paragraph}`;
}

/**
 * The paragraphs that a pending card of the current job already rewrites:
 * each resolved card item row of a pending card of this job that names its
 * Line and paragraph. A rejected or stale card rewrites nothing, and a pending card
 * of an earlier job is left out: a new request is the writer's own choice to
 * work on those paragraphs again, while a job (and its Continue chain) must
 * not overwrite the card it just made.
 */
export function pendingCardParagraphs(rows: ReadonlyArray<ItemCoverageRow>): LineParagraph[] {
  const places = new Map<string, LineParagraph>();
  for (const row of rows) {
    if (row.proposalState !== "pending" || !row.inCurrentJob) continue;
    // Review round 3 F1: only a row the card resolved stands for an edit; a
    // blocked or conflicting row rewrites nothing.
    if (row.status !== "resolved") continue;
    if (!row.section || row.paragraph === undefined || row.paragraph < 1) continue;
    const place = { section: row.section, paragraph: row.paragraph };
    places.set(paragraphKey(place), place);
  }
  return [...places.values()];
}

/** The 1-based paragraph an inventory id names (`r-242-1-4` is paragraph 1), if any. */
export function itemIdParagraph(itemId: string): number | undefined {
  const match = /^[rcx]-(?:242|244|246)-(\d+)-\d+$/.exec(itemId);
  const paragraph = match ? Number(match[1]) : NaN;
  return Number.isInteger(paragraph) && paragraph >= 1 ? paragraph : undefined;
}

/**
 * Split the items still to do into those waiting on a pending card (their
 * paragraph is already rewritten by one) and the rest. Waiting items are not
 * counted in the Continue offer and never decide its next Line.
 */
export function splitWaiting<T extends { section: CompletionReportSection; itemId: string; paragraph?: number }>(
  items: ReadonlyArray<T>,
  pending: ReadonlyArray<LineParagraph>
): { open: T[]; waiting: WaitingItem[] } {
  const covered = new Set(pending.map(paragraphKey));
  const open: T[] = [];
  const waiting: WaitingItem[] = [];
  for (const item of items) {
    const paragraph = item.paragraph ?? itemIdParagraph(item.itemId);
    if (paragraph !== undefined && covered.has(paragraphKey({ section: item.section, paragraph }))) {
      waiting.push({ itemId: item.itemId, section: item.section, paragraph });
    } else {
      open.push(item);
    }
  }
  return { open, waiting };
}

/** The most waiting items one note or offer names. */
export const MAX_WAITING_ITEMS = 60;

/** The instruction that goes with waiting items, in the per-turn note and in the inventory. */
export const WAITING_ITEMS_INSTRUCTION =
  "These items sit in paragraphs a pending card already rewrites, so do not rewrite those paragraphs again. Name them in your closing by Line and paragraph, so the writer can refine that card or ask for them after applying it.";

/**
 * The per-turn note line for the current job's waiting items (ids and
 * Line and paragraph only), or null when there are none. Goes in the
 * per-turn tail, never the cached head.
 */
export function waitingItemsNote(waiting: ReadonlyArray<WaitingItem>): string | null {
  if (waiting.length === 0) return null;
  const listed = waiting
    .slice(0, MAX_WAITING_ITEMS)
    .map((item) => `${item.itemId} (Line ${item.section}, paragraph ${item.paragraph})`);
  const more = waiting.length > MAX_WAITING_ITEMS ? `, and ${waiting.length - MAX_WAITING_ITEMS} more` : "";
  return `Deviations waiting on a pending card: ${listed.join(", ")}${more}. ${WAITING_ITEMS_INSTRUCTION}`;
}
