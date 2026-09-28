/**
 * What the start dialog (StartRunDialog) shows, shared by New project and
 * the project pages (2026-09-27, fourth): the model line (decision 52) and,
 * on a project page, the project's own transcripts and files, every one
 * ticked when it opens (decision 56).
 */
import { defaultModelIdFor, modelLabelFor, type PickerCapabilities } from "$lib/modelPicker";
import { CONTEXT_CATEGORIES, type ContextCategoryId } from "$lib/contextCategories";
import { PREVIOUS_YEAR_ONLY_MESSAGE } from "../../../../shared/previousYear";
import type { StartRunExcluded, StartRunSource } from "./StartRunDialog.svelte";

type Capabilities =
  | (NonNullable<PickerCapabilities> & { planningModelLabel?: string | null; pdReviewModelLabel?: string | null })
  | null
  | undefined;

/** The AI mark row: the model names over what they do. */
export function startRunModels(args: {
  mode: "iterative" | "single" | "compare" | "review";
  capabilities: Capabilities;
  singleModelId: string;
  compareSlotA: string;
  compareSlotB: string;
}): { title: string; line: string } {
  const { capabilities } = args;
  if (args.mode === "review") {
    return {
      title: capabilities?.pdReviewModelLabel ?? "The review model",
      line: "Reviews the draft, you get a feedback report",
    };
  }
  const picked = modelLabelFor(args.singleModelId || defaultModelIdFor(capabilities), capabilities);
  if (args.mode === "iterative") {
    const planning = capabilities?.planningModelLabel ?? picked;
    return {
      title: planning,
      line: planning === picked ? "Writes the ideas and the report." : `Writes the ideas. ${picked} writes the report.`,
    };
  }
  if (args.mode === "single") return { title: picked, line: "Writes the draft, about 3 minutes" };
  const slot = (id: string) => (id ? modelLabelFor(id, capabilities) : "a random model");
  return {
    title:
      !args.compareSlotA && !args.compareSlotB
        ? "Two random models"
        : `${slot(args.compareSlotA)} and ${slot(args.compareSlotB)}`.replace(/^a random/, "A random"),
    line: "One draft each, you keep the better one",
  };
}

const CATEGORY_ORDER: string[] = CONTEXT_CATEGORIES.map((category) => category.id);

/** A file's chip: its category, "Written PD" for a PD under review, else Other supporting docs. */
export function documentTypeLabel(document: { category: string | null; source?: string }): string {
  const category = CONTEXT_CATEGORIES.find((item) => item.id === document.category);
  if (category) return category.label;
  if (document.source === "review_pd") return "Written PD";
  return CONTEXT_CATEGORIES.find((item) => item.id === ("other" satisfies ContextCategoryId))!.label;
}

function words(count: number): string {
  return `${count.toLocaleString("en-US")} words`;
}

export type ProjectTranscriptRow = { _id: string; label: string; wordCount: number };
export type ProjectDocumentRow = {
  _id: string;
  fileName: string;
  category: string | null;
  source?: string;
  archived: boolean;
  wordCount?: number;
  createdAt: number;
};

/**
 * A project's start dialog rows: its transcripts in list order, then its
 * files that are not archived, in SR&ED weight order (oldest first within
 * a category). Archived files are never read, so they are not offered.
 */
export function projectStartSources(
  transcripts: readonly ProjectTranscriptRow[],
  documents: readonly ProjectDocumentRow[]
): StartRunSource[] {
  const rank = (document: ProjectDocumentRow) => {
    const index = CATEGORY_ORDER.indexOf(document.category ?? "");
    return index < 0 ? CATEGORY_ORDER.length : index;
  };
  const files = documents
    .filter((document) => !document.archived)
    .sort((a, b) => rank(a) - rank(b) || a.createdAt - b.createdAt);
  return [
    ...transcripts.map((transcript) => ({
      id: transcript._id,
      kind: "transcript" as const,
      name: transcript.label,
      typeLabel: "Transcript",
      meta: words(transcript.wordCount),
    })),
    ...files.map((document) => ({
      id: document._id,
      kind: "document" as const,
      name: document.fileName,
      typeLabel: documentTypeLabel(document),
      meta: words(document.wordCount ?? 0),
    })),
  ];
}

/**
 * Decision 42 on a project page: last year's report alone is never the
 * source. Null when the ticked files include a transcript or a current
 * file; the server checks again.
 */
export function projectStartProblem(
  excluded: StartRunExcluded,
  transcripts: readonly ProjectTranscriptRow[],
  documents: readonly ProjectDocumentRow[]
): string | null {
  const leftOut = new Set([...excluded.transcriptIds, ...excluded.documentIds]);
  if (transcripts.some((transcript) => !leftOut.has(transcript._id))) return null;
  const ticked = documents.filter(
    (document) => !document.archived && !leftOut.has(document._id) && (document.wordCount ?? 1) > 0
  );
  if (ticked.length === 0) return null;
  return ticked.every((document) => document.category === "previous_pd") ? PREVIOUS_YEAR_ONLY_MESSAGE : null;
}
