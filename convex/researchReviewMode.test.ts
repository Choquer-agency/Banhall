/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import workflowSchema from "../node_modules/@convex-dev/workflow/src/component/schema.js";
import workpoolSchema from "../node_modules/@convex-dev/workpool/src/component/schema.js";

const modules = import.meta.glob("./**/*.ts");
// Convex-test needs the workflow component and its nested workpool registered
// under the same names as convex.config.ts. Recheck these package source paths
// whenever @convex-dev/workflow or @convex-dev/workpool is upgraded.
const workflowModules = import.meta.glob(
  "../node_modules/@convex-dev/workflow/src/component/**/*.ts"
);
const workpoolModules = import.meta.glob(
  "../node_modules/@convex-dev/workpool/src/component/**/*.ts"
);
const authId = "research-review-user";

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
});

async function setupReviewResearch() {
  const t = convexTest(schema, modules);
  t.registerComponent("researchWorkflow", workflowSchema, workflowModules);
  t.registerComponent("researchWorkflow/workpool", workpoolSchema, workpoolModules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      authId,
      name: "Alex Writer",
      role: "writer",
    });
    const now = Date.now();
    const projectId = await ctx.db.insert("projects", {
      title: "Thermal control investigation",
      clientName: "Private Client Ltd.",
      status: "review",
      mode: "review",
      writer: "Alex Writer",
      createdBy: userId,
      shareToken: "review-research-token",
      createdAt: now,
      updatedAt: now,
    });
    const reportId = await ctx.db.insert("reports", {
      projectId,
      content: "The control loop exhibited unstable thermal oscillation under variable load.",
      version: 1,
      generatedAt: now,
      updatedAt: now,
      revisionNumber: 2,
    });
    const documentId = await ctx.db.insert("projectDocuments", {
      projectId,
      fileName: "uploaded-pd.docx",
      fileType: "docx",
      content:
        "Private Client Ltd. tested a thermal control loop and recorded unstable oscillation under variable load.",
      source: "review_pd",
      uploadedBy: authId,
      createdAt: now,
    });
    return { userId, projectId, reportId, documentId };
  });
  return { t, ...ids };
}

async function insertQueuedSession(
  setup: Awaited<ReturnType<typeof setupReviewResearch>>
) {
  return await setup.t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("researchSessions", {
      projectId: setup.projectId,
      reportId: setup.reportId,
      requestedBy: setup.userId,
      selectedText: "unstable thermal oscillation under variable load",
      selectionFrom: 18,
      selectionTo: 66,
      surroundingContext: "The control loop exhibited unstable thermal oscillation.",
      instruction: "Verify whether thermal instability is a recognized control-system risk.",
      externalBrief: "Redacted external brief",
      reportRevisionNumber: 2,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    });
  });
}

describe("review-mode contextual research", () => {
  it("starts and lists a report-scoped session after revisit", async () => {
    const setup = await setupReviewResearch();
    const sessionId = await setup.t.withIdentity({ subject: authId }).mutation(
      api.research.startResearch,
      {
        reportId: setup.reportId,
        selectedText: "unstable thermal oscillation under variable load",
        selectionFrom: 18,
        selectionTo: 66,
        surroundingContext: "The control loop exhibited unstable thermal oscillation.",
        instruction: "Verify whether thermal instability is a recognized control-system risk.",
      }
    );

    const sessions = await setup.t
      .withIdentity({ subject: authId })
      .query(api.research.listSessions, { reportId: setup.reportId });
    const session = await setup.t.run(async (ctx) => ctx.db.get(sessionId));

    expect(sessions).toEqual([
      expect.objectContaining({
        _id: sessionId,
        status: "queued",
        selectedText: "unstable thermal oscillation under variable load",
      }),
    ]);
    expect(session).toMatchObject({
      projectId: setup.projectId,
      reportId: setup.reportId,
      reportRevisionNumber: 2,
    });
    expect(session?.externalBrief).toContain("Selected report passage");
    expect(session?.externalBrief).not.toContain("Private Client Ltd.");
    expect(session?.externalBrief).not.toContain("recorded unstable oscillation");
  });

  it("rejects duplicate active research for the same writer and report", async () => {
    const setup = await setupReviewResearch();
    await insertQueuedSession(setup);

    await expect(
      setup.t.withIdentity({ subject: authId }).mutation(api.research.startResearch, {
        reportId: setup.reportId,
        selectedText: "unstable thermal oscillation",
        selectionFrom: 1,
        selectionTo: 29,
        surroundingContext: "thermal control",
        instruction: "Verify this risk",
      })
    ).rejects.toThrow(/already running/i);
  });

  it("collects the uploaded PD as private project evidence", async () => {
    const setup = await setupReviewResearch();
    const sessionId = await insertQueuedSession(setup);

    await setup.t.mutation(internal.research.collectProjectEvidence, { sessionId });

    const sources = await setup.t.run(async (ctx) =>
      ctx.db
        .query("researchSources")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
        .take(10)
    );
    expect(sources).toEqual([
      expect.objectContaining({
        kind: "project_document",
        projectDocumentId: setup.documentId,
        title: "uploaded-pd.docx",
        verification: "project_evidence",
      }),
    ]);
  });


  it("does not expose sessions without internal access", async () => {
    const setup = await setupReviewResearch();
    await insertQueuedSession(setup);

    await expect(
      setup.t.mutation(api.research.startResearch, {
        reportId: setup.reportId,
        selectedText: "unstable thermal oscillation",
        selectionFrom: 1,
        selectionTo: 29,
        surroundingContext: "thermal control",
        instruction: "Verify this risk",
      })
    ).rejects.toThrow(/NOT_AUTHENTICATED|Authentication required/i);
    expect(await setup.t.query(api.research.listSessions, { reportId: setup.reportId })).toEqual(
      []
    );
  });
});
