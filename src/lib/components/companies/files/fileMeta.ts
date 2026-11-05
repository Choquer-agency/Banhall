/**
 * Words and groups for a company's Files tab (2026-11-04, the company
 * profile): a file's category label, its kind, the fiscal year it is filed
 * under, the groups the list shows, and the file type names a drag shows
 * before the drop.
 */
import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../../../convex/_generated/api";

export type ListedCompanyFile = FunctionReturnType<typeof api.companyFiles.listCompanyFiles>["files"][number];
export type CompanyFileCategory = NonNullable<ListedCompanyFile["category"]>;

export const CATEGORY_OPTIONS: readonly { value: CompanyFileCategory; label: string }[] = [
  { value: "previous_pd", label: "Prior SR&ED report" },
  { value: "scoping_notes", label: "Scoping notes" },
  { value: "writer_notes", label: "Writer's notes" },
  { value: "background", label: "Background" },
  { value: "other", label: "Other" },
];

export function categoryLabel(category: CompanyFileCategory | null | undefined): string | null {
  return CATEGORY_OPTIONS.find((option) => option.value === category)?.label ?? null;
}

const KIND_LABELS: Record<string, string> = {
  pdf: "PDF",
  docx: "Word",
  xlsx: "Spreadsheet",
  msg: "Email",
  eml: "Email",
  txt: "Text",
  md: "Text",
  image: "Image",
  other: "File",
};

/** The AI label's document type, else the file type, with a capital first letter. */
export function kindLabel(file: Pick<ListedCompanyFile, "labels" | "fileType">): string {
  const type = file.labels?.documentType;
  if (type && type !== "other") return type.charAt(0).toUpperCase() + type.slice(1);
  return KIND_LABELS[file.fileType] ?? "File";
}

/** What the row says the file is: the category a person picked, else the AI's kind. */
export function describeFile(file: Pick<ListedCompanyFile, "labels" | "fileType" | "category">): string {
  return categoryLabel(file.category) ?? kindLabel(file);
}

export function wordsLabel(wordCount: number): string {
  return `${wordCount.toLocaleString("en-US")} ${wordCount === 1 ? "word" : "words"}`;
}

/** The year a person filed the file under, else the AI label's year; null for none. */
export function fiscalYearOf(file: Pick<ListedCompanyFile, "fiscalYear" | "labels">): number | null {
  if (file.fiscalYear !== undefined) return file.fiscalYear;
  return file.labels?.fiscalYear ?? null;
}

export function couldNotRead(file: Pick<ListedCompanyFile, "processingStatus">): boolean {
  return file.processingStatus === "could_not_read";
}

export type FileGroup = { key: string; label: string; files: ListedCompanyFile[]; warning?: boolean };

/**
 * The list's groups: files nothing could be read from first, then one group
 * per fiscal year (newest first), then files with no fiscal year. Each keeps
 * the list's own order (newest first).
 */
export function groupFiles(files: readonly ListedCompanyFile[]): FileGroup[] {
  const unread: ListedCompanyFile[] = [];
  const byYear = new Map<number, ListedCompanyFile[]>();
  const noYear: ListedCompanyFile[] = [];
  for (const file of files) {
    if (couldNotRead(file)) {
      unread.push(file);
      continue;
    }
    const year = fiscalYearOf(file);
    if (year === null) noYear.push(file);
    else byYear.set(year, [...(byYear.get(year) ?? []), file]);
  }
  const groups: FileGroup[] = [];
  if (unread.length) groups.push({ key: "unread", label: "Could not read", files: unread, warning: true });
  for (const year of [...byYear.keys()].sort((a, b) => b - a)) {
    groups.push({ key: `fy-${year}`, label: `FY ${year}`, files: byYear.get(year)! });
  }
  if (noYear.length) groups.push({ key: "no-year", label: "No fiscal year", files: noYear });
  return groups;
}

/** The fiscal years Edit details offers: next year back to ten years ago. */
export function fiscalYearOptions(now = new Date(), current: number | null = null): number[] {
  const top = now.getFullYear() + 1;
  const years = Array.from({ length: 12 }, (_, index) => top - index);
  if (current !== null && !years.includes(current)) years.push(current);
  return years.sort((a, b) => b - a);
}

export function addedLabel(createdAt: number): string {
  return `Added ${new Date(createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

export function bytesLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** What a dragged file is called before the drop (the browser gives only its type). */
export function draggedTypeLabel(mimeType: string): { label: string; name: string } {
  const type = mimeType.toLowerCase();
  if (type === "application/pdf") return { label: "PDF file", name: "file.pdf" };
  if (type.includes("spreadsheet") || type.includes("excel") || type === "text/csv") return { label: "Excel file", name: "file.xlsx" };
  if (type.includes("wordprocessing") || type === "application/msword") return { label: "Word file", name: "file.docx" };
  if (type === "message/rfc822" || type === "application/vnd.ms-outlook") return { label: "Email", name: "file.eml" };
  if (type.startsWith("image/")) return { label: "Image", name: "file.png" };
  if (type.startsWith("text/")) return { label: "Text file", name: "file.txt" };
  return { label: "File", name: "file" };
}

/** Whether a drag carries files (not text or a link from the page). */
export function dragHasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

/** The types of the files a drag carries (known before the drop; names are not). */
export function draggedFileTypes(event: DragEvent): string[] {
  return Array.from(event.dataTransfer?.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => item.type);
}
