// Report chat parity, Phase B (2026-10-20): the reads behind the chat's three
// reading tools (`convex/ai/chatDocumentTools.ts`). Internal queries only:
// the streaming action is internal and carries no identity, so every query
// scopes itself through the thread row (`agentChatThreads`): the thread's
// project, the thread's report in that same project, and the file or
// transcript in that project. Archived files, removed or replaced
// transcripts and projects being deleted read as not found.
//
// What these queries return reaches the model for the current turn only. The
// tool stores a receipt, never this text (see chatDocumentTools.ts), and
// nothing here logs, stores or returns text anywhere else.

import { internalQuery, type QueryCtx } from "./_generated/server";
import { getConvexSize, v, type Value } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { isProjectDeleting } from "./lib/projectDeletion";
import { chatDocumentToolsEnabled } from "./appSettings";
import { listActiveTranscriptRows, projectTranscriptsFrom, transcriptLabel } from "./lib/transcripts";
import { evidenceRole, listSpeakerRows } from "./lib/transcriptStructure";
import { formatTimestamp } from "../shared/transcriptParse";
import { STOP_WORDS, chunkScore } from "./ai/research/core";
import type { ChatEvidenceTranscript, ChatSpeakerRole } from "./ai/chatEvidence";

// ─── Shared reading limits ───────────────────────────────────────────────────

/** One part of a file or of a transcript without speaker turns. */
export const CHAT_READ_PART_CHARS = 40_000;
/** At most this many characters reach the model from one reading call. */
export const CHAT_READ_MAX_CALL_CHARS = 120_000;
/** Shared by all three reading tools across every pass of one turn. */
export const CHAT_READ_MAX_TURN_CHARS = 240_000;
/** readDocument's `parts` ceiling: three parts are the per-call cap. */
export const CHAT_READ_MAX_PARTS = CHAT_READ_MAX_CALL_CHARS / CHAT_READ_PART_CHARS;
/** readTranscript reads at most this many characters of turns per call. */
export const CHAT_TRANSCRIPT_READ_CHARS = 40_000;
/** searchDocuments returns at most this many excerpts... */
export const CHAT_SEARCH_MAX_EXCERPTS = 8;
/** ...of at most this many characters each. */
export const CHAT_SEARCH_EXCERPT_CHARS = 1_500;
/** Excerpts one file or transcript may give a search. */
const SEARCH_EXCERPTS_PER_SOURCE = 3;
/** Files the search index hands the search, archived rows included. */
const SEARCH_FILE_CANDIDATES = 16;
/** Convex full text search takes a bounded number of terms. */
const SEARCH_INDEX_TERMS = 16;
/** Turns one transcript gives the search or a read, scanned in index order. */
const MAX_TURNS_SCANNED = 8_000;

// ─── Read budget (the chatReadBudget pattern, convex/chatV2.ts) ──────────────

const MIB = 1 << 20;
const CHAT_DOCUMENT_READ_BYTES = 8 * MIB;
/** Room for one maximum-size row before each read. */
const ROW_HEADROOM = MIB + 4096;
const ROW_OVERHEAD = 256;

/**
 * What `chatV2.getChatContextV2`'s budget and this module's share: reserve
 * before a read, charge what was read, and stop (reporting it) rather than
 * let the transaction pass Convex's read limit.
 */
export interface ChatReadBudget {
  read<T>(fn: () => Promise<T>, extraBytes?: number): Promise<{ ok: true; value: T } | { ok: false }>;
}

function documentReadBudget() {
  let used = 0;
  const reserve = () => used + ROW_HEADROOM <= CHAT_DOCUMENT_READ_BYTES;
  const account = (value: unknown) => {
    used += getConvexSize(value as Value) + ROW_OVERHEAD;
  };
  return {
    async read<T>(fn: () => Promise<T>, extraBytes = 0): Promise<{ ok: true; value: T } | { ok: false }> {
      if (!reserve()) return { ok: false };
      const value = await fn();
      used += extraBytes;
      if (Array.isArray(value)) value.forEach(account);
      else if (value !== null && value !== undefined && typeof value === "object") account(value);
      return { ok: true, value };
    },
    /** Walk an async source up to `cap` rows within the budget. */
    async list<T>(source: AsyncIterable<T>, cap: number): Promise<{ rows: T[]; complete: boolean }> {
      const rows: T[] = [];
      const iterator = source[Symbol.asyncIterator]();
      try {
        while (reserve()) {
          if (rows.length >= cap) return { rows, complete: false };
          const next = await iterator.next();
          if (next.done) return { rows, complete: true };
          account(next.value);
          rows.push(next.value);
        }
        return { rows, complete: false };
      } finally {
        await iterator.return?.();
      }
    },
  };
}

