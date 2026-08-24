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
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      authId: "brain-admin",
      role: "admin",
      name: "Admin",
    });
    await ctx.db.insert("users", {
      authId: "brain-writer",
      role: "writer",
      name: "Tracy",
    });
  });
  return {
    t,
    admin: t.withIdentity({ subject: "brain-admin" }),
    writer: t.withIdentity({ subject: "brain-writer" }),
  };
}

async function allRows<T extends "brainSources" | "brainAuditLog">(
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
