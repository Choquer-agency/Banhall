/**
 * Verified transcript facts (phase 3, the transcript method). Pure: windows
 * of turns for the extraction call, the server verifier that locates every
 * quote in the verbatim transcript, near-duplicate merge, and the
 * deterministic fact pack a generation freezes.
 *
 * Owner decisions: only client turns back a claim (25): a quote found only
 * in interviewer turns is never evidence, and a fact drawn only from them is
 * kept as context without a quote. Names reach the model as placeholders
 * (26): quotes come back through `restorePlaceholders` before they reach the
 * verifier here, which then works on the real verbatim text.
 *
 * Bump FACTS_VERSION whenever the extraction prompt, the verifier rules or
 * the stored fact shape change: stored facts are reused on (transcript,
 * text hash, FACTS_VERSION) alone.
 */
import { pseudonymize, type PlaceholderMap } from "./deidentify";
import {
  TRANSCRIPT_FACT_TYPES,
  type TranscriptFactType,
  type TranscriptSpeakerRole,
} from "./transcriptValidators";

export const FACTS_VERSION = "1";

/** Tokens (about 4 characters each) of turn lines one extraction call reads. */
export const FACT_WINDOW_TOKENS = 30_000;
/** Turns repeated at the start of the next window, so no fact is cut in two. */
export const FACT_WINDOW_OVERLAP_TURNS = 3;
/** A quote shorter than this says too little to back a claim. */
export const MIN_QUOTE_WORDS = 3;
export const MIN_QUOTE_CHARS = 12;

export type FactTurn = {
  index: number;
  speakerLabel?: string;
  role: TranscriptSpeakerRole;
  startMs?: number;
  charStart: number;
  charEnd: number;
  cleanText: string;
};

export type ProposedFact = {
  type: string;
  claim: string;
  /** Turn indexes the model pointed at (T0412 is 412). */
  turnIndexes: number[];
  /** Verbatim quotes, placeholders already restored. */
  quotes: string[];
};

export type VerifiedQuote = {
  charStart: number;
  charEnd: number;
  exactExcerpt: string;
  match: "exact" | "normalized";
};

export type VerifiedFact = {
  key: string;
  type: TranscriptFactType;
  claim: string;
  turnIndexes: number[];
  quotes: VerifiedQuote[];
  speakerLabel?: string;
  confidence: number;
};

export type FactCounts = { proposed: number; verified: number; dropped: number };

// ─── Windows and turn lines ────────────────────────────────────────────────

export function turnId(index: number): string {
  return `T${String(index).padStart(4, "0")}`;
}

export function parseTurnId(id: string): number | null {
  const match = /^T?(\d{1,6})$/.exec(id.trim());
  return match ? Number(match[1]) : null;
}

/**
 * One turn as the model reads it: `[T0412] (client) Priya: <clean text>`.
 * Names are replaced by placeholders here, before anything leaves the app.
 */
export function renderTurnLine(turn: FactTurn, placeholders: PlaceholderMap = []): string {
  const speaker = turn.speakerLabel ? ` ${pseudonymize(turn.speakerLabel, placeholders)}:` : "";
  return `[${turnId(turn.index)}] (${turn.role})${speaker} ${pseudonymize(turn.cleanText, placeholders)}`;
}

/** Turns the model sees: no empty turns, no exact repeat of the turn before. */
export function modelTurns(turns: readonly FactTurn[]): FactTurn[] {
  const out: FactTurn[] = [];
  for (const turn of turns) {
    if (turn.cleanText.trim() === "") continue;
    const previous = out[out.length - 1];
    if (previous && previous.cleanText === turn.cleanText && previous.speakerLabel === turn.speakerLabel) continue;
    out.push(turn);
  }
  return out;
}

/**
 * Turn-aligned windows of about FACT_WINDOW_TOKENS each, the last few turns
 * of one window repeated at the start of the next. Deterministic.
 */