// ─── Scope ───────────────────────────────────────────────────────────────────

/**
 * The thread's project, when the thread, its report and its project all
 * stand: the report must belong to the thread's project, and the project
 * must not be on its way out.
 */
async function chatScope(ctx: QueryCtx, agentThreadId: string): Promise<{ projectId: Id<"projects"> } | null> {
  const thread = await ctx.db
    .query("agentChatThreads")
    .withIndex("by_agentThreadId", (q) => q.eq("agentThreadId", agentThreadId))
    .unique();
  if (!thread) return null;
  if (await isProjectDeleting(ctx, thread.projectId)) return null;
  const report = await ctx.db.get(thread.reportId);
  if (!report || report.projectId !== thread.projectId) return null;
  return { projectId: thread.projectId };
}

/** An active transcript of the project: not removed, not replaced, not empty. */
function isActiveTranscript(row: Doc<"transcripts"> | null, projectId: Id<"projects">): row is Doc<"transcripts"> {
  return (
    row !== null &&
    row.projectId === projectId &&
    row.archivedAt === undefined &&
    row.supersededById === undefined &&
    row.content.trim() !== ""
  );
}

// ─── Text helpers ────────────────────────────────────────────────────────────

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/** `[start, end)` moved so neither end splits a surrogate pair. */
export function safeRange(text: string, start: number, end: number): { start: number; end: number } {
  let from = Math.max(0, Math.min(start, text.length));
  let to = Math.max(from, Math.min(end, text.length));
  if (from > 0 && from < text.length && isLowSurrogate(text.charCodeAt(from))) from -= 1;
  if (to > from && to < text.length && isHighSurrogate(text.charCodeAt(to - 1))) to -= 1;
  return { start: from, end: to };
}

/** A speaker role as a readTranscript line opens it. */
export const CHAT_TURN_ROLE_WORDS: Readonly<Record<ChatSpeakerRole, string>> = {
  interviewer: "Interviewer",
  client: "Client",
  other: "Other",
  unknown: "Role unknown",
};

/** One line breaks nothing: the turn's text is folded to one line. */
function oneLine(text: string): string {
  return text.replace(/[\r\n\u2028\u2029\v\f]+/g, " ").trim();
}

/**
 * One turn as the model reads it: `[turn 12, 00:14:32] Interviewer (Dana
 * Whitfield): text`, with the turn's stored text and the label as written.
 * Turn numbers are 1-based.
 */
export function transcriptTurnLine(
  turn: Pick<Doc<"transcriptTurns">, "index" | "startMs" | "speakerLabel" | "cleanText">,
  role: ChatSpeakerRole
): string {
  const at = turn.startMs === undefined ? "" : `, ${formatTimestamp(turn.startMs)}`;
  const speaker = turn.speakerLabel
    ? `${CHAT_TURN_ROLE_WORDS[role]} (${oneLine(turn.speakerLabel)})`
    : "No speaker label";
  return `[turn ${turn.index + 1}${at}] ${speaker}: ${oneLine(turn.cleanText)}`;
}

/** The speakers' evidence roles of one transcript, keyed by label. */
async function speakerRoles(ctx: QueryCtx, transcriptId: Id<"transcripts">): Promise<Map<string, ChatSpeakerRole>> {
  const rows = await listSpeakerRows(ctx, transcriptId);
  return new Map(rows.map((row) => [row.label, evidenceRole(row)]));
}

// ─── The transcripts list for the evidence head ──────────────────────────────

/**
 * The project's active transcripts as the TRANSCRIPTS IN THIS PROJECT block
 * lists them, in the project's transcript order (`listProjectTranscripts`):
 * label, speaker turns (the newest stored turn's index plus one), characters
 * and speakers with their evidence roles. Each read is reserved on `budget`
 * first; a read the budget refuses ends the list, marked incomplete.
 */
