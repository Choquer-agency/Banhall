/**
 * Profile photo rules the browser checks before uploading (decision 54: PNG
 * or JPG, up to 5 MB). The server (`account.setMyPhoto`) enforces the same.
 */
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const PHOTO_TYPES = ["image/png", "image/jpeg"] as const;

export const PHOTO_HINT = "PNG or JPG, up to 5 MB";

export type StagedPhoto =
  | { kind: "none" }
  | { kind: "file"; file: File; previewUrl: string }
  | { kind: "remove" };

/** Plain error copy for a picked file, or null when it can be used. */
export function photoProblem(file: { type: string; size: number }): string | null {
  if (!(PHOTO_TYPES as readonly string[]).includes(file.type)) return "Use a PNG or JPG file.";
  if (file.size > PHOTO_MAX_BYTES) return "That photo is over 5 MB.";
  return null;
}
