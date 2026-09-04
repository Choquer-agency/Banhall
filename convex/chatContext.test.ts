/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { DEFAULT_CHAT_EVIDENCE_BUDGET } from "./ai/chatEvidence";

const modules = import.meta.glob("./**/*.ts");

// getChatContextV2 grounds the report chat on a generation's agentOutputs.
// The analysis must come from the generation that produced THE REPORT BEING
// EDITED — not whichever generation happens to be newest on the project.

async function seedProject(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      authId: "chat-context-user",
      role: "writer",
    });
    const now = Date.now();
    const projectId = await ctx.db.insert("projects", {
      title: "Grounding project",
      clientName: "Client",
      status: "review",
      createdBy: userId,
      shareToken: "chat-context-token",
      createdAt: now,
      updatedAt: now,
    });
    const transcriptId = await ctx.db.insert("transcripts", {
      projectId,
      content: "Interview content",
      createdAt: now,
    });
    return { projectId, transcriptId };
  });
}

async function insertGeneration(
  t: ReturnType<typeof convexTest>,
  args: {
    projectId: Id<"projects">;
    transcriptId: Id<"transcripts">;
    status: "completed" | "failed" | "running";
    agentOutputs?: string;
  }
) {
  return await t.run(async (ctx) =>
    await ctx.db.insert("generations", {
      projectId: args.projectId,
      transcriptId: args.transcriptId,
      status: args.status,
      agentOutputs: args.agentOutputs,
      startedAt: Date.now(),
    })
  );
}

describe("getChatContextV2 grounding", () => {
  test("prefers the generation the report was generated from over a newer one", async () => {
    const t = convexTest(schema, modules);
    const { projectId, transcriptId } = await seedProject(t);
    const ownGenerationId = await insertGeneration(t, {
      projectId,
      transcriptId,
      status: "completed",
      agentOutputs: JSON.stringify({ analyzer: "REPORTS-OWN-ANALYSIS" }),
    });
    const reportId = await t.run(async (ctx) =>
      await ctx.db.insert("reports", {
        projectId,
        generationId: ownGenerationId,
        content: JSON.stringify({ type: "doc", content: [] }),
        version: 1,
        generatedAt: Date.now(),
        updatedAt: Date.now(),
      })
    );
    // A newer generation on the same project (e.g. a regeneration for a newer
    // report) must not hijack the analysis context.
    await insertGeneration(t, {
      projectId,
      transcriptId,
      status: "completed",
      agentOutputs: JSON.stringify({ analyzer: "NEWER-UNRELATED-ANALYSIS" }),
    });

    const context = await t.query(internal.chatV2.getChatContextV2, {
      reportId,
      agentThreadId: "thread-grounding",
    });
    expect(context.agentOutputs).toContain("REPORTS-OWN-ANALYSIS");
    expect(context.agentOutputs).not.toContain("NEWER-UNRELATED-ANALYSIS");
  });

  test("falls back to the latest COMPLETED generation with agentOutputs for unlinked reports", async () => {
    const t = convexTest(schema, modules);
    const { projectId, transcriptId } = await seedProject(t);
    await insertGeneration(t, {
      projectId,
      transcriptId,
      status: "completed",
      agentOutputs: JSON.stringify({ analyzer: "USABLE-ANALYSIS" }),
    });
    // Newer rows that must be skipped: a completed run with no outputs and a
    // failed rerun (whose row is never a grounding source).
    await insertGeneration(t, {
      projectId,
      transcriptId,
      status: "completed",
    });
    await insertGeneration(t, {
      projectId,
      transcriptId,
      status: "failed",
      agentOutputs: JSON.stringify({ analyzer: "FAILED-ANALYSIS" }),
    });
    const reportId = await t.run(async (ctx) =>
      await ctx.db.insert("reports", {
        projectId,
        content: JSON.stringify({ type: "doc", content: [] }),
        version: 1,
        generatedAt: Date.now(),
        updatedAt: Date.now(),
      })
    );

    const context = await t.query(internal.chatV2.getChatContextV2, {
      reportId,
      agentThreadId: "thread-fallback",
    });
    expect(context.agentOutputs).toContain("USABLE-ANALYSIS");
    expect(context.agentOutputs).not.toContain("FAILED-ANALYSIS");
  });

  test("returns null agentOutputs when no completed generation has any", async () => {
    const t = convexTest(schema, modules);
    const { projectId, transcriptId } = await seedProject(t);
    await insertGeneration(t, {
      projectId,
      transcriptId,
      status: "failed",
      agentOutputs: JSON.stringify({ analyzer: "FAILED-ANALYSIS" }),
    });
    const reportId = await t.run(async (ctx) =>
      await ctx.db.insert("reports", {
        projectId,
        content: JSON.stringify({ type: "doc", content: [] }),
        version: 1,
        generatedAt: Date.now(),
        updatedAt: Date.now(),
      })
    );

    const context = await t.query(internal.chatV2.getChatContextV2, {
      reportId,
      agentThreadId: "thread-empty",
    });
    expect(context.agentOutputs).toBeNull();
  });
});