export async function chatTranscriptSummaries(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  budget: ChatReadBudget
): Promise<{ transcripts: ChatEvidenceTranscript[]; complete: boolean }> {
  const read = await budget.read(() => listActiveTranscriptRows(ctx, projectId));
  if (!read.ok) return { transcripts: [], complete: false };
  const rows = projectTranscriptsFrom(read.value);
  const transcripts: ChatEvidenceTranscript[] = [];
  for (const row of rows) {
    const speakers = await budget.read(() => listSpeakerRows(ctx, row._id));
    const last = await budget.read(() =>
      ctx.db
        .query("transcriptTurns")
        .withIndex("by_transcriptId_and_index", (q) => q.eq("transcriptId", row._id))
        .order("desc")
        .first()
    );
    if (!speakers.ok || !last.ok) return { transcripts, complete: false };
    transcripts.push({
      transcriptId: row._id,
      label: transcriptLabel(row),
      turnCount: last.value ? last.value.index + 1 : 0,
      chars: row.content.length,
      speakers: speakers.value.map((speaker) => ({ label: speaker.label, role: evidenceRole(speaker) })),
    });
  }
  return { transcripts, complete: true };
}

// ─── readDocument ────────────────────────────────────────────────────────────

export type ReadDocumentResult =
  | { status: "off" }
  | { status: "unavailable" }
  | { status: "not_found" }
  | { status: "no_text"; fileName: string }
  | { status: "past_end"; fileName: string; totalChars: number }
  | {
      status: "ok";
      fileName: string;
      category?: Doc<"projectDocuments">["category"];
      uploaderRole?: string;
      totalChars: number;
      start: number;
      end: number;
      text: string;
    };

/**
 * Up to `maxChars` characters of one project file's stored text, from
 * `start`. The file must be the thread's project's and not archived.
 */
export const readDocumentForChat = internalQuery({
  args: {
    agentThreadId: v.string(),
    documentId: v.id("projectDocuments"),
    start: v.number(),
    maxChars: v.number(),
  },
  handler: async (ctx, args): Promise<ReadDocumentResult> => {
    if (!(await chatDocumentToolsEnabled(ctx))) return { status: "off" };
    const scope = await chatScope(ctx, args.agentThreadId);
    if (!scope) return { status: "unavailable" };
    const doc = await ctx.db.get(args.documentId);
    if (!doc || doc.projectId !== scope.projectId || doc.archived) return { status: "not_found" };
    const content = doc.content;
    if (content.trim() === "") return { status: "no_text", fileName: doc.fileName };
    if (args.start >= content.length) {
      return { status: "past_end", fileName: doc.fileName, totalChars: content.length };
    }
    const range = safeRange(content, args.start, args.start + Math.max(0, Math.floor(args.maxChars)));
    return {
      status: "ok",
      fileName: doc.fileName,
      ...(doc.category ? { category: doc.category } : {}),
      ...(doc.uploaderRole ? { uploaderRole: doc.uploaderRole } : {}),
      totalChars: content.length,
      start: range.start,
      end: range.end,
      text: content.slice(range.start, range.end),
    };
  },
});

// ─── readTranscript ──────────────────────────────────────────────────────────

export type ReadTranscriptResult =
  | { status: "off" }
  | { status: "unavailable" }
  | { status: "not_found" }
  | { status: "past_end"; label: string; totalTurns: number; totalChars: number }
  | {
      status: "turns";
      label: string;
      totalTurns: number;
      /** 0-based indexes of the first and last turn read. */
      firstIndex: number;
      lastIndex: number;
      /** The last turn read was cut to fit `maxChars`. */
      cutShort: boolean;
      text: string;
    }
  | {
      status: "chars";
      label: string;
      totalChars: number;
      start: number;
      end: number;
      text: string;
    };

/**
 * One page of an active transcript of the thread's project. With stored
 * speaker turns it reads whole turns from `fromIndex`, as lines, until
 * `maxChars` or `maxTurns`; a transcript with no turns is read by
 * characters from `fromIndex * CHAT_READ_PART_CHARS` (the part).
 */
