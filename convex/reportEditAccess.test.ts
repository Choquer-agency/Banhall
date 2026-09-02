/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// 2026-09-01 audit, findings S1 and S2: the capability matrix cells
// `report.editProse` (Consultant = own, Manager/Admin = all) and
// `financial.read`/`financial.write` (Consultant = none) are enforced at the
// final mutation boundary through convex/lib/roleCapabilities.ts. "Own" for
// prose means the project's durable Owner or a Consultant assigned an OPEN
// work item on the project; `createdBy` is never consulted.

const AUTH = {
  owner: "rea-owner",
  otherWriter: "rea-other-writer",
  assignedWriter: "rea-assigned-writer",
  manager: "rea-manager",
  admin: "rea-admin",
} as const;

type Actor = keyof typeof AUTH;

const REPORT_DOC = JSON.stringify({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "Original prose." }],
    },
  ],
});

const EDITED_DOC = JSON.stringify({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "Edited prose." }],
    },
  ],
});

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
});

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const ownerId = await ctx.db.insert("users", {
      authId: AUTH.owner,
      role: "writer",
      firstName: "Owen",
    });
    const otherWriterId = await ctx.db.insert("users", {
      authId: AUTH.otherWriter,
      role: "writer",
      firstName: "Wren",
    });
    const assignedWriterId = await ctx.db.insert("users", {
      authId: AUTH.assignedWriter,
      role: "writer",
      firstName: "Asa",
    });
    const managerId = await ctx.db.insert("users", {
      authId: AUTH.manager,
      role: "manager",
      firstName: "Mara",
    });
    const adminId = await ctx.db.insert("users", {
      authId: AUTH.admin,
      role: "admin",
      firstName: "Ada",
    });
    // The Consultant who created the project is NOT its Owner any more
    // (ownership was transferred to `owner`): createdBy must not grant edits.
    const projectId = await ctx.db.insert("projects", {
      title: "Edit-access project",
      clientName: "Acme",
      status: "review",
      createdBy: otherWriterId,
      ownerId,
      shareToken: "rea-token",
      createdAt: now,
      updatedAt: now,
    });
    const reportId = await ctx.db.insert("reports", {
      projectId,
      content: REPORT_DOC,
      version: 1,
      generatedAt: now,
      updatedAt: now,
      revisionNumber: 0,
    });
    const snapshotId = await ctx.db.insert("reportSnapshots", {
      projectId,
      reportId,
      content: EDITED_DOC,
      reason: "manual",
      createdByRole: "writer",
      createdAt: now,
    });
    await ctx.db.insert("workItems", {
      projectId,
      kind: "revision",
      assigneeId: assignedWriterId,
      assignerId: ownerId,
      instructions: "Tighten line 244.",
      blocking: false,
      status: "open",
      version: 1,
      createRequestId: "rea-req-1",
      createRequestFingerprint: "rea-fp-1",
      createdAt: now,
      updatedAt: now,
    });
    const uploadId = await ctx.db.insert("financialUploads", {
      projectId,
      fileName: "hours.csv",
      fileType: "timesheet",
      content: "alice,2026-01-05,4,prototype",
      createdAt: now,
      processingStatus: "completed",
    });
    const entryId = await ctx.db.insert("timesheetEntries", {
      projectId,
      uploadId,
      personName: "Alice",
      date: "2026-01-05",
      hours: 4,
      description: "prototype",
      sredEligible: true,
      confidence: "high",
      source: "hours.csv",
      reviewStatus: "pending",
    });
    return { projectId, reportId, snapshotId, uploadId, entryId };
  });
  const as = (actor: Actor) => t.withIdentity({ subject: AUTH[actor] });
  return { t, as, ...ids };
}

async function reportContent(
  t: Awaited<ReturnType<typeof setup>>["t"],
  reportId: Awaited<ReturnType<typeof setup>>["reportId"]
) {
  return await t.run(async (ctx) => (await ctx.db.get(reportId))!.content);
}