export function planFactWindows(
  turns: readonly FactTurn[],
  maxTokens = FACT_WINDOW_TOKENS
): FactTurn[][] {
  const visible = modelTurns(turns);
  const budget = maxTokens * 4;
  const windows: FactTurn[][] = [];
  let start = 0;
  while (start < visible.length) {
    let used = 0;
    let end = start;
    while (end < visible.length) {
      const size = visible[end].cleanText.length + 24;
      if (end > start && used + size > budget) break;
      used += size;
      end += 1;
    }
    windows.push(visible.slice(start, end));
    if (end >= visible.length) break;
    start = Math.max(start + 1, end - FACT_WINDOW_OVERLAP_TURNS);
  }
  return windows;
}

// ─── Verifier ──────────────────────────────────────────────────────────────

const FILLERS = new Set(["um", "umm", "uh", "uhh", "erm", "er", "ah", "ahh", "hmm", "mm", "mhm"]);

type Token = { text: string; start: number; end: number };

/**
 * Word tokens with their offsets in `text`, normalized for matching: case
 * folded, curly quotes straightened, fillers dropped and immediate repeats
 * collapsed. The offsets always point at the verbatim characters.
 */
export function matchTokens(text: string, base = 0): Token[] {
  const tokens: Token[] = [];
  const pattern = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
  for (const match of text.matchAll(pattern)) {
    const normalized = match[0].toLowerCase().replace(/’/g, "'");
    if (FILLERS.has(normalized)) continue;
    const previous = tokens[tokens.length - 1];
    const start = base + (match.index ?? 0);
    if (previous && previous.text === normalized) {
      // "we we tried": the stutter folds into one token spanning both.
      previous.end = start + match[0].length;
      continue;
    }
    tokens.push({ text: normalized, start, end: start + match[0].length });
  }
  return tokens;
}

function findTokenRun(haystack: readonly Token[], needle: readonly Token[]): number {
  if (needle.length === 0 || needle.length > haystack.length) return -1;
  outer: for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    if (haystack[i].text !== needle[0].text) continue;
    for (let j = 1; j < needle.length; j += 1) {
      if (haystack[i + j].text !== needle[j].text) continue outer;
    }
    return i;
  }
  return -1;
}

export type QuoteLocation =
  | { kind: "found"; quote: VerifiedQuote; turn: FactTurn }
  | { kind: "interviewer_only" }
  | { kind: "not_found" }
  | { kind: "too_short" };

/**
 * Locates one quote in the verbatim transcript: the cited turns first, then
 * two turns either side, then every turn. Exact text wins; otherwise the
 * normalized word run maps back to verbatim offsets. A match inside an
 * interviewer turn never counts as evidence (owner decision 25). The
 * returned excerpt is `content.slice(charStart, charEnd)` and is checked
 * byte for byte before it is returned.
 */
