/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { CAP_TRUNCATION_MARKER } from "../shared/documentStatus";

const modules = import.meta.glob("./**/*.ts");
const writerAuthId = "auth-writer-documents-tests";
const outsiderAuthId = "auth-outsider-documents-tests";

async function setup() {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const { projectId } = await t.run(async (ctx) => {
    const writerId = await ctx.db.insert("users", {
      authId: writerAuthId,
      email: "writer@banhall.com",
      role: "writer",
    });
    await ctx.db.insert("users", {
      authId: outsiderAuthId,
      email: "outsider@banhall.com",
      role: "writer",
    });
    const projectId = await ctx.db.insert("projects", {
      title: "Status project",
      clientName: "Client",
      status: "draft",
      createdBy: writerId,
      shareToken: "status-project-token",
      createdAt: now,
      updatedAt: now,
    });
    return { projectId };
  });
  return { t, projectId, writer: t.withIdentity({ subject: writerAuthId }) };
}

describe("uploadDocument processing status", () => {
  test("derives and persists a status for each kind of extraction outcome", async () => {
    const { t, projectId, writer } = await setup();

    const cases = [
      {
        args: { fileName: "interview.docx", fileType: "docx" as const, content: "we tried X" },
        status: "ready",
        detail: "text_extracted",
      },
      {
        args: { fileName: "drawing.png", fileType: "image" as const, content: "" },
        status: "reference_only",
        detail: "image_reference",
      },
      {
        args: {
          fileName: "scan.pdf",
          fileType: "pdf" as const,
          content: "",
          extractionOutcome: "failed" as const,
        },
        status: "could_not_read",
        detail: "parse_failed",
      },
      {
        args: {
          fileName: "big.pdf",
          fileType: "pdf" as const,
          content: "body text" + CAP_TRUNCATION_MARKER,
        },
        status: "ready_truncated",
        detail: "text_truncated",
      },
      {
        args: {
          fileName: "Previous-year note (FY 2024)",
          fileType: "txt" as const,
          content: "last year we built the rig",
          intake: "pasted" as const,
        },
        status: "ready",
        detail: "pasted_text",
      },
    ];

    for (const testCase of cases) {
      const documentId = await writer.mutation(api.documents.uploadDocument, {
        projectId,
        ...testCase.args,
      });
      const stored = await t.run(async (ctx) => await ctx.db.get(documentId));
      expect(stored?.processingStatus, testCase.args.fileName).toBe(testCase.status);
      expect(stored?.processingDetail, testCase.args.fileName).toBe(testCase.detail);
    }
  });

  test("an unsupported type is only skipped when it yielded no text", async () => {
    const { t, projectId, writer } = await setup();
    const skipped = await writer.mutation(api.documents.uploadDocument, {
      projectId,
      fileName: "bundle.zip",
      fileType: "other",
      content: "",
    });
    const readable = await writer.mutation(api.documents.uploadDocument, {
      projectId,
      fileName: "notes.rtf",
      fileType: "other",
      content: "the trial run failed",
    });
    const rows = await t.run(async (ctx) => ({
      skipped: await ctx.db.get(skipped),
      readable: await ctx.db.get(readable),
    }));
    expect(rows.skipped?.processingStatus).toBe("skipped_unsupported");
    expect(rows.readable?.processingStatus).toBe("ready");
  });

  test("the dedupe path backfills a missing status without churning an existing one", async () => {
    const { t, projectId, writer } = await setup();
    const legacyId = await t.run(async (ctx) =>
      await ctx.db.insert("projectDocuments", {
        projectId,
        fileName: "legacy.docx",
        fileType: "docx",
        content: "legacy content",
        source: "chat_upload",
        uploadedBy: "writer@banhall.com",
        createdAt: Date.now(),
      })
    );

    const first = await writer.mutation(api.documents.uploadDocument, {
      projectId,
      fileName: "legacy.docx",
      fileType: "docx",
      content: "legacy content",
    });
    expect(first).toBe(legacyId);
    expect(
      await t.run(async (ctx) => (await ctx.db.get(legacyId))?.processingStatus)
    ).toBe("ready");

    // A second dedupe hit must not rewrite the value already recorded.
    await t.run(async (ctx) => {
      await ctx.db.patch(legacyId, { processingStatus: "reference_only" });
    });
    await writer.mutation(api.documents.uploadDocument, {
      projectId,
      fileName: "legacy.docx",
      fileType: "docx",
      content: "legacy content",
    });
    expect(
      await t.run(async (ctx) => (await ctx.db.get(legacyId))?.processingStatus)
    ).toBe("reference_only");
  });

  test("records the uploader's internal role, and never backfills it on dedupe", async () => {
    const { t, projectId, writer } = await setup();

    // CAP-3: the analyzer's trust in a writer's-notes document comes from this
    // stored role, because `uploadedBy` is not a usable join key to `users`.
    const documentId = await writer.mutation(api.documents.uploadDocument, {
      projectId,
      fileName: "notes.md",
      fileType: "txt",
      content: "Writer direction.",
      category: "writer_notes",
    });
    expect(
      await t.run(async (ctx) => (await ctx.db.get(documentId))?.uploaderRole)
    ).toBe("writer");

    // A row that predates this field stays roleless: the dedupe branch resolves
    // to a *different* upload event, so its role is not a fact about that row.
    const legacyId = await t.run(async (ctx) =>
      await ctx.db.insert("projectDocuments", {
        projectId,
        fileName: "legacy-notes.md",
        fileType: "txt",
        content: "Legacy direction.",
        category: "writer_notes",
        source: "chat_upload",
        uploadedBy: "writer@banhall.com",
        createdAt: Date.now(),
      })
    );
    const deduped = await writer.mutation(api.documents.uploadDocument, {
      projectId,
      fileName: "legacy-notes.md",
      fileType: "txt",
      content: "Legacy direction.",
      category: "writer_notes",
    });
    expect(deduped).toBe(legacyId);
    // Assert the key's absence rather than its value: a dedupe branch that
    // wrote `uploaderRole: undefined` would be indistinguishable from one that
    // wrote nothing if we only compared values, and only true absence proves
    // the row was left alone.
    expect(
      await t.run(async (ctx) => {
        const row = await ctx.db.get(legacyId);
        return row !== null && "uploaderRole" in row;
      })
    ).toBe(false);

    // Complementary case: an already-attributed row must keep the role it was
    // stored with, even when a user holding a different role re-uploads it.
    // Without this, code that patched `uploaderRole` on the dedupe branch would
    // still pass the roleless case above.
    const attributedId = await t.run(async (ctx) =>
      await ctx.db.insert("projectDocuments", {
        projectId,
        fileName: "manager-notes.md",
        fileType: "txt",
        content: "Manager direction.",
        category: "writer_notes",
        source: "chat_upload",
        uploadedBy: "manager@banhall.com",
        uploaderRole: "manager",
        createdAt: Date.now(),
      })
    );
    const rededuped = await writer.mutation(api.documents.uploadDocument, {
      projectId,
      fileName: "manager-notes.md",
      fileType: "txt",
      content: "Manager direction.",
      category: "writer_notes",
    });
    expect(rededuped).toBe(attributedId);
    expect(
      await t.run(async (ctx) => (await ctx.db.get(attributedId))?.uploaderRole)
    ).toBe("manager");
  });

  test("two unreadable files with the same name stay separate rows", async () => {
    const { t, projectId, writer } = await setup();
    // Both store "", so a (fileName, content) dedupe would merge them. They are
    // different uploads from different parts of the wizard and must each keep
    // their own row, their own original bytes, and their own attempt.
    const first = await writer.mutation(api.documents.uploadDocument, {
      projectId,
      fileName: "scan.pdf",
      fileType: "pdf",
      content: "",
      category: "previous_pd",
    });
    const second = await writer.mutation(api.documents.uploadDocument, {
      projectId,
      fileName: "scan.pdf",
      fileType: "pdf",
      content: "",
      category: "background",
    });

    expect(second).not.toBe(first);
    const rows = await t.run(async (ctx) =>
      await ctx.db
        .query("projectDocuments")
        .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
        .collect()
    );
    expect(rows).toHaveLength(2);
    // The second file's category must survive rather than being discarded by a
    // merge into the first.
    expect(rows.map((r) => r.category).sort()).toEqual(["background", "previous_pd"]);
    for (const row of rows) {
      expect(row.processingStatus).toBe("could_not_read");
    }
  });

  test("each unreadable upload resolves only its own attempt", async () => {
    const { t, projectId, writer } = await setup();
    const keyA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const keyB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await writer.mutation(api.uploadAttempts.recordUploadAttempts, {
      projectId,
      attempts: [
        { attemptKey: keyA, fileName: "scan.pdf", origin: "context_input" },
        { attemptKey: keyB, fileName: "scan.pdf", origin: "context_input" },
      ],
    });
    const docA = await writer.mutation(api.documents.uploadDocument, {
      projectId,
      fileName: "scan.pdf",
      fileType: "pdf",
      content: "",
      attemptKey: keyA,
    });
    const docB = await writer.mutation(api.documents.uploadDocument, {
      projectId,
      fileName: "scan.pdf",
      fileType: "pdf",
      content: "",
      attemptKey: keyB,
    });

    const attempts = await t.run(async (ctx) =>
      await ctx.db.query("documentUploadAttempts").collect()
    );
    const byKey = new Map(attempts.map((a) => [a.attemptKey, a]));
    expect(byKey.get(keyA)?.documentId).toBe(docA);
    expect(byKey.get(keyB)?.documentId).toBe(docB);
    expect(docA).not.toBe(docB);
  });

  test("non-empty content still dedupes", async () => {
    const { projectId, writer } = await setup();
    const first = await writer.mutation(api.documents.uploadDocument, {
      projectId,
      fileName: "interview.docx",
      fileType: "docx",
      content: "we tried X",
    });
    const second = await writer.mutation(api.documents.uploadDocument, {
      projectId,
      fileName: "interview.docx",
      fileType: "docx",
      content: "we tried X",
    });
    expect(second).toBe(first);
  });

  test("whitespace-only content is treated as empty for dedupe", async () => {
    const { t, projectId, writer } = await setup();
    for (let i = 0; i < 2; i++) {
      await writer.mutation(api.documents.uploadDocument, {
        projectId,
        fileName: "blank.txt",
        fileType: "txt",
        content: "   \n ",
      });
    }
    const rows = await t.run(async (ctx) =>
      await ctx.db
        .query("projectDocuments")
        .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
        .collect()
    );
    expect(rows).toHaveLength(2);
  });

  test("an attempt key that is not a UUID is refused", async () => {
    const { t, projectId, writer } = await setup();
    await expect(
      writer.mutation(api.documents.uploadDocument, {
        projectId,
        fileName: "notes.docx",
        fileType: "docx",
        content: "text",
        attemptKey: "TypeError: failed to fetch",
      })
    ).rejects.toThrow();
    // The rejection must take the document with it: a stored row whose attempt
    // could never be resolved would sit on the receipt forever.
    const rows = await t.run(async (ctx) =>
      await ctx.db
        .query("projectDocuments")
        .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
        .collect()
    );
    expect(rows).toHaveLength(0);
  });

  test("wizard boilerplate never makes an unreadable file look ready", async () => {
    const { t, projectId, writer } = await setup();
    // Regression for the receipt lie: the wizard prefixes previous-year files
    // with `[Previous-year report — fiscal X]` + an optional note. If that
    // prefix were sent for a file with no extracted text, the server would see
    // real text and derive `ready`. The wizard now sends "" instead.
    const unreadable = await writer.mutation(api.documents.uploadDocument, {
      projectId,
      fileName: "scanned-2023.pdf",
      fileType: "pdf",
      content: "",
      category: "previous_pd",
      extractionOutcome: "ok",
    });
    // A readable file in the same flow keeps its prefix untouched.
    const readable = await writer.mutation(api.documents.uploadDocument, {
      projectId,
      fileName: "report-2023.pdf",
      fileType: "pdf",
      content:
        "[Previous-year report — fiscal 2023]\nNote: check section 3\n\nthe extracted body",
      category: "previous_pd",
    });

    const rows = await t.run(async (ctx) => ({
      unreadable: await ctx.db.get(unreadable),
      readable: await ctx.db.get(readable),
    }));
    expect(rows.unreadable?.processingStatus).toBe("could_not_read");
    expect(rows.readable?.processingStatus).toBe("ready");
    expect(rows.readable?.content).toContain("Note: check section 3");
  });

  test("an identical-content replacement returns the old id and resolves its fresh attempt", async () => {
    const { t, projectId, writer } = await setup();
    const original = await writer.mutation(api.documents.uploadDocument, {
      projectId,
      fileName: "interview.docx",
      fileType: "docx",
      content: "we tried X",
    });
    const key = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    await writer.mutation(api.uploadAttempts.recordUploadAttempts, {
      projectId,
      attempts: [
        { attemptKey: key, fileName: "interview.docx", origin: "chat_upload" },
      ],
    });
    const replacement = await writer.mutation(api.documents.uploadDocument, {
      projectId,
      fileName: "interview.docx",
      fileType: "docx",
      content: "we tried X",
      attemptKey: key,
    });

    expect(replacement).toBe(original);
    const state = await t.run(async (ctx) => ({
      documents: await ctx.db.query("projectDocuments").collect(),
      attempt: await ctx.db.query("documentUploadAttempts").unique(),
    }));
    expect(state.documents).toHaveLength(1);
    expect(state.attempt).toMatchObject({
      status: "succeeded",
      documentId: original,
    });
  });

  test("replacing an empty document creates a new row that can safely supersede it", async () => {
    const { t, projectId, writer } = await setup();
    const original = await writer.mutation(api.documents.uploadDocument, {
      projectId,
      fileName: "scan.pdf",
      fileType: "pdf",
      content: "",
    });
    const replacement = await writer.mutation(api.documents.uploadDocument, {
      projectId,
      fileName: "readable.pdf",
      fileType: "pdf",
      content: "real text",
    });
    expect(replacement).not.toBe(original);

    await writer.mutation(api.documents.deleteDocument, { documentId: original });
    const state = await t.run(async (ctx) => ({
      original: await ctx.db.get(original),
      replacement: await ctx.db.get(replacement),
    }));
    expect(state.original).toBeNull();
    expect(state.replacement?.content).toBe("real text");
  });

  test("an old client that sends no derivation facts still gets a truthful status", async () => {
    const { t, projectId, writer } = await setup();
    const documentId = await writer.mutation(api.documents.uploadDocument, {
      projectId,
      fileName: "empty.txt",
      fileType: "txt",
      content: "   \n ",
    });
    const stored = await t.run(async (ctx) => await ctx.db.get(documentId));
    expect(stored?.processingStatus).toBe("could_not_read");
    expect(stored?.processingDetail).toBe("no_text_extracted");
  });
});