export const readTranscriptForChat = internalQuery({
  args: {
    agentThreadId: v.string(),
    transcriptId: v.id("transcripts"),
    fromIndex: v.number(),
    maxTurns: v.optional(v.number()),
    maxChars: v.number(),
  },
  handler: async (ctx, args): Promise<ReadTranscriptResult> => {
    if (!(await chatDocumentToolsEnabled(ctx))) return { status: "off" };
    const scope = await chatScope(ctx, args.agentThreadId);
    if (!scope) return { status: "unavailable" };
    const transcript = await ctx.db.get(args.transcriptId);
    if (!isActiveTranscript(transcript, scope.projectId)) return { status: "not_found" };
    const label = transcriptLabel(transcript);
    const maxChars = Math.max(1, Math.floor(args.maxChars));
    const fromIndex = Math.max(0, Math.floor(args.fromIndex));
    const last = await ctx.db
      .query("transcriptTurns")
      .withIndex("by_transcriptId_and_index", (q) => q.eq("transcriptId", transcript._id))
      .order("desc")
      .first();
    if (!last) {
      // No parsed turns: page by characters, one part per index.
      const start = fromIndex * CHAT_READ_PART_CHARS;
      if (start >= transcript.content.length) {
        return { status: "past_end", label, totalTurns: 0, totalChars: transcript.content.length };
      }
      const range = safeRange(transcript.content, start, start + Math.min(maxChars, CHAT_READ_PART_CHARS));
      return {
        status: "chars",
        label,
        totalChars: transcript.content.length,
        start: range.start,
        end: range.end,
        text: transcript.content.slice(range.start, range.end),
      };
    }
    const totalTurns = last.index + 1;
    if (fromIndex >= totalTurns) {
      return { status: "past_end", label, totalTurns, totalChars: transcript.content.length };
    }
    const roles = await speakerRoles(ctx, transcript._id);
    const maxTurns = args.maxTurns === undefined ? Number.POSITIVE_INFINITY : Math.max(1, Math.floor(args.maxTurns));
    const lines: string[] = [];
    let used = 0;
    let firstIndex = -1;
    let lastIndex = -1;
    let cutShort = false;
    const turns = ctx.db
      .query("transcriptTurns")
      .withIndex("by_transcriptId_and_index", (q) => q.eq("transcriptId", transcript._id).gte("index", fromIndex));
    for await (const turn of turns) {
      if (lines.length >= maxTurns) break;
      const line = transcriptTurnLine(turn, turn.speakerLabel ? (roles.get(turn.speakerLabel) ?? "unknown") : "unknown");
      const cost = line.length + (lines.length ? 1 : 0);
      if (used + cost > maxChars) {
        // The first turn always comes back, cut to fit, so a call never
        // returns nothing for a very long turn.
        if (lines.length === 0) {
          const range = safeRange(line, 0, maxChars);
          lines.push(line.slice(0, range.end));
          firstIndex = turn.index;
          lastIndex = turn.index;
          cutShort = true;
        }
        break;
      }
      lines.push(line);
      used += cost;
      if (firstIndex < 0) firstIndex = turn.index;
      lastIndex = turn.index;
    }
    if (lines.length === 0) {
      return { status: "past_end", label, totalTurns, totalChars: transcript.content.length };
    }
    return { status: "turns", label, totalTurns, firstIndex, lastIndex, cutShort, text: lines.join("\n") };
  },
});

// ─── searchDocuments ─────────────────────────────────────────────────────────

/** Lower case, compatibility forms folded and accents removed, for matching. */
export function foldForSearch(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase();
}

/** Common French function words and short English ones, beside research's list. */
const EXTRA_STOP_WORDS: ReadonlySet<string> = new Set([
  "les", "des", "une", "pour", "dans", "avec", "sur", "est", "que", "qui", "par", "pas",
  "aux", "ces", "son", "ses", "leur", "leurs", "mais", "plus", "comme", "nous", "vous",
  // Short English words research's list leaves to its length rule.
  "the", "and", "for", "are", "was", "were", "has", "had", "not", "but", "you", "our", "can",
]);

/**
 * Query terms for the chat's search. Unlike Contextual Research's
 * `queryTerms` (ASCII only, which drops accented letters), any letter or
 * digit counts, so "étalonnage" and "contrôle" are terms; matching is done
 * on accent-folded text, so "etalonnage" finds "étalonnage" too. `index` is
 * what the full text index is asked: each term as written and folded.
 */
export function chatSearchTerms(query: string): { terms: string[]; index: string } {
  const words = query.normalize("NFC").toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]*/gu) ?? [];
  const written: string[] = [];
  const folded = new Set<string>();
  for (const raw of words) {
    const word = raw.replace(/-+$/u, "");
    const fold = foldForSearch(word);
    if ([...fold].length < 3 || STOP_WORDS.has(fold) || EXTRA_STOP_WORDS.has(fold)) continue;
    if (!folded.has(fold)) {
      folded.add(fold);
      written.push(word);
    }
  }
  const terms = [...folded].slice(0, 40);
  const indexTerms = [...new Set([...written, ...terms])].slice(0, SEARCH_INDEX_TERMS);
  return { terms, index: indexTerms.join(" ") };
}