/**
 * Story 4 (CAP-4): the query is where provenance and the evidence budget come
 * from. The action must never invent either, so both are pinned here.
 */
describe("getChatContextV2 evidence inputs", () => {
  async function seedReportWithDocuments(t: ReturnType<typeof convexTest>) {
    const { projectId, transcriptId } = await seedProject(t);
    await insertGeneration(t, { projectId, transcriptId, status: "completed" });
    return await t.run(async (ctx) => {
      const now = Date.now();
      const base = {
        projectId,
        source: "upload",
        uploadedBy: "chat-context-uploader",
        createdAt: now,
      };
      await ctx.db.insert("projectDocuments", {
        ...base,
        fileName: "notes.md",
        fileType: "md",
        content: "Writer direction.",
        category: "writer_notes",
        uploaderRole: "writer",
      });
      // A row predating CAP-3 and BNH-9: neither category nor uploaderRole.
      await ctx.db.insert("projectDocuments", {
        ...base,
        fileName: "legacy.txt",
        fileType: "txt",
        content: "Legacy body.",
      });
      await ctx.db.insert("projectDocuments", {
        ...base,
        fileName: "archived.txt",
        fileType: "txt",
        content: "Archived body.",
        category: "other",
        archived: true,
      });
      return await ctx.db.insert("reports", {
        projectId,
        content: JSON.stringify({ type: "doc", content: [] }),
        version: 1,
        generatedAt: now,
        updatedAt: now,
      });
    });
  }

  test("carries category and uploaderRole, and excludes archived documents", async () => {
    const t = convexTest(schema, modules);
    const reportId = await seedReportWithDocuments(t);
    const context = await t.query(internal.chatV2.getChatContextV2, {
      reportId,
      agentThreadId: "thread-evidence",
    });
    expect(context.documents).toEqual([
      {
        fileName: "notes.md",
        content: "Writer direction.",
        category: "writer_notes",
        uploaderRole: "writer",
      },
      // A legacy row carries neither field; both absences fail closed later.
      { fileName: "legacy.txt", content: "Legacy body." },
    ]);
    expect(context.documents.map((d) => d.fileName)).not.toContain("archived.txt");
  });

  test("resolves the evidence budget, honouring settings and ignoring garbage", async () => {
    const t = convexTest(schema, modules);
    const reportId = await seedReportWithDocuments(t);
    expect(
      (
        await t.query(internal.chatV2.getChatContextV2, {
          reportId,
          agentThreadId: "thread-budget",
        })
      ).evidenceBudget
    ).toEqual(DEFAULT_CHAT_EVIDENCE_BUDGET);

    await t.run(async (ctx) => {
      const adminId = await ctx.db.insert("users", {
        authId: "chat-context-admin",
        role: "admin",
      });
      const now = Date.now();
      await ctx.db.insert("appSettings", {
        key: "ai.chatEvidenceBudgetTokens",
        value: "30000",
        updatedBy: adminId,
        updatedAt: now,
      });
      await ctx.db.insert("appSettings", {
        key: "ai.chatMaxEvidenceDocuments",
        value: "not a number",
        updatedBy: adminId,
        updatedAt: now,
      });
    });

    expect(
      (
        await t.query(internal.chatV2.getChatContextV2, {
          reportId,
          agentThreadId: "thread-budget",
        })
      ).evidenceBudget
    ).toEqual({
      ...DEFAULT_CHAT_EVIDENCE_BUDGET,
      totalTokens: 30_000,
      maxDocuments: DEFAULT_CHAT_EVIDENCE_BUDGET.maxDocuments,
    });
  });
});