describe("listDocuments", () => {
  test("derives a fallback status for rows stored before the field existed", async () => {
    const { t, projectId, writer } = await setup();
    await t.run(async (ctx) => {
      const base = {
        projectId,
        source: "chat_upload",
        uploadedBy: "writer@banhall.com",
        createdAt: Date.now(),
      };
      // An image with no text is reference-only by design — the rollout rule in
      // the ticket ("no text ⇒ could not read") would have mislabelled it.
      await ctx.db.insert("projectDocuments", {
        ...base,
        fileName: "legacy-drawing.png",
        fileType: "image",
        content: "",
      });
      await ctx.db.insert("projectDocuments", {
        ...base,
        fileName: "legacy-notes.docx",
        fileType: "docx",
        content: "old notes",
      });
      // Pasted rows have no extension; treating them as files would wrongly
      // call them unsupported.
      await ctx.db.insert("projectDocuments", {
        ...base,
        fileName: "Previous-year note (FY 2023)",
        fileType: "txt",
        content: "pasted body",
      });
    });

    const listed = await writer.query(api.documents.listDocuments, { projectId });
    const byName = new Map(listed.map((d) => [d.fileName, d]));
    expect(byName.get("legacy-drawing.png")?.processingStatus).toBe("reference_only");
    expect(byName.get("legacy-notes.docx")?.processingStatus).toBe("ready");
    expect(byName.get("Previous-year note (FY 2023)")?.processingStatus).toBe("ready");
    expect(byName.get("Previous-year note (FY 2023)")?.processingDetail).toBe(
      "pasted_text"
    );
  });

  test("every listed detail is a machine code, never prose", async () => {
    const { projectId, writer } = await setup();
    await writer.mutation(api.documents.uploadDocument, {
      projectId,
      fileName: "corrupt.pdf",
      fileType: "pdf",
      content: "",
      extractionOutcome: "failed",
    });
    const listed = await writer.query(api.documents.listDocuments, { projectId });
    for (const doc of listed) {
      expect(doc.processingDetail).toMatch(/^[a-z_]+$/);
      expect(doc.processingStatus).toMatch(/^[a-z_]+$/);
    }
  });

  test("an unauthenticated caller gets nothing, an internal one sees the project", async () => {
    const { t, projectId, writer } = await setup();
    await writer.mutation(api.documents.uploadDocument, {
      projectId,
      fileName: "notes.docx",
      fileType: "docx",
      content: "text",
    });
    // Internal visibility is firm-wide (domain contract D1): another writer
    // reads the same rows. Only an unauthenticated caller — which includes
    // client-review token holders, who never authenticate — gets nothing.
    const otherWriter = t.withIdentity({ subject: outsiderAuthId });
    expect(
      (await otherWriter.query(api.documents.listDocuments, { projectId })).length
    ).toBe(1);
    expect(await t.query(api.documents.listDocuments, { projectId })).toEqual([]);
  });
});
