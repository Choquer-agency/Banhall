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

type FileType = "txt" | "md" | "pdf" | "docx" | "msg" | "eml" | "xlsx" | "image" | "other";

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
    if (!doc.file) continue;
    const content = doc.parsed?.content ?? "";
    const hasText = content.trim().length > 0;
    if (category === "previous_pd" && hasText) carried.add(doc.year);
    sources.push({
      sourceKey: input.keyFor(doc.id),
      kind: "document",
      position: position++,
      label: doc.file.name,
      // Only extracted text gets the header: an empty file stays empty.
      content: hasText ? prefix + content : "",
      fileType: (doc.parsed?.fileType as FileType | undefined) ?? (guessFileType(doc.file.name) as FileType),
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
