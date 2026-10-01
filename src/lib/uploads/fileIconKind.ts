/**
 * Which file-icon-vectors "vivid" icon a file gets (round 2 boards E1 to E6,
 * F1, G1 to G3). Only the four types the boards show have their own icon;
 * everything else, including a missing name, gets the neutral blank page.
 */
export type FileIconKind = "pdf" | "docx" | "xlsx" | "txt" | "generic";

const KNOWN: ReadonlySet<string> = new Set(["pdf", "docx", "xlsx", "txt"]);

/** Accepts a file name ("Notes.PDF") or a bare extension ("pdf", ".pdf"). */
export function fileIconKind(nameOrExtension: string | null | undefined): FileIconKind {
  const value = nameOrExtension?.trim().toLowerCase() ?? "";
  const dot = value.lastIndexOf(".");
  const extension = dot === -1 ? value : value.slice(dot + 1);
  return KNOWN.has(extension) ? (extension as FileIconKind) : "generic";
}
