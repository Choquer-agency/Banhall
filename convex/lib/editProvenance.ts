import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  MAX_CLAIMS_PER_REVISION,
  MAX_CLAIM_TEXT_LENGTH,
  sha256,
} from "./contracts";
import { plainTextLines } from "./reportEdits";
import { NOT_GENERATED_PLACEHOLDER, sectionOfHeading } from "./tiptapReport";
import { generationTranscriptIds } from "./transcripts";

// Amendment 2026-09-25 (fifth): a human edit carries the report's claim
// record over to the new revision instead of clearing it. Unchanged claims
// keep their review state and sources; a claim whose paragraph changed is
// moved to the new wording and needs review again; a claim whose paragraph
// was deleted is dropped; a new paragraph in a Section is a new claim that
// needs review. The manager's claim review and the filing gate then apply
// to the new revision exactly as they do to a generated one.

type Claim = Doc<"reportProvenance">["claims"][number];
type Section = Claim["section"];
type Line = { text: string; section: Section | null };

const MAX_ALIGNED_CELLS = 4_000_000;

/** Split a report document into its plain-text lines (the lines of
 * extractPlainText), tagged by Section. Section boundaries come from the
 * Section heading nodes, never from what a line says: a paragraph that
 * starts "Line 246" is still prose and still a claim. Heading lines and
 * lines before the first Section heading carry no Section: they are never
 * claims. A document that does not parse has no lines. */
function linesOf(content: string): Line[] {
  const lines: Line[] = [];
  try {
    const top = (JSON.parse(content) as { content?: unknown }).content;
    if (!Array.isArray(top)) return [];
    let section: Section | null = null;
    for (const node of top as Array<Record<string, unknown>>) {
      const heading = sectionOfHeading(node);
      if (heading) section = heading.slice(1) as Section;
      for (const text of plainTextLines(node)) {
        lines.push({ text, section: heading ? null : section });
      }
    }
  } catch {
    return []; // As extractPlainText: an unreadable document has no text.
  }
  return lines;
}

function isClaimLine(line: Line): boolean {
  const text = line.text.trim();
  return (
    line.section !== null &&
    text.length > 0 &&
    text !== NOT_GENERATED_PLACEHOLDER &&
    text !== "———"
  );
}

/** Pair old and new lines that are identical and in order (longest common
 * subsequence). Returns, for each old line, the new index it kept or -1. */
