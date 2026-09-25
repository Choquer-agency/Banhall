/**
 * Transcript intake and turn parsing (phase 3, the transcript method).
 *
 * Pure and runtime-free: the browser runs it to detect a file's format and
 * render VTT/SRT to one canonical verbatim text before upload, and Convex
 * runs it again on the stored text, so turns are never taken from the
 * client. Every offset a turn carries indexes into the verbatim `content`
 * string exactly as stored on the `transcripts` row.
 *
 * `speakerOfTranscriptLine` moved here from convex/lib/seedContract.ts
 * (which re-exports it) without a change in behaviour: Seed citations keep
 * stamping the speaker they stamped before.
 *
 * Bump TRANSCRIPT_PARSER_VERSION whenever a change here can move a turn
 * boundary, a speaker label or a clean text; stored turns built under an
 * older version are rebuilt by the backfill.
 */

export const TRANSCRIPT_PARSER_VERSION = "1";

export const TRANSCRIPT_SOURCE_FORMATS = [
  "teams_docx",
  "vtt",
  "srt",
  "txt",
  "zoom",
  "meet",
  "otter",
  "paste",
  "unknown",
] as const;

export type TranscriptSourceFormat = (typeof TRANSCRIPT_SOURCE_FORMATS)[number];

/** File extensions a transcript can be uploaded as. */
export const TRANSCRIPT_FILE_EXTENSIONS = [".docx", ".vtt", ".srt", ".txt"] as const;

/** The `accept` attribute for a transcript file input. */
export const TRANSCRIPT_ACCEPT = TRANSCRIPT_FILE_EXTENSIONS.join(",");

/** Short label for a detected format, shown next to a transcript row. */
export const TRANSCRIPT_FORMAT_LABELS: Record<TranscriptSourceFormat, string> = {
  teams_docx: "Teams",
  vtt: "WebVTT",
  srt: "SRT",
  txt: "Text",
  zoom: "Zoom",
  meet: "Google Meet",
  otter: "Otter",
  paste: "Pasted",
  unknown: "Unrecognized",
};

export function isTranscriptFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return TRANSCRIPT_FILE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

// ─── Speaker labels (moved from convex/lib/seedContract.ts) ────────────────

const TIMESTAMP = String.raw`[\[(]?\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?[\])]?`;
const LEADING_TIMESTAMP = new RegExp(String.raw`^${TIMESTAMP}\s*(?:[-\u2013\u2014]\s*)?`);
const TRAILING_TIMESTAMP = new RegExp(String.raw`\s+${TIMESTAMP}$`);
const ONLY_TIMESTAMP = new RegExp(String.raw`^${TIMESTAMP}$`);
/** WebVTT voice span: `<v Priya Shah>` or `<v.loud Priya>`. */
const VTT_VOICE = /^<v(?:\.[^\s>]+)*\s+([^>]{1,80})>/;
/** "Priya:", "Interviewer (Dana):", "Priya Shah [00:01:02]:" followed by speech. */
const COLON_LABEL = /^(.{1,100}?)\s*:\s+\S/;
/** A header line holding only a name and its timestamp (Otter, Teams exports). */
const NAME_THEN_TIMESTAMP = new RegExp(String.raw`^(.{1,80}?)\s+${TIMESTAMP}$`);
/** Zoom's header: `[Priya Shah] 10:02:33`. New with the parser; not a Seed stamp. */
const ZOOM_HEADER = new RegExp(String.raw`^\[([^\]\n]{1,80})\]\s+(${TIMESTAMP})$`);
const NAME_PARTICLES = new Set(["de", "da", "di", "du", "del", "der", "van", "von", "la", "le", "bin", "al"]);
/** Header keys that end in a colon in exported transcripts but name no one. */
const NOT_A_SPEAKER = new Set([
  "agenda", "attendees", "date", "duration", "location", "meeting", "note",
  "notes", "participants", "recording", "summary", "time", "title", "transcript",
]);

