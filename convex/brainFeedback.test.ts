/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const SUBSTANTIVE_BODY =
  "The QA reviewer keeps flagging passive uncertainties phrased as business risk even when the paragraph already names the knowledge gap.";
const RULE =
  "Do not flag passive uncertainties as business risk when the knowledge limitation is explicit.";

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      authId: "brain-admin",
      role: "admin",
      name: "Admin",
    });
    const writerId = await ctx.db.insert("users", {
      authId: "brain-writer",
      role: "writer",
      name: "Tracy",
    });
    await ctx.db.insert("users", {
      authId: "brain-anon",
      role: "writer",
      name: "Anon",
      isAnonymous: true,
    });
    await ctx.db.insert("users", { authId: "brain-norole", name: "No Role" });
    const now = Date.now();
    const projectId = await ctx.db.insert("projects", {
      title: "Project A",
      clientName: "Client A",
      status: "review",
      createdBy: writerId,
      shareToken: "brain-project-a",
      createdAt: now,
      updatedAt: now,
    });
    const otherProjectId = await ctx.db.insert("projects", {
      title: "Project B",
      clientName: "Client B",
      status: "review",
      createdBy: writerId,
      shareToken: "brain-project-b",
      createdAt: now,
      updatedAt: now,
    });
    const reportId = await ctx.db.insert("reports", {
      projectId,
      content: "Report under project A",
      version: 1,
      generatedAt: now,
      updatedAt: now,
    });
    return { projectId, otherProjectId, reportId };
  });
  return {
    t,
    ...ids,
    admin: t.withIdentity({ subject: "brain-admin" }),
    writer: t.withIdentity({ subject: "brain-writer" }),
    anon: t.withIdentity({ subject: "brain-anon" }),
    noRole: t.withIdentity({ subject: "brain-norole" }),
  };
}

async function allRows<
  T extends "brainSources" | "brainAuditLog" | "brainFeedbackQueue",
>(
  t: ReturnType<typeof convexTest>,
  table: T,
) {
  return await t.run(async (ctx) => {
    const rows = [];
    for await (const row of ctx.db.query(table)) rows.push(row);
    return rows;
  });
}

/** Pending draft-style distillation jobs queued by the mutation under test. */
async function scheduledDistillations(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const jobs = await ctx.db.system.query("_scheduled_functions").collect();
    return jobs.filter((job) => job.name.includes("generateDraftStyleDigest"));
  });
}