describe("report.editProse at the mutation boundary", () => {
  it("lets the project Owner save prose", async () => {
    const { as, reportId } = await setup();
    const revision = await as("owner").mutation(api.reports.updateReportContent, {
      reportId,
      content: EDITED_DOC,
      expectedRevisionNumber: 0,
    });
    expect(revision).toBe(1);
  });

  it("rejects a Consultant who merely created the project", async () => {
    const { t, as, reportId } = await setup();
    await expect(
      as("otherWriter").mutation(api.reports.updateReportContent, {
        reportId,
        content: EDITED_DOC,
        expectedRevisionNumber: 0,
      })
    ).rejects.toMatchObject({
      data: { code: "NOT_AUTHORIZED", capability: "report.editProse" },
    });
    expect(await reportContent(t, reportId)).toBe(REPORT_DOC);
  });

  it("lets a Consultant with an open work item on the project save prose", async () => {
    const { as, reportId } = await setup();
    const revision = await as("assignedWriter").mutation(
      api.reports.updateReportContent,
      { reportId, content: EDITED_DOC, expectedRevisionNumber: 0 }
    );
    expect(revision).toBe(1);
  });

  it("stops granting access once the assignment is no longer open", async () => {
    const { t, as, reportId, projectId } = await setup();
    await t.run(async (ctx) => {
      const item = await ctx.db
        .query("workItems")
        .withIndex("by_projectId_and_status", (q) =>
          q.eq("projectId", projectId).eq("status", "open")
        )
        .first();
      await ctx.db.patch(item!._id, { status: "completed" });
    });
    await expect(
      as("assignedWriter").mutation(api.reports.updateReportContent, {
        reportId,
        content: EDITED_DOC,
        expectedRevisionNumber: 0,
      })
    ).rejects.toMatchObject({ data: { code: "NOT_AUTHORIZED" } });
  });

  it("lets Managers and Admins save any report", async () => {
    for (const actor of ["manager", "admin"] as const) {
      const { as, reportId } = await setup();
      const revision = await as(actor).mutation(api.reports.updateReportContent, {
        reportId,
        content: EDITED_DOC,
        expectedRevisionNumber: 0,
      });
      expect(revision).toBe(1);
    }
  });

  it("applies the same gate to snapshot restore", async () => {
    const { t, as, reportId, snapshotId } = await setup();
    await expect(
      as("otherWriter").mutation(api.snapshots.restoreSnapshot, {
        snapshotId,
        targetReportId: reportId,
        expectedRevisionNumber: 0,
      })
    ).rejects.toMatchObject({ data: { code: "NOT_AUTHORIZED" } });
    expect(await reportContent(t, reportId)).toBe(REPORT_DOC);

    await as("owner").mutation(api.snapshots.restoreSnapshot, {
      snapshotId,
      targetReportId: reportId,
      expectedRevisionNumber: 0,
    });
    expect(await reportContent(t, reportId)).toBe(EDITED_DOC);
  });
});

describe("financial capabilities", () => {
  it("hides financial reads from Consultants, including the project Owner", async () => {
    const { as, projectId } = await setup();
    for (const actor of ["owner", "otherWriter", "assignedWriter"] as const) {
      expect(await as(actor).query(api.financial.listUploads, { projectId })).toEqual([]);
      expect(
        await as(actor).query(api.financial.getTimesheetEntries, { projectId })
      ).toEqual([]);
      expect(
        await as(actor).query(api.financial.getFinancialSummary, { projectId })
      ).toBeNull();
    }
  });

  it("serves financial reads to Managers and Admins", async () => {
    const { as, projectId } = await setup();
    for (const actor of ["manager", "admin"] as const) {
      expect(await as(actor).query(api.financial.listUploads, { projectId })).toHaveLength(1);
      expect(
        await as(actor).query(api.financial.getTimesheetEntries, { projectId })
      ).toHaveLength(1);
    }
  });

  it("rejects Consultant financial writes before any write happens", async () => {
    const { t, as, projectId, entryId, uploadId } = await setup();
    await expect(
      as("owner").mutation(api.financial.uploadAndScheduleFinancialData, {
        projectId,
        fileName: "more.csv",
        fileType: "timesheet",
        content: "bob,2026-01-06,2,testing",
      })
    ).rejects.toMatchObject({
      data: { code: "NOT_AUTHORIZED", capability: "financial.write" },
    });
    await expect(
      as("owner").mutation(api.financial.reviewTimesheetEntry, {
        entryId,
        status: "approved",
      })
    ).rejects.toMatchObject({ data: { code: "NOT_AUTHORIZED" } });
    await expect(
      as("owner").mutation(api.financial.deleteUpload, { uploadId })
    ).rejects.toMatchObject({ data: { code: "NOT_AUTHORIZED" } });

    const state = await t.run(async (ctx) => ({
      uploads: await ctx.db
        .query("financialUploads")
        .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
        .collect(),
      entry: await ctx.db.get(entryId),
      scheduled: await ctx.db.system.query("_scheduled_functions").collect(),
    }));
    expect(state.uploads).toHaveLength(1);
    expect(state.entry?.reviewStatus).toBe("pending");
    expect(state.scheduled).toHaveLength(0);
  });

  it("lets a Manager upload, review, and delete financial data", async () => {
    const { t, as, projectId, entryId } = await setup();
    const uploadId = await as("manager").mutation(
      api.financial.uploadAndScheduleFinancialData,
      {
        projectId,
        fileName: "more.csv",
        fileType: "timesheet",
        content: "bob,2026-01-06,2,testing",
      }
    );
    expect(uploadId).toBeTruthy();
    await as("manager").mutation(api.financial.reviewTimesheetEntry, {
      entryId,
      status: "approved",
    });
    const reviewed = await t.run(async (ctx) => ctx.db.get(entryId));
    expect(reviewed?.reviewStatus).toBe("approved");
    await as("manager").mutation(api.financial.deleteUpload, { uploadId });
  });
});
