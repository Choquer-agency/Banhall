import { describe, expect, it } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  PROCESSING_STATUSES,
  type ReceiptStatus,
} from "../../../shared/documentStatus";
import { PROCESSING_STATUS_COPY, statusLabel } from "./processingStatus";
import {
  buildReceiptRows,
  countReceiptFailures,
  summarizeReceipt,
  type EphemeralEntry,
  type ListedAttempt,
  type ListedDocument,
  type ReceiptRow,
} from "./receiptRows";

const docId = (id: string) => id as Id<"projectDocuments">;

function doc(over: Partial<ListedDocument> = {}): ListedDocument {
  return {
    _id: docId("d1"),
    fileName: "interview.docx",
    createdAt: 1_000,
    sizeChars: 500,
    archived: false,
    processingStatus: "ready",
    processingDetail: "text_extracted",
    ...over,
  };
}

function attempt(over: Partial<ListedAttempt> = {}): ListedAttempt {
  return {
    attemptKey: "11111111-1111-4111-8111-111111111111",
    fileName: "dropped.pdf",
    fileSizeBytes: 2_048,
    createdAt: 2_000,
    displayStatus: "failed",
    ...over,
  };
}

function eph(over: Partial<EphemeralEntry> = {}): EphemeralEntry {
  return {
    attemptKey: "22222222-2222-4222-8222-222222222222",
    fileName: "live.docx",
    status: null,
    hasFile: true,
    ...over,
  };
}

describe("buildReceiptRows", () => {
  it("merges all three sources into uniquely keyed rows", () => {
    const rows = buildReceiptRows([doc()], [attempt()], [eph()]);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.key)).size).toBe(3);
    expect(rows.map((r) => r.key)).toEqual([
      "local:22222222-2222-4222-8222-222222222222",
      "attempt:11111111-1111-4111-8111-111111111111",
      "d1",
    ]);
  });

  it("shows in-session work first, then failures, then documents", () => {
    const rows = buildReceiptRows(
      [doc({ _id: docId("d1") }), doc({ _id: docId("d2"), fileName: "second.docx" })],
      [attempt()],
      [eph()]
    );
    expect(rows.map((r) => r.fileName)).toEqual([
      "live.docx",
      "dropped.pdf",
      "interview.docx",
      "second.docx",
    ]);
  });

  it("never lists an attempt that already resolved or was dismissed", () => {
    const resolved = [
      attempt({ displayStatus: "succeeded" as never }),
      attempt({
        attemptKey: "33333333-3333-4333-8333-333333333333",
        displayStatus: "dismissed" as never,
      }),
    ];
    expect(buildReceiptRows([], resolved, [])).toEqual([]);
  });

  it("prefers the in-session entry over the server row for the same attempt", () => {
    const key = "22222222-2222-4222-8222-222222222222";
    const rows = buildReceiptRows(
      [],
      [attempt({ attemptKey: key, fileName: "stale name.docx" })],
      [eph({ attemptKey: key, status: "upload_failed", hasFile: true })]
    );
    expect(rows).toHaveLength(1);
    // Only the session entry knows the file is still in memory.
    expect(rows[0].canRetry).toBe(true);
    expect(rows[0].fileName).toBe("live.docx");
  });

  it("drops an attempt already represented by a document", () => {
    // Today's server can't emit this shape (documentId is written only with
    // status succeeded, which the list query excludes), so it is built by hand
    // to keep the guard honest if that projection ever widens.
    const rows = buildReceiptRows(
      [doc({ _id: docId("d9") })],
      [attempt({ documentId: docId("d9") })],
      []
    );
    expect(rows.map((r) => r.key)).toEqual(["d9"]);
  });

  it("drops an in-session entry once its document exists", () => {
    const rows = buildReceiptRows(
      [doc({ _id: docId("d9") })],
      [],
      [eph({ documentId: docId("d9"), status: "ready" })]
    );
    expect(rows.map((r) => r.key)).toEqual(["d9"]);
  });

  it("assigns actions per provenance", () => {
    const cases: Array<{ row: ReceiptRow; expected: [boolean, boolean, boolean] }> = [
      { row: buildReceiptRows([], [], [eph()])[0], expected: [false, false, false] },
      {
        row: buildReceiptRows([], [], [eph({ status: "upload_failed", hasFile: true })])[0],
        expected: [true, false, true],
      },
      {
        row: buildReceiptRows([], [], [eph({ status: "upload_failed", hasFile: false })])[0],
        expected: [false, true, true],
      },
      {
        row: buildReceiptRows([], [], [eph({ status: "skipped_unsupported" })])[0],
        expected: [false, false, true],
      },
      {
        row: buildReceiptRows([], [], [eph({ status: "ready" })])[0],
        expected: [false, false, false],
      },
      {
        row: buildReceiptRows([], [attempt({ displayStatus: "in_progress" })], [])[0],
        expected: [false, false, false],
      },
      {
        row: buildReceiptRows([], [attempt()], [])[0],
        expected: [false, true, true],
      },
      {
        row: buildReceiptRows([doc({ processingStatus: "ready" })], [], [])[0],
        expected: [false, false, true],
      },
      {
        row: buildReceiptRows([doc({ processingStatus: "could_not_read" })], [], [])[0],
        expected: [false, true, true],
      },
    ];
    for (const { row, expected } of cases) {
      expect([row.canRetry, row.canReplace, row.canRemove], row.key).toEqual(expected);
    }
  });

  it("does not offer Replace on a truncated file", () => {
    // Replace deletes the old row, which would throw away the text that was
    // captured. The advice for a truncated file is to split it instead.
    const row = buildReceiptRows([doc({ processingStatus: "ready_truncated" })], [], [])[0];
    expect(row.canReplace).toBe(false);
  });

  it("marks a fresh attempt as loading and a failed one as upload_failed", () => {
    expect(buildReceiptRows([], [attempt({ displayStatus: "in_progress" })], [])[0].status).toBe(
      null
    );
    expect(buildReceiptRows([], [attempt()], [])[0].status).toBe("upload_failed");
  });

  it("flags an archived document and withholds Replace from it", () => {
    const row = buildReceiptRows(
      [doc({ archived: true, processingStatus: "could_not_read" })],
      [],
      []
    )[0];
    expect(row.archived).toBe(true);
    expect(row.canReplace).toBe(false);
    // The real status is kept: suppression is the row component's job, and
    // null would mean "still loading".
    expect(row.status).toBe("could_not_read");
  });
});

