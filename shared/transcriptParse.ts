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
 * (which re-exports it) without a change in behaviour. Parser v4 changed
 * what it reads on a line in the same way as the turns: brackets after a
 * name, "Shah, Priya" names and heading words. The transcript-wide rules
 * (Teams-pane headers, plain labels without a speaker pattern) are turns
 * only; a Seed stamp still reads one line.
 *
 * Bump TRANSCRIPT_PARSER_VERSION whenever a change here can move a turn
 * boundary, a speaker label or a clean text; stored turns built under an
 * older version are rebuilt by the backfill
 * (`transcripts:backfillTranscriptStructure`).
 *
 * v4 (2026-09-25): "Priya Shah (she/her)" and "Priya Shah (Acme)" are
 * "Priya Shah" (the bracket names the speaker only after a role word, as in
 * "Interviewer (Dana)"); "Shah, Priya" is "Priya Shah" in headers, voices
 * and labels; text copied from the Teams transcript pane (name line, time
 * line, speech) keeps its speakers; heading words ("Result:") never name a
 * speaker, and plain "Name:" labels count only with a speaker pattern
 * across the transcript. Turn and speaker rows keep their shape.
 *
 * v5 (2026-09-25, review): "Acme (Priya Shah)", one word then a full name
 * in brackets, is "Priya Shah" of Acme, unless the same bracketed name
 * follows several one-word names ("Dana (Verdant Grid)", "Sam (Verdant
 * Grid)"), which makes it their company. Every name in a label's brackets
 * is hidden as v3 hid it; job titles and departments are not names.
 *
 * v6 (2026-09-25, final review): brackets are a job title only when every
 * word is a title or department word ("VP Engineering", "Head of R&D"). A
 * company or a person whose name holds one of those words ("Northwind
 * Engineering", "Acme (Jonathan Head)") is hidden again, as v3 and v4 hid
 * it. The bump makes the build store names again for rows v5 built.
 */

export const TRANSCRIPT_PARSER_VERSION = "6";

/**
 * Longest turn, in characters of stored text. A longer run of speech (a
 * plain-text transcript with no blank lines, say) is split into turns of the
 * same speaker at whitespace, so no turn's clean text approaches a
 * document's size limit and every turn fits a fact window.
 */
export const MAX_TURN_CHARS = 16_000;

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
/**
 * A bracketed time opening a line of speech that names no one: the canonical
 * render of a VTT or SRT cue without a speaker (`[00:00:05] text`).
 */
const BRACKETED_TIME_LEAD = /^\[\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?\]\s+(?=\S)/;
/** Zoom's header: `[Priya Shah] 10:02:33`. New with the parser; not a Seed stamp. */
const ZOOM_HEADER = new RegExp(String.raw`^\[([^\]\n]{1,80})\]\s+(${TIMESTAMP})$`);
const NAME_PARTICLES = new Set(["de", "da", "di", "du", "del", "der", "van", "von", "la", "le", "bin", "al"]);
/**
 * Heading words that end in a colon in exported transcripts and notes but
 * name no one ("Result: throughput improved 30%"). A label is refused when
 * it is one of these, or when it ends in one ("Key Findings", "Next Steps").
 */
const NOT_A_SPEAKER = new Set([
  "agenda", "attendees", "date", "duration", "location", "meeting", "note",
  "notes", "participants", "recording", "summary", "time", "title", "transcript",
  // Parser v4 (2026-09-25): common headings in notes pasted as transcripts.
  "action", "actions", "advancement", "advancements", "approach", "background",
  "budget", "challenge", "challenges", "comment", "comments", "conclusion",
  "conclusions", "context", "cost", "costs", "deadline", "decision", "decisions",
  "example", "examples", "experiment", "experiments", "finding", "findings",
  "goal", "goals", "highlights", "hypothesis", "hypotheses", "introduction",
  "issue", "issues", "items", "method", "methods", "methodology", "objective",
  "objectives", "observation", "observations", "outcome", "outcomes", "overview",
  "problem", "problems", "purpose", "reason", "recommendation", "recommendations",
  "reference", "references", "result", "results", "risk", "risks", "scope",
  "solution", "solutions", "source", "sources", "status", "step", "steps",
  "takeaway", "takeaways", "timeline", "total", "uncertainty", "uncertainties",
  "update", "updates",
]);
/**
 * Labels that name a role, not a person: in "Interviewer (Dana)" the name in
 * brackets is the speaker; in "Priya Shah (Acme)" it is not.
 */
const ROLE_LABEL = /^(?:interviewer|interviewee|subject|client|host|co-?host|moderator|facilitator|consultant|respondent|participant|guest|presenter|panelist|speaker|person|attendee|customer|expert|q|a)(?:\s+\d+)?$/i;
/**
 * Words that open a sentence before a comma and a name ("Well, Dana: ..."),
 * and short replies that stand on a line of their own. Never a surname, and
 * never a speaker's whole name on a line above a time.
 */
const NOT_A_NAME = new Set([
  "absolutely", "actually", "again", "agreed", "alright", "also", "and",
  "anyway", "basically", "but", "bye", "cool", "correct", "definitely",
  "exactly", "fine", "finally", "first", "good", "great", "hello", "hey", "hi",
  "hmm", "honestly", "indeed", "listen", "look", "no", "nope", "now", "oh",
  "ok", "okay", "perfect", "please", "plus", "right", "second", "see", "so",
  "sorry", "sure", "thanks", "then", "totally", "true", "wait", "well", "wow",
  "yeah", "yep", "yes",
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

/**
 * Last words that mark a company's name ("Northwind Labs", "Acme Corp",
 * "Northwind Engineering"), never a person's (parser v5). The department
 * words here end a company's name after a name word ("Pacific Research"),
 * and a title only when every word is a title word ("VP Engineering").
 */
const ORG_WORDS = new Set([
  "inc", "incorporated", "ltd", "limited", "llc", "corp", "corporation", "co",
  "company", "plc", "gmbh", "ulc", "lp", "llp", "technologies", "technology",
  "systems", "solutions", "group", "holdings", "labs", "laboratories",
  "industries", "international", "enterprises", "services", "software",
  "energy", "canada", "engineering", "research", "design", "development",
  "science", "sciences", "consulting", "analytics", "robotics",
]);

/**
 * Job titles and departments written in a label's brackets ("Priya Shah
 * (CTO)", "Raj Patel (Engineering)", "Head of R&D"). Brackets are a title,
 * naming no one and no company, only when every word is one of these or a
 * connector: "Northwind Engineering" and "Jonathan Head" hold a name word,
 * so they stay hidden (parser v5, review 2026-09-25).
 */
const TITLE_WORDS = new Set([
  "ceo", "cto", "cfo", "coo", "cio", "vp", "svp", "evp", "president", "chief",
  "officer", "director", "manager", "lead", "head", "engineer", "engineering",
  "scientist", "science", "research", "researcher", "developer", "development",
  "analyst", "architect", "founder", "cofounder", "co-founder", "owner",
  "partner", "principal", "senior", "junior", "sales", "marketing", "finance",
  "operations", "product", "design", "designer", "hr", "legal", "it", "r&d",
  "qa", "support", "technician", "specialist", "coordinator", "consultant",
  "advisor", "intern", "team", "technology", "technical", "executive",
  "financial", "operating", "information", "vice", "general", "program",
  "project", "business", "data", "software", "hardware", "staff", "assistant",
]);
const TITLE_CONNECTORS = new Set(["of", "and", "&"]);

function lastWord(text: string): string {
  const words = text.toLowerCase().replace(/[.,]+$/, "").split(/\s+/);
  return words[words.length - 1];
}

function isTitle(text: string): boolean {
  const words = text.toLowerCase().split(/\s+/).map((word) => word.replace(/[.,]+$/, ""));
  return (
    words.some((word) => TITLE_WORDS.has(word)) &&
    words.every((word) => TITLE_WORDS.has(word) || TITLE_CONNECTORS.has(word))
  );
}

/** A label split at its closing brackets: "Priya Shah (Acme)". */
function bracketParts(rawLabel: string): { outer: string; inner: string } | undefined {
  const label = rawLabel.trim().replace(TRAILING_TIMESTAMP, "");
  const paren = /^(.+?)\s*[(\[]([^()[\]]{1,80})[)\]]$/.exec(label);
  return paren ? { outer: paren[1].trim(), inner: paren[2].trim() } : undefined;
}

/**
 * Whether brackets hold a person's full name after one word that is more
 * likely a company's ("Acme (Priya Shah)"): two to five name words, not a
 * role, pronouns, a time, a title or a company's name. The name in brackets
 * is then the speaker and the word before it the organization (parser v5,
 * review 2026-09-25); `resolveBracketSpeakers` turns this round when the
 * same bracketed name follows several words ("Dana (Verdant Grid)", "Sam
 * (Verdant Grid)").
 */
function companyThenName(parts: { outer: string; inner: string }): boolean {
  const { outer, inner } = parts;
  if (/\s/.test(outer) || !nameWords(outer) || ROLE_LABEL.test(outer) || isHeadingLabel(outer)) return false;
  if (ONLY_TIMESTAMP.test(inner) || inner.includes("/") || ROLE_LABEL.test(inner)) return false;
  const words = inner.split(/\s+/);
  if (words.length < 2 || !nameWords(inner)) return false;
  return !ORG_WORDS.has(lastWord(inner)) && !isTitle(inner);
}

function isHeadingLabel(label: string): boolean {
  const words = label.toLowerCase().split(/\s+/);
  return NOT_A_SPEAKER.has(words.join(" ")) || (words.length <= 3 && NOT_A_SPEAKER.has(words[words.length - 1]));
}

/**
 * "Shah, Priya" as "Priya Shah": the surname, a comma, then the given
 * names, as Teams and directory exports write them. Each side is one to
 * three name words, and the surname is not a word that opens a sentence
 * ("Well, Dana").
 */
function lastFirstName(label: string): string | undefined {
  const match = /^([^,]+),\s*([^,]+)$/.exec(label);
  if (!match) return undefined;
  const surname = match[1].trim();
  const given = match[2].trim();
  const surnameWords = surname.split(/\s+/);
  const givenWords = given.split(/\s+/);
  if (surnameWords.length > 3 || givenWords.length > 3) return undefined;
  if (!nameWords(surname) || !nameWords(given)) return undefined;
  if (NOT_A_NAME.has(surname.toLowerCase()) || NOT_A_NAME.has(given.toLowerCase())) return undefined;
  return `${given} ${surname}`;
}

/**
 * A speaker from a label such as "Priya", "Speaker 2", "Interviewer (Dana)",
 * "Subject (Marcus Lindqvist, CTO)" or "Shah, Priya". The name in brackets
 * wins only after a role word; after a name, brackets hold pronouns, a
 * company or a role ("Priya Shah (she/her)", "Priya Shah (Acme)") and are
 * left off, so two people never share one label (parser v4).
 */
function speakerFromLabel(raw: string): string | undefined {
  let label = raw.trim().replace(TRAILING_TIMESTAMP, "");
  const parts = bracketParts(label);
  let preferred: string | undefined;
  if (parts) {
    label = parts.outer;
    const inner = parts.inner;
    if (!ONLY_TIMESTAMP.test(inner) && ROLE_LABEL.test(label)) {
      const first = inner.split(",")[0].trim();
      if (/^\p{L}/u.test(first) && first.length >= 2) preferred = first;
    } else if (companyThenName(parts)) {
      preferred = inner;
    }
  }
  if (label.length < 2 || label.length > 60) return undefined;
  const name = nameWords(label) ? label : lastFirstName(label);
  if (!name || isHeadingLabel(name)) return undefined;
  return preferred ?? name;
}

/** A VTT voice's name, with "Shah, Priya" read as "Priya Shah". */
function voiceSpeaker(raw: string): string | undefined {
  const voice = raw.trim();
  if (!voice) return undefined;
  return lastFirstName(voice) ?? voice;
}

/**
 * The names a label holds besides its speaker's, hidden with the speakers'
 * names (owner decision 26). An organization in brackets ("Acme" in "Priya
 * Shah (Acme)", "Northwind Labs") is an organization. Brackets holding two
 * or more name words that are not a company's name are hidden as a person,
 * word by word too, as every parser before v4 did ("Acme (Priya Shah)",
 * review 2026-09-25), and so is the other side of such a label. Pronouns,
 * roles, times, job titles and departments are not names.
 */
export function labelBracketNames(rawLabel: string): { people: string[]; organizations: string[] } {
  const none = { people: [], organizations: [] };
  const parts = bracketParts(rawLabel);
  if (!parts || ROLE_LABEL.test(parts.outer)) return none;
  if (companyThenName(parts)) return { people: [parts.inner], organizations: [parts.outer] };
  const inner = parts.inner;
  if (ONLY_TIMESTAMP.test(inner) || inner.includes("/") || ROLE_LABEL.test(inner)) return none;
  if (inner.length < 3 || !nameWords(inner) || isTitle(inner)) return none;
  if (/\s/.test(inner) && !ORG_WORDS.has(lastWord(inner))) return { people: [inner], organizations: [] };
  return { people: [], organizations: [inner] };
}

/**
 * Every string a speaker label may have been read as, by this parser or an
 * earlier one: the label as written, the name before its brackets, the
 * brackets' content and its first comma part, and "Shah, Priya" as written
 * and as "Priya Shah". A rebuild uses these to carry a role set on an old
 * label over to the label the new parse gives the same line (review
 * 2026-09-25).
 */
export function rawLabelForms(rawLabel: string): string[] {
  const label = rawLabel.trim().replace(TRAILING_TIMESTAMP, "");
  const forms = new Set([label]);
  const parts = bracketParts(label);
  const names = parts ? [label, parts.outer] : [label];
  if (parts) {
    forms.add(parts.outer);
    forms.add(parts.inner);
    forms.add(parts.inner.split(",")[0].trim());
  }
  for (const name of names) {
    const named = lastFirstName(name);
    if (named) forms.add(named);
  }
  forms.delete("");
  return [...forms];
}

/** The speaker a transcript line opens with, if it opens a turn. */
export function speakerOfTranscriptLine(line: string): string | undefined {
  const text = line.replace(/\r$/, "").trim();
  if (!text) return undefined;
  const voice = VTT_VOICE.exec(text);
  if (voice) return voiceSpeaker(voice[1]);
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
  | { kind: "timestamp"; timeMs?: number }
  /** A bracketed time, then speech that names no one (`[00:00:05] text`). */
  | { kind: "timed"; timeMs?: number; speechOffset: number };

/**
 * How one line opens a turn, if it does. `inline` carries speech after the
 * label, `header` is a name and a time on its own line (Teams, Otter, Zoom),
 * `timestamp` is a time on its own line (Google Meet), `timed` is a
 * bracketed time and speech with no name (a VTT or SRT cue that named no
 * one). Agrees with `speakerOfTranscriptLine` on every line that function
 * names a speaker for.
 */
export function splitSpeakerLine(line: string): SpeakerLine | undefined {
  const withoutCr = line.replace(/\r$/, "");
  const lead = withoutCr.length - withoutCr.trimStart().length;
  const text = withoutCr.trim();
  if (!text) return undefined;
  if (ONLY_TIMESTAMP.test(text)) return { kind: "timestamp", timeMs: timestampToMs(text) };
  const voice = VTT_VOICE.exec(text);
  if (voice) {
    const speaker = voiceSpeaker(voice[1]);
    if (!speaker) return undefined;
    return { kind: "inline", speaker, rawLabel: voice[1].trim(), speechOffset: lead + voice[0].length };
  }
  const timePrefix = LEADING_TIMESTAMP.exec(text);
  const afterTime = timePrefix ? text.slice(timePrefix[0].length) : text;
  const colon = /^(.{1,100}?)\s*:\s+(?=\S)/.exec(afterTime);
  if (colon && COLON_LABEL.test(afterTime)) {
    const speaker = speakerFromLabel(colon[1]);
    if (speaker) {
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
    // Not a speaker: "[00:00:03] We tested two options: the first failed"
    // is an unnamed cue whose speech holds a colon, so it is still timed.
    if (!BRACKETED_TIME_LEAD.test(text)) return undefined;
  }
  const timed = BRACKETED_TIME_LEAD.exec(text);
  if (timed) {
    return { kind: "timed", timeMs: timestampToMs(timed[0]), speechOffset: lead + timed[0].length };
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

/**
 * Cues of a WebVTT or SRT file (also a Teams .docx that kept cue timings).
 * A blank line ends a VTT or SRT cue. In a Word document every paragraph
 * ends in a blank line once extracted, so a Teams cue whose timing, name and
 * speech are separate paragraphs runs to the next timing line instead
 * (`acrossBlankLines`).
 */
function parseCues(text: string, options: { acrossBlankLines?: boolean } = {}): Cue[] {
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
    while (index < all.length && !CUE_TIMING.test(all[index])) {
      if (all[index].trim() === "") {
        if (!options.acrossBlankLines) break;
      } else {
        body.push(all[index]);
      }
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

/** A paragraph of the canonical cue render: `Name [hh:mm:ss]: text` or `[hh:mm:ss] text`. */
const CANONICAL_CUE_PARAGRAPH = /^(?:\[\d{2}:\d{2}:\d{2}\] \S|[^\n]{1,100}? \[\d{2}:\d{2}:\d{2}\]: \S)/;

/**
 * Whether stored text is a cue render (`renderCuesCanonical`): a VTT or SRT
 * file, or a Teams .docx that kept its cue timings, whose every paragraph
 * opens with its cue's time. Only there does a line opening with a
 * bracketed time and no name mark a cue nobody was named for; in any other
 * transcript it marks a time inside the speech (`parseTranscriptTurns`).
 */
export function isCueRender(format: TranscriptSourceFormat | undefined, content: string): boolean {
  if (format === "vtt" || format === "srt") return true;
  if (format !== "teams_docx") return false;
  const paragraphs = content.split(/\n{2,}/).filter((paragraph) => paragraph.trim() !== "");
  return paragraphs.length > 0 && paragraphs.every((paragraph) => CANONICAL_CUE_PARAGRAPH.test(paragraph));
}

/**
 * The verbatim text stored for an upload. VTT, SRT and cue-timed Teams
 * exports are rendered to the canonical form; every other format is kept
 * as extracted, with line endings normalized to `\n` and outer blank space
 * trimmed.
 */
export function normalizeTranscriptText(format: TranscriptSourceFormat, text: string): string {
  const unified = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const teamsCues =
    format === "teams_docx" && countMatching(lines(unified), (line) => CUE_TIMING.test(line)) >= 2;
  if (format === "vtt" || format === "srt" || teamsCues) {
    const rendered = renderCuesCanonical(parseCues(unified, { acrossBlankLines: teamsCues }));
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

/** Where to end a piece of speech that runs past MAX_TURN_CHARS from `from`. */
function cutPoint(content: string, from: number): number {
  const limit = from + MAX_TURN_CHARS;
  for (let at = limit; at > from + MAX_TURN_CHARS / 2; at -= 1) {
    if (/\s/.test(content[at - 1])) return at;
  }
  // No whitespace in the second half: cut there, never inside a surrogate pair.
  const code = content.charCodeAt(limit - 1);
  return code >= 0xd800 && code <= 0xdbff ? limit - 1 : limit;
}

/**
 * A turn longer than MAX_TURN_CHARS as consecutive turns of the same
 * speaker, cut at whitespace. Only the first keeps the start time.
 */
function splitLongDraft(content: string, draft: Draft): Draft[] {
  const first = draft.spans[0][0];
  const last = draft.spans[draft.spans.length - 1][1];
  if (last - first <= MAX_TURN_CHARS) return [draft];
  const pieces: Array<[number, number]> = [];
  for (const [start, end] of draft.spans) {
    let from = start;
    while (end - from > MAX_TURN_CHARS) {
      const cut = cutPoint(content, from);
      const piece = trimmedSpan(content, from, cut);
      if (piece) pieces.push(piece);
      from = cut;
    }
    const rest = trimmedSpan(content, from, end);
    if (rest) pieces.push(rest);
  }
  const out: Draft[] = [];
  let chunk: Draft = { ...draft, spans: [] };
  for (const piece of pieces) {
    if (chunk.spans.length > 0 && piece[1] - chunk.spans[0][0] > MAX_TURN_CHARS) {
      out.push(chunk);
      chunk = { speakerLabel: draft.speakerLabel, rawLabel: draft.rawLabel, spans: [] };
    }
    chunk.spans.push(piece);
  }
  out.push(chunk);
  return out;
}

/**
 * Splits verbatim transcript text into speaker turns. A turn opens on a
 * labelled line ("Name: text", `<v Name>`), or on a header line holding a
 * name and a time with the speech below it; unlabelled lines continue the
 * turn above them. Text before the first label, and every paragraph of a
 * transcript that names no one, becomes its own turn with no speaker. A
 * turn longer than MAX_TURN_CHARS continues as further turns of the same
 * speaker.
 *
 * A line opening with a bracketed time and no name depends on `cues`
 * (`isCueRender`). In a cue render it is a cue nobody was named for: its
 * own turn with that time and no speaker, never folded into the speaker
 * above. Anywhere else it is speech with a time on it, read like any other
 * line: it continues a named turn, and a turn it opens starts at that time.
 */
export function parseTranscriptTurns(
  content: string,
  options: { cues?: boolean } = {}
): TranscriptTurn[] {
  const turns: TranscriptTurn[] = speakerDrafts(content, options)
    .flatMap((draft) => splitLongDraft(content, draft))
    .map((draft, index) => {
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

export type TranscriptSpeakerNames = {
  /** Every speaker label a turn gets, in order of first appearance. */
  labels: string[];
  /**
   * Other forms of speakers' names the text holds: a label as written when
   * it differs from the turn's label ("Shah, Priya"), and a label on a line
   * the transcript-wide rules did not count as a speaker.
   */
  otherNames: string[];
  /** Organizations named in labels' brackets ("Acme" in "Priya Shah (Acme)"). */
  organizations: string[];
};

/**
 * The names a transcript's speaker labels hold, from the same parse as
 * `parseTranscriptTurns`, so `labels` is exactly the set of the turns'
 * labels, which the stored speaker rows hold once the turn build has run.
 * Owner decision 26 hides all of them, so a draft started before that build
 * finishes still sends no speaker's name.
 */
export function transcriptSpeakerNames(content: string, options: { cues?: boolean } = {}): TranscriptSpeakerNames {
  const lines = analyzeLines(content);
  const labels = new Set<string>();
  // A draft holds at least one non-empty span, so it gives at least one turn.
  for (const draft of draftsFrom(content, lines, options)) {
    if (draft.speakerLabel !== undefined) labels.add(draft.speakerLabel);
  }
  const otherNames = new Set<string>();
  const organizations = new Set<string>();
  const add = (set: Set<string>, value: string | undefined) => {
    if (value !== undefined && !labels.has(value)) set.add(value);
  };
  for (const kind of [...lines.lineKinds, ...lines.kinds]) {
    if (kind?.kind !== "inline" && kind?.kind !== "header") continue;
    add(otherNames, kind.speaker);
    add(otherNames, writtenLastFirst(kind.rawLabel));
    const bracketed = labelBracketNames(kind.rawLabel);
    for (const name of bracketed.people) add(otherNames, name);
    for (const name of bracketed.organizations) add(organizations, name);
  }
  for (const name of lines.paneNames) add(otherNames, name);
  return { labels: [...labels], otherNames: [...otherNames], organizations: [...organizations] };
}

/** A "Shah, Priya" label as written, before it is read as "Priya Shah". */
function writtenLastFirst(rawLabel: string): string | undefined {
  let label = rawLabel.trim().replace(TRAILING_TIMESTAMP, "");
  const paren = /^(.+?)\s*[(\[]([^()[\]]{1,80})[)\]]$/.exec(label);
  if (paren) label = paren[1].trim();
  return lastFirstName(label) !== undefined ? label : undefined;
}

/** A time line a Teams-pane header took over (`markPaneHeaders`). */
type LineKind = SpeakerLine | { kind: "consumed" } | undefined;

/**
 * A line holding only a speaker's name ("Priya Shah", "Shah, Priya"), as
 * the Teams transcript pane puts above each turn's time.
 */
function bareNameLine(text: string): string | undefined {
  const line = text.trim();
  if (line.includes(":") || NOT_A_NAME.has(line.toLowerCase())) return undefined;
  return speakerFromLabel(line);
}

/**
 * Text copied from the Teams transcript pane: the speaker's name on one
 * line, the time on the next, then the speech. A name line becomes a header
 * with that time only when the next line is a time and the line after it is
 * speech, and only when the transcript holds at least two such headers.
 * Returns the names of the headers it found too few of, for hiding only.
 */
function markPaneHeaders(infos: readonly LineInfo[], kinds: LineKind[]): string[] {
  const next = (from: number) => {
    let at = from;
    while (at < infos.length && infos[at].text.trim() === "") at += 1;
    return at;
  };
  const found: Array<{ name: number; time: number; speaker: string }> = [];
  for (let i = 0; i < infos.length; i += 1) {
    if (kinds[i] !== undefined) continue;
    const speaker = bareNameLine(infos[i].text);
    if (!speaker) continue;
    const time = next(i + 1);
    if (kinds[time]?.kind !== "timestamp") continue;
    const speech = next(time + 1);
    if (speech >= infos.length) continue;
    const after = kinds[speech];
    if (after !== undefined && after.kind !== "timed") continue;
    found.push({ name: i, time, speaker });
  }
  if (found.length < 2) return found.map((header) => header.speaker);
  for (const header of found) {
    const time = kinds[header.time];
    kinds[header.name] = {
      kind: "header",
      speaker: header.speaker,
      rawLabel: infos[header.name].text.trim(),
      ...(time?.kind === "timestamp" && time.timeMs !== undefined ? { timeMs: time.timeMs } : {}),
    };
    kinds[header.time] = { kind: "consumed" };
  }
  return [];
}

/**
 * Plain "Name:" labels count only when the transcript shows a speaker
 * pattern (parser v4): a header or a timed or voiced label, a label that
 * recurs, a text that opens with its label, or an exchange between at
 * least two speakers that is not buried in prose (no more text before the
 * first label than labelled lines). Otherwise a lone "Lessons Learned: ..."
 * in notes would take over every paragraph after it; those lines stay
 * plain text.
 */
function dropUnpatternedLabels(infos: readonly LineInfo[], kinds: LineKind[]): void {
  const counts = new Map<string, number>();
  let strong = false;
  let labelled = 0;
  let textBeforeFirstLabel = 0;
  for (let i = 0; i < infos.length; i += 1) {
    const kind = kinds[i];
    if (infos[i].text.trim() === "" || kind?.kind === "consumed" || kind?.kind === "timestamp") continue;
    if (kind?.kind === "inline" || kind?.kind === "header") {
      counts.set(kind.speaker, (counts.get(kind.speaker) ?? 0) + 1);
      labelled += 1;
      if (!isPlainLabel(infos[i].text, kind)) strong = true;
    } else if (labelled === 0) {
      textBeforeFirstLabel += 1;
    }
  }
  if (strong || [...counts.values()].some((count) => count >= 2)) return;
  if (textBeforeFirstLabel === 0 || (counts.size >= 2 && labelled >= textBeforeFirstLabel)) return;
  for (let i = 0; i < infos.length; i += 1) {
    const kind = kinds[i];
    if (kind?.kind === "inline" && isPlainLabel(infos[i].text, kind)) kinds[i] = undefined;
  }
}

/**
 * "Dana (Verdant Grid)" and "Sam (Verdant Grid)": a bracketed name that
 * follows several one-word names, each always with that same name, is the
 * company they share, so each word before it is the speaker. One line alone
 * cannot tell this from "Acme (Priya Shah)" (`companyThenName`), so this
 * reads the whole transcript (parser v5).
 */
function resolveBracketSpeakers(kinds: LineKind[]): void {
  const outersOf = new Map<string, Set<string>>();
  const innersOf = new Map<string, Set<string>>();
  const pairs: Array<{ at: number; outer: string; inner: string }> = [];
  kinds.forEach((kind, at) => {
    if (kind?.kind !== "inline" && kind?.kind !== "header") return;
    const parts = bracketParts(kind.rawLabel);
    if (!parts || !companyThenName(parts)) return;
    pairs.push({ at, ...parts });
    outersOf.set(parts.inner, (outersOf.get(parts.inner) ?? new Set()).add(parts.outer));
    innersOf.set(parts.outer, (innersOf.get(parts.outer) ?? new Set()).add(parts.inner));
  });
  for (const pair of pairs) {
    if ((outersOf.get(pair.inner)?.size ?? 0) < 2 || (innersOf.get(pair.outer)?.size ?? 0) !== 1) continue;
    const kind = kinds[pair.at] as Extract<SpeakerLine, { speaker: string }>;
    kinds[pair.at] = { ...kind, speaker: pair.outer };
  }
}

/** An untimed "Name: speech" line: the weakest sign of a speaker. */
function isPlainLabel(text: string, kind: SpeakerLine): boolean {
  return kind.kind === "inline" && kind.timeMs === undefined && !VTT_VOICE.test(text.trim());
}

type AnalyzedLines = {
  infos: LineInfo[];
  /** How each line opens a turn, on its own (`splitSpeakerLine`). */
  lineKinds: readonly LineKind[];
  /** The same after the transcript-wide rules: what the turns follow. */
  kinds: LineKind[];
  /** Names on lines above a time that were too few to count as headers. */
  paneNames: string[];
};

function analyzeLines(content: string): AnalyzedLines {
  const infos = lineInfos(content);
  const lineKinds: LineKind[] = infos.map((info) => splitSpeakerLine(info.text));
  const kinds = [...lineKinds];
  const paneNames = markPaneHeaders(infos, kinds);
  resolveBracketSpeakers(kinds);
  dropUnpatternedLabels(infos, kinds);
  return { infos, lineKinds, kinds, paneNames };
}

/** Speaker turns before long ones are split: each holds at least one span. */
function speakerDrafts(content: string, options: { cues?: boolean }): Draft[] {
  return draftsFrom(content, analyzeLines(content), options);
}

function draftsFrom(content: string, lines: AnalyzedLines, options: { cues?: boolean }): Draft[] {
  const { infos, kinds } = lines;
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
    if (kind?.kind === "consumed") continue;
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
    if (kind?.kind === "timed" && options.cues) {
      // A cue that named no one: its own turn, with its time, never folded
      // into the speaker above it.
      open({ startMs: kind.timeMs ?? pendingTime, spans: [] });
      pendingTime = undefined;
      const span = trimmedSpan(content, info.start + kind.speechOffset, info.end);
      if (span) current!.spans.push(span);
      blankSinceSpeech = false;
      continue;
    }
    // Outside a cue render a bracketed time is part of the line.
    const lineTime = kind?.kind === "timed" ? kind.timeMs : undefined;
    const span = trimmedSpan(content, info.start, info.end);
    if (!span) continue;
    const unlabelled = !current || current.speakerLabel === undefined;
    // Without any speaker labels, or before the first one, a paragraph is a
    // turn of its own; inside a labelled turn, text continues it.
    if (!hasSpeakers || unlabelled) {
      if (!current || current.speakerLabel !== undefined || blankSinceSpeech) {
        open({ spans: [], startMs: lineTime ?? pendingTime });
        pendingTime = undefined;
      }
    }
    current!.spans.push(span);
    blankSinceSpeech = false;
  }
  if (current && current.spans.length > 0) drafts.push(current);
  return drafts;
}