export function locateQuote(
  content: string,
  turns: readonly FactTurn[],
  quote: string,
  citedTurnIndexes: readonly number[]
): QuoteLocation {
  const trimmed = quote.trim().replace(/^["“']+|["”']+$/g, "").trim();
  const needle = matchTokens(trimmed);
  if (needle.length < MIN_QUOTE_WORDS || trimmed.length < MIN_QUOTE_CHARS) return { kind: "too_short" };

  const byIndex = new Map(turns.map((turn, position) => [turn.index, position]));
  const cited = citedTurnIndexes
    .map((index) => byIndex.get(index))
    .filter((position): position is number => position !== undefined);
  const near = new Set<number>();
  for (const position of cited) {
    for (let delta = -2; delta <= 2; delta += 1) {
      const candidate = position + delta;
      if (candidate >= 0 && candidate < turns.length && !cited.includes(candidate)) near.add(candidate);
    }
  }
  const order = [
    ...cited,
    ...[...near].sort((a, b) => a - b),
    ...turns.map((_, position) => position).filter((position) => !cited.includes(position) && !near.has(position)),
  ];

  let interviewerHit = false;
  for (const position of order) {
    const turn = turns[position];
    const span = content.slice(turn.charStart, turn.charEnd);
    let found: VerifiedQuote | null = null;
    const exact = span.indexOf(trimmed);
    if (exact !== -1) {
      found = {
        charStart: turn.charStart + exact,
        charEnd: turn.charStart + exact + trimmed.length,
        exactExcerpt: trimmed,
        match: "exact",
      };
    } else {
      const haystack = matchTokens(span, turn.charStart);
      const at = findTokenRun(haystack, needle);
      if (at !== -1) {
        const charStart = haystack[at].start;
        const charEnd = haystack[at + needle.length - 1].end;
        found = {
          charStart,
          charEnd,
          exactExcerpt: content.slice(charStart, charEnd),
          match: "normalized",
        };
      }
    }
    if (!found) continue;
    if (content.slice(found.charStart, found.charEnd) !== found.exactExcerpt) continue;
    if (turn.role === "interviewer") {
      interviewerHit = true;
      continue;
    }
    return { kind: "found", quote: found, turn };
  }
  return interviewerHit ? { kind: "interviewer_only" } : { kind: "not_found" };
}

function isFactType(type: string): type is TranscriptFactType {
  return (TRANSCRIPT_FACT_TYPES as readonly string[]).includes(type);
}

function normalizeType(type: string): TranscriptFactType | null {
  const lower = type.trim().toLowerCase();
  if (isFactType(lower)) return lower;
  const aliases: Record<string, TranscriptFactType> = {
    uncertainties: "uncertainty",
    hypotheses: "hypothesis",
    experiments: "experiment",
    results: "result",
    advancements: "advancement",
    advance: "advancement",
  };
  return aliases[lower] ?? null;
}

/**
 * Keeps the facts with at least one verified quote, and facts drawn only
 * from interviewer turns as context without a quote. Everything else is
 * dropped and counted. Keys are assigned after the merge, in transcript
 * order, so the same facts always get the same keys.
 */
export function verifyFacts(input: {
  content: string;
  turns: readonly FactTurn[];
  proposals: readonly ProposedFact[];
}): { facts: VerifiedFact[]; counts: FactCounts } {
  const kept: Omit<VerifiedFact, "key">[] = [];
  let dropped = 0;
  for (const proposal of input.proposals) {
    const type = normalizeType(proposal.type);
    const claim = proposal.claim.trim();
    if (!type || claim === "") {
      dropped += 1;
      continue;
    }
    const quotes: VerifiedQuote[] = [];
    const turnIndexes = new Set<number>();
    let speakerLabel: string | undefined;
    let interviewerOnly = false;
    for (const quote of proposal.quotes) {
      const located = locateQuote(input.content, input.turns, quote, proposal.turnIndexes);
      if (located.kind === "interviewer_only") interviewerOnly = true;
      if (located.kind !== "found") continue;
      if (quotes.some((q) => q.charStart === located.quote.charStart && q.charEnd === located.quote.charEnd)) continue;
      quotes.push(located.quote);
      turnIndexes.add(located.turn.index);
      speakerLabel ??= located.turn.speakerLabel;
    }
    if (quotes.length === 0) {
      if (interviewerOnly) {
        kept.push({
          type: "context",
          claim,
          turnIndexes: [...proposal.turnIndexes].sort((a, b) => a - b),
          quotes: [],
          confidence: 0.5,
        });
      } else {
        dropped += 1;
      }
      continue;
    }
    kept.push({
      type,
      claim,
      turnIndexes: [...turnIndexes].sort((a, b) => a - b),
      quotes: quotes.sort((a, b) => a.charStart - b.charStart),
      ...(speakerLabel ? { speakerLabel } : {}),
      confidence: quotes.every((quote) => quote.match === "exact") ? 1 : 0.8,
    });
  }
  const merged = mergeNearDuplicates(kept);
  const facts = assignFactKeys(merged);
  return {
    facts,
    counts: {
      proposed: input.proposals.length,
      verified: facts.filter((fact) => fact.quotes.length > 0).length,
      dropped: dropped + (kept.length - merged.length),
    },
  };
}

function overlaps(a: VerifiedQuote, b: VerifiedQuote): boolean {
  return a.charStart < b.charEnd && b.charStart < a.charEnd;
}

/**
 * Overlapping windows propose the same fact twice. Two facts of one type
 * whose quotes overlap become one: the longer claim, every distinct quote.
 */
export function mergeNearDuplicates<F extends Omit<VerifiedFact, "key">>(facts: readonly F[]): F[] {
  const out: F[] = [];
  for (const fact of facts) {
    const twin = out.find(
      (existing) =>
        existing.type === fact.type &&
        existing.quotes.length > 0 &&
        existing.quotes.some((a) => fact.quotes.some((b) => overlaps(a, b)))
    );
    if (!twin) {
      out.push({ ...fact, quotes: [...fact.quotes], turnIndexes: [...fact.turnIndexes] });
      continue;
    }
    if (fact.claim.length > twin.claim.length) twin.claim = fact.claim;
    for (const quote of fact.quotes) {
      if (!twin.quotes.some((existing) => overlaps(existing, quote))) twin.quotes.push(quote);
    }
    twin.quotes.sort((a, b) => a.charStart - b.charStart);
    twin.turnIndexes = [...new Set([...twin.turnIndexes, ...fact.turnIndexes])].sort((a, b) => a - b);
    twin.confidence = Math.min(twin.confidence, fact.confidence);
    twin.speakerLabel ??= fact.speakerLabel;
  }
  return out;
}

function firstPosition(fact: Omit<VerifiedFact, "key">): number {
  return fact.quotes[0]?.charStart ?? Number.MAX_SAFE_INTEGER;
}

/** Keys `F1`, `F2`, ... in transcript order (context facts by turn). */
export function assignFactKeys(facts: readonly Omit<VerifiedFact, "key">[]): VerifiedFact[] {
  return [...facts]
    .sort(
      (a, b) =>
        (a.turnIndexes[0] ?? 0) - (b.turnIndexes[0] ?? 0) ||
        firstPosition(a) - firstPosition(b) ||
        a.claim.localeCompare(b.claim)
    )
    .map((fact, index) => ({ key: `F${index + 1}`, ...fact }));
}

// ─── Fact pack ─────────────────────────────────────────────────────────────

/** A fact's id inside a generation: `F<transcript position>-<n>`. */
export function packFactId(position: number, key: string): string {
  return `F${position}-${key.replace(/^F/, "")}`;
}

export function parsePackFactId(id: string): { position: number; key: string } | null {
  const match = /^F(\d{1,3})-(\d{1,5})$/.exec(id.trim());
  return match ? { position: Number(match[1]), key: `F${match[2]}` } : null;
}

export type PackFact = {
  key: string;
  type: TranscriptFactType;
  claim: string;
  turnIndexes: readonly number[];
  quotes: readonly { charStart: number; charEnd: number; exactExcerpt: string }[];
  speakerLabel?: string;
};

export type PackTurnInfo = {
  speakerLabel?: string;
  startMs?: number;
  charStart?: number;
  charEnd?: number;
};

const TYPE_ORDER: Record<TranscriptFactType, number> = {
  uncertainty: 0,
  hypothesis: 1,
  experiment: 2,
  result: 3,
  advancement: 4,
  context: 5,
};

function clock(ms: number | undefined): string | undefined {
  if (ms === undefined) return undefined;
  const total = Math.floor(ms / 1000);
  const parts = [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60];
  return parts.map((part) => String(part).padStart(2, "0")).join(":");
}

export type FactPackOptions = {
  /** Current speaker roles; a quote in an interviewer turn is never shown. */
  roles: ReadonlyMap<string, TranscriptSpeakerRole>;
  /** Turn index to speaker and time, for the quote's attribution. */
  turnInfo: ReadonlyMap<number, PackTurnInfo>;
  /** Cap on the rendered characters; facts are kept by type rank. */
  maxChars?: number;
};

/**
 * The frozen fact pack of one transcript: deterministic for the same facts,
 * roles and position (sorted by first turn, then key), so the cached prompt
 * prefix it sits in is byte-stable across runs. Quotes are verbatim excerpts
 * of the transcript, so a model that quotes from the pack quotes the
 * transcript itself.
 */
export function renderFactPack(
  header: { position: number; label: string },
  facts: readonly PackFact[],
  options: FactPackOptions
): string {
  const ordered = [...facts].sort(
    (a, b) =>
      (a.turnIndexes[0] ?? 0) - (b.turnIndexes[0] ?? 0) ||
      Number(a.key.replace(/^F/, "")) - Number(b.key.replace(/^F/, ""))
  );
  const blocks: { rank: number; text: string }[] = ordered.map((fact) => {
    const shown = fact.quotes.filter((quote) => {
      const speaker = quoteSpeaker(fact, quote, options.turnInfo);
      return !speaker || options.roles.get(speaker) !== "interviewer";
    });
    const type: TranscriptFactType = shown.length === 0 && fact.quotes.length > 0 ? "context" : fact.type;
    const lines = [`[${packFactId(header.position, fact.key)}] (${type}) ${fact.claim}`];
    for (const quote of shown) {
      const info = quoteTurnInfo(fact, quote, options.turnInfo);
      const speaker = info?.speakerLabel;
      const role = speaker ? options.roles.get(speaker) : undefined;
      const attribution = [speaker, role && role !== "unknown" ? role : undefined, clock(info?.startMs)]
        .filter(Boolean)
        .join(", ");
      lines.push(`  > "${quote.exactExcerpt.replace(/\s+/g, " ")}"${attribution ? ` (${attribution})` : ""}`);
    }
    return { rank: TYPE_ORDER[type], text: lines.join("\n") };
  });
  const head = `Transcript ${header.position}: ${header.label}\nVerified facts. Cite a fact by its id; quotes are verbatim from the transcript.`;
  if (options.maxChars === undefined) {
    return [head, ...blocks.map((block) => block.text)].join("\n\n");
  }
  // Over the cap: keep the highest-ranked facts, in their original order.
  let used = head.length;
  const keep = new Set<number>();
  const byRank = blocks.map((block, index) => ({ ...block, index })).sort((a, b) => a.rank - b.rank || a.index - b.index);
  for (const block of byRank) {
    if (used + block.text.length + 2 > options.maxChars) continue;
    used += block.text.length + 2;
    keep.add(block.index);
  }
  const kept = blocks.filter((_, index) => keep.has(index)).map((block) => block.text);
  const omitted = blocks.length - kept.length;
  return [head, ...kept, ...(omitted > 0 ? [`[${omitted} more facts omitted to fit.]`] : [])].join("\n\n");
}

/** The turn a quote sits in: the fact's turn whose span holds the quote. */
export function quoteTurnInfo(
  fact: Pick<PackFact, "turnIndexes">,
  quote: { charStart: number },
  turnInfo: ReadonlyMap<number, PackTurnInfo>
): PackTurnInfo | undefined {
  for (const index of fact.turnIndexes) {
    const info = turnInfo.get(index);
    if (!info) continue;
    if (info.charStart === undefined || info.charEnd === undefined) return info;
    if (quote.charStart >= info.charStart && quote.charStart < info.charEnd) return info;
  }
  return fact.turnIndexes.length > 0 ? turnInfo.get(fact.turnIndexes[0]) : undefined;
}

function quoteSpeaker(
  fact: PackFact,
  quote: { charStart: number },
  turnInfo: ReadonlyMap<number, PackTurnInfo>
): string | undefined {
  return quoteTurnInfo(fact, quote, turnInfo)?.speakerLabel ?? fact.speakerLabel;
}
