import { isSupportedFile } from "$lib/parseDocument";
import {
  CONTEXT_CATEGORIES,
  type ContextCategoryDef,
  type ContextCategoryId,
} from "$lib/contextCategories";

export type StagedCategory = { files: File[]; text: string };
export type Staged = Record<ContextCategoryId, StagedCategory>;
export type PyRow = { id: string; year: number; note: string; files: File[] };

export function emptyStaged(): Staged {
  const out = {} as Staged;
  for (const c of CONTEXT_CATEGORIES) out[c.id] = { files: [], text: "" };
  return out;
}

export function guessFileType(
  name: string
): "txt" | "md" | "pdf" | "docx" | "msg" | "eml" | "xlsx" | "other" {
  const l = name.toLowerCase();
  if (l.endsWith(".pdf")) return "pdf";
  if (l.endsWith(".docx")) return "docx";
  if (l.endsWith(".msg")) return "msg";
  if (l.endsWith(".eml") || l.endsWith(".mbox")) return "eml";
  if (l.endsWith(".xlsx") || l.endsWith(".xls") || l.endsWith(".csv")) return "xlsx";
  if (l.endsWith(".md") || l.endsWith(".markdown")) return "md";
  if (l.endsWith(".txt")) return "txt";
  return "other";
}

/** BNH-33: split an incoming file list into parseable vs. unsupported. */
export function partitionSupported(files: File[]): { ok: File[]; rejected: string[] } {
  const ok: File[] = [];
  const rejected: string[] = [];
  for (const f of files) {
    if (isSupportedFile(f.name)) ok.push(f);
    else rejected.push(f.name);
  }
  return { ok, rejected };
}

export const WEIGHT_STYLES: Record<ContextCategoryDef["weight"], string> = {
  Highest: "bg-primary/10 text-primary-dark",
  High: "bg-primary/10 text-primary-dark",
  Medium: "bg-chrome text-gray-500",
  Supporting: "bg-chrome text-gray-400",
};
