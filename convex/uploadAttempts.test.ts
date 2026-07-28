/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import {
  ATTEMPT_CAP,
  STALE_ATTEMPT_MS,
  attemptIdsToPrune,
} from "./lib/uploadAttempts";

const modules = import.meta.glob("./**/*.ts");
const writerAuthId = "auth-writer-attempt-tests";

const KEY_A = "11111111-1111-4111-8111-111111111111";
const KEY_B = "22222222-2222-4222-8222-222222222222";

async function setup() {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const projectId = await t.run(async (ctx) => {
    const writerId = await ctx.db.insert("users", {
      authId: writerAuthId,
      email: "writer@banhall.com",
      role: "writer",
    });
    return await ctx.db.insert("projects", {
      title: "Attempts project",
      clientName: "Client",
      status: "draft",
      createdBy: writerId,
      shareToken: "attempts-project-token",
      createdAt: now,
      updatedAt: now,
    });
  });
  return { t, projectId, writer: t.withIdentity({ subject: writerAuthId }) };
}

function attempt(overrides: Partial<{ attemptKey: string; fileName: string }> = {}) {
  return {
    attemptKey: KEY_A,
    fileName: "notes.docx",
    fileSizeBytes: 1234,
    origin: "chat_upload" as const,
    ...overrides,
  };
}

describe("attempt lifecycle", () => {
  test("record then fail leaves one durable failed row on the receipt", async () => {
    const { projectId, writer } = await setup();
    await writer.mutation(api.uploadAttempts.recordUploadAttempts, {
      projectId,
      attempts: [attempt()],
    });
    await writer.mutation(api.uploadAttempts.failUploadAttempt, {
      projectId,
      attemptKey: KEY_A,
      failureCode: "upload_failed",
    });

    const listed = await writer.query(api.uploadAttempts.listUploadAttempts, {
      projectId,
    });
    if (!listed) throw new Error("expected access to the attempts list");
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      attemptKey: KEY_A,
      fileName: "notes.docx",
      failureCode: "upload_failed",
      displayStatus: "failed",
    });
  });

  test("recording the same key twice upserts instead of duplicating", async () => {
    const { t, projectId, writer } = await setup();
    for (let i = 0; i < 3; i++) {
      await writer.mutation(api.uploadAttempts.recordUploadAttempts, {
        projectId,
        attempts: [attempt()],
      });
    }
    const rows = await t.run(async (ctx) =>
      await ctx.db.query("documentUploadAttempts").collect()
    );
    expect(rows).toHaveLength(1);
  });

  test("a client-side rejection records as failed in the same call", async () => {
    const { projectId, writer } = await setup();
    await writer.mutation(api.uploadAttempts.recordUploadAttempts, {
      projectId,
      attempts: [
        { ...attempt({ fileName: "archive.zip" }), failureCode: "rejected_unsupported" },
      ],
    });
    const listed = await writer.query(api.uploadAttempts.listUploadAttempts, {
      projectId,
    });
    if (!listed) throw new Error("expected access to the attempts list");
    expect(listed[0]).toMatchObject({
      failureCode: "rejected_unsupported",
      displayStatus: "failed",
    });
  });

  test("retry under the same key flips failed back to in progress", async () => {
    const { projectId, writer } = await setup();
    await writer.mutation(api.uploadAttempts.recordUploadAttempts, {
      projectId,
      attempts: [attempt()],
    });
    await writer.mutation(api.uploadAttempts.failUploadAttempt, {
      projectId,
      attemptKey: KEY_A,
      failureCode: "upload_failed",
    });
    await writer.mutation(api.uploadAttempts.recordUploadAttempts, {
      projectId,
      attempts: [attempt()],
    });
    const listed = await writer.query(api.uploadAttempts.listUploadAttempts, {
      projectId,
    });
    if (!listed) throw new Error("expected access to the attempts list");
    expect(listed).toHaveLength(1);
    expect(listed[0].displayStatus).toBe("in_progress");
  });

  test("uploadDocument resolves the attempt and it leaves the receipt", async () => {
    const { t, projectId, writer } = await setup();
    await writer.mutation(api.uploadAttempts.recordUploadAttempts, {
      projectId,
      attempts: [attempt()],
    });
    const documentId = await writer.mutation(api.documents.uploadDocument, {
      projectId,
      fileName: "notes.docx",
      fileType: "docx",
      content: "interview text",
      attemptKey: KEY_A,
    });

    expect(
      await writer.query(api.uploadAttempts.listUploadAttempts, { projectId })
    ).toEqual([]);
    const row = await t.run(async (ctx) =>
      await ctx.db.query("documentUploadAttempts").unique()
    );
    expect(row?.status).toBe("succeeded");
    expect(row?.documentId).toBe(documentId);
  });

  test("a dedupe hit resolves the attempt too, leaving no ghost row", async () => {
    const { t, projectId, writer } = await setup();
    const firstId = await writer.mutation(api.documents.uploadDocument, {
      projectId,
      fileName: "notes.docx",
      fileType: "docx",
      content: "interview text",
    });
    await writer.mutation(api.uploadAttempts.recordUploadAttempts, {
      projectId,
      attempts: [attempt()],
    });
    const secondId = await writer.mutation(api.documents.uploadDocument, {
      projectId,
      fileName: "notes.docx",
      fileType: "docx",
      content: "interview text",
      attemptKey: KEY_A,
    });

    expect(secondId).toBe(firstId);
    expect(
      await writer.query(api.uploadAttempts.listUploadAttempts, { projectId })
    ).toEqual([]);
    const row = await t.run(async (ctx) =>
      await ctx.db.query("documentUploadAttempts").unique()
    );
    expect(row?.status).toBe("succeeded");
    expect(row?.documentId).toBe(firstId);
  });

  test("succeeded is terminal against a late flush or a late failure report", async () => {
    const { t, projectId, writer } = await setup();
    await writer.mutation(api.uploadAttempts.recordUploadAttempts, {
      projectId,
      attempts: [attempt()],
    });
    await writer.mutation(api.documents.uploadDocument, {
      projectId,
      fileName: "notes.docx",
      fileType: "docx",
      content: "interview text",
      attemptKey: KEY_A,
    });

    await writer.mutation(api.uploadAttempts.recordUploadAttempts, {
      projectId,
      attempts: [{ ...attempt(), failureCode: "upload_failed" }],
    });
    await writer.mutation(api.uploadAttempts.failUploadAttempt, {
      projectId,
      attemptKey: KEY_A,
      failureCode: "upload_failed",
    });
    await writer.mutation(api.uploadAttempts.dismissUploadAttempt, {
      projectId,
      attemptKey: KEY_A,
    });

    const row = await t.run(async (ctx) =>
      await ctx.db.query("documentUploadAttempts").unique()
    );
    expect(row?.status).toBe("succeeded");
  });

  test("dismiss hides the row but keeps it as audit history", async () => {
    const { t, projectId, writer } = await setup();
    await writer.mutation(api.uploadAttempts.recordUploadAttempts, {
      projectId,
      attempts: [{ ...attempt(), failureCode: "upload_failed" }],
    });
    await writer.mutation(api.uploadAttempts.dismissUploadAttempt, {
      projectId,
      attemptKey: KEY_A,
    });

    expect(
      await writer.query(api.uploadAttempts.listUploadAttempts, { projectId })
    ).toEqual([]);
    const row = await t.run(async (ctx) =>
      await ctx.db.query("documentUploadAttempts").unique()
    );
    expect(row?.status).toBe("dismissed");
  });
});

