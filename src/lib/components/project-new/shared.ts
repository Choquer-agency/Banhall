import { isImageFile } from "$lib/parseDocument";

export function guessFileType(
  name: string
): "txt" | "md" | "pdf" | "docx" | "msg" | "eml" | "xlsx" | "image" | "other" {
  const l = name.toLowerCase();
  if (l.endsWith(".pdf")) return "pdf";
  if (l.endsWith(".docx")) return "docx";
  if (l.endsWith(".msg")) return "msg";
  if (l.endsWith(".eml") || l.endsWith(".mbox")) return "eml";
  if (l.endsWith(".xlsx") || l.endsWith(".xls") || l.endsWith(".csv")) return "xlsx";
  if (isImageFile(name)) return "image";
  if (l.endsWith(".md") || l.endsWith(".markdown")) return "md";
  if (l.endsWith(".txt")) return "txt";
  return "other";
}
