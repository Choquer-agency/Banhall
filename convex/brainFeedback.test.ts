/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
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

// ─── CAP-5 (story 3): feedback scoped to an accessible, matching pair ────────

/** Typed domain-error code of a rejected call, or a marker for other outcomes. */
async function errorCode(call: () => Promise<unknown>): Promise<string> {
  try {
    await call();
  } catch (error) {
    const data = (error as { data?: unknown }).data;
    if (data && typeof data === "object" && "code" in data) {
      return String((data as { code: unknown }).code);
    }
    return `UNTYPED: ${(error as Error).message}`;
  }
  return "NO_ERROR";
}

async function scopeSetup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const writerId = await ctx.db.insert("users", {
      authId: "scope-writer",
      role: "writer",
      name: "Tracy",
    });
    // Mapped and signed in, but holds no internal role.
    await ctx.db.insert("users", { authId: "scope-roleless", name: "Rory" });
    const projectId = await ctx.db.insert("projects", {
      title: "Alloy fatigue PD",
      clientName: "Acme Metals",
      status: "review",
      createdBy: writerId,
      ownerId: writerId,
      shareToken: "scope-token-a",
      createdAt: now,
      updatedAt: now,
    });
    const otherProjectId = await ctx.db.insert("projects", {
      title: "Sensor firmware PD",
      clientName: "Beta Devices",
      status: "review",
      createdBy: writerId,
      ownerId: writerId,
      shareToken: "scope-token-b",
      createdAt: now,
      updatedAt: now,
    });
    const reportId = await ctx.db.insert("reports", {
      projectId,
      content: "{}",
      version: 1,
      generatedAt: now,
      updatedAt: now,
    });
    const otherReportId = await ctx.db.insert("reports", {
      projectId: otherProjectId,
      content: "{}",
      version: 1,
      generatedAt: now,
      updatedAt: now,
    });
    // A report id that resolves to nothing.
    const missingReportId = await ctx.db.insert("reports", {
      projectId,
      content: "{}",
      version: 1,
      generatedAt: now,
      updatedAt: now,
    });
    await ctx.db.delete(missingReportId);
    return {
      writerId,
      projectId,
      otherProjectId,
      reportId,
      otherReportId,
      missingReportId,
    };
  });
  return {
    t,
    ...ids,
    writer: t.withIdentity({ subject: "scope-writer" }),
    roleless: t.withIdentity({ subject: "scope-roleless" }),
    // No JWT at all.
    noIdentity: t,
  };
}

type ScopeFixture = Awaited<ReturnType<typeof scopeSetup>>;

async function feedbackCount(f: ScopeFixture) {
  return (await allRows(f.t, "brainFeedbackQueue")).length;
}