describe("listUploadAttempts contract", () => {
  test("reports only the two statuses the receipt can render", async () => {
    const { projectId, writer } = await setup();
    await writer.mutation(api.uploadAttempts.recordUploadAttempts, {
      projectId,
      attempts: [attempt()],
    });
    const listed = await writer.query(api.uploadAttempts.listUploadAttempts, {
      projectId,
    });
    if (!listed) throw new Error("expected access to the attempts list");

    // Compile-level guard: if the filter above ever stops narrowing, the stored
    // four-value union leaks back into displayStatus and this stops compiling
    // here — in the Convex suite, which is what gates the Convex-first deploy.
    listed satisfies Array<{ displayStatus: "in_progress" | "failed" }>;
    expect(["in_progress", "failed"]).toContain(listed[0].displayStatus);
  });
});

describe("read-time staleness", () => {
  test("an abandoned in-progress attempt displays as failed without a stored rewrite", async () => {
    const { t, projectId, writer } = await setup();
    await writer.mutation(api.uploadAttempts.recordUploadAttempts, {
      projectId,
      attempts: [attempt(), attempt({ attemptKey: KEY_B, fileName: "fresh.docx" })],
    });
    const staleAt = Date.now() - STALE_ATTEMPT_MS - 1_000;
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("documentUploadAttempts").collect();
      const stale = rows.find((r) => r.attemptKey === KEY_A)!;
      await ctx.db.patch(stale._id, { updatedAt: staleAt });
    });

    const listed = await writer.query(api.uploadAttempts.listUploadAttempts, {
      projectId,
    });
    if (!listed) throw new Error("expected access to the attempts list");
    const byKey = new Map(listed.map((a) => [a.attemptKey, a]));
    expect(byKey.get(KEY_A)?.displayStatus).toBe("failed");
    expect(byKey.get(KEY_B)?.displayStatus).toBe("in_progress");

    const stored = await t.run(async (ctx) => {
      const rows = await ctx.db.query("documentUploadAttempts").collect();
      return rows.find((r) => r.attemptKey === KEY_A)?.status;
    });
    expect(stored).toBe("in_progress");
  });
});