/** A span of text and where it starts in its source. */
type Span = { start: number; end: number };

/**
 * Paragraph groups of at most `maxChars`, with their offsets in `content`.
 * The rule of research's `documentChunks` (blank lines split paragraphs; a
 * paragraph too long for one group is cut in windows), at the chat's
 * excerpt size, with offsets so an excerpt can say which part it is in.
 */
export function chunkSpans(content: string, maxChars: number): Span[] {
  const paragraphs: Span[] = [];
  const separator = /\n[ \t\r\f\v]*\n\s*/g;
  let cursor = 0;
  const push = (start: number, end: number) => {
    const text = content.slice(start, end);
    const lead = text.length - text.trimStart().length;
    const trail = text.length - text.trimEnd().length;
    if (end - trail > start + lead) paragraphs.push({ start: start + lead, end: end - trail });
  };
  for (const match of content.matchAll(separator)) {
    push(cursor, match.index);
    cursor = match.index + match[0].length;
  }
  push(cursor, content.length);
  const spans: Span[] = [];
  let current: Span | null = null;
  for (const paragraph of paragraphs) {
    const length = paragraph.end - paragraph.start;
    if (length > maxChars) {
      if (current) spans.push(current);
      current = null;
      const step = Math.max(1, Math.floor(maxChars * 0.8));
      for (let start = paragraph.start; start < paragraph.end; start += step) {
        const range = safeRange(content, start, Math.min(paragraph.end, start + maxChars));
        spans.push(range);
        if (start + maxChars >= paragraph.end) break;
      }
    } else if (!current || paragraph.end - current.start <= maxChars) {
      current = current ? { start: current.start, end: paragraph.end } : { ...paragraph };
    } else {
      spans.push(current);
      current = { ...paragraph };
    }
  }
  if (current) spans.push(current);
  return spans;
}

export type SearchExcerpt =
  | {
      kind: "file";
      documentId: Id<"projectDocuments">;
      fileName: string;
      category?: Doc<"projectDocuments">["category"];
      uploaderRole?: string;
      /** Where the excerpt starts in the file's text. */
      start: number;
      text: string;
    }
  | {
      kind: "transcript";
      transcriptId: Id<"transcripts">;
      label: string;
      /** 0-based turn indexes, for a transcript with turns. */
      firstIndex?: number;
      lastIndex?: number;
      /** Where the excerpt starts in the text, for one without turns. */
      start?: number;
      text: string;
    };

export type SearchDocumentsResult =
  | { status: "off" }
  | { status: "unavailable" }
  | { status: "no_terms" }
  | {
      status: "ok";
      excerpts: SearchExcerpt[];
      /** False when a read bound stopped the search before it saw everything. */
      complete: boolean;
    };

type Candidate = { score: number; order: number; source: string; excerpt: SearchExcerpt };

/**
 * Consecutive turns as lines, grouped up to `maxChars` per group. A single
 * turn longer than that is cut to fit.
 */
export function turnGroups(
  turns: ReadonlyArray<Pick<Doc<"transcriptTurns">, "index" | "startMs" | "speakerLabel" | "cleanText">>,
  roles: ReadonlyMap<string, ChatSpeakerRole>,
  maxChars: number
): Array<{ firstIndex: number; lastIndex: number; text: string }> {
  const groups: Array<{ firstIndex: number; lastIndex: number; text: string }> = [];
  let lines: string[] = [];
  let chars = 0;
  let firstIndex = 0;
  let lastIndex = 0;
  const flush = () => {
    if (lines.length) groups.push({ firstIndex, lastIndex, text: lines.join("\n") });
    lines = [];
    chars = 0;
  };
  for (const turn of turns) {
    const role = turn.speakerLabel ? (roles.get(turn.speakerLabel) ?? "unknown") : "unknown";
    let line = transcriptTurnLine(turn, role);
    if (line.length > maxChars) line = line.slice(0, safeRange(line, 0, maxChars).end);
    if (lines.length && chars + 1 + line.length > maxChars) flush();
    if (!lines.length) firstIndex = turn.index;
    chars += (lines.length ? 1 : 0) + line.length;
    lines.push(line);
    lastIndex = turn.index;
  }
  flush();
  return groups;
}

/**
 * The best excerpts for a query across the thread's project files (through
 * the `search_content` index, archived rows dropped after the read) and its
 * active transcripts (in memory, by groups of speaker turns), at most
 * CHAT_SEARCH_MAX_EXCERPTS of at most CHAT_SEARCH_EXCERPT_CHARS each and
 * `maxChars` in all, best first.
 */
