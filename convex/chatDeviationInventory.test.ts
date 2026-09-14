/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { MAX_PROJECT_DOCUMENT_SCAN } from "./chatV2";

const modules = import.meta.glob("./**/*.ts");

// Story 5 (CAP-12/CAP-15): getDeviationInventoryContext is everything the two
// read-only chat tools see. It takes no project, report or generation argument,
// so these cases pin what the thread alone can reach — and, for the Reference
// PD, what it must refuse to reach.

const heading = (text: string) => ({
  type: "heading",
  attrs: { level: 2 },
  content: [{ type: "text", text }],
});

const para = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

const SECTIONS = (paragraphs: string[]) =>
  JSON.stringify({
    type: "doc",
    content: [
      heading("Line 242 — Scientific/Technological Uncertainty"),
      ...paragraphs.map(para),
    ],
  });

/**
 * A Reference PD as one actually arrives: all three Locked sections present. A
 * `previous_pd` that parses to fewer is refused as uncomparable (its own cases
 * below), so a fixture with only Line 242 would never reach the comparison.
 */
const ALL_SECTIONS = (paragraphs: string[]) =>
  JSON.stringify({
    type: "doc",
    content: [
      heading("Line 242 — Scientific/Technological Uncertainty"),
      ...paragraphs.map(para),
      heading("Line 244 — Work Performed"),
      para("Reference work performed."),
      heading("Line 246 — Scientific/Technological Advancement"),
      para("Reference advancement."),
    ],
  });

async function seedThread(
  t: ReturnType<typeof convexTest>,
  opts: { paragraphs: string[]; withGeneration?: boolean }
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      authId: `inventory-user-${now}-${Math.random()}`,
      role: "writer",
    });
    const projectId = await ctx.db.insert("projects", {
      title: "Inventory project",
      clientName: "Client",
      status: "review",
      createdBy: userId,
      shareToken: `inventory-token-${now}-${Math.random()}`,
      createdAt: now,
      updatedAt: now,
    });
    const transcriptId = await ctx.db.insert("transcripts", {
      projectId,
      content: "Interview content",
      createdAt: now,
    });
    let generationId: Id<"generations"> | undefined;
    if (opts.withGeneration !== false) {
      generationId = await ctx.db.insert("generations", {
        projectId,
        transcriptId,
        status: "completed",
        candidateMode: "single",
        startedAt: now,
      });
    }
    const reportId = await ctx.db.insert("reports", {
      projectId,
      ...(generationId ? { generationId } : {}),
      content: SECTIONS(opts.paragraphs),
      version: 1,
      generatedAt: now,
      updatedAt: now,
    });
    const agentThreadId = `thread-${now}-${Math.random()}`;
    await ctx.db.insert("agentChatThreads", {
      projectId,
      reportId,
      agentThreadId,
      title: "Chat",
      createdAt: now,
    });
    return { projectId, reportId, generationId, agentThreadId, userId };
  });
}

async function insertNote(
  t: ReturnType<typeof convexTest>,
  args: {
    projectId: Id<"projects">;
    generationId: Id<"generations">;
    paragraphIndex?: number;
    outcome: "applied" | "not_applied";
  }
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("complianceNotes", {
      projectId: args.projectId,
      generationId: args.generationId,
      section: "242",
      ...(args.paragraphIndex !== undefined
        ? { paragraphIndex: args.paragraphIndex }
        : {}),
      source: "deterministic",
      instruction: "Call the pressure range the pressure operating envelope.",
      outcome: args.outcome,
      tier: args.outcome === "applied" ? "none" : "conflict",
      reason: 'the paragraph still says "pressure range"',
      repaired: false,
    });
  });
}

async function insertDocument(
  t: ReturnType<typeof convexTest>,
  args: {
    projectId: Id<"projects">;
    fileName: string;
    paragraphs: string[];
    category?: "previous_pd" | "background";
    archived?: boolean;
  }
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("projectDocuments", {
      projectId: args.projectId,
      fileName: args.fileName,
      fileType: "docx",
      content: ALL_SECTIONS(args.paragraphs),
      category: args.category ?? "previous_pd",
      ...(args.archived ? { archived: true } : {}),
      source: "upload",
      uploadedBy: "Writer",
      createdAt: Date.now(),
    });
  });
}

