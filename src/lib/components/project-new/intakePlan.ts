/**
 * What New project saves to its private intake draft (decision 65, stage 2):
 * every transcript in list order, then the supporting documents in the
 * order and with the text a confirmed project stores them (SR&ED weight
 * order, previous-year reports under their header and note, a note no
 * report carried as its own file). Files still being read wait until they
 * are read. Pure, so the page and its tests build the same list.
 */
import { CATEGORY_ORDER, type SupportingDoc } from "./supportingDocs.svelte";
import { guessFileType } from "./shared";
import { previousYearNoteText, previousYearReportHeader } from "../../../../shared/previousYear";
import type { ContextCategoryId } from "$lib/contextCategories";
import type { TranscriptSourceFormat } from "../../../../shared/transcriptParse";

export type FileType = "txt" | "md" | "pdf" | "docx" | "msg" | "eml" | "xlsx" | "image" | "other";

export type IntakeSourceDesc = {
  sourceKey: string;
  kind: "transcript" | "document";
  position: number;
  label: string;
  content: string;
  sourceFormat?: TranscriptSourceFormat;
  fileType?: FileType;
  category?: ContextCategoryId;
  intake?: "file" | "pasted";
  extractionOutcome?: "ok" | "failed";
  /** The original file, saved to the draft once the text is. */
  file?: File | null;
};

/** Positions of documents start here, after every transcript's. */
export const DOCUMENT_POSITION_BASE = 1000;

/** The source key of a previous-year note no report carried. */
export function noteSourceKey(year: number): string {
  return `prevyear-note-${year}`;
}

