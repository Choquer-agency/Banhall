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


/**
 * Story 5 (CAP-14): the unresolved and unreliable Confidence Map facts of THIS
 * report's Brief reach the turn as evidence, because the converge question must
 * be answered without a tool call. `established` and `partial` are facts, not
 * open questions, and never appear.
 */
describe("getChatContextV2 open questions", () => {
  async function seedBrief(
    t: ReturnType<typeof convexTest>,
    entries: Array<{ text: string; confidence?: string; group?: string }>
  ) {
    const { projectId, transcriptId } = await seedProject(t);
    const generationId = await insertGeneration(t, {
      projectId,
      transcriptId,
      status: "completed",
      agentOutputs: JSON.stringify({ analyzer: "OWN-ANALYSIS" }),
    });
    return await t.run(async (ctx) => {
      const now = Date.now();
      const sourceId = await ctx.db.insert("generationSources", {
        generationId,
        projectId,
        kind: "transcript",
        label: "March interview",
        content: "Interview content",
        contentHash: "hash-1",
        truncated: false,
        originalLength: 17,
        capturedAt: now,
      });
      const briefId = await ctx.db.insert("generationBriefs", {
        projectId,
        generationId,
        inputsHash: "inputs-1",
        version: 1,
        origin: "derived",
        storylineText: "The controlling narrative.",
        createdAt: now,
      });
      for (const entry of entries) {
        await ctx.db.insert("generationBriefEntries", {
          briefId,
          projectId,
          group: (entry.group ?? "confidenceMap") as "confidenceMap",
          text: entry.text,
          ...(entry.confidence
            ? { confidence: entry.confidence as "unresolved" }
            : {}),
          sourceId,
          sourceContentHash: "hash-1",
          startOffset: 0,
          endOffset: 17,
          exactExcerpt: "Interview content",
          createdAt: now,
        });
      }
      await ctx.db.patch(generationId, { briefId });
      const reportId = await ctx.db.insert("reports", {
        projectId,
        generationId,
        content: JSON.stringify({ type: "doc", content: [] }),
        version: 1,
        generatedAt: now,
        updatedAt: now,
      });
      return { reportId, projectId, generationId };
    });
  }

  test("returns only unresolved and unreliable confidenceMap entries, with their source", async () => {
    const t = convexTest(schema, modules);
    const { reportId } = await seedBrief(t, [
      { text: "The cycle count was never measured.", confidence: "unresolved" },
      { text: "The vendor datasheet contradicts the log.", confidence: "unreliable" },
      { text: "The rig ran at 400 kPa.", confidence: "established" },
      { text: "Partial evidence for the seal change.", confidence: "partial" },
      // Another group on the same Brief must not leak in.
      { text: "Routine maintenance is excluded.", group: "claimExclusion" },
      // A confidenceMap entry with no stored confidence is not an open question.
      { text: "Unclassified fact.", group: "confidenceMap" },
    ]);
    const context = await t.query(internal.chatV2.getChatContextV2, {
      reportId,
      agentThreadId: "thread-open-questions",
    });
    expect(context.openQuestions).toEqual([
      {
        text: "The cycle count was never measured.",
        confidence: "unresolved",
        sourceLabel: "March interview",
      },
      {
        text: "The vendor datasheet contradicts the log.",
        confidence: "unreliable",
        sourceLabel: "March interview",
      },
    ]);
    // The type union already forbids it; this is the runtime guard that the
    // query filtered rather than relabelled.
    expect(
      context.openQuestions.map((q) => q.confidence).sort()
    ).toEqual(["unreliable", "unresolved"]);
  });

  test("returns at most 20 entries", async () => {
    const t = convexTest(schema, modules);
    const { reportId } = await seedBrief(
      t,
      Array.from({ length: 26 }, (_, i) => ({
        text: `Open fact ${i + 1}.`,
        confidence: i % 2 === 0 ? "unresolved" : "unreliable",
      }))
    );
    const context = await t.query(internal.chatV2.getChatContextV2, {
      reportId,
      agentThreadId: "thread-open-questions-many",
    });
    expect(context.openQuestions).toHaveLength(20);
    expect(context.openQuestions[0]?.text).toBe("Open fact 1.");
  });

  test("returns an empty list for a generation with no Brief", async () => {
    const t = convexTest(schema, modules);
    const { projectId, transcriptId } = await seedProject(t);
    const generationId = await insertGeneration(t, {
      projectId,
      transcriptId,
      status: "completed",
      agentOutputs: JSON.stringify({ analyzer: "OWN-ANALYSIS" }),
    });
    const reportId = await t.run(async (ctx) =>
      await ctx.db.insert("reports", {
        projectId,
        generationId,
        content: JSON.stringify({ type: "doc", content: [] }),
        version: 1,
        generatedAt: Date.now(),
        updatedAt: Date.now(),
      })
    );
    const context = await t.query(internal.chatV2.getChatContextV2, {
      reportId,
      agentThreadId: "thread-no-brief",
    });
    expect(context.openQuestions).toEqual([]);
  });

  test("returns an empty list for a report with no generationId", async () => {
    // A copied project's report has no `generationId` (`projects.ts` inserts it
    // that way). The analysis grounding may fall back to a project generation;
    // the open questions must NOT, or another draft's unresolved Confidence Map
    // entries would be presented as this report's.
    const t = convexTest(schema, modules);
    const { reportId: linkedReportId, projectId } = await seedBrief(t, [
      { text: "Another draft's open fact.", confidence: "unresolved" },
    ]);
    const unlinkedReportId = await t.run(async (ctx) => {
      const now = Date.now();
      return await ctx.db.insert("reports", {
        projectId,
        content: JSON.stringify({ type: "doc", content: [] }),
        version: 1,
        generatedAt: now,
        updatedAt: now,
      });
    });
    // Control: the linked report does see it.
    expect(
      (
        await t.query(internal.chatV2.getChatContextV2, {
          reportId: linkedReportId,
          agentThreadId: "thread-linked",
        })
      ).openQuestions
    ).toHaveLength(1);
    const context = await t.query(internal.chatV2.getChatContextV2, {
      reportId: unlinkedReportId,
      agentThreadId: "thread-unlinked",
    });
    // The analysis still falls back, so this is not "no generation was found".
    expect(context.agentOutputs).toContain("OWN-ANALYSIS");
    expect(context.openQuestions).toEqual([]);
  });

  test("reads the Brief of the report's own generation, never a newer one", async () => {
    const t = convexTest(schema, modules);
    const { reportId, projectId, generationId } = await seedBrief(t, [
      { text: "This report's own open fact.", confidence: "unresolved" },
    ]);
    // A newer generation on the same project with its own Brief.
    await t.run(async (ctx) => {
      const now = Date.now();
      const transcriptId = (
        await ctx.db
          .query("transcripts")
          .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
          .first()
      )?._id;
      if (!transcriptId) throw new Error("fixture transcript missing");
      const newerId = await ctx.db.insert("generations", {
        projectId,
        transcriptId,
        status: "completed",
        agentOutputs: JSON.stringify({ analyzer: "NEWER" }),
        startedAt: now,
      });
      const sourceId = await ctx.db.insert("generationSources", {
        generationId: newerId,
        projectId,
        kind: "transcript",
        label: "Newer interview",
        content: "x",
        contentHash: "hash-2",
        truncated: false,
        originalLength: 1,
        capturedAt: now,
      });
      const newerBriefId = await ctx.db.insert("generationBriefs", {
        projectId,
        generationId: newerId,
        inputsHash: "inputs-2",
        version: 1,
        origin: "derived",
        storylineText: "Another narrative.",
        createdAt: now,
      });
      await ctx.db.insert("generationBriefEntries", {
        briefId: newerBriefId,
        projectId,
        group: "confidenceMap",
        text: "A NEWER GENERATION open fact.",
        confidence: "unresolved",
        sourceId,
        sourceContentHash: "hash-2",
        startOffset: 0,
        endOffset: 1,
        exactExcerpt: "x",
        createdAt: now,
      });
      await ctx.db.patch(newerId, { briefId: newerBriefId });
      expect(newerId).not.toBe(generationId);
    });
    const context = await t.query(internal.chatV2.getChatContextV2, {
      reportId,
      agentThreadId: "thread-own-brief",
    });
    expect(context.openQuestions.map((q) => q.text)).toEqual([
      "This report's own open fact.",
    ]);
  });
});