describe("getDeviationInventoryContext report and rules", () => {
  test("returns the report's sections and only its own generation's notes", async () => {
    const t = convexTest(schema, modules);
    const { projectId, generationId, agentThreadId } = await seedThread(t, {
      paragraphs: ["First paragraph.", "Second paragraph."],
    });
    await insertNote(t, {
      projectId,
      generationId: generationId!,
      paragraphIndex: 0,
      outcome: "not_applied",
    });
    // A second generation on the same project must not contribute notes.
    await t.run(async (ctx) => {
      const other = await ctx.db.insert("generations", {
        projectId,
        transcriptId: (await ctx.db.query("transcripts").first())!._id,
        status: "completed",
        candidateMode: "single",
        startedAt: Date.now() + 1000,
      });
      await ctx.db.insert("complianceNotes", {
        projectId,
        generationId: other,
        section: "244",
        source: "model",
        instruction: "A note from a different generation.",
        outcome: "not_applied",
        tier: "conflict",
        reason: "other generation",
        repaired: false,
      });
    });

    const context = await t.query(internal.chatV2.getDeviationInventoryContext, {
      agentThreadId,
    });
    expect(context.found).toBe(true);
    expect(context.sections.s242).toContain("First paragraph.");
    expect(context.rulesAvailable).toBe(true);
    expect(context.notes).toHaveLength(1);
    expect(context.notes[0]?.instruction).toContain("pressure operating envelope");
  });

  test("reports rules unavailable for a report with no generation", async () => {
    const t = convexTest(schema, modules);
    const { agentThreadId } = await seedThread(t, {
      paragraphs: ["Legacy paragraph."],
      withGeneration: false,
    });
    const context = await t.query(internal.chatV2.getDeviationInventoryContext, {
      agentThreadId,
    });
    expect(context.found).toBe(true);
    expect(context.notes).toEqual([]);
    expect(context.rulesAvailable).toBe(false);
    expect(context.rulesStatus).toBe("no_generation");
  });

  test("never falls back to another generation's notes for an unlinked report", async () => {
    // `complianceNotes.paragraphIndex` indexes the paragraphs of the draft its
    // generation produced. Anchoring the project's newest generation's rows onto
    // an unlinked report would present ANOTHER draft's rule Deviations as this
    // one's, paragraph numbers and all.
    const t = convexTest(schema, modules);
    const { projectId, agentThreadId } = await seedThread(t, {
      paragraphs: ["Copied paragraph one.", "Copied paragraph two."],
      withGeneration: false,
    });
    await t.run(async (ctx) => {
      const generationId = await ctx.db.insert("generations", {
        projectId,
        transcriptId: (await ctx.db.query("transcripts").first())!._id,
        status: "completed",
        candidateMode: "single",
        startedAt: Date.now(),
      });
      await ctx.db.insert("complianceNotes", {
        projectId,
        generationId,
        section: "242",
        paragraphIndex: 0,
        source: "deterministic",
        instruction: "A DIFFERENT DRAFT's paragraph 1 rule.",
        outcome: "not_applied",
        tier: "conflict",
        reason: "belongs to another draft",
        repaired: false,
      });
    });
    const context = await t.query(internal.chatV2.getDeviationInventoryContext, {
      agentThreadId,
    });
    expect(context.notes).toEqual([]);
    expect(context.rulesStatus).toBe("no_generation");
    expect(context.rulesAvailable).toBe(false);
  });

  test("distinguishes a linked generation that stored no note", async () => {
    const t = convexTest(schema, modules);
    const { agentThreadId } = await seedThread(t, { paragraphs: ["Paragraph."] });
    const context = await t.query(internal.chatV2.getDeviationInventoryContext, {
      agentThreadId,
    });
    expect(context.notes).toEqual([]);
    expect(context.rulesStatus).toBe("no_notes");
    expect(context.rulesAvailable).toBe(false);
  });

  test("returns nothing for an unknown thread", async () => {
    const t = convexTest(schema, modules);
    await seedThread(t, { paragraphs: ["Paragraph."] });
    const context = await t.query(internal.chatV2.getDeviationInventoryContext, {
      agentThreadId: "no-such-thread",
    });
    expect(context.found).toBe(false);
    expect(context.notes).toEqual([]);
    expect(context.referenceFileNames).toEqual([]);
    expect(context.reference).toBeNull();
  });

  test("scopes rule Deviations to the selected candidate on a compare-mode generation", async () => {
    // "compare" is the schema's own default candidateMode: a report generated
    // through the normal multi-candidate workflow, not a rare edge case. Every
    // other case above seeds `candidateMode: "single"`, so this is the one path
    // that exercises `selectedCandidateRunId`'s actual DB lookups.
    const t = convexTest(schema, modules);
    const { projectId, reportId, agentThreadId } = await seedThread(t, {
      paragraphs: ["First paragraph.", "Second paragraph."],
      withGeneration: false,
    });
    await t.run(async (ctx) => {
      const transcriptId = (await ctx.db.query("transcripts").first())!._id;
      const generationId = await ctx.db.insert("generations", {
        projectId,
        transcriptId,
        status: "completed",
        candidateMode: "compare",
        startedAt: Date.now(),
      });
      await ctx.db.patch(reportId, { generationId });
      const candidateAId = await ctx.db.insert("reportCandidates", {
        projectId,
        generationId,
        model: "model-a",
        label: "A",
        content: "content a",
        agentOutputs: "{}",
        createdAt: Date.now(),
      });
      const candidateBId = await ctx.db.insert("reportCandidates", {
        projectId,
        generationId,
        model: "model-b",
        label: "B",
        content: "content b",
        agentOutputs: "{}",
        createdAt: Date.now(),
      });
      const runA = await ctx.db.insert("generationCandidateRuns", {
        generationId,
        projectId,
        model: "model-a",
        label: "A",
        status: "succeeded",
        candidateId: candidateAId,
        queuedAt: Date.now(),
      });
      const runB = await ctx.db.insert("generationCandidateRuns", {
        generationId,
        projectId,
        model: "model-b",
        label: "B",
        status: "succeeded",
        candidateId: candidateBId,
        queuedAt: Date.now(),
      });
      await ctx.db.insert("modelSelections", {
        projectId,
        generationId,
        userId: "writer-1",
        candidateId: candidateAId,
        model: "model-a",
        label: "A",
        createdAt: Date.now(),
      });
      await ctx.db.insert("complianceNotes", {
        projectId,
        generationId,
        candidateRunId: runA,
        section: "242",
        paragraphIndex: 0,
        source: "deterministic",
        instruction: "Selected candidate's rule.",
        outcome: "not_applied",
        tier: "conflict",
        reason: "selected run note",
        repaired: false,
      });
      await ctx.db.insert("complianceNotes", {
        projectId,
        generationId,
        candidateRunId: runB,
        section: "242",
        paragraphIndex: 0,
        source: "deterministic",
        instruction: "Unselected candidate's rule.",
        outcome: "not_applied",
        tier: "conflict",
        reason: "other run note",
        repaired: false,
      });
    });

    const context = await t.query(internal.chatV2.getDeviationInventoryContext, {
      agentThreadId,
    });
    expect(context.rulesAvailable).toBe(true);
    expect(context.notes).toHaveLength(1);
    expect(context.notes[0]?.instruction).toBe("Selected candidate's rule.");
  });
});