/** A fresh, opaque source key. */
export function newSourceKey(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

/** A previous-year report's first lines: its header, then the year's note. */
export function previousYearPrefix(year: number, note: string): string {
  return `${previousYearReportHeader(year)}${note ? `Note: ${note}\n` : ""}\n`;
}

export function plannedIntakeSources(input: {
  transcripts: ReadonlyArray<{ id: string; label: string; content: string; format?: TranscriptSourceFormat; file?: File }>;
  /** The supporting documents, transcript-chip files excluded. */
  docs: readonly SupportingDoc[];
  yearNotes: ReadonlyMap<number, string>;
  /** Fiscal years with previous-year reports or notes, newest first. */
  previousYears: readonly number[];
  keyFor: (id: string) => string;
}): IntakeSourceDesc[] {
  const sources: IntakeSourceDesc[] = input.transcripts.map((item, index) => ({
    sourceKey: input.keyFor(item.id),
    kind: "transcript",
    position: index,
    label: item.label,
    content: item.content,
    ...(item.format ? { sourceFormat: item.format } : {}),
    file: item.file ?? null,
  }));
  const order = (doc: SupportingDoc) => CATEGORY_ORDER.indexOf(doc.category as ContextCategoryId);
  const docs = [...input.docs].filter((doc) => doc.category !== "transcript").sort((a, b) => order(a) - order(b));
  const noteOf = (year: number) => (input.yearNotes.get(year) ?? "").trim();
  const carried = new Set<number>();
  let position = DOCUMENT_POSITION_BASE;
  for (const doc of docs) {
    if (doc.status === "reading") continue;
    const category = doc.category as ContextCategoryId;
    const prefix = category === "previous_pd" ? previousYearPrefix(doc.year, noteOf(doc.year)) : "";
    if (doc.pastedText !== null) {
      if (category === "previous_pd" && doc.pastedText.trim()) carried.add(doc.year);
      sources.push({
        sourceKey: input.keyFor(doc.id),
        kind: "document",
        position: position++,
        label: doc.name,
        content: prefix + doc.pastedText,
        fileType: "txt",
        category,
        intake: "pasted",
      });
      continue;
    }
    // A file brought back after a reload has its text but no File.
    if (!doc.file && !doc.restored) continue;
    const content = doc.parsed?.content ?? "";
    const hasText = content.trim().length > 0;
    if (category === "previous_pd" && hasText) carried.add(doc.year);
    const name = doc.file?.name ?? doc.name;
    sources.push({
      sourceKey: input.keyFor(doc.id),
      kind: "document",
      position: position++,
      label: name,
      // Only extracted text gets the header: an empty file stays empty.
      content: hasText ? prefix + content : "",
      fileType:
        doc.restored?.fileType ??
        (doc.parsed?.fileType as FileType | undefined) ??
        (guessFileType(name) as FileType),
      category,
      intake: "file",
      extractionOutcome: doc.status === "failed" ? "failed" : "ok",
      file: doc.file,
    });
  }
  for (const year of input.previousYears) {
    const note = noteOf(year);
    if (!note || carried.has(year)) continue;
    sources.push({
      sourceKey: noteSourceKey(year),
      kind: "document",
      position: position++,
      label: `Previous-year note (FY ${year})`,
      content: previousYearNoteText(year, note),
      fileType: "txt",
      category: "previous_pd",
      intake: "pasted",
    });
  }
  return sources;
}

/** One saved source as a reload reads it back (`intakeDrafts.restoreIntakeDraft`). */
export type RestoredSource = {
  sourceKey: string;
  kind: "transcript" | "document";
  position: number;
  label: string;
  sourceFormat?: TranscriptSourceFormat;
  fileType?: FileType;
  category?: ContextCategoryId;
  intake?: "file" | "pasted";
  extractionOutcome?: "ok" | "failed";
  hasOriginal: boolean;
};

const REPORT_HEADER = /^\[Previous-year report \u2014 fiscal (\d+)\]\n(?:Note: ([^\n]*)\n)?\n/;
const NOTE_TEXT = /^\[Previous-year note \u2014 fiscal (\d+)\]\n\n([\s\S]*)$/;

/**
 * A saved previous-year report's text split back into its fiscal year, its
 * note and the report's own text (the page writes `previousYearPrefix`).
 * Null when the text does not start with the header (an empty file).
 */
export function splitPreviousYearText(content: string): { year: number; note: string; body: string } | null {
  const match = REPORT_HEADER.exec(content);
  if (!match) return null;
  return { year: Number(match[1]), note: match[2] ?? "", body: content.slice(match[0].length) };
}

/** A saved previous-year note no report carried, back to its year and note. */
export function splitPreviousYearNote(content: string): { year: number; note: string } | null {
  const match = NOTE_TEXT.exec(content);
  return match ? { year: Number(match[1]), note: match[2] } : null;
}

/** A transcript brought back after a reload, as the page lists it. */
export type RestoredTranscript = {
  sourceKey: string;
  label: string;
  content: string;
  format?: TranscriptSourceFormat;
  pasted: boolean;
};

/** A supporting document brought back after a reload, as the page lists it. */
export type RestoredDocument = {
  sourceKey: string;
  name: string;
  category: ContextCategoryId;
  year: number | null;
  /** Pasted text, or null for a file. */
  pastedText: string | null;
  /** A file's text without its previous-year header. */
  body: string;
  fileType: FileType;
  failed: boolean;
};

/**
 * What a reload brings back (2026-09-27, fourth), from the saved sources
 * and their text: the transcripts in list order, the documents in saved
 * order (with each previous-year report's year, and the year's note split
 * off its header), the notes by year, and the sources exactly as the draft
 * holds them, so nothing is saved again. Pure, so the page and its tests
 * build the same thing.
 */
export function restoredIntake(
  sources: readonly RestoredSource[],
  texts: ReadonlyMap<string, string>
): {
  transcripts: RestoredTranscript[];
  documents: RestoredDocument[];
  yearNotes: Map<number, string>;
  saved: IntakeSourceDesc[];
} {
  const ordered = [...sources].filter((source) => texts.has(source.sourceKey)).sort((a, b) => a.position - b.position);
  const yearNotes = new Map<number, string>();
  const transcripts: RestoredTranscript[] = [];
  const documents: RestoredDocument[] = [];
  const saved: IntakeSourceDesc[] = [];
  for (const source of ordered) {
    const content = texts.get(source.sourceKey)!;
    saved.push({
      sourceKey: source.sourceKey,
      kind: source.kind,
      position: source.position,
      label: source.label,
      content,
      ...(source.sourceFormat ? { sourceFormat: source.sourceFormat } : {}),
      ...(source.fileType ? { fileType: source.fileType } : {}),
      ...(source.category ? { category: source.category } : {}),
      ...(source.intake ? { intake: source.intake } : {}),
      ...(source.extractionOutcome ? { extractionOutcome: source.extractionOutcome } : {}),
      file: null,
    });
    if (source.kind === "transcript") {
      transcripts.push({
        sourceKey: source.sourceKey,
        label: source.label,
        content,
        ...(source.sourceFormat ? { format: source.sourceFormat } : {}),
        pasted: /^Pasted transcript \d+$/.test(source.label),
      });
      continue;
    }
    const category = source.category ?? "other";
    if (category === "previous_pd" && source.sourceKey.startsWith("prevyear-note-")) {
      const note = splitPreviousYearNote(content);
      if (note) yearNotes.set(note.year, note.note);
      continue;
    }
    const split = category === "previous_pd" ? splitPreviousYearText(content) : null;
    if (split?.note) yearNotes.set(split.year, split.note);
    const body = split ? split.body : content;
    const pasted = source.intake === "pasted";
    documents.push({
      sourceKey: source.sourceKey,
      name: source.label,
      category,
      year: split?.year ?? null,
      pastedText: pasted ? body : null,
      body,
      fileType: source.fileType ?? "other",
      failed: source.extractionOutcome === "failed",
    });
  }
  return { transcripts, documents, yearNotes, saved };
}
