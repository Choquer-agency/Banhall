import { describe, expect, it } from "vitest";
import {
  PROCESSING_STATUSES,
  SUPPORTED_LABEL,
  type ReceiptStatus,
} from "../../../shared/documentStatus";
import {
  DENIED_COPY,
  LOADING_COPY,
  PROCESSING_STATUS_COPY,
  REPLACE_UNCHANGED_COPY,
  SUMMARY_CLAUSE,
  SUMMARY_LOADING_CLAUSE,
  statusAction,
  statusLabel,
} from "./processingStatus";

const ALL_STATUSES: ReceiptStatus[] = [...PROCESSING_STATUSES, "upload_failed"];

describe("copy map", () => {
  it("covers every status a receipt row can have", () => {
    expect(Object.keys(PROCESSING_STATUS_COPY).sort()).toEqual([...ALL_STATUSES].sort());
  });

  it("gives every status a non-empty label and explanation", () => {
    for (const status of ALL_STATUSES) {
      const copy = PROCESSING_STATUS_COPY[status];
      expect(copy.label.trim(), status).not.toBe("");
      expect(copy.explanation.trim(), status).not.toBe("");
    }
  });

  it("never leaks provider or internal error language", () => {
    // AC3 made testable: the guarantee is structural (no field can carry prose
    // and nothing interpolates a caught error), and this pins the one place a
    // human could still type something leaky.
    const banned = /error|exception|stack|convex|openrouter|anthropic|undefined|\bat \w+\(/i;
    const strings = [
      ...ALL_STATUSES.flatMap((status) => {
        const copy = PROCESSING_STATUS_COPY[status];
        return [
          copy.label,
          copy.explanation,
          statusAction(status, { canRetry: true, canReplace: false }) ?? "",
          statusAction(status, { canRetry: false, canReplace: true }) ?? "",
          statusAction(status, { canRetry: false, canReplace: false }) ?? "",
        ];
      }),
      LOADING_COPY.label,
      DENIED_COPY.label,
      DENIED_COPY.explanation,
      ...ALL_STATUSES.map((status) => SUMMARY_CLAUSE[status]),
      SUMMARY_LOADING_CLAUSE,
      REPLACE_UNCHANGED_COPY,
    ];
    for (const text of strings) {
      expect(text, text).not.toMatch(banned);
    }
  });

  it("tells the user which file types actually work", () => {
    expect(
      statusAction("skipped_unsupported", { canRetry: false, canReplace: false })
    ).toContain(SUPPORTED_LABEL);
  });

  it("only omits an action where nothing needs doing", () => {
    expect(statusAction("ready", { canRetry: false, canReplace: false })).toBeNull();
    for (const status of ALL_STATUSES.filter((s) => s !== "ready")) {
      expect(
        statusAction(status, { canRetry: false, canReplace: false })?.trim(),
        status
      ).toBeTruthy();
    }
  });

  it("advises retry or replace depending on whether the file is still held", () => {
    const retry = statusAction("upload_failed", { canRetry: true, canReplace: false })!;
    const replace = statusAction("upload_failed", { canRetry: false, canReplace: true })!;
    expect(retry).not.toBe(replace);
    expect(retry).toMatch(/try again/i);
    // After a reload the bytes are gone, so "try again" would be unactionable.
    expect(replace).toMatch(/replace/i);
  });

  it("ignores the flags for statuses that do not branch", () => {
    const branching: ReceiptStatus[] = ["upload_failed", "could_not_read"];
    for (const status of ALL_STATUSES.filter((s) => !branching.includes(s))) {
      expect(statusAction(status, { canRetry: true, canReplace: true }), status).toBe(
        statusAction(status, { canRetry: false, canReplace: false })
      );
    }
  });

  it("only names the Replace button when the row actually offers one", () => {
    // The live chat receipt shows unreadable files but no Replace control;
    // advice pointing at a button that is not there is worse than none.
    const withButton = statusAction("could_not_read", {
      canRetry: false,
      canReplace: true,
    })!;
    const withoutButton = statusAction("could_not_read", {
      canRetry: false,
      canReplace: false,
    })!;
    expect(withButton).toContain('"Replace file…"');
    expect(withoutButton).not.toContain("Replace file");
    expect(withoutButton).toMatch(/paste the text into the chat/);
  });
});

describe("summary clauses", () => {
  it("gives every status a non-empty clause", () => {
    expect(Object.keys(SUMMARY_CLAUSE).sort()).toEqual([...ALL_STATUSES].sort());
    for (const status of ALL_STATUSES) {
      expect(SUMMARY_CLAUSE[status].trim(), status).not.toBe("");
    }
    expect(SUMMARY_LOADING_CLAUSE.trim()).not.toBe("");
  });

  it("keeps truncated distinct from ready", () => {
    expect(SUMMARY_CLAUSE.ready_truncated).not.toBe(SUMMARY_CLAUSE.ready);
  });
});

describe("statusLabel", () => {
  it("labels a row that is still being read", () => {
    expect(statusLabel(null)).toBe(LOADING_COPY.label);
  });

  it("returns the mapped label for every status", () => {
    for (const status of ALL_STATUSES) {
      expect(statusLabel(status), status).toBe(PROCESSING_STATUS_COPY[status].label);
    }
  });
});
