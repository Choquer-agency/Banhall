/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { matchWriterText, normalizeFullName } from "./lib/ownerMatching";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

type Setup = Awaited<ReturnType<typeof setupFixture>>;

type BackfillTotals = {
  scanned: number;
  ownerFromWriter: number;
  ownerFromCreator: number;
  flaggedForReview: number;
  stageDrafting: number;
  stageIntake: number;
  skippedOwner: number;
  skippedStage: number;
};

async function setupFixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const adminId = await ctx.db.insert("users", {
      authId: "owner-backfill-admin",
      email: "admin@banhall.ca",
      firstName: "Avery",
      lastName: "Admin",
      role: "admin",
    });
    const creatorId = await ctx.db.insert("users", {
      authId: "owner-backfill-creator",
      email: "creator@banhall.ca",
      firstName: "Casey",
      lastName: "Creator",
      role: "writer",
    });
    const emailWriterId = await ctx.db.insert("users", {
      authId: "owner-backfill-email",
      email: "email.writer@banhall.ca",
      firstName: "Email",
      lastName: "Writer",
      role: "writer",
    });
    const nameWriterId = await ctx.db.insert("users", {
      authId: "owner-backfill-name",
      email: "name.writer@banhall.ca",
      firstName: "Name",
      lastName: "Writer",
      role: "writer",
    });
    const duplicateAId = await ctx.db.insert("users", {
      email: "duplicate@banhall.ca",
      name: "Duplicate One",
      role: "writer",
    });
    const duplicateBId = await ctx.db.insert("users", {
      email: "duplicate@banhall.ca",
      name: "Duplicate Two",
      role: "manager",
    });
    const sameNameAId = await ctx.db.insert("users", {
      email: "same-a@banhall.ca",
      name: "Same Person",
      role: "writer",
    });
    const sameNameBId = await ctx.db.insert("users", {
      email: "same-b@banhall.ca",
      firstName: "Same",
      lastName: "Person",
      role: "writer",
    });
    await ctx.db.insert("users", {
      email: "anonymous@banhall.ca",
      name: "Ignored Anonymous",
      role: "writer",
      isAnonymous: true,
    });

    const now = Date.now();
    const insertProject = (title: string, writer?: string) =>
      ctx.db.insert("projects", {
        title,
        clientName: "Client",
        ...(writer === undefined ? {} : { writer }),
        status: "draft",
        createdBy: creatorId,
        shareToken: `token-${title}`,
        createdAt: now,
        updatedAt: now,
      });
    const emailProjectId = await insertProject("Email match", " EMAIL.WRITER@BANHALL.CA ");
    const nameProjectId = await insertProject("Name match", "  NAME   WRITER ");
    const noneProjectId = await insertProject("No match", "Former Consultant");
    const ambiguousProjectId = await insertProject("Ambiguous", "duplicate@banhall.ca");
    const blankProjectId = await insertProject("Blank", "   ");
    const reportProjectId = await insertProject("Has report", "email.writer@banhall.ca");
    await ctx.db.insert("reports", {
      projectId: reportProjectId,
      content: "Report",
      version: 1,
      generatedAt: now,
      updatedAt: now,
    });
    const alreadyOwnedId = await ctx.db.insert("projects", {
      title: "Already owned",
      clientName: "Client",
      writer: "Former Consultant",
      ownerId: nameWriterId,
      workflowStage: "internal_review",
      workflowUpdatedAt: now - 1,
      status: "review",
      createdBy: creatorId,
      shareToken: "token-already-owned",
      createdAt: now,
      updatedAt: now,
    });
    return {
      adminId,
      creatorId,
      emailWriterId,
      nameWriterId,
      duplicateAId,
      duplicateBId,
      sameNameAId,
      sameNameBId,
      emailProjectId,
      nameProjectId,
      noneProjectId,
      ambiguousProjectId,
      blankProjectId,
      reportProjectId,
      alreadyOwnedId,
      originalUpdatedAt: now,
    };
  });
  return {
    t,
    ...ids,
    admin: t.withIdentity({ subject: "owner-backfill-admin" }),
    creator: t.withIdentity({ subject: "owner-backfill-creator" }),
  };
}

async function runBackfill(setup: Setup, dryRun = false, numItems = 2) {
  let cursor: string | null = null;
  let totals = undefined;
  do {
    const result: {
      isDone: boolean;
      continueCursor: string;
      totals: BackfillTotals;
    } = await setup.t.mutation(internal.ownerBackfill.backfillOwnership, {
      paginationOpts: { numItems, cursor },
      actorId: setup.adminId,
      dryRun,
      ...(totals ? { totals } : {}),
    });
    totals = result.totals;
    cursor = result.isDone ? null : result.continueCursor;
  } while (cursor);
  return totals;
}

