/**
 * Pure document file-type helpers and text normalization utilities.
 * Kept separate from `parseDocument.ts` so callers that only need extension
 * checks, accept strings, or text capping never pull `pdfjs-dist` into
 * eagerly loaded route chunks.
 */
export {
  SUPPORTED_EXTENSIONS,
  IMAGE_EXTENSIONS,
  SUPPORTED_ACCEPT,
  SUPPORTED_LABEL,
  getFileExtension,
  isSupportedFile,
  isImageFile,
  normalizeExtractedText,
} from "../../shared/documentStatus";
export { capContent, MAX_CONTENT_CHARS } from "./documentContent";
export { locatePageOffsets } from "../../shared/documentContent";

export type ParsedFileType =
  | "txt"
  | "md"
  | "pdf"
  | "docx"
  | "msg"
  | "eml"
  | "xlsx"
  | "image"
  | "other";