describe("getDeviationInventoryContext Reference PD", () => {
  test("resolves the only previous_pd document without being named", async () => {
    const t = convexTest(schema, modules);
    const { projectId, agentThreadId } = await seedThread(t, {
      paragraphs: ["Draft paragraph."],
    });
    await insertDocument(t, {
      projectId,
      fileName: "last-year-pd.docx",
      paragraphs: ["Reference paragraph."],
    });
    const context = await t.query(internal.chatV2.getDeviationInventoryContext, {
      agentThreadId,
    });
    expect(context.referenceFileNames).toEqual(["last-year-pd.docx"]);
    expect(context.reference?.fileName).toBe("last-year-pd.docx");
    expect(context.reference?.sections.s242).toContain("Reference paragraph.");
  });

  test("finds a previous_pd attached after more than 200 other documents (DW-138)", async () => {
    // The read used to take 200 rows and THEN keep the previous_pd ones, so a
    // Reference PD uploaded after 200 chat attachments was reported absent.
    const t = convexTest(schema, modules);
    const { projectId, agentThreadId } = await seedThread(t, {
      paragraphs: ["Draft paragraph."],
    });
    await t.run(async (ctx) => {
      for (let i = 0; i < 201; i += 1) {
        await ctx.db.insert("projectDocuments", {
          projectId,
          fileName: `attachment-${i + 1}.txt`,
          fileType: "txt",
          content: `Attachment ${i + 1}.`,
          category: "background",
          source: "upload",
          uploadedBy: "Writer",
          createdAt: Date.now(),
        });
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await insertDocument(t, {
      projectId,
      fileName: "last-year-pd.docx",
      paragraphs: ["Reference paragraph."],
    });
    const context = await t.query(internal.chatV2.getDeviationInventoryContext, {
      agentThreadId,
    });
    expect(context.referenceFileNames).toEqual(["last-year-pd.docx"]);
    expect(context.referenceStatus).toBe("resolved");
    expect(context.reference?.fileName).toBe("last-year-pd.docx");
    expect(context.documentScanTruncated).toBe(false);
  });

  test("says so when the document scan hit its bound instead of reporting absence (DW-138)", async () => {
    const t = convexTest(schema, modules);
    const { projectId, agentThreadId } = await seedThread(t, {
      paragraphs: ["Draft paragraph."],
    });
    await t.run(async (ctx) => {
      for (let i = 0; i < MAX_PROJECT_DOCUMENT_SCAN; i += 1) {
        await ctx.db.insert("projectDocuments", {
          projectId,
          fileName: `attachment-${i + 1}.txt`,
          fileType: "txt",
          content: `Attachment ${i + 1}.`,
          category: "background",
          source: "upload",
          uploadedBy: "Writer",
          createdAt: Date.now(),
        });
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await insertDocument(t, {
      projectId,
      fileName: "beyond-the-bound.docx",
      paragraphs: ["Reference paragraph."],
    });
    const context = await t.query(internal.chatV2.getDeviationInventoryContext, {
      agentThreadId,
    });
    // Bounded reads stay bounded; the bound is REPORTED, never mistaken for
    // "no Reference PD attached".
    expect(context.documentScanTruncated).toBe(true);
    expect(context.referenceStatus).toBe("none");
  });

  test("names every available file when the requested one is unknown", async () => {
    const t = convexTest(schema, modules);
    const { projectId, agentThreadId } = await seedThread(t, {
      paragraphs: ["Draft paragraph."],
    });
    await insertDocument(t, { projectId, fileName: "pd-2024.docx", paragraphs: ["A."] });
    await insertDocument(t, { projectId, fileName: "pd-2025.docx", paragraphs: ["B."] });
    const context = await t.query(internal.chatV2.getDeviationInventoryContext, {
      agentThreadId,
      referenceFileName: "pd-2099.docx",
    });
    expect(context.reference).toBeNull();
    expect(context.referenceFileNames.sort()).toEqual([
      "pd-2024.docx",
      "pd-2025.docx",
    ]);
  });

  test("an archived previous_pd is neither offered nor resolvable", async () => {
    const t = convexTest(schema, modules);
    const { projectId, agentThreadId } = await seedThread(t, {
      paragraphs: ["Draft paragraph."],
    });
    await insertDocument(t, {
      projectId,
      fileName: "archived-pd.docx",
      paragraphs: ["Old."],
      archived: true,
    });
    const context = await t.query(internal.chatV2.getDeviationInventoryContext, {
      agentThreadId,
      referenceFileName: "archived-pd.docx",
    });
    expect(context.referenceFileNames).toEqual([]);
    expect(context.reference).toBeNull();
  });

  test("a previous_pd with no extracted text is never offered as a choice", async () => {
    const t = convexTest(schema, modules);
    const { projectId, agentThreadId } = await seedThread(t, {
      paragraphs: ["Draft paragraph."],
    });
    await t.run(async (ctx) => {
      const base = {
        projectId,
        fileType: "pdf" as const,
        category: "previous_pd" as const,
        source: "upload",
        uploadedBy: "Writer",
        createdAt: Date.now(),
      };
      await ctx.db.insert("projectDocuments", {
        ...base,
        fileName: "blank.pdf",
        content: "",
      });
      await ctx.db.insert("projectDocuments", {
        ...base,
        fileName: "image-only.pdf",
        content: "  ",
        processingStatus: "could_not_read",
      });
      await ctx.db.insert("projectDocuments", {
        ...base,
        fileName: "kept-for-reference.pdf",
        content: "a stub line",
        processingStatus: "reference_only",
      });
    });
    const context = await t.query(internal.chatV2.getDeviationInventoryContext, {
      agentThreadId,
    });
    // None is comparable, so none is offered, and none is silently compared.
    expect(context.referenceFileNames).toEqual([]);
    expect(context.unreadableReferenceFileNames.sort()).toEqual([
      "blank.pdf",
      "image-only.pdf",
      "kept-for-reference.pdf",
    ]);
    expect(context.reference).toBeNull();
    expect(context.referenceStatus).toBe("unreadable");

    // Naming one of them says "unreadable", not "unknown".
    expect(
      (
        await t.query(internal.chatV2.getDeviationInventoryContext, {
          agentThreadId,
          referenceFileName: "image-only.pdf",
        })
      ).referenceStatus
    ).toBe("unreadable");
  });

  test("a previous_pd whose text carries no Line 24x sections is not compared", async () => {
    const t = convexTest(schema, modules);
    const { projectId, agentThreadId } = await seedThread(t, {
      paragraphs: ["Draft paragraph."],
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("projectDocuments", {
        projectId,
        fileName: "plain-prose.docx",
        fileType: "docx" as const,
        // A real docx extract: prose, no recognizable section headings.
        content: JSON.stringify({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Last year we built a control loop." }],
            },
          ],
        }),
        category: "previous_pd",
        source: "upload",
        uploadedBy: "Writer",
        createdAt: Date.now(),
      });
    });
    const context = await t.query(internal.chatV2.getDeviationInventoryContext, {
      agentThreadId,
    });
    // It IS readable, so it is offered as a choice, but selecting it produces no
    // comparison rather than a difference per paragraph against empty sections.
    expect(context.referenceFileNames).toEqual(["plain-prose.docx"]);
    expect(context.reference).toBeNull();
    expect(context.referenceStatus).toBe("unparsed");
    expect(context.selectedReferenceFileName).toBe("plain-prose.docx");
  });

  test("more than one readable previous_pd resolves to none and reports ambiguity", async () => {
    const t = convexTest(schema, modules);
    const { projectId, agentThreadId } = await seedThread(t, {
      paragraphs: ["Draft paragraph."],
    });
    await insertDocument(t, { projectId, fileName: "pd-2024.docx", paragraphs: ["A."] });
    await insertDocument(t, { projectId, fileName: "pd-2025.docx", paragraphs: ["B."] });
    const context = await t.query(internal.chatV2.getDeviationInventoryContext, {
      agentThreadId,
    });
    expect(context.reference).toBeNull();
    expect(context.referenceStatus).toBe("ambiguous");
  });

  test("a project with no previous_pd offers none", async () => {
    const t = convexTest(schema, modules);
    const { projectId, agentThreadId } = await seedThread(t, {
      paragraphs: ["Draft paragraph."],
    });
    // A document of another category is not a Reference PD.
    await insertDocument(t, {
      projectId,
      fileName: "notes.docx",
      paragraphs: ["Notes."],
      category: "background",
    });
    const context = await t.query(internal.chatV2.getDeviationInventoryContext, {
      agentThreadId,
    });
    expect(context.referenceFileNames).toEqual([]);
    expect(context.reference).toBeNull();
  });

  test("another project's previous_pd is never reachable", async () => {
    const t = convexTest(schema, modules);
    const { agentThreadId } = await seedThread(t, { paragraphs: ["Draft."] });
    const otherProjectId = await t.run(async (ctx) => {
      const now = Date.now();
      const userId = await ctx.db.insert("users", {
        authId: "other-project-user",
        role: "writer",
      });
      return await ctx.db.insert("projects", {
        title: "Another client's project",
        clientName: "Other client",
        status: "review",
        createdBy: userId,
        shareToken: "other-project-token",
        createdAt: now,
        updatedAt: now,
      });
    });
    await insertDocument(t, {
      projectId: otherProjectId,
      fileName: "other-client-pd.docx",
      paragraphs: ["Confidential."],
    });
    const context = await t.query(internal.chatV2.getDeviationInventoryContext, {
      agentThreadId,
      referenceFileName: "other-client-pd.docx",
    });
    expect(context.referenceFileNames).toEqual([]);
    expect(context.reference).toBeNull();
  });
});

/**
 * Astra review of DW-138: a row bound alone does not keep the walk under
 * Convex's 16 MiB per-transaction read limit (400 attachments of 50 KiB blow
 * it before row 1000), and an incomplete walk must not auto-resolve "the only"
 * Reference PD or claim absence.
 */
describe("getDeviationInventoryContext read budget", () => {
  /** Below the 1 MiB document cap, well above the per-row headroom. */
  const bigBody = "attachment text ".repeat(56_000); // ~900 KB

  async function insertBigAttachments(
    t: ReturnType<typeof convexTest>,
    projectId: Id<"projects">,
    count: number
  ) {
    for (let i = 0; i < count; i += 1) {
      await t.run(async (ctx) => {
        await ctx.db.insert("projectDocuments", {
          projectId,
          fileName: `big-attachment-${i + 1}.txt`,
          fileType: "txt",
          content: bigBody,
          category: "background",
          source: "upload",
          uploadedBy: "Writer",
          createdAt: Date.now(),
        });
      });
    }
  }

  test("stops at its byte budget instead of exceeding the transaction read limit", async () => {
    const t = convexTest({ schema, modules, transactionLimits: true });
    const { projectId, agentThreadId } = await seedThread(t, {
      paragraphs: ["Draft paragraph."],
    });
    await insertBigAttachments(t, projectId, 20); // ~18 MiB in one index range
    await new Promise((resolve) => setTimeout(resolve, 5));
    await insertDocument(t, {
      projectId,
      fileName: "behind-the-budget.docx",
      paragraphs: ["Reference paragraph."],
    });
    // The unbudgeted walk reproduces the platform failure.
    await expect(
      t.query(async (ctx) => {
        let n = 0;
        for await (const row of ctx.db
          .query("projectDocuments")
          .withIndex("by_projectId", (q) => q.eq("projectId", projectId))) {
          n += row.content.length > 0 ? 1 : 0;
        }
        return n;
      })
    ).rejects.toThrow("Read too much data");
    const context = await t.query(internal.chatV2.getDeviationInventoryContext, {
      agentThreadId,
    });
    expect(context.documentScanTruncated).toBe(true);
    expect(context.referenceStatus).toBe("none");
  });

  test("does not auto-resolve the only PD seen when the walk was incomplete", async () => {
    const t = convexTest({ schema, modules, transactionLimits: true });
    const { projectId, agentThreadId } = await seedThread(t, {
      paragraphs: ["Draft paragraph."],
    });
    await insertDocument(t, {
      projectId,
      fileName: "seen-pd.docx",
      paragraphs: ["Reference paragraph."],
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await insertBigAttachments(t, projectId, 20);
    const unnamed = await t.query(internal.chatV2.getDeviationInventoryContext, {
      agentThreadId,
    });
    expect(unnamed.documentScanTruncated).toBe(true);
    expect(unnamed.referenceFileNames).toEqual(["seen-pd.docx"]);
    // Uniqueness cannot be established, so the writer must choose explicitly.
    expect(unnamed.referenceStatus).toBe("ambiguous");
    expect(unnamed.reference).toBeNull();

    const named = await t.query(internal.chatV2.getDeviationInventoryContext, {
      agentThreadId,
      referenceFileName: "seen-pd.docx",
    });
    expect(named.referenceStatus).toBe("resolved");
    expect(named.reference?.fileName).toBe("seen-pd.docx");
    expect(named.documentScanTruncated).toBe(true);
  });
});