describe("brain feedback review routing", () => {
  test("approving feedback with a suggested rule nominates a pending writer_feedback source", async () => {
    const { t, admin, writer } = await setup();
    const feedbackId = await writer.mutation(api.brain.submitBrainFeedback, {
      body: SUBSTANTIVE_BODY,
      suggestedRule: RULE,
    });

    await admin.mutation(api.brain.reviewFeedback, {
      feedbackId,
      decision: "approved",
      reviewNote: "Good catch",
    });

    const sources = await allRows(t, "brainSources");
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      kind: "writer_feedback",
      // Pending, never auto-approved: the sources queue stays the only gate
      // into the vector index.
      status: "pending",
      docType: "writer_feedback",
      writerName: "Tracy",
      writerTier: 0.4,
      industry: "general",
    });
    expect(sources[0].content).toContain(RULE);
    expect(sources[0].content).toContain(SUBSTANTIVE_BODY);

    const audit = await allRows(t, "brainAuditLog");
    // importSource logs "ingest" for the nominated source; the decision itself
    // logs "approve" linking feedbackId AND the nominated sourceId.
    const decision = audit.find((row) => row.feedbackId === feedbackId);
    expect(decision).toMatchObject({
      action: "approve",
      sourceId: sources[0]._id,
      reason: "Good catch",
    });
    expect(
      audit.some(
        (row) => row.action === "ingest" && row.sourceId === sources[0]._id,
      ),
    ).toBe(true);

    const fb = await t.run((ctx) => ctx.db.get(feedbackId));
    expect(fb).toMatchObject({ status: "approved", reviewNote: "Good catch" });
  });

  test("substantive feedback without a rule is still promoted", async () => {
    const { t, admin, writer } = await setup();
    const feedbackId = await writer.mutation(api.brain.submitBrainFeedback, {
      body: SUBSTANTIVE_BODY,
    });
    await admin.mutation(api.brain.reviewFeedback, {
      feedbackId,
      decision: "approved",
    });
    const sources = await allRows(t, "brainSources");
    expect(sources).toHaveLength(1);
    expect(sources[0].content).toBe(SUBSTANTIVE_BODY);
  });

  test("approval of trivially short feedback records the decision but nominates nothing", async () => {
    const { t, admin, writer } = await setup();
    const feedbackId = await writer.mutation(api.brain.submitBrainFeedback, {
      body: "thanks!",
    });
    await admin.mutation(api.brain.reviewFeedback, {
      feedbackId,
      decision: "approved",
    });
    expect(await allRows(t, "brainSources")).toHaveLength(0);
    const fb = await t.run((ctx) => ctx.db.get(feedbackId));
    expect(fb?.status).toBe("approved");
  });

  test("rejection creates no source", async () => {
    const { t, admin, writer } = await setup();
    const feedbackId = await writer.mutation(api.brain.submitBrainFeedback, {
      body: SUBSTANTIVE_BODY,
      suggestedRule: RULE,
    });
    await admin.mutation(api.brain.reviewFeedback, {
      feedbackId,
      decision: "rejected",
      reviewNote: "Not generalizable",
    });
    expect(await allRows(t, "brainSources")).toHaveLength(0);
    const audit = await allRows(t, "brainAuditLog");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "reject",
      feedbackId,
    });
  });

  test("status fence: a decided item cannot be re-decided, and no duplicate source appears", async () => {
    const { t, admin, writer } = await setup();
    const feedbackId = await writer.mutation(api.brain.submitBrainFeedback, {
      body: SUBSTANTIVE_BODY,
      suggestedRule: RULE,
    });
    await admin.mutation(api.brain.reviewFeedback, {
      feedbackId,
      decision: "approved",
    });
    await expect(
      admin.mutation(api.brain.reviewFeedback, {
        feedbackId,
        decision: "approved",
      }),
    ).rejects.toThrow(/already reviewed/i);
    // A reversal attempt is fenced too — decisions are final at this surface.
    await expect(
      admin.mutation(api.brain.reviewFeedback, {
        feedbackId,
        decision: "rejected",
      }),
    ).rejects.toThrow(/already reviewed/i);
    expect(await allRows(t, "brainSources")).toHaveLength(1);
  });

  test("identical feedback content dedups to a single source across items", async () => {
    const { t, admin, writer } = await setup();
    const first = await writer.mutation(api.brain.submitBrainFeedback, {
      body: SUBSTANTIVE_BODY,
      suggestedRule: RULE,
    });
    const second = await writer.mutation(api.brain.submitBrainFeedback, {
      body: SUBSTANTIVE_BODY,
      suggestedRule: RULE,
    });
    await admin.mutation(api.brain.reviewFeedback, {
      feedbackId: first,
      decision: "approved",
    });
    await admin.mutation(api.brain.reviewFeedback, {
      feedbackId: second,
      decision: "approved",
    });
    // Content-hash dedup in importSource: the second approval is a no-op.
    expect(await allRows(t, "brainSources")).toHaveLength(1);
  });

  test("approving a promotable item schedules the draft-style distillation", async () => {
    const { t, admin, writer } = await setup();
    const feedbackId = await writer.mutation(api.brain.submitBrainFeedback, {
      body: SUBSTANTIVE_BODY,
      suggestedRule: RULE,
    });
    expect(await scheduledDistillations(t)).toHaveLength(0);
    await admin.mutation(api.brain.reviewFeedback, {
      feedbackId,
      decision: "approved",
    });
    const jobs = await scheduledDistillations(t);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].state.kind).toBe("pending");
  });

  test("rejection schedules no distillation", async () => {
    const { t, admin, writer } = await setup();
    const feedbackId = await writer.mutation(api.brain.submitBrainFeedback, {
      body: SUBSTANTIVE_BODY,
      suggestedRule: RULE,
    });
    await admin.mutation(api.brain.reviewFeedback, {
      feedbackId,
      decision: "rejected",
    });
    expect(await scheduledDistillations(t)).toHaveLength(0);
  });

  test("approval of a non-promotable item schedules no distillation", async () => {
    const { t, admin, writer } = await setup();
    const feedbackId = await writer.mutation(api.brain.submitBrainFeedback, {
      body: "thanks!",
    });
    await admin.mutation(api.brain.reviewFeedback, {
      feedbackId,
      decision: "approved",
    });
    expect(await scheduledDistillations(t)).toHaveLength(0);
  });

  test("review is admin-only", async () => {
    const { t, admin, writer } = await setup();
    const feedbackId = await writer.mutation(api.brain.submitBrainFeedback, {
      body: SUBSTANTIVE_BODY,
    });
    await expect(
      writer.mutation(api.brain.reviewFeedback, {
        feedbackId,
        decision: "approved",
      }),
    ).rejects.toThrow(/admin only/i);
    await expect(
      t.mutation(api.brain.reviewFeedback, {
        feedbackId,
        decision: "approved",
      }),
    ).rejects.toThrow(/not authenticated/i);
    // The item is untouched and still decidable by the admin.
    await admin.mutation(api.brain.reviewFeedback, {
      feedbackId,
      decision: "approved",
    });
  });
});