export const searchForChat = internalQuery({
  args: { agentThreadId: v.string(), query: v.string(), maxChars: v.number() },
  handler: async (ctx, args): Promise<SearchDocumentsResult> => {
    if (!(await chatDocumentToolsEnabled(ctx))) return { status: "off" };
    const scope = await chatScope(ctx, args.agentThreadId);
    if (!scope) return { status: "unavailable" };
    const { terms, index } = chatSearchTerms(args.query);
    if (terms.length === 0) return { status: "no_terms" };
    const budget = documentReadBudget();
    const candidates: Candidate[] = [];
    let order = 0;
    let complete = true;
    const consider = (source: string, text: string, excerpt: SearchExcerpt) => {
      const score = chunkScore(foldForSearch(text), terms);
      if (score > 0) candidates.push({ score, order: order++, source, excerpt });
    };

    // Project files: the full text index narrows the candidates.
    const files = await budget.list(
      ctx.db
        .query("projectDocuments")
        .withSearchIndex("search_content", (q) => q.search("content", index).eq("projectId", scope.projectId)),
      SEARCH_FILE_CANDIDATES
    );
    if (!files.complete && files.rows.length < SEARCH_FILE_CANDIDATES) complete = false;
    for (const doc of files.rows) {
      if (doc.archived || doc.projectId !== scope.projectId || doc.content.trim() === "") continue;
      for (const span of chunkSpans(doc.content, CHAT_SEARCH_EXCERPT_CHARS)) {
        const text = doc.content.slice(span.start, span.end);
        consider(`file:${doc._id}`, text, {
          kind: "file",
          documentId: doc._id,
          fileName: doc.fileName,
          ...(doc.category ? { category: doc.category } : {}),
          ...(doc.uploaderRole ? { uploaderRole: doc.uploaderRole } : {}),
          start: span.start,
          text,
        });
      }
    }

    // Active transcripts, in memory: by groups of whole turns where the
    // turn build stored them, by characters otherwise.
    const rows = await budget.read(() => listActiveTranscriptRows(ctx, scope.projectId));
    if (!rows.ok) complete = false;
    for (const transcript of rows.ok ? projectTranscriptsFrom(rows.value) : []) {
      const label = transcriptLabel(transcript);
      const turns = await budget.list(
        ctx.db
          .query("transcriptTurns")
          .withIndex("by_transcriptId_and_index", (q) => q.eq("transcriptId", transcript._id)),
        MAX_TURNS_SCANNED
      );
      if (!turns.complete) complete = false;
      if (turns.rows.length === 0) {
        if (!turns.complete) break;
        for (const span of chunkSpans(transcript.content, CHAT_SEARCH_EXCERPT_CHARS)) {
          const text = transcript.content.slice(span.start, span.end);
          consider(`transcript:${transcript._id}`, text, {
            kind: "transcript",
            transcriptId: transcript._id,
            label,
            start: span.start,
            text,
          });
        }
        continue;
      }
      const roles = await speakerRoles(ctx, transcript._id);
      for (const group of turnGroups(turns.rows, roles, CHAT_SEARCH_EXCERPT_CHARS)) {
        consider(`transcript:${transcript._id}`, group.text, {
          kind: "transcript",
          transcriptId: transcript._id,
          label,
          firstIndex: group.firstIndex,
          lastIndex: group.lastIndex,
          text: group.text,
        });
      }
    }

    // Best first; ties keep the order the sources were read in.
    candidates.sort((a, b) => b.score - a.score || a.order - b.order);
    const perSource = new Map<string, number>();
    const excerpts: SearchExcerpt[] = [];
    let left = Math.max(0, Math.floor(args.maxChars));
    for (const candidate of candidates) {
      if (excerpts.length >= CHAT_SEARCH_MAX_EXCERPTS || left <= 0) break;
      const count = perSource.get(candidate.source) ?? 0;
      if (count >= SEARCH_EXCERPTS_PER_SOURCE) continue;
      const take = Math.min(candidate.excerpt.text.length, CHAT_SEARCH_EXCERPT_CHARS, left);
      const text = candidate.excerpt.text.slice(0, safeRange(candidate.excerpt.text, 0, take).end);
      if (!text) break;
      excerpts.push({ ...candidate.excerpt, text });
      perSource.set(candidate.source, count + 1);
      left -= text.length;
    }
    return { status: "ok", excerpts, complete };
  },
});