describe("summarizeReceipt", () => {
  it("produces the batch line the ticket specifies", () => {
    const rows = buildReceiptRows(
      [
        doc({ _id: docId("d1") }),
        doc({ _id: docId("d2") }),
        doc({ _id: docId("d3") }),
        doc({ _id: docId("d4") }),
        doc({ _id: docId("d5"), processingStatus: "reference_only" }),
      ],
      [attempt()],
      []
    );
    expect(summarizeReceipt(rows)).toBe("6 files: 4 ready, 1 reference only, 1 failed");
  });

  it("uses the singular for one file", () => {
    expect(summarizeReceipt(buildReceiptRows([doc()], [], []))).toBe("1 file: 1 ready");
  });

  it("says nothing when there is nothing to count", () => {
    expect(summarizeReceipt([])).toBe("");
  });

  it("omits statuses with no rows", () => {
    const summary = summarizeReceipt(buildReceiptRows([doc()], [], []));
    expect(summary).not.toMatch(/0 /);
    expect(summary).not.toContain("skipped");
  });

  it("keeps a fixed clause order regardless of row order", () => {
    const rows = buildReceiptRows(
      [
        doc({ _id: docId("d1"), processingStatus: "skipped_unsupported" }),
        doc({ _id: docId("d2"), processingStatus: "ready" }),
        doc({ _id: docId("d3"), processingStatus: "reference_only" }),
        doc({ _id: docId("d4"), processingStatus: "ready_truncated" }),
      ],
      [],
      []
    );
    expect(summarizeReceipt(rows)).toBe(
      "4 files: 1 ready, 1 truncated, 1 reference only, 1 skipped"
    );
  });

  it("counts files still being read", () => {
    const rows = buildReceiptRows([], [attempt({ displayStatus: "in_progress" })], [eph()]);
    expect(summarizeReceipt(rows)).toBe("2 files: 2 still reading");
  });

  it("leaves archived files out of the count entirely", () => {
    const rows = buildReceiptRows(
      [doc({ _id: docId("d1") }), doc({ _id: docId("d2"), archived: true })],
      [],
      []
    );
    expect(summarizeReceipt(rows)).toBe("1 file: 1 ready");
  });
});

describe("countReceiptFailures", () => {
  it("counts only uploads that never reached the project", () => {
    const rows = buildReceiptRows(
      [
        doc({ _id: docId("d1"), processingStatus: "could_not_read" }),
        doc({ _id: docId("d2"), processingStatus: "ready" }),
      ],
      [
        attempt(),
        attempt({ attemptKey: "44444444-4444-4444-8444-444444444444" }),
        attempt({
          attemptKey: "55555555-5555-4555-8555-555555555555",
          displayStatus: "in_progress",
        }),
      ],
      []
    );
    // An unreadable file did reach the project; a file still uploading has not
    // failed yet.
    expect(countReceiptFailures(rows)).toBe(2);
  });

  it("is zero when nothing failed", () => {
    expect(countReceiptFailures(buildReceiptRows([doc()], [], []))).toBe(0);
    expect(countReceiptFailures([])).toBe(0);
  });

  it("agrees with the summary about archived rows", () => {
    // Kept in step with summarizeReceipt: if one counted an archived row and
    // the other didn't, the header and the summary line would disagree.
    const archivedFailure: ReceiptRow = {
      key: "x",
      fileName: "old.pdf",
      status: "upload_failed",
      archived: true,
      canRetry: false,
      canReplace: false,
      canRemove: false,
    };
    expect(countReceiptFailures([archivedFailure])).toBe(0);
    expect(summarizeReceipt([archivedFailure])).toBe("");
  });
});

