/**
 * Files being added to a company (2026-11-04): each file's step, its share
 * sent and what the row says. A file over 50 MB never gets past
 * "too_large": it is refused in the browser before anything is sent.
 */
import type { Id } from "../../../../../convex/_generated/dataModel";
import { TOO_LARGE_MESSAGE } from "$lib/uploads/storeCompanyFile";

export type UploadPhase = "waiting" | "reading" | "uploading" | "saving" | "done" | "failed" | "too_large";

export type UploadEntry = {
  id: number;
  name: string;
  size: number;
  file: File;
  attemptKey: string;
  companyKey: string;
  clientId: Id<"clients"> | null;
  phase: UploadPhase;
  /** Share of the original sent, 0 to 1, while uploading. */
  fraction: number;
  error: string | null;
  companyFileId?: Id<"companyFiles">;
};

export function uploadStatus(upload: Pick<UploadEntry, "phase" | "fraction" | "error">): string {
  switch (upload.phase) {
    case "waiting":
      return "Waiting";
    case "reading":
      return "Reading";
    case "uploading":
      return `Uploading, ${Math.round(upload.fraction * 100)}%`;
    case "saving":
      return "Saving";
    case "done":
      return "Added";
    case "too_large":
      return TOO_LARGE_MESSAGE;
    case "failed":
      return upload.error ?? "This file could not be added. Try again.";
  }
}

/** Still on its way: it may be stopped. */
export function inFlight(upload: Pick<UploadEntry, "phase">): boolean {
  return upload.phase === "waiting" || upload.phase === "reading" || upload.phase === "uploading" || upload.phase === "saving";
}

/** How far along the row's fill is, 0 to 1. */
export function uploadFill(upload: Pick<UploadEntry, "phase" | "fraction">): number {
  if (upload.phase === "uploading") return upload.fraction;
  if (upload.phase === "saving" || upload.phase === "done") return 1;
  return 0;
}