async function project(setup: Setup, projectId: Id<"projects">) {
  return await setup.t.run(async (ctx) => ctx.db.get(projectId));
}

describe("owner matcher", () => {
  test("normalizes exact full names without fuzzy matching", async () => {
    const setup = await setupFixture();
    const roster = await setup.t.run(async (ctx) => ctx.db.query("users").take(100));
    expect(normalizeFullName("  NAME   WRITER ")).toBe("name writer");
    expect(matchWriterText(" NAME  WRITER ", roster)).toMatchObject({
      kind: "matched",
      matchedBy: "name",
      user: { _id: setup.nameWriterId },
    });
    expect(matchWriterText("Name Writ", roster)).toEqual({ kind: "none" });
  });

  test("matches exact normalized email first and treats collisions as ambiguous", async () => {
    const setup = await setupFixture();
    const roster = await setup.t.run(async (ctx) => ctx.db.query("users").take(100));
    expect(matchWriterText("EMAIL.WRITER@BANHALL.CA", roster)).toMatchObject({
      kind: "matched",
      matchedBy: "email",
      user: { _id: setup.emailWriterId },
    });
    const collision = matchWriterText("duplicate@banhall.ca", roster);
    expect(collision.kind).toBe("ambiguous");
    if (collision.kind === "ambiguous") {
      expect(collision.users.map((user) => user._id)).toEqual(
        expect.arrayContaining([setup.duplicateAId, setup.duplicateBId])
      );
    }
  });

  test("treats exact name collisions as ambiguous and excludes anonymous users", async () => {
    const setup = await setupFixture();
    const roster = await setup.t.run(async (ctx) => ctx.db.query("users").take(100));
    const collision = matchWriterText("Same Person", roster);
    expect(collision.kind).toBe("ambiguous");
    expect(matchWriterText("Ignored Anonymous", roster)).toEqual({ kind: "none" });
  });
});

