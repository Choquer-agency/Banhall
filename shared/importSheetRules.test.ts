import { describe, expect, it } from "vitest";
import {
  canDelete,
  canPutBack,
  categoryTakes,
  deletedReasonFor,
  DELETED_IN_ONEDRIVE_NOTE,
  labelApplies,
  looksLikeEmail,
  rosterWriterName,
  type ImportCategory,
  type ImportItemStatus,
  type ImportLabel,
} from "./importSheetRules";

/** The Import sheet's one rule for what a file may take (2026-11-11, phase 3b fixes). */
const CATEGORIES: ImportCategory[] = ["final_pd", "draft", "review_copy", "transcript", "supporting", "company_file", "unknown"];
const STATUSES: ImportItemStatus[] = ["discovered", "fetched", "pending_review", "approved", "rejected", "failed", "deleted"];
const LABELS: ImportLabel[] = ["company", "category", "fiscalYearEnd", "pdNumber", "version", "writerName", "scienceCode"];

/** The rule written out by hand, apart from the code under test. */
function byHand(label: ImportLabel, status: ImportItemStatus, category: ImportCategory): boolean {
  const onReview = ["discovered", "fetched", "pending_review", "failed"].includes(status);
  if (!onReview) return false;
  if (label === "company" || label === "category") return true;
  if (status !== "pending_review") return false;
  if (label === "fiscalYearEnd") return true;
  if (label === "scienceCode") return category === "final_pd";
  return ["final_pd", "draft", "review_copy"].includes(category);
}

describe("labelApplies", () => {
  it("matches the written rule for every label, status and category", () => {
    for (const label of LABELS) {
      for (const status of STATUSES) {
        for (const category of CATEGORIES) {
          expect(labelApplies(label, { status, category }), `${label} ${status} ${category}`).toBe(byHand(label, status, category));
        }
      }
    }
  });

  it("judges by the category the change gives the file", () => {
    const draft = { status: "pending_review" as const, category: "draft" as const };
    expect(labelApplies("scienceCode", draft)).toBe(false);
    expect(labelApplies("scienceCode", draft, "final_pd")).toBe(true);
    expect(labelApplies("writerName", { ...draft, category: "transcript" }, "draft")).toBe(true);
    expect(labelApplies("writerName", draft, "supporting")).toBe(false);
  });
});

describe("categoryTakes", () => {
  it("is labelApplies for a read file on To review, with the status left out", () => {
    for (const label of LABELS) {
      for (const category of CATEGORIES) {
        expect(categoryTakes(label, category), `${label} ${category}`).toBe(byHand(label, "pending_review", category));
      }
    }
    // A label the category takes stays taken on a read-only tab: the sheet still shows it there.
    expect(categoryTakes("scienceCode", "final_pd")).toBe(true);
    expect(labelApplies("scienceCode", { status: "approved", category: "final_pd" })).toBe(false);
  });
});

describe("Deleted tab rules", () => {
  it("says why a file is on Deleted, and puts back all but a file removed in OneDrive", () => {
    expect(deletedReasonFor({ status: "deleted" })).toBe("deleted");
    expect(deletedReasonFor({ status: "rejected", reviewNote: "Not ours" })).toBe("rejected");
    expect(deletedReasonFor({ status: "rejected", reviewNote: DELETED_IN_ONEDRIVE_NOTE })).toBe("removed_in_onedrive");
    // Deleted by a person after it was removed in OneDrive: still removed there.
    expect(deletedReasonFor({ status: "deleted", reviewNote: DELETED_IN_ONEDRIVE_NOTE })).toBe("removed_in_onedrive");
    expect(deletedReasonFor({ status: "pending_review" })).toBeUndefined();

    expect(canPutBack({ status: "deleted", deletedReason: "deleted" })).toBe(true);
    expect(canPutBack({ status: "rejected", deletedReason: "rejected" })).toBe(true);
    expect(canPutBack({ status: "rejected", deletedReason: "removed_in_onedrive" })).toBe(false);
    expect(canPutBack({ status: "deleted", deletedReason: "removed_in_onedrive" })).toBe(false);
    expect(canPutBack({ status: "pending_review" })).toBe(false);
    expect(canPutBack({ status: "approved" })).toBe(false);
  });

  it("deletes a read, failed or rejected file, never one being read, approved or deleted", () => {
    expect(STATUSES.filter(canDelete)).toEqual(["pending_review", "rejected", "failed"]);
  });
});

describe("writer names", () => {
  it("takes only a real name from the roster, never an email address or the roster's stand-in", () => {
    expect(rosterWriterName({ name: " Dana  Whitlock ", email: "dana@example.com" })).toBe("Dana Whitlock");
    expect(rosterWriterName({ name: "dana@example.com", email: "dana@example.com" })).toBeNull();
    expect(rosterWriterName({ name: "sam.okafor@example.com" })).toBeNull();
    expect(rosterWriterName({ name: "Unknown team member", email: null })).toBeNull();
    expect(rosterWriterName({ name: "   " })).toBeNull();
    expect(looksLikeEmail("Priya Nair")).toBe(false);
    expect(looksLikeEmail("priya@northgate.example")).toBe(true);
  });
});