describe("submitBrainFeedback scope", () => {
  test("a reportId that resolves to nothing is rejected before any write", async () => {
    const f = await scopeSetup();
    const before = await feedbackCount(f);
    expect(
      await errorCode(() =>
        f.writer.mutation(api.brain.submitBrainFeedback, {
          body: SUBSTANTIVE_BODY,
          reportId: f.missingReportId,
        }),
      ),
    ).toBe("NOT_FOUND");
    // Same outcome when the (accessible) project is supplied alongside it.
    expect(
      await errorCode(() =>
        f.writer.mutation(api.brain.submitBrainFeedback, {
          body: SUBSTANTIVE_BODY,
          reportId: f.missingReportId,
          projectId: f.projectId,
        }),
      ),
    ).toBe("NOT_FOUND");
    expect(await feedbackCount(f)).toBe(before);
  });

  test("a projectId the caller cannot access is rejected before any write", async () => {
    const f = await scopeSetup();
    const before = await feedbackCount(f);
    expect(
      await errorCode(() =>
        f.roleless.mutation(api.brain.submitBrainFeedback, {
          body: SUBSTANTIVE_BODY,
          projectId: f.projectId,
        }),
      ),
    ).toBe("NOT_AUTHORIZED");
    expect(
      await errorCode(() =>
        f.noIdentity.mutation(api.brain.submitBrainFeedback, {
          body: SUBSTANTIVE_BODY,
          projectId: f.projectId,
        }),
      ),
    ).toBe("NOT_AUTHENTICATED");
    // The pair can be internally consistent and still inaccessible.
    expect(
      await errorCode(() =>
        f.roleless.mutation(api.brain.submitBrainFeedback, {
          body: SUBSTANTIVE_BODY,
          reportId: f.reportId,
          projectId: f.projectId,
        }),
      ),
    ).toBe("NOT_AUTHORIZED");
    expect(await feedbackCount(f)).toBe(before);
  });

  test("a report that belongs to a different project than the supplied projectId is rejected before any write", async () => {
    const f = await scopeSetup();
    const before = await feedbackCount(f);
    let caught: unknown;
    try {
      await f.writer.mutation(api.brain.submitBrainFeedback, {
        body: SUBSTANTIVE_BODY,
        reportId: f.otherReportId,
        projectId: f.projectId,
      });
    } catch (error) {
      caught = error;
    }
    expect((caught as { data?: { code?: string; message?: string } }).data).toMatchObject({
      code: "NOT_AUTHORIZED",
      message: "Report does not belong to this project",
    });
    expect(await feedbackCount(f)).toBe(before);
  });

  test("a caller without an internal role is rejected even with no ids", async () => {
    const f = await scopeSetup();
    const before = await feedbackCount(f);
    expect(
      await errorCode(() =>
        f.roleless.mutation(api.brain.submitBrainFeedback, {
          body: SUBSTANTIVE_BODY,
        }),
      ),
    ).toBe("NOT_AUTHORIZED");
    expect(
      await errorCode(() =>
        f.noIdentity.mutation(api.brain.submitBrainFeedback, {
          body: SUBSTANTIVE_BODY,
        }),
      ),
    ).toBe("NOT_AUTHENTICATED");
    // A bare reportId does not rescue a role-less caller either.
    expect(
      await errorCode(() =>
        f.roleless.mutation(api.brain.submitBrainFeedback, {
          body: SUBSTANTIVE_BODY,
          reportId: f.reportId,
        }),
      ),
    ).toBe("NOT_AUTHORIZED");
    expect(await feedbackCount(f)).toBe(before);
  });

  test("positive control: a writer with a matching accessible pair is recorded with both ids", async () => {
    const f = await scopeSetup();
    const before = await feedbackCount(f);
    const feedbackId = await f.writer.mutation(api.brain.submitBrainFeedback, {
      body: `  ${SUBSTANTIVE_BODY}  `,
      suggestedRule: `  ${RULE}  `,
      reportId: f.reportId,
      projectId: f.projectId,
    });
    expect(await feedbackCount(f)).toBe(before + 1);
    const row = await f.t.run((ctx) => ctx.db.get(feedbackId));
    expect(row).toMatchObject({
      fromUserId: f.writerId,
      fromName: "Tracy",
      reportId: f.reportId,
      projectId: f.projectId,
      // Stored trimmed.
      body: SUBSTANTIVE_BODY,
      suggestedRule: RULE,
      status: "pending",
    });
  });

  test("with only a reportId, the report's own project is stored on the row", async () => {
    const f = await scopeSetup();
    const feedbackId = await f.writer.mutation(api.brain.submitBrainFeedback, {
      body: SUBSTANTIVE_BODY,
      reportId: f.otherReportId,
    });
    const row = await f.t.run((ctx) => ctx.db.get(feedbackId));
    expect(row).toMatchObject({
      reportId: f.otherReportId,
      projectId: f.otherProjectId,
    });
  });

  test("input bounds: an empty body, an oversize body, or an oversize rule is INVALID_INPUT with no write", async () => {
    const f = await scopeSetup();
    const before = await feedbackCount(f);
    expect(
      await errorCode(() =>
        f.writer.mutation(api.brain.submitBrainFeedback, { body: "   " }),
      ),
    ).toBe("INVALID_INPUT");
    expect(
      await errorCode(() =>
        f.writer.mutation(api.brain.submitBrainFeedback, {
          body: "x".repeat(10_001),
          projectId: f.projectId,
        }),
      ),
    ).toBe("INVALID_INPUT");
    expect(
      await errorCode(() =>
        f.writer.mutation(api.brain.submitBrainFeedback, {
          body: SUBSTANTIVE_BODY,
          suggestedRule: "r".repeat(1_001),
          projectId: f.projectId,
        }),
      ),
    ).toBe("INVALID_INPUT");
    expect(await feedbackCount(f)).toBe(before);
    // Exactly at the bounds is accepted.
    await f.writer.mutation(api.brain.submitBrainFeedback, {
      body: "x".repeat(10_000),
      suggestedRule: "r".repeat(1_000),
      projectId: f.projectId,
    });
    expect(await feedbackCount(f)).toBe(before + 1);
  });
});