function nameWords(text: string): boolean {
  const words = text.split(/\s+/);
  if (words.length === 0 || words.length > 5) return false;
  return words.every((word, index) => {
    if (!/^[\p{L}\p{M}\d'’.\-]+$/u.test(word)) return false;
    if (/^\p{Lu}/u.test(word)) return true;
    if (index === 0) return false;
    return /^\d+$/.test(word) || NAME_PARTICLES.has(word.toLowerCase());
  });
}

/** A speaker from a label such as "Priya", "Speaker 2", "Interviewer (Dana)"
 * or "Subject (Marcus Lindqvist, CTO)"; the name in parentheses wins. */
function speakerFromLabel(raw: string): string | undefined {
  let label = raw.trim().replace(TRAILING_TIMESTAMP, "");
  const paren = /^(.+?)\s*[(\[]([^()[\]]{1,80})[)\]]$/.exec(label);
  let preferred: string | undefined;
  if (paren) {
    label = paren[1].trim();
    const inner = paren[2].trim();
    if (!ONLY_TIMESTAMP.test(inner)) {
      const first = inner.split(",")[0].trim();
      if (/^\p{L}/u.test(first) && first.length >= 2) preferred = first;
    }
  }
  if (label.length < 2 || label.length > 60 || !nameWords(label)) return undefined;
  if (NOT_A_SPEAKER.has(label.toLowerCase())) return undefined;
  return preferred ?? label;
}

/** The speaker a transcript line opens with, if it opens a turn. */
export function speakerOfTranscriptLine(line: string): string | undefined {
  const text = line.replace(/\r$/, "").trim();
  if (!text) return undefined;
  const voice = VTT_VOICE.exec(text);
  if (voice) return voice[1].trim() || undefined;
  const afterTime = text.replace(LEADING_TIMESTAMP, "");
  const colon = COLON_LABEL.exec(afterTime);
  if (colon) return speakerFromLabel(colon[1]);
  if (afterTime === text) {
    const header = NAME_THEN_TIMESTAMP.exec(text);
    if (header) return speakerFromLabel(header[1]);
  }
  return undefined;
}

/** Milliseconds from `0:03`, `02:03`, `1:02:03`, `00:00:03.520` or `00:00:03,520`. */
export function timestampToMs(raw: string): number | undefined {
  const match = /(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?(?:[.,](\d{1,3}))?/.exec(raw);
  if (!match) return undefined;
  const [, a, b, c, fraction] = match;
  const millis = fraction ? Number(fraction.padEnd(3, "0")) : 0;
  const seconds =
    c === undefined
      ? Number(a) * 60 + Number(b)
      : Number(a) * 3600 + Number(b) * 60 + Number(c);
  return seconds * 1000 + millis;
}

/** `hh:mm:ss` for a millisecond offset, as the canonical render writes it. */
export function formatTimestamp(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

export type SpeakerLine =
  | {
      kind: "inline";
      speaker: string;
      /** The label as written, before normalization ("Interviewer (Dana)"). */
      rawLabel: string;
      /** Index in the line where the speech starts. */
      speechOffset: number;
      timeMs?: number;
    }
  | { kind: "header"; speaker: string; rawLabel: string; timeMs?: number }
  | { kind: "timestamp"; timeMs?: number };

/**
 * How one line opens a turn, if it does. `inline` carries speech after the
 * label, `header` is a name and a time on its own line (Teams, Otter, Zoom),
 * `timestamp` is a time on its own line (Google Meet). Agrees with
 * `speakerOfTranscriptLine` on every line that function names a speaker for.
 */
export function splitSpeakerLine(line: string): SpeakerLine | undefined {
  const withoutCr = line.replace(/\r$/, "");
  const lead = withoutCr.length - withoutCr.trimStart().length;
  const text = withoutCr.trim();
  if (!text) return undefined;
  if (ONLY_TIMESTAMP.test(text)) return { kind: "timestamp", timeMs: timestampToMs(text) };
  const voice = VTT_VOICE.exec(text);
  if (voice) {
    const speaker = voice[1].trim();
    if (!speaker) return undefined;
    return { kind: "inline", speaker, rawLabel: speaker, speechOffset: lead + voice[0].length };
  }
  const timePrefix = LEADING_TIMESTAMP.exec(text);
  const afterTime = timePrefix ? text.slice(timePrefix[0].length) : text;
  const colon = /^(.{1,100}?)\s*:\s+(?=\S)/.exec(afterTime);
  if (colon && COLON_LABEL.test(afterTime)) {
    const speaker = speakerFromLabel(colon[1]);
    if (!speaker) return undefined;
    const labelTime = TRAILING_TIMESTAMP.exec(colon[1].trim());
    const time = labelTime?.[0] ?? timePrefix?.[0];
    return {
      kind: "inline",
      speaker,
      rawLabel: colon[1].trim(),
      speechOffset: lead + (timePrefix?.[0].length ?? 0) + colon[0].length,
      ...(time ? { timeMs: timestampToMs(time) } : {}),
    };
  }
  if (!timePrefix) {
    const zoom = ZOOM_HEADER.exec(text);
    if (zoom) {
      const speaker = speakerFromLabel(zoom[1]) ?? (zoom[1].trim() || undefined);
      return speaker
        ? { kind: "header", speaker, rawLabel: zoom[1].trim(), timeMs: timestampToMs(zoom[2]) }
        : undefined;
    }
    const header = NAME_THEN_TIMESTAMP.exec(text);
    if (header) {
      const speaker = speakerFromLabel(header[1]);
      if (!speaker) return undefined;
      return {
        kind: "header",
        speaker,
        rawLabel: header[1].trim(),
        timeMs: timestampToMs(text.slice(header[1].length)),
      };
    }
  }
  return undefined;
}

// ─── Format detection and canonical render ────────────────────────────────

const CUE_TIMING = /^\s*(\d{1,2}:\d{1,2}(?::\d{1,2})?[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{1,2}(?::\d{1,2})?[.,]\d{1,3})/;

function extensionOf(fileName: string | undefined): string {
  if (!fileName) return "";
  const dot = fileName.lastIndexOf(".");
  return dot === -1 ? "" : fileName.slice(dot).toLowerCase();
}

function lines(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").split("\n");
}

function looksLikeVtt(text: string): boolean {
  return /^﻿?WEBVTT\b/.test(text.trimStart());
}

function looksLikeSrt(text: string): boolean {
  const all = lines(text.trimStart());
  return /^\d+$/.test(all[0]?.trim() ?? "") && CUE_TIMING.test(all[1] ?? "");
}

function countMatching(all: string[], test: (line: string) => boolean): number {
  let count = 0;
  for (const line of all) if (test(line)) count += 1;
  return count;
}

/**
 * The format a transcript was exported in, from its file name and text.
 * Detection only picks the render and the label; the parser reads every
 * format with the same turn rules.
 */
export function detectTranscriptFormat(args: {
  fileName?: string;
  text: string;
  intake?: "file" | "paste";
}): TranscriptSourceFormat {
  const extension = extensionOf(args.fileName);
  const text = args.text;
  if (extension === ".vtt" || looksLikeVtt(text)) return "vtt";
  if (extension === ".srt" || looksLikeSrt(text)) return "srt";
  const all = lines(text).slice(0, 4000);
  if (/otter\.ai/i.test(text)) return "otter";
  const zoomHeaders = countMatching(all, (line) => ZOOM_HEADER.test(line.trim()));
  if (zoomHeaders >= 2) return "zoom";
  const timestampLines = countMatching(all, (line) => ONLY_TIMESTAMP.test(line.trim()));
  const colonTurns = countMatching(all, (line) => {
    const split = splitSpeakerLine(line);
    return split?.kind === "inline";
  });
  const headers = countMatching(all, (line) => splitSpeakerLine(line)?.kind === "header");
  if (/^\s*meeting (transcript|notes)\b/im.test(text.slice(0, 2000)) && timestampLines >= 1 && colonTurns >= 1) {
    return "meet";
  }
  if (extension === ".docx") {
    if (countMatching(all, (line) => CUE_TIMING.test(line)) >= 2) return "teams_docx";
    return headers >= 2 ? "teams_docx" : colonTurns >= 2 ? "teams_docx" : "unknown";
  }
  if (timestampLines >= 2 && colonTurns >= 2 && timestampLines <= colonTurns) return "meet";
  if (args.intake === "paste" || extension === "") return "paste";
  if (extension === ".txt") return "txt";
  return "unknown";
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " ", "&lrm;": "", "&rlm;": "",
};

function cueText(raw: string): string {
  return raw
    .replace(/<\/?(?:c|i|b|u|v|lang|ruby|rt)(?:\.[^>\s]*)?(?:\s[^>]*)?>/g, "")
    .replace(/<\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3}>/g, "")
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp|lrm|rlm);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/\s+/g, " ")
    .trim();
}

type Cue = { startMs?: number; speaker?: string; text: string };

/** Cues of a WebVTT or SRT file (also a Teams .docx that kept cue timings). */
function parseCues(text: string): Cue[] {
  const cues: Cue[] = [];
  const all = lines(text);
  let index = 0;
  while (index < all.length) {
    const timing = CUE_TIMING.exec(all[index]);
    if (!timing) {
      index += 1;
      continue;
    }
    const body: string[] = [];
    index += 1;
    while (index < all.length && all[index].trim() !== "" && !CUE_TIMING.test(all[index])) {
      body.push(all[index]);
      index += 1;
    }
    // An SRT or VTT cue id line directly before the next timing is not text.
    if (body.length > 0 && /^\d+$/.test(body[body.length - 1].trim()) && CUE_TIMING.test(all[index] ?? "")) {
      body.pop();
    }
    if (body.length === 0) continue;
    let speaker: string | undefined;
    let first = body[0].trim();
    const voice = /^<v(?:\.[^\s>]+)*\s+([^>]{1,80})>/.exec(first);
    if (voice) {
      speaker = voice[1].trim();
      first = first.slice(voice[0].length);
    } else if (body.length >= 2 && speakerFromLabel(first) && !first.includes(":")) {
      // Teams .docx cue: the speaker's name on its own line above the text.
      speaker = speakerFromLabel(first);
      first = "";
    } else {
      const colon = /^(.{1,60}?)\s*:\s+(?=\S)/.exec(cueText(first));
      const named = colon ? speakerFromLabel(colon[1]) : undefined;
      if (colon && named) {
        speaker = named;
        first = cueText(first).slice(colon[0].length);
      }
    }
    const textOut = cueText([first, ...body.slice(1)].join(" "));
    if (textOut) cues.push({ startMs: timestampToMs(timing[1]), speaker, text: textOut });
  }
  return cues;
}

/**
 * Cues as one canonical verbatim text: `Name [hh:mm:ss]: text`, one turn per
 * paragraph, with consecutive cues of the same speaker joined into one turn.
 */
export function renderCuesCanonical(cues: readonly Cue[]): string {
  const turns: Cue[] = [];
  for (const cue of cues) {
    const last = turns[turns.length - 1];
    if (last && cue.speaker !== undefined && last.speaker === cue.speaker) {
      last.text = `${last.text} ${cue.text}`;
      continue;
    }
    turns.push({ ...cue });
  }
  return turns
    .map((turn) => {
      const time = turn.startMs === undefined ? "" : `[${formatTimestamp(turn.startMs)}]`;
      if (turn.speaker) return `${turn.speaker}${time ? ` ${time}` : ""}: ${turn.text}`;
      return time ? `${time} ${turn.text}` : turn.text;
    })
    .join("\n\n");
}

/**
 * The verbatim text stored for an upload. VTT, SRT and cue-timed Teams
 * exports are rendered to the canonical form; every other format is kept
 * as extracted, with line endings normalized to `\n` and outer blank space
 * trimmed.
 */
export function normalizeTranscriptText(format: TranscriptSourceFormat, text: string): string {
  const unified = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const cueTimed =
    format === "vtt" ||
    format === "srt" ||
    (format === "teams_docx" && countMatching(lines(unified), (line) => CUE_TIMING.test(line)) >= 2);
  if (cueTimed) {
    const rendered = renderCuesCanonical(parseCues(unified));
    if (rendered.trim() !== "") return rendered;
  }
  return unified.replace(/[ \t]+$/gm, "").trim();
}

/** Detect, then normalize: what the browser uploads for one transcript. */
export function prepareTranscriptUpload(args: {
  fileName?: string;
  text: string;
  intake?: "file" | "paste";
}): { format: TranscriptSourceFormat; content: string } {
  const format = detectTranscriptFormat(args);
  return { format, content: normalizeTranscriptText(format, args.text) };
}

// ─── Turns ─────────────────────────────────────────────────────────────────

export type TranscriptTurn = {
  index: number;
  /** Normalized speaker label; absent when the text names no one. */
  speakerLabel?: string;
  /** The label as written, kept for role hints ("Interviewer (Dana)"). */
  rawLabel?: string;
  startMs?: number;
  endMs?: number;
  /** Offset of the first spoken character in `content`. */
  charStart: number;
  /** Offset after the last spoken character in `content`. */
  charEnd: number;
  /** Speech without timestamps, fillers or stutters; the model's view. */
  cleanText: string;
};

const FILLER = /(?<![\p{L}\p{N}'])(?:um+|uh+|erm+|er|ah+|hmm+|mm+-?hmm+|uh-?huh)(?![\p{L}\p{N}'])[,.]?/giu;

/**
 * The model's view of one turn's speech: inline timestamps, fillers and
 * immediately repeated words dropped, whitespace collapsed. Verbatim text is
 * never replaced by this; offsets always index the stored content.
 */
export function cleanTurnText(speech: string): string {
  let text = speech
    .replace(new RegExp(String.raw`(^|\s)${TIMESTAMP}(?=\s|$)`, "g"), "$1")
    .replace(FILLER, " ")
    .replace(/\s+/g, " ")
    .trim();
  // "the the", "we we": a stutter, not content.
  text = text.replace(/\b([\p{L}\p{N}']+)(?:\s+\1\b)+/giu, "$1");
  return text.replace(/\s+([,.;:!?])/g, "$1").replace(/^[,.;:]\s*/, "").trim();
}

type LineInfo = { start: number; end: number; text: string };

function lineInfos(content: string): LineInfo[] {
  const out: LineInfo[] = [];
  let start = 0;
  for (;;) {
    const newline = content.indexOf("\n", start);
    const end = newline === -1 ? content.length : newline;
    const raw = content.slice(start, end);
    const trimmedEnd = raw.endsWith("\r") ? end - 1 : end;
    out.push({ start, end: trimmedEnd, text: content.slice(start, trimmedEnd) });
    if (newline === -1) break;
    start = newline + 1;
  }
  return out;
}

type Draft = {
  speakerLabel?: string;
  rawLabel?: string;
  startMs?: number;
  /** [start, end) spans of speech inside content. */
  spans: Array<[number, number]>;
};

function trimmedSpan(content: string, start: number, end: number): [number, number] | null {
  let s = start;
  let e = end;
  while (s < e && /\s/.test(content[s])) s += 1;
  while (e > s && /\s/.test(content[e - 1])) e -= 1;
  return e > s ? [s, e] : null;
}

/**
 * Splits verbatim transcript text into speaker turns. A turn opens on a
 * labelled line ("Name: text", `<v Name>`), or on a header line holding a
 * name and a time with the speech below it; unlabelled lines continue the
 * turn above them. Text before the first label, and every paragraph of a
 * transcript that names no one, becomes its own turn with no speaker.
 */
export function parseTranscriptTurns(content: string): TranscriptTurn[] {
  const infos = lineInfos(content);
  const kinds = infos.map((info) => splitSpeakerLine(info.text));
  const hasSpeakers = kinds.some((kind) => kind?.kind === "inline" || kind?.kind === "header");
  const drafts: Draft[] = [];
  let current: Draft | undefined;
  let pendingTime: number | undefined;
  let blankSinceSpeech = false;

  const open = (draft: Draft) => {
    if (current && current.spans.length > 0) drafts.push(current);
    current = draft;
  };

  for (let i = 0; i < infos.length; i += 1) {
    const info = infos[i];
    const kind = kinds[i];
    if (info.text.trim() === "") {
      blankSinceSpeech = true;
      continue;
    }
    if (kind?.kind === "timestamp") {
      pendingTime = kind.timeMs;
      continue;
    }
    if (kind?.kind === "inline") {
      open({
        speakerLabel: kind.speaker,
        rawLabel: kind.rawLabel,
        startMs: kind.timeMs ?? pendingTime,
        spans: [],
      });
      pendingTime = undefined;
      const span = trimmedSpan(content, info.start + kind.speechOffset, info.end);
      if (span) current!.spans.push(span);
      blankSinceSpeech = false;
      continue;
    }
    if (kind?.kind === "header") {
      open({
        speakerLabel: kind.speaker,
        rawLabel: kind.rawLabel,
        startMs: kind.timeMs ?? pendingTime,
        spans: [],
      });
      pendingTime = undefined;
      blankSinceSpeech = false;
      continue;
    }
    const span = trimmedSpan(content, info.start, info.end);
    if (!span) continue;
    const unlabelled = !current || current.speakerLabel === undefined;
    // Without any speaker labels, or before the first one, a paragraph is a
    // turn of its own; inside a labelled turn, text continues it.
    if (!hasSpeakers || unlabelled) {
      if (!current || current.speakerLabel !== undefined || blankSinceSpeech) {
        open({ spans: [], startMs: pendingTime });
        pendingTime = undefined;
      }
    }
    current!.spans.push(span);
    blankSinceSpeech = false;
  }
  if (current && current.spans.length > 0) drafts.push(current);

  const turns: TranscriptTurn[] = drafts.map((draft, index) => {
    const charStart = draft.spans[0][0];
    const charEnd = draft.spans[draft.spans.length - 1][1];
    const speech = draft.spans.map(([s, e]) => content.slice(s, e)).join(" ");
    return {
      index,
      ...(draft.speakerLabel !== undefined ? { speakerLabel: draft.speakerLabel } : {}),
      ...(draft.rawLabel !== undefined ? { rawLabel: draft.rawLabel } : {}),
      ...(draft.startMs !== undefined ? { startMs: draft.startMs } : {}),
      charStart,
      charEnd,
      cleanText: cleanTurnText(speech),
    };
  });
  for (let i = 0; i < turns.length - 1; i += 1) {
    const next = turns[i + 1].startMs;
    if (turns[i].startMs !== undefined && next !== undefined && next >= turns[i].startMs!) {
      turns[i].endMs = next;
    }
  }
  return turns;
}