function alignLines(oldLines: Line[], newLines: Line[]): number[] | null {
  const kept = new Array<number>(oldLines.length).fill(-1);
  let start = 0;
  while (
    start < oldLines.length &&
    start < newLines.length &&
    oldLines[start].text === newLines[start].text
  ) {
    kept[start] = start;
    start += 1;
  }
  let oldEnd = oldLines.length;
  let newEnd = newLines.length;
  while (
    oldEnd > start &&
    newEnd > start &&
    oldLines[oldEnd - 1].text === newLines[newEnd - 1].text
  ) {
    oldEnd -= 1;
    newEnd -= 1;
    kept[oldEnd] = newEnd;
  }
  const rows = oldEnd - start;
  const cols = newEnd - start;
  if (rows === 0 || cols === 0) return kept;
  if (rows * cols > MAX_ALIGNED_CELLS) return null;
  const width = cols + 1;
  const table = new Uint32Array((rows + 1) * width);
  for (let i = rows - 1; i >= 0; i--) {
    for (let j = cols - 1; j >= 0; j--) {
      table[i * width + j] =
        oldLines[start + i].text === newLines[start + j].text
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (oldLines[start + i].text === newLines[start + j].text) {
      kept[start + i] = start + j;
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return kept;
}

function words(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []);
}

export type CarriedClaims = {
  claims: Array<Omit<Claim, "claimTextHash"> & { claimTextHash?: string }>;
};

/**
 * Carry claims from the previous revision's document (Tiptap JSON) to the
 * next one. Pure, so the rule is tested without a database. `newClaimPrefix` makes the ids of
 * claims for new paragraphs unique to the revision that added them. Returns
 * null when the two texts are too large to compare.
 */
export function carryClaims(
  previousContent: string,
  nextContent: string,
  claims: readonly Claim[],
  newClaimPrefix: string
): CarriedClaims | null {
  const oldLines = linesOf(previousContent);
  const newLines = linesOf(nextContent);
  const kept = alignLines(oldLines, newLines);
  if (!kept) return null;
  const keptNew = new Set(kept.filter((index) => index >= 0));
  const claimedNewLines = new Set<number>();
  const out: CarriedClaims["claims"] = [];

  // The new lines that took the place of old line `oldIndex`: those between
  // its nearest unchanged neighbours.
  const replacementRange = (oldIndex: number): [number, number] => {
    let before = oldIndex - 1;
    while (before >= 0 && kept[before] < 0) before -= 1;
    let after = oldIndex + 1;
    while (after < oldLines.length && kept[after] < 0) after += 1;
    return [
      before >= 0 ? kept[before] + 1 : 0,
      after < oldLines.length ? kept[after] : newLines.length,
    ];
  };

  for (const claim of claims) {
    const oldIndex = oldLines.findIndex((line) => line.text.includes(claim.claimText));
    if (oldIndex >= 0 && kept[oldIndex] >= 0) {
      // Its paragraph is word for word the same: the claim keeps its state.
      claimedNewLines.add(kept[oldIndex]);
      out.push(claim);
      continue;
    }
    if (oldIndex < 0) {
      // Not placeable in the previous text (an older revision's record).
      // Keep it for a manager to decide rather than lose it.
      const unchanged = newLines.some((line) => line.text.includes(claim.claimText));
      out.push(unchanged ? claim : { ...claim, state: "needs_review" });
      continue;
    }
    const [from, to] = replacementRange(oldIndex);
    const candidates: number[] = [];
    for (let index = from; index < to; index++) {
      if (isClaimLine(newLines[index]) && !claimedNewLines.has(index)) candidates.push(index);
    }
    if (candidates.length === 0) continue; // The paragraph was deleted.
    // Prefer the paragraph that still holds the claim's words (a sentence
    // added to it), then the one sharing the most words.
    let chosen = candidates.find((index) => newLines[index].text.includes(claim.claimText));
    if (chosen === undefined) {
      const oldWords = words(claim.claimText);
      let best = -1;
      for (const index of candidates) {
        let overlap = 0;
        for (const word of words(newLines[index].text)) if (oldWords.has(word)) overlap += 1;
        if (overlap > best) {
          best = overlap;
          chosen = index;
        }
      }
    }
    const line = newLines[chosen!];
    claimedNewLines.add(chosen!);
    out.push({
      ...claim,
      section: line.section ?? claim.section,
      claimText: line.text.trim().slice(0, MAX_CLAIM_TEXT_LENGTH),
      claimTextHash: undefined,
      state: "needs_review",
    });
  }

  // A paragraph the edit added to a Section, with no claim moved onto it,
  // is a new claim that needs review before export.
  let added = 0;
  newLines.forEach((line, index) => {
    if (keptNew.has(index) || claimedNewLines.has(index) || !isClaimLine(line)) return;
    added += 1;
    out.push({
      claimId: `${newClaimPrefix}-${line.section}-${added}`,
      section: line.section!,
      material: true,
      claimText: line.text.trim().slice(0, MAX_CLAIM_TEXT_LENGTH),
      state: "needs_review",
      sources: [],
    });
  });
  return { claims: out };
}

/** True when a row other than `report` points at this claim record: an
 * export, a snapshot, a candidate or another report. Such a record is part of
 * that row's history and is never changed or deleted by an edit. */
async function heldElsewhere(
  ctx: MutationCtx,
  provenanceId: Id<"reportProvenance">,
  reportId: Id<"reports"> | null
): Promise<boolean> {
  const reports = await ctx.db
    .query("reports")
    .withIndex("by_provenanceId", (q) => q.eq("provenanceId", provenanceId))
    .take(2);
  if (reports.some((row) => row._id !== reportId)) return true;
  for (const table of ["reportExports", "reportSnapshots", "reportCandidates"] as const) {
    const held = await ctx.db
      .query(table)
      .withIndex("by_provenanceId", (q) => q.eq("provenanceId", provenanceId))
      .first();
    if (held) return true;
  }
  return false;
}

/** Delete a claim record no report, export, snapshot or candidate holds any
 * more (a snapshot the retention rule just pruned, say). */
export async function deleteProvenanceIfUnheld(
  ctx: MutationCtx,
  provenanceId: Id<"reportProvenance">
): Promise<void> {
  if (await heldElsewhere(ctx, provenanceId, null)) return;
  if (await ctx.db.get(provenanceId)) await ctx.db.delete(provenanceId);
}

function sameClaims(a: readonly Claim[], b: readonly Claim[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Write the claim record for a report revision a human edit produced.
 * Returns the provenance id, or undefined when the previous revision had
 * no usable record (legacy reports stay unavailable, as before) or the edited
 * report has more claims than one record may hold.
 *
 * The editor autosaves every second of idle time, so an edit that leaves the
 * claims and status as they were reuses the previous record (its content hash
 * moves to the new revision) instead of inserting a copy. A record an export,
 * snapshot, candidate or another report holds is never changed: the edit then
 * inserts a new one. A superseded record nothing else holds is deleted.
 */
export async function provenanceForEdit(
  ctx: MutationCtx,
  report: Doc<"reports">,
  nextContent: string,
  options: { actorId?: Id<"users">; nextRevisionNumber: number; now: number }
): Promise<Id<"reportProvenance"> | undefined> {
  if (!report.provenanceId) return undefined;
  const previous = await ctx.db.get(report.provenanceId);
  if (!previous || previous.projectId !== report.projectId) return undefined;
  const carried = carryClaims(
    report.content,
    nextContent,
    previous.claims,
    `r${options.nextRevisionNumber}`
  );
  // The record the report drops. Nothing else may hold it once it is gone.
  const pruneable = !(await heldElsewhere(ctx, previous._id, report._id));
  if (!carried || carried.claims.length > MAX_CLAIMS_PER_REVISION) {
    if (pruneable) await ctx.db.delete(previous._id);
    return undefined;
  }
  const claims: Claim[] = await Promise.all(
    carried.claims.map(async (claim) => ({
      ...claim,
      claimTextHash: claim.claimTextHash ?? (await sha256(claim.claimText)),
    }))
  );
  const hasUnsupported = claims.some(
    (claim) => claim.material && claim.state === "unsupported"
  );
  const allApproved = claims.every(
    (claim) => !claim.material || claim.state === "approved"
  );
  // Never more approved than the previous record: an edit can keep an
  // approval, never grant one.
  const status: Doc<"reportProvenance">["status"] = hasUnsupported
    ? "rejected"
    : previous.status === "approved" && allApproved
      ? "approved"
      : "needs_review";
  const contentHash = await sha256(nextContent);
  if (pruneable && status === previous.status && sameClaims(claims, previous.claims)) {
    await ctx.db.patch(previous._id, { contentHash });
    return previous._id;
  }
  const nextId = await ctx.db.insert("reportProvenance", {
    projectId: previous.projectId,
    generationId: previous.generationId,
    sourceTranscriptId: previous.sourceTranscriptId,
    sourceTranscriptIds: previous.sourceTranscriptIds,
    digestIds: previous.digestIds,
    contentHash,
    status,
    claims,
    createdAt: options.now,
    createdBy: options.actorId ?? previous.createdBy,
    ...(status === "approved"
      ? { reviewedAt: previous.reviewedAt, reviewedBy: previous.reviewedBy }
      : {}),
  });
  if (pruneable) await ctx.db.delete(previous._id);
  return nextId;
}

/**
 * The claim record for a report assembled from Sections a writer approved
 * one at a time (the legacy Step by step flow). No quote was tied to that
 * text, so every Section paragraph is a claim that needs review.
 */
export async function provenanceForWriterApprovedReport(
  ctx: MutationCtx,
  args: {
    projectId: Id<"projects">;
    generation: Doc<"generations">;
    content: string;
    now: number;
  }
): Promise<Id<"reportProvenance"> | undefined> {
  const carried = carryClaims("", args.content, [], "approved");
  if (!carried || carried.claims.length > MAX_CLAIMS_PER_REVISION) return undefined;
  const claims: Claim[] = await Promise.all(
    carried.claims.map(async (claim) => ({
      ...claim,
      claimTextHash: await sha256(claim.claimText),
    }))
  );
  return await ctx.db.insert("reportProvenance", {
    projectId: args.projectId,
    generationId: args.generation._id,
    sourceTranscriptId: args.generation.transcriptId,
    sourceTranscriptIds: generationTranscriptIds(args.generation),
    contentHash: await sha256(args.content),
    status: "needs_review",
    claims,
    createdAt: args.now,
    createdBy: args.generation.requestedBy,
  });
}