// ─── CAP-1: de-identification at the Brain nomination boundary ───────────────

const CLIENT_NAME = "Acme Metals";
const PROJECT_TITLE = "Alloy fatigue PD";
const WRITER_NAME = "Tracy Fielding";

function tiptap(...paragraphs: string[]) {
  return JSON.stringify({
    type: "doc",
    content: paragraphs.map((text) => ({
      type: "paragraph",
      content: [{ type: "text", text }],
    })),
  });
}

describe("nominateFromReport de-identification", () => {
  test("scrubs client identifiers from both the nominated content and its title", async () => {
    const t = convexTest(schema, modules);
    const reportId = await t.run(async (ctx) => {
      const now = Date.now();
      const writerId = await ctx.db.insert("users", {
        authId: "nominate-writer",
        role: "writer",
        name: "Tracy",
      });
      const projectId = await ctx.db.insert("projects", {
        title: PROJECT_TITLE,
        clientName: CLIENT_NAME,
        writer: WRITER_NAME,
        status: "review",
        createdBy: writerId,
        ownerId: writerId,
        shareToken: "nominate-token",
        createdAt: now,
        updatedAt: now,
      });
      return await ctx.db.insert("reports", {
        projectId,
        content: tiptap(
          `${CLIENT_NAME} engaged us on ${PROJECT_TITLE} after ${WRITER_NAME} scoped it.`,
          "Reach the lead at tracy@acmemetals.ca or (613) 555-0134.\n613\n555\n0134",
        ),
        version: 1,
        generatedAt: now,
        updatedAt: now,
      });
    });

    await t.mutation(internal.brain.nominateFromReport, {
      reportId,
      writerName: WRITER_NAME,
      score: 88,
    });

    const sources = await allRows(t, "brainSources");
    expect(sources).toHaveLength(1);
    const source = sources[0]!;
    for (const field of [source.content, source.title]) {
      expect(field).not.toContain(CLIENT_NAME);
      expect(field).not.toContain(PROJECT_TITLE);
      expect(field).not.toContain(WRITER_NAME);
    }
    expect(source.content).toContain("[redacted email]");
    expect(source.content).toContain("[redacted phone]");
    // The label degrades to the score, which is the point: the exemplar title
    // is injected into drafting prompts.
    expect(source.title).toBe("[redacted] (writer-rated 88/100)");
    // The prose keeps its paragraph structure — it is exemplar material.
    expect(source.content).toBe(
      "[redacted] engaged us on [redacted] after [redacted] scoped it.\n\n" +
      "Reach the lead at [redacted email] or [redacted phone].\n613\n555\n0134"
    );
    const report = await t.run((ctx) => ctx.db.get(reportId));
    expect(report?.content).toContain("(613) 555-0134");
  });
});