describe("brain feedback scope", () => {
  async function codeOf(p: Promise<unknown>) {
    try {
      await p;
    } catch (error) {
      const code = (error as { data?: { code?: string } }).data?.code;
      if (!code) throw error;
      return code;
    }
    throw new Error("expected rejection");
  }

  test("unscoped feedback stores no report or project", async () => {
    const { t, writer } = await setup();
    const id = await writer.mutation(api.brain.submitBrainFeedback, {
      body: SUBSTANTIVE_BODY,
    });
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row).toMatchObject({ status: "pending" });
    expect(row?.fromUserId).toBeDefined();
    expect(row?.reportId).toBeUndefined();
    expect(row?.projectId).toBeUndefined();
  });

  test("scoped by project stores that projectId", async () => {
    const { t, writer, projectId } = await setup();
    const id = await writer.mutation(api.brain.submitBrainFeedback, {
      body: SUBSTANTIVE_BODY,
      projectId,
    });
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.projectId).toBe(projectId);
    expect(row?.reportId).toBeUndefined();
  });

  test("scoped by report derives projectId from the report", async () => {
    const { t, writer, projectId, reportId } = await setup();
    const id = await writer.mutation(api.brain.submitBrainFeedback, {
      body: SUBSTANTIVE_BODY,
      reportId,
    });
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.reportId).toBe(reportId);
    expect(row?.projectId).toBe(projectId);
  });

  test("report with matching project stores both ids", async () => {
    const { t, writer, projectId, reportId } = await setup();
    const id = await writer.mutation(api.brain.submitBrainFeedback, {
      body: SUBSTANTIVE_BODY,
      reportId,
      projectId,
    });
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.reportId).toBe(reportId);
    expect(row?.projectId).toBe(projectId);
  });

  test("report paired with a foreign project is NOT_AUTHORIZED", async () => {
    const { t, writer, otherProjectId, reportId } = await setup();
    expect(
      await codeOf(
        writer.mutation(api.brain.submitBrainFeedback, {
          body: SUBSTANTIVE_BODY,
          reportId,
          projectId: otherProjectId,
        }),
      ),
    ).toBe("NOT_AUTHORIZED");
    expect(await allRows(t, "brainFeedbackQueue")).toHaveLength(0);
  });

  test("deleted report is NOT_FOUND", async () => {
    const { t, writer, reportId } = await setup();
    await t.run((ctx) => ctx.db.delete(reportId));
    expect(
      await codeOf(
        writer.mutation(api.brain.submitBrainFeedback, {
          body: SUBSTANTIVE_BODY,
          reportId,
        }),
      ),
    ).toBe("NOT_FOUND");
    expect(await allRows(t, "brainFeedbackQueue")).toHaveLength(0);
  });

  test("deleted project is NOT_FOUND", async () => {
    const { t, writer, otherProjectId } = await setup();
    await t.run((ctx) => ctx.db.delete(otherProjectId));
    expect(
      await codeOf(
        writer.mutation(api.brain.submitBrainFeedback, {
          body: SUBSTANTIVE_BODY,
          projectId: otherProjectId,
        }),
      ),
    ).toBe("NOT_FOUND");
    expect(await allRows(t, "brainFeedbackQueue")).toHaveLength(0);
  });

  test("report whose project was deleted is NOT_FOUND", async () => {
    const { t, writer, projectId, reportId } = await setup();
    await t.run((ctx) => ctx.db.delete(projectId));
    expect(
      await codeOf(
        writer.mutation(api.brain.submitBrainFeedback, {
          body: SUBSTANTIVE_BODY,
          reportId,
        }),
      ),
    ).toBe("NOT_FOUND");
    expect(await allRows(t, "brainFeedbackQueue")).toHaveLength(0);
  });

  test("anonymous user scoped by project is NOT_AUTHORIZED", async () => {
    const { t, anon, projectId } = await setup();
    expect(
      await codeOf(
        anon.mutation(api.brain.submitBrainFeedback, {
          body: SUBSTANTIVE_BODY,
          projectId,
        }),
      ),
    ).toBe("NOT_AUTHORIZED");
    expect(await allRows(t, "brainFeedbackQueue")).toHaveLength(0);
  });

  test("role-less user scoped by report is NOT_AUTHORIZED", async () => {
    const { t, noRole, reportId } = await setup();
    expect(
      await codeOf(
        noRole.mutation(api.brain.submitBrainFeedback, {
          body: SUBSTANTIVE_BODY,
          reportId,
        }),
      ),
    ).toBe("NOT_AUTHORIZED");
    expect(await allRows(t, "brainFeedbackQueue")).toHaveLength(0);
  });

  test("anonymous user with a deleted report is NOT_AUTHORIZED, not NOT_FOUND", async () => {
    const { t, anon, reportId } = await setup();
    await t.run((ctx) => ctx.db.delete(reportId));
    expect(
      await codeOf(
        anon.mutation(api.brain.submitBrainFeedback, {
          body: SUBSTANTIVE_BODY,
          reportId,
        }),
      ),
    ).toBe("NOT_AUTHORIZED");
    expect(await allRows(t, "brainFeedbackQueue")).toHaveLength(0);
  });

  test("unauthenticated scoped submission throws Not authenticated", async () => {
    const { t, projectId } = await setup();
    await expect(
      t.mutation(api.brain.submitBrainFeedback, {
        body: SUBSTANTIVE_BODY,
        projectId,
      }),
    ).rejects.toThrow(/not authenticated/i);
    expect(await allRows(t, "brainFeedbackQueue")).toHaveLength(0);
  });

  test("unauthenticated unscoped submission throws Not authenticated", async () => {
    const { t } = await setup();
    await expect(
      t.mutation(api.brain.submitBrainFeedback, { body: SUBSTANTIVE_BODY }),
    ).rejects.toThrow(/not authenticated/i);
    expect(await allRows(t, "brainFeedbackQueue")).toHaveLength(0);
  });
});