describe("deploy-skew resilience", () => {
  it("summarizes an unknown status without leaking undefined or throwing", () => {
    const row = {
      ...buildReceiptRows([doc()], [], [])[0],
      status: "future_status",
    } as unknown as ReceiptRow;
    expect(summarizeReceipt([row])).toBe("1 file: 1 status unavailable");
    expect(summarizeReceipt([row])).not.toContain("undefined");
  });
});

describe("acceptance scenarios", () => {
  it("AC1 — a mixed batch reports every file with its own outcome and actions", () => {
    const rows = buildReceiptRows(
      [],
      [],
      [
        eph({ attemptKey: "a0000000-0000-4000-8000-000000000001", fileName: "archive.zip", status: "skipped_unsupported", hasFile: true }),
        eph({ attemptKey: "a0000000-0000-4000-8000-000000000002", fileName: "scan.pdf", status: "could_not_read", documentId: docId("d1"), hasFile: true }),
        eph({ attemptKey: "a0000000-0000-4000-8000-000000000003", fileName: "notes.docx", status: "ready", documentId: docId("d2"), hasFile: true }),
        eph({ attemptKey: "a0000000-0000-4000-8000-000000000004", fileName: "costs.xlsx", status: "ready", documentId: docId("d3"), hasFile: true }),
      ]
    );

    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.status)).toEqual([
      "skipped_unsupported",
      "could_not_read",
      "ready",
      "ready",
    ]);
    // Nothing failed to upload, so nothing offers Retry or Replace.
    expect(rows.some((r) => r.canRetry || r.canReplace)).toBe(false);
    expect(rows.filter((r) => r.canRemove).map((r) => r.fileName)).toEqual(["archive.zip"]);
  });

  it("AC1 — only a failure that still holds its file offers Retry", () => {
    const rows = buildReceiptRows(
      [],
      [],
      [
        eph({ attemptKey: "b0000000-0000-4000-8000-000000000001", fileName: "lost.docx", status: "upload_failed", hasFile: true }),
        eph({ attemptKey: "b0000000-0000-4000-8000-000000000002", fileName: "ok.docx", status: "ready", hasFile: true }),
      ]
    );
    expect(rows.filter((r) => r.canRetry).map((r) => r.fileName)).toEqual(["lost.docx"]);
  });

  it("AC2 — a truncated file says so, and explains the consequence", () => {
    const rows = buildReceiptRows([doc({ processingStatus: "ready_truncated" })], [], []);
    expect(rows[0].status).toBe("ready_truncated");
    expect(summarizeReceipt(rows)).toBe("1 file: 1 truncated");
    // The copy the row renders has to tell the user what the cut-off costs.
    expect(PROCESSING_STATUS_COPY.ready_truncated.explanation).toMatch(
      /won't be used when the report is written/i
    );
  });

  it("AC3 — statuses survive a reload, and failures degrade to Replace", () => {
    // Rebuilt from server payloads alone: no in-session state.
    const rows = buildReceiptRows(
      [
        doc({ _id: docId("d1"), processingStatus: "ready" }),
        doc({ _id: docId("d2"), processingStatus: "reference_only" }),
      ],
      [attempt()],
      []
    );

    expect(rows.map((r) => r.status)).toEqual(["upload_failed", "ready", "reference_only"]);
    const failed = rows.find((r) => r.status === "upload_failed")!;
    expect(failed.canRetry).toBe(false);
    expect(failed.canReplace).toBe(true);

    // Every status is a known enum value — no free text can reach the UI.
    const allowed: ReceiptStatus[] = [...PROCESSING_STATUSES, "upload_failed"];
    for (const row of rows) {
      expect(row.status === null || allowed.includes(row.status)).toBe(true);
    }
  });

  it("AC4 — a failed upload is never confused with an unreadable file", () => {
    const rows = buildReceiptRows(
      [doc({ _id: docId("d1"), fileName: "scan.pdf", processingStatus: "could_not_read" })],
      [attempt({ fileName: "dropped.pdf" })],
      []
    );
    const failed = rows.find((r) => r.fileName === "dropped.pdf")!;
    const unreadable = rows.find((r) => r.fileName === "scan.pdf")!;

    expect(failed.status).toBe("upload_failed");
    expect(unreadable.status).toBe("could_not_read");
    expect(statusLabel(failed.status)).not.toBe(statusLabel(unreadable.status));
    // Provenance differs too: nothing was stored for the failure.
    expect(failed.documentId).toBeUndefined();
    expect(failed.attemptKey).toBeDefined();
    expect(unreadable.documentId).toBeDefined();
    expect(unreadable.attemptKey).toBeUndefined();
  });
});
