/**
 * New project's supporting documents (board E1, section 03), read as soon as
 * they are added rather than at submit. Each file keeps its reading progress
 * (PDF pages read over total; indeterminate otherwise), its extracted text,
 * page offsets and the PD Sections found in it, so the card meta, the preview
 * sheet and the start dialog all read one record. The text is uploaded when
 * the writer starts.
 */
import { isImageFile, parseFileToText, type ParsedDocument, type ParseOptions } from "$lib/parseDocument";
import { isParseAbort } from "$lib/spreadsheetClient";
import { CONTEXT_CATEGORIES, type ContextCategoryId } from "$lib/contextCategories";
import { readTranscriptFile, type ReadTranscript } from "$lib/transcriptUpload";
import { detectPdSections, sectionsFoundLabel, type DetectedPdSection } from "../../../../shared/pdSectionDetect";

/** A supporting document's chip: one of the five categories, or (Review a
 * written PD only) a transcript, which is stored as a transcript. */
export type SupportingCategory = ContextCategoryId | "transcript";

export const CATEGORY_LABELS: Record<SupportingCategory, string> = {
  ...(Object.fromEntries(CONTEXT_CATEGORIES.map((category) => [category.id, category.label])) as Record<
    ContextCategoryId,
    string
  >),
  transcript: "Transcript",
};

/** Chip menu order: the five categories in their SR&ED weight order. */
export const CATEGORY_ORDER: ContextCategoryId[] = CONTEXT_CATEGORIES.map((category) => category.id);

export type SupportingDoc = {
  id: string;
  name: string;
  file: File | null;
  /** Text the writer pasted instead of a file. */
  pastedText: string | null;
  category: SupportingCategory;
  /** True once the writer picked the chip, so detection never overrides it. */
  categoryTouched: boolean;
  /** Fiscal year of a previous-year report (the header its text is stored under). */
  year: number;
  status: "reading" | "ready" | "failed";
  /** Pages read over total for a PDF; null while unknown or for other types. */
  progress: { done: number; total: number } | null;
  startedAt: number;
  finishedAt: number | null;
  parsed: ParsedDocument | null;
  /** Set when the chip is Transcript (Review a written PD). */
  transcript: ReadTranscript | null;
  error: string | null;
  sections: DetectedPdSection[];
  words: number;
};

export type ParseFile = (file: File, options: ParseOptions) => Promise<ParsedDocument>;
export type ReadTranscriptFile = (file: File) => Promise<ReadTranscript>;

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Seconds until a PDF finishes, from the pages read so far; null when unknown. */
export function readingEtaSeconds(doc: SupportingDoc, now: number): number | null {
  if (doc.status !== "reading" || !doc.progress || doc.progress.done === 0) return null;
  const elapsed = Math.max(0, now - doc.startedAt);
  const perPage = elapsed / doc.progress.done;
  return Math.max(0, ((doc.progress.total - doc.progress.done) * perPage) / 1000);
}

/** Percent read for the card bar; null means indeterminate (animate). */
export function readingPercent(doc: SupportingDoc): number | null {
  if (!doc.progress || doc.progress.total === 0) return null;
  return Math.round((doc.progress.done / doc.progress.total) * 100);
}

/** The card and start-dialog meta line. */
export function supportingMeta(doc: SupportingDoc): string {
  if (doc.status === "failed") return "We could not read this file.";
  if (doc.status === "reading") return "Reading";
  if (doc.category === "transcript") {
    return `${(doc.transcript ? countWords(doc.transcript.content) : 0).toLocaleString("en-US")} words`;
  }
  if (doc.category === "previous_pd") {
    const found = sectionsFoundLabel(doc.sections.length);
    if (found) return found;
  }
  if (doc.file && isImageFile(doc.file.name)) return "Image, kept for reference";
  if (doc.parsed?.pageCount) {
    return `${doc.parsed.pageCount} ${doc.parsed.pageCount === 1 ? "page" : "pages"}`;
  }
  return `${doc.words.toLocaleString("en-US")} words`;
}

/** True when a supporting document gives a draft readable text. */
export function hasReadableText(doc: SupportingDoc): boolean {
  if (doc.category === "transcript") return Boolean(doc.transcript?.content.trim());
  if (doc.pastedText !== null) return doc.pastedText.trim().length > 0;
  if (doc.file && isImageFile(doc.file.name)) return false;
  // A file still being read counts: it is used as soon as it is ready.
  if (doc.status === "reading") return true;
  return Boolean(doc.parsed?.content.trim());
}

export class SupportingDocs {
  items = $state<SupportingDoc[]>([]);
  #seq = 0;
  #controllers = new Map<string, AbortController>();
  #settled = new Map<string, { promise: Promise<void>; resolve: () => void }>();
  #parse: ParseFile;
  #readTranscript: ReadTranscriptFile;
  #lifetime: AbortSignal;
  #defaultYear: () => number;

  constructor(options: {
    lifetime: AbortSignal;
    defaultYear: () => number;
    parse?: ParseFile;
    readTranscript?: ReadTranscriptFile;
  }) {
    this.#lifetime = options.lifetime;
    this.#defaultYear = options.defaultYear;
    this.#parse = options.parse ?? parseFileToText;
    this.#readTranscript = options.readTranscript ?? readTranscriptFile;
  }

  get(id: string): SupportingDoc | undefined {
    return this.items.find((item) => item.id === id);
  }