describe("validation and authorization", () => {
  test("an attempt key that is not a UUID is rejected", async () => {
    const { projectId, writer } = await setup();
    await expect(
      writer.mutation(api.uploadAttempts.recordUploadAttempts, {
        projectId,
        attempts: [attempt({ attemptKey: "TypeError: failed to fetch" })],
      })
    ).rejects.toThrow();
    await expect(
      writer.mutation(api.documents.uploadDocument, {
        projectId,
        fileName: "notes.docx",
        fileType: "docx",
        content: "text",
        attemptKey: "not-a-uuid",
      })
    ).rejects.toThrow();
  });

  test("an oversized batch is rejected", async () => {
    const { projectId, writer } = await setup();
    const attempts = Array.from({ length: 51 }, (_, i) => ({
      attemptKey: `3333333${i.toString().padStart(1, "0")}-3333-4333-8333-333333333333`.slice(
        0,
        36
      ),
      fileName: `file-${i}.docx`,
      origin: "chat_upload" as const,
    }));
    await expect(
      writer.mutation(api.uploadAttempts.recordUploadAttempts, { projectId, attempts })
    ).rejects.toThrow("Too many files");
  });

  test("a long file name is capped and no other free text is stored", async () => {
    const { t, projectId, writer } = await setup();
    await writer.mutation(api.uploadAttempts.recordUploadAttempts, {
      projectId,
      attempts: [attempt({ fileName: "x".repeat(500) })],
    });
    const row = await t.run(async (ctx) =>
      await ctx.db.query("documentUploadAttempts").unique()
    );
    expect(row?.fileName.length).toBe(200);
  });

  test("an unauthenticated caller cannot read or write attempts", async () => {
    const { t, projectId, writer } = await setup();
    await writer.mutation(api.uploadAttempts.recordUploadAttempts, {
      projectId,
      attempts: [{ ...attempt(), failureCode: "upload_failed" }],
    });
    // Client-review token holders never authenticate, and no attempts function
    // accepts a share token, so they are excluded structurally. The denial is
    // null rather than an empty list so the UI can tell it apart from a project
    // that simply has no failures.
    expect(
      await t.query(api.uploadAttempts.listUploadAttempts, { projectId })
    ).toBeNull();
    await expect(
      t.mutation(api.uploadAttempts.failUploadAttempt, {
        projectId,
        attemptKey: KEY_A,
        failureCode: "upload_failed",
      })
    ).rejects.toThrow();
  });
});

describe("attemptIdsToPrune", () => {
  const row = (id: string, status: "in_progress" | "failed" | "succeeded" | "dismissed", createdAt: number) => ({
    _id: id,
    status,
    createdAt,
  });

  test("keeps everything while under the cap", () => {
    const attempts = Array.from({ length: ATTEMPT_CAP }, (_, i) =>
      row(`a${i}`, "failed", i)
    );
    expect(attemptIdsToPrune(attempts)).toEqual([]);
  });

  test("gives up resolved and dismissed rows before failures, oldest first", () => {
    const attempts = [
      row("old-failed", "failed", 1),
      row("old-succeeded", "succeeded", 2),
      row("newer-dismissed", "dismissed", 3),
      ...Array.from({ length: ATTEMPT_CAP - 1 }, (_, i) => row(`f${i}`, "failed", 100 + i)),
    ];
    expect(attemptIdsToPrune(attempts)).toEqual(["old-succeeded", "newer-dismissed"]);
  });

  test("prunes the oldest failures only once nothing expendable is left", () => {
    const attempts = [
      row("oldest", "failed", 1),
      row("second", "failed", 2),
      ...Array.from({ length: ATTEMPT_CAP, }, (_, i) => row(`f${i}`, "failed", 100 + i)),
    ];
    expect(attemptIdsToPrune(attempts)).toEqual(["oldest", "second"]);
  });
});