describe("ownership and stage backfill", () => {
  test("dry-run reports work but writes no projects or events", async () => {
    const setup = await setupFixture();
    const totals = await runBackfill(setup, true);
    expect(totals?.scanned).toBe(7);
    expect(totals?.flaggedForReview).toBe(2);
    expect((await project(setup, setup.emailProjectId))?.ownerId).toBeUndefined();
    const events = await setup.t.run(async (ctx) => ctx.db.query("projectEvents").take(100));
    expect(events).toHaveLength(0);
  });

  test("backfills unique matches, creator fallbacks, review flags, and conservative stages", async () => {
    const setup = await setupFixture();
    const totals = await runBackfill(setup);
    expect(totals).toMatchObject({
      scanned: 7,
      ownerFromWriter: 3,
      ownerFromCreator: 3,
      flaggedForReview: 2,
      stageDrafting: 1,
      stageIntake: 5,
      skippedOwner: 1,
      skippedStage: 1,
    });

    const [email, name, none, ambiguous, blank, withReport, existing] = await Promise.all([
      project(setup, setup.emailProjectId),
      project(setup, setup.nameProjectId),
      project(setup, setup.noneProjectId),
      project(setup, setup.ambiguousProjectId),
      project(setup, setup.blankProjectId),
      project(setup, setup.reportProjectId),
      project(setup, setup.alreadyOwnedId),
    ]);
    expect(email).toMatchObject({ ownerId: setup.emailWriterId, workflowStage: "intake" });
    expect(name).toMatchObject({ ownerId: setup.nameWriterId, workflowStage: "intake" });
    expect(none).toMatchObject({
      ownerId: setup.creatorId,
      ownerBackfillStatus: "needs_review",
      workflowStage: "intake",
    });
    expect(ambiguous).toMatchObject({
      ownerId: setup.creatorId,
      ownerBackfillStatus: "needs_review",
    });
    expect(blank).toMatchObject({ ownerId: setup.creatorId, workflowStage: "intake" });
    expect(blank?.ownerBackfillStatus).toBeUndefined();
    expect(withReport).toMatchObject({ ownerId: setup.emailWriterId, workflowStage: "drafting" });
    expect(existing).toMatchObject({
      ownerId: setup.nameWriterId,
      workflowStage: "internal_review",
      updatedAt: setup.originalUpdatedAt,
    });
    expect(none?.writer).toBe("Former Consultant");
    expect(none?.createdBy).toBe(setup.creatorId);
    expect(none?.status).toBe("draft");
    expect(none?.updatedAt).toBe(setup.originalUpdatedAt);

    const events = await setup.t.run(async (ctx) => ctx.db.query("projectEvents").take(100));
    expect(events).toHaveLength(12);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          projectId: setup.noneProjectId,
          type: "ownership_transferred",
          actorId: setup.adminId,
          to: setup.creatorId,
          note: "backfill:creator-fallback",
        }),
        expect.objectContaining({
          projectId: setup.reportProjectId,
          type: "stage_changed",
          to: "drafting",
          note: "backfill:stage-heuristic:has-report",
        }),
      ])
    );
  });

  test("self-schedules every remaining live batch", async () => {
    vi.useFakeTimers();
    try {
      const setup = await setupFixture();
      await setup.t.mutation(internal.ownerBackfill.backfillOwnership, {
        paginationOpts: { numItems: 1, cursor: null },
        actorId: setup.adminId,
        runKey: "scheduled-test-run",
      });
      await setup.t.finishAllScheduledFunctions(() => vi.runAllTimers());
      const report = await setup.t.query(internal.ownerBackfill.report, {});
      expect(report).toMatchObject({ missingOwner: 0, missingStage: 0, needsReview: 2 });
      const values = await setup.t.run(async (ctx) => ({
        events: await ctx.db.query("projectEvents").take(100),
        run: await ctx.db
          .query("ownerBackfillRuns")
          .withIndex("by_runKey", (q) => q.eq("runKey", "scheduled-test-run"))
          .unique(),
      }));
      expect(values.events).toHaveLength(12);
      expect(values.run?.totals).toMatchObject({
        scanned: 7,
        ownerFromWriter: 3,
        ownerFromCreator: 3,
        flaggedForReview: 2,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test("reports bounded migration state and duplicate email groups", async () => {
    const setup = await setupFixture();
    const before = await setup.t.query(internal.ownerBackfill.report, {});
    expect(before).toMatchObject({
      projectsScanned: 7,
      projectsTruncated: false,
      missingOwner: 6,
      missingStage: 6,
      needsReview: 0,
      duplicateNormalizedEmails: 1,
      rosterTruncated: false,
    });
    await runBackfill(setup);
    const after = await setup.t.query(internal.ownerBackfill.report, {});
    expect(after).toMatchObject({ missingOwner: 0, missingStage: 0, needsReview: 2 });
  });

  test("is resumable and idempotent across small batches", async () => {
    const setup = await setupFixture();
    await runBackfill(setup, false, 1);
    const firstEvents = await setup.t.run(async (ctx) => ctx.db.query("projectEvents").take(100));
    const totals = await runBackfill(setup, false, 1);
    const secondEvents = await setup.t.run(async (ctx) => ctx.db.query("projectEvents").take(100));
    expect(totals).toMatchObject({
      ownerFromWriter: 0,
      ownerFromCreator: 0,
      flaggedForReview: 0,
      stageDrafting: 0,
      stageIntake: 0,
      skippedOwner: 7,
      skippedStage: 7,
    });
    expect(secondEvents).toHaveLength(firstEvents.length);
  });

  test("rejects a missing or non-admin migration actor", async () => {
    const setup = await setupFixture();
    await expect(
      setup.t.mutation(internal.ownerBackfill.backfillOwnership, {
        paginationOpts: { numItems: 10, cursor: null },
        actorId: setup.creatorId,
      })
    ).rejects.toThrow(/administrator|authorized/i);
  });
});

describe("ownership review queue", () => {
  test("is admin-only and lists live collision candidates", async () => {
    const setup = await setupFixture();
    await runBackfill(setup);
    await expect(setup.creator.query(api.ownerBackfill.listReviewQueue, {})).rejects.toThrow(
      /elevated|authorized/i
    );
    const queue = await setup.admin.query(api.ownerBackfill.listReviewQueue, {});
    expect(queue.rows).toHaveLength(2);
    const ambiguous = queue.rows.find((row) => row.projectId === setup.ambiguousProjectId);
    expect(ambiguous).toMatchObject({ reason: "ambiguous", currentOwnerId: setup.creatorId });
    expect(ambiguous?.candidates.map((candidate) => candidate.userId)).toEqual(
      expect.arrayContaining([setup.duplicateAId, setup.duplicateBId])
    );
  });

  test("manual assignment is OCC-safe and writes one audited transfer", async () => {
    const setup = await setupFixture();
    await runBackfill(setup);
    await setup.admin.mutation(api.ownerBackfill.assignOwnerFromReview, {
      projectId: setup.noneProjectId,
      toUserId: setup.nameWriterId,
      expectedOwnerId: setup.creatorId,
    });
    const resolved = await project(setup, setup.noneProjectId);
    expect(resolved?.ownerId).toBe(setup.nameWriterId);
    expect(resolved?.ownerBackfillStatus).toBeUndefined();
    expect(resolved?.workflowVersion).toBe(2);
    expect(resolved?.workflowUpdatedAt).toEqual(expect.any(Number));
    const events = await setup.t.run(async (ctx) =>
      ctx.db
        .query("projectEvents")
        .withIndex("by_projectId", (q) => q.eq("projectId", setup.noneProjectId))
        .take(10)
    );
    expect(events.filter((event) => event.type === "ownership_transferred")).toHaveLength(2);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "ownership_transferred",
          from: setup.creatorId,
          to: setup.nameWriterId,
          note: "review:manual-assign",
        }),
      ])
    );
    await expect(
      setup.admin.mutation(api.ownerBackfill.assignOwnerFromReview, {
        projectId: setup.noneProjectId,
        toUserId: setup.emailWriterId,
        expectedOwnerId: setup.creatorId,
      })
    ).rejects.toThrow(/no longer needs|latest/i);
  });

  test("invalidates a transfer dialog opened before ownership review resolution", async () => {
    const setup = await setupFixture();
    await runBackfill(setup);
    const before = await project(setup, setup.noneProjectId);
    expect(before?.workflowVersion).toBe(1);

    await setup.admin.mutation(api.ownerBackfill.assignOwnerFromReview, {
      projectId: setup.noneProjectId,
      toUserId: setup.nameWriterId,
      expectedOwnerId: setup.creatorId,
    });

    await expect(
      setup.admin.mutation(api.projectWorkflow.transferOwnership, {
        projectId: setup.noneProjectId,
        toUserId: setup.emailWriterId,
        expectedVersion: before?.workflowVersion ?? 0,
      })
    ).rejects.toThrow(/STALE_REVISION|workflow changed/i);
    expect((await project(setup, setup.noneProjectId))?.ownerId).toBe(setup.nameWriterId);
  });

  test("surfaces a writer account that becomes uniquely matchable after backfill", async () => {
    const setup = await setupFixture();
    await runBackfill(setup);
    await setup.t.run(async (ctx) => {
      await ctx.db.insert("users", {
        email: "former@banhall.ca",
        name: "Former Consultant",
        role: "writer",
      });
    });
    const queue = await setup.admin.query(api.ownerBackfill.listReviewQueue, {});
    const row = queue.rows.find((item) => item.projectId === setup.noneProjectId);
    expect(row).toMatchObject({
      reason: "now_matched",
      candidates: [expect.objectContaining({ label: "Former Consultant" })],
    });
  });

  test("rejects role-less and administrator accounts as manual owners", async () => {
    const setup = await setupFixture();
    await runBackfill(setup);
    const rolelessId = await setup.t.run(async (ctx) =>
      ctx.db.insert("users", { email: "roleless@banhall.ca", name: "Roleless User" })
    );
    await expect(
      setup.admin.mutation(api.ownerBackfill.assignOwnerFromReview, {
        projectId: setup.noneProjectId,
        toUserId: rolelessId,
        expectedOwnerId: setup.creatorId,
      })
    ).rejects.toThrow(/Consultant|Manager/i);
    await expect(
      setup.admin.mutation(api.ownerBackfill.assignOwnerFromReview, {
        projectId: setup.noneProjectId,
        toUserId: setup.adminId,
        expectedOwnerId: setup.creatorId,
      })
    ).rejects.toThrow(/Consultant|Manager/i);
  });

  test("keeping the fallback clears review without a duplicate transfer event", async () => {
    const setup = await setupFixture();
    await runBackfill(setup);
    const before = await setup.t.run(async (ctx) => ctx.db.query("projectEvents").take(100));
    await setup.admin.mutation(api.ownerBackfill.confirmFallbackOwner, {
      projectId: setup.noneProjectId,
      expectedOwnerId: setup.creatorId,
    });
    const after = await setup.t.run(async (ctx) => ctx.db.query("projectEvents").take(100));
    expect((await project(setup, setup.noneProjectId))?.ownerBackfillStatus).toBeUndefined();
    expect(after).toHaveLength(before.length);
  });
});