  #update(id: string, patch: Partial<SupportingDoc>) {
    const index = this.items.findIndex((item) => item.id === id);
    if (index < 0) return;
    this.items[index] = { ...this.items[index], ...patch };
  }

  #settle(id: string) {
    this.#settled.get(id)?.resolve();
  }

  #track(id: string) {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => (resolve = done));
    this.#settled.set(id, { promise, resolve });
  }

  /** Adds files and starts reading each one. Returns their ids. */
  add(files: File[], category?: SupportingCategory): string[] {
    const ids: string[] = [];
    for (const file of files) {
      const id = `doc-${this.#seq++}`;
      const chosen = category ?? "other";
      this.items.push({
        id,
        name: file.name,
        file,
        pastedText: null,
        category: chosen,
        categoryTouched: category !== undefined,
        year: this.#defaultYear(),
        status: "reading",
        progress: null,
        startedAt: Date.now(),
        finishedAt: null,
        parsed: null,
        transcript: null,
        error: null,
        sections: [],
        words: 0,
      });
      ids.push(id);
      this.#track(id);
      void this.#read(id);
    }
    return ids;
  }

  /** Adds pasted text as its own item, ready at once. */
  addPasted(text: string, category: SupportingCategory): string {
    const id = `doc-${this.#seq++}`;
    const label = CATEGORY_LABELS[category];
    const sameCategory = this.items.filter((item) => item.pastedText !== null && item.category === category).length;
    const content = text.trim();
    this.items.push({
      id,
      name: sameCategory === 0 ? `${label} (pasted)` : `${label} (pasted ${sameCategory + 1})`,
      file: null,
      pastedText: content,
      category,
      categoryTouched: true,
      year: this.#defaultYear(),
      status: "ready",
      progress: null,
      startedAt: Date.now(),
      finishedAt: Date.now(),
      parsed: null,
      transcript: null,
      error: null,
      sections: category === "previous_pd" ? detectPdSections(content) : [],
      words: countWords(content),
    });
    this.#track(id);
    this.#settle(id);
    return id;
  }

  remove(id: string) {
    this.#controllers.get(id)?.abort();
    this.#controllers.delete(id);
    this.#settle(id);
    this.#settled.delete(id);
    this.items = this.items.filter((item) => item.id !== id);
  }

  /** Swaps the file behind a card and reads the new one. */
  replace(id: string, file: File) {
    const doc = this.get(id);
    if (!doc) return;
    this.#controllers.get(id)?.abort();
    this.#settle(id);
    this.#update(id, {
      name: file.name,
      file,
      pastedText: null,
      status: "reading",
      progress: null,
      startedAt: Date.now(),
      finishedAt: null,
      parsed: null,
      transcript: null,
      error: null,
      sections: [],
      words: 0,
    });
    this.#track(id);
    void this.#read(id);
  }

  setCategory(id: string, category: SupportingCategory) {
    const doc = this.get(id);
    if (!doc || doc.category === category) return;
    const wasTranscript = doc.category === "transcript";
    this.#update(id, {
      category,
      categoryTouched: true,
      sections:
        category === "previous_pd"
          ? detectPdSections(doc.pastedText ?? doc.parsed?.content ?? "", doc.parsed?.pageOffsets)
          : doc.sections,
    });
    // A transcript is read by the transcript reader, a document by the
    // document parser; switching re-reads the file with the right one.
    if (doc.file && (category === "transcript" || wasTranscript)) {
      this.replace(id, doc.file);
    }
  }

  setYear(id: string, year: number) {
    this.#update(id, { year });
  }

  /** Resolves once every listed item has finished reading (or was removed). */
  async whenRead(ids: readonly string[]): Promise<void> {
    await Promise.all(ids.map((id) => this.#settled.get(id)?.promise ?? Promise.resolve()));
  }

  async #read(id: string) {
    const doc = this.get(id);
    if (!doc?.file) return;
    const controller = new AbortController();
    this.#controllers.set(id, controller);
    const stop = () => controller.abort();
    this.#lifetime.addEventListener("abort", stop, { once: true });
    const file = doc.file;
    try {
      if (doc.category === "transcript") {
        const transcript = await this.#readTranscript(file);
        if (controller.signal.aborted) return;
        this.#update(id, {
          status: "ready",
          transcript,
          words: countWords(transcript.content),
          finishedAt: Date.now(),
        });
        return;
      }
      const parsed = await this.#parse(file, {
        signal: controller.signal,
        onProgress: (progress) => {
          if (controller.signal.aborted) return;
          if (progress.kind === "pages") {
            this.#update(id, { progress: { done: progress.done, total: progress.total } });
          }
        },
      });
      if (controller.signal.aborted) return;
      const sections = detectPdSections(parsed.content, parsed.pageOffsets);
      const current = this.get(id);
      // A report with all three Sections is a previous-year report unless
      // the writer already picked the chip.
      const category =
        current && !current.categoryTouched && sections.length === 3 ? "previous_pd" : current?.category;
      this.#update(id, {
        status: "ready",
        parsed,
        sections,
        words: countWords(parsed.content),
        finishedAt: Date.now(),
        ...(category ? { category } : {}),
      });
    } catch (error) {
      if (controller.signal.aborted || isParseAbort(error)) return;
      this.#update(id, {
        status: "failed",
        error: error instanceof Error ? error.message : "We could not read this file.",
        finishedAt: Date.now(),
      });
    } finally {
      this.#lifetime.removeEventListener("abort", stop);
      if (this.#controllers.get(id) === controller) this.#controllers.delete(id);
      if (!controller.signal.aborted) this.#settle(id);
    }
  }
}
