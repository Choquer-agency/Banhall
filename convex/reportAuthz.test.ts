/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import {
  getInternalProjectAccessOrNull,
  requireInternalProjectAccess,
} from "./lib/auth";

const modules = import.meta.glob("./**/*.ts");

// Story 1 (CAP-1): `requireInternalProjectAccess` must decide actor
// eligibility exactly like `getInternalProjectAccessOrNull` — no identity, an
// unmapped identity, and a stored-anonymous user are NOT_AUTHENTICATED; a
// mapped user without an internal role is NOT_AUTHORIZED; an eligible actor
// against a missing project still gets NOT_FOUND. Every direct and transitive
// caller inherits that rule (see the Story 1 caller inventory).

const REPORT_DOC = JSON.stringify({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "The team tested the alloy at low temperature." },
      ],
    },
  ],
});

const EDITED_DOC = JSON.stringify({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "The team measured the alloy at low temperature." },
      ],
    },
  ],
});

async function setup() {
  const t = convexTest(schema, modules);
  agentTest.register(t);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const ownerId = await ctx.db.insert("users", {
      authId: "ra-owner",
      role: "writer",
      firstName: "Owen",
    });
    const managerId = await ctx.db.insert("users", {
      authId: "ra-manager",
      role: "manager",
      firstName: "Mara",
    });
    const adminId = await ctx.db.insert("users", {
      authId: "ra-admin",
      role: "admin",
      firstName: "Ada",
    });
    // Mapped, signed in, but holds no internal role.
    const rolelessId = await ctx.db.insert("users", {
      authId: "ra-roleless",
      firstName: "Rory",
    });
    // Stored anonymous record that also carries a role: still not an internal
    // actor. The role field must never rescue an anonymous auth record.
    const storedAnonymousId = await ctx.db.insert("users", {
      authId: "ra-anonymous",
      role: "writer",
      isAnonymous: true,
      firstName: "Anon",
    });
    // Anonymous state takes precedence over a missing role.
    const storedAnonymousRolelessId = await ctx.db.insert("users", {
      authId: "ra-anonymous-roleless",
      isAnonymous: true,
      firstName: "Anon Roleless",
    });

    const projectId = await ctx.db.insert("projects", {
      title: "Alloy fatigue PD",
      clientName: "Acme Metals",
      status: "review",
      createdBy: ownerId,
      ownerId,
      shareToken: "ra-project-token",
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
    // A pre-existing snapshot, so "the snapshot id list is unchanged" is a
    // real comparison rather than an empty-vs-empty assertion.
    await ctx.db.insert("reportSnapshots", {
      projectId,
      reportId,
      content: REPORT_DOC,
      reason: "manual",
      createdByRole: "writer",
      createdAt: now,
    });
    const proposalId = await ctx.db.insert("chatProposals", {
      agentThreadId: "ra-thread",
      projectId,
      reportId,
      kind: "edit",
      targetText: "tested the alloy",
      newText: "measured the alloy",
      state: "pending",
      createdAt: now,
    });
    await ctx.db.insert("agentChatThreads", {
      projectId,
      reportId,
      agentThreadId: "ra-thread",
      title: "Chat",
      createdAt: now,
    });

    // Duplicate destination for the copyProjectContent action path.
    const destinationProjectId = await ctx.db.insert("projects", {
      title: "Alloy fatigue PD (copy)",
      clientName: "Acme Metals",
      status: "draft",
      createdBy: ownerId,
      ownerId,
      shareToken: "ra-destination-token",
      createdAt: now,
      updatedAt: now,
    });
    const destinationTranscriptId = await ctx.db.insert("transcripts", {
      projectId: destinationProjectId,
      content: "Interview notes",
      createdAt: now,
    });

    // A project id that resolves to nothing: the NOT_FOUND control.
    const missingProjectId = await ctx.db.insert("projects", {
      title: "Deleted",
      clientName: "Deleted",
      status: "draft",
      createdBy: ownerId,
      shareToken: "ra-deleted-token",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.delete(missingProjectId);

    return {
      ownerId,
      managerId,
      adminId,
      rolelessId,
      storedAnonymousId,
      storedAnonymousRolelessId,
      projectId,
      reportId,
      proposalId,
      destinationProjectId,
      destinationTranscriptId,
      missingProjectId,
    };
  });

  return {
    t,
    ...ids,
    // No JWT at all.
    noIdentity: t,
    // Authenticated, but no `users` row maps to the subject.
    unmapped: t.withIdentity({ subject: "ra-unmapped" }),
    storedAnonymous: t.withIdentity({ subject: "ra-anonymous" }),
    storedAnonymousRoleless: t.withIdentity({
      subject: "ra-anonymous-roleless",
    }),
    roleless: t.withIdentity({ subject: "ra-roleless" }),
    owner: t.withIdentity({ subject: "ra-owner" }),
    manager: t.withIdentity({ subject: "ra-manager" }),
    admin: t.withIdentity({ subject: "ra-admin" }),
  };
}

type Fixture = Awaited<ReturnType<typeof setup>>;
type Actor = Fixture["owner"];

/**
 * Resolve a call to its typed domain-error code, or a readable marker when it
 * succeeded or threw an untyped error. Comparing codes (not message regexes)
 * keeps the matrix assertions exact.
 */
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

function rejectedActors(f: Fixture): Array<[string, Actor, string]> {
  return [
    ["no identity", f.noIdentity, "NOT_AUTHENTICATED"],
    ["unmapped identity", f.unmapped, "NOT_AUTHENTICATED"],
    ["stored anonymous with role", f.storedAnonymous, "NOT_AUTHENTICATED"],
    [
      "stored anonymous without role",
      f.storedAnonymousRoleless,
      "NOT_AUTHENTICATED",
    ],
    ["role-less", f.roleless, "NOT_AUTHORIZED"],
  ];
}

async function reportRow(f: Fixture) {
  return await f.t.run((ctx) => ctx.db.get(f.reportId));
}

async function proposalRow(f: Fixture) {
  return await f.t.run((ctx) => ctx.db.get(f.proposalId));
}

async function snapshotIds(f: Fixture): Promise<Id<"reportSnapshots">[]> {
  const snaps = await f.t.run((ctx) =>
    ctx.db
      .query("reportSnapshots")
      .withIndex("by_reportId", (q) => q.eq("reportId", f.reportId))
      .collect()
  );
  return snaps.map((snapshot) => snapshot._id);
}

describe("requireInternalProjectAccess eligibility parity", () => {
  it("rejects every actor the nullable helper refuses, with typed codes", async () => {
    const f = await setup();
    for (const [label, actor, code] of rejectedActors(f)) {
      const nullable = await actor.run((ctx) =>
        getInternalProjectAccessOrNull(ctx, f.projectId)
      );
      expect(nullable, `${label}: nullable helper`).toBeNull();
      expect(
        await errorCode(() =>
          actor.run((ctx) => requireInternalProjectAccess(ctx, f.projectId))
        ),
        `${label}: throwing helper`
      ).toBe(code);
    }
  });

  it("returns the same project and user for every internal role", async () => {
    const f = await setup();
    const eligible: Array<[string, Actor, Id<"users">]> = [
      ["writer", f.owner, f.ownerId],
      ["manager", f.manager, f.managerId],
      ["admin", f.admin, f.adminId],
    ];
    for (const [label, actor, userId] of eligible) {
      const nullable = await actor.run((ctx) =>
        getInternalProjectAccessOrNull(ctx, f.projectId)
      );
      const required = await actor.run((ctx) =>
        requireInternalProjectAccess(ctx, f.projectId)
      );
      expect(nullable, `${label}: nullable helper`).not.toBeNull();
      expect(required.user._id, `${label}: user`).toBe(userId);
      expect(required.project._id, `${label}: project`).toBe(f.projectId);
      expect(required, `${label}: parity`).toEqual(nullable);
    }
  });

  it("preserves NOT_FOUND for an eligible actor and a missing project", async () => {
    const f = await setup();
    expect(
      await f.owner.run((ctx) =>
        getInternalProjectAccessOrNull(ctx, f.missingProjectId)
      )
    ).toBeNull();
    expect(
      await errorCode(() =>
        f.owner.run((ctx) =>
          requireInternalProjectAccess(ctx, f.missingProjectId)
        )
      )
    ).toBe("NOT_FOUND");
  });

  it("rejects an ineligible actor before it can probe project existence", async () => {
    const f = await setup();
    // Same code for a real and a deleted project: existence never leaks.
    for (const [label, actor, code] of rejectedActors(f)) {
      expect(
        await errorCode(() =>
          actor.run((ctx) =>
            requireInternalProjectAccess(ctx, f.missingProjectId)
          )
        ),
        `${label}: missing project`
      ).toBe(code);
    }
  });
});

describe("updateReportContent write boundary", () => {
  it("rejects ineligible actors and writes nothing", async () => {
    const f = await setup();
    const before = await reportRow(f);
    const beforeSnapshots = await snapshotIds(f);
    for (const [label, actor, code] of rejectedActors(f)) {
      expect(
        await errorCode(() =>
          actor.mutation(api.reports.updateReportContent, {
            reportId: f.reportId,
            content: EDITED_DOC,
            expectedRevisionNumber: 0,
          })
        ),
        label
      ).toBe(code);
      expect(await reportRow(f), `${label}: report row`).toEqual(before);
      expect(await snapshotIds(f), `${label}: snapshots`).toEqual(
        beforeSnapshots
      );
    }
  });

  it("still lets an eligible owner and elevated roles save", async () => {
    const f = await setup();
    expect(
      await f.owner.mutation(api.reports.updateReportContent, {
        reportId: f.reportId,
        content: EDITED_DOC,
        expectedRevisionNumber: 0,
      })
    ).toBe(1);
    expect(
      await f.manager.mutation(api.reports.updateReportContent, {
        reportId: f.reportId,
        content: REPORT_DOC,
        expectedRevisionNumber: 1,
      })
    ).toBe(2);
    expect(
      await f.admin.mutation(api.reports.updateReportContent, {
        reportId: f.reportId,
        content: EDITED_DOC,
        expectedRevisionNumber: 2,
      })
    ).toBe(3);
    const report = await reportRow(f);
    expect(report?.content).toBe(EDITED_DOC);
    expect(report?.revisionNumber).toBe(3);
  });

  it("keeps existing validation ahead of the tightened gate", async () => {
    const f = await setup();
    // Object-level rules still apply to an eligible actor.
    expect(
      await errorCode(() =>
        f.owner.mutation(api.reports.updateReportContent, {
          reportId: f.reportId,
          content: EDITED_DOC,
          expectedRevisionNumber: 7,
        })
      )
    ).toBe("STALE_REVISION");
    // A report id that resolves to nothing is still NOT_FOUND, before access.
    const missingReportId = await f.t.run(async (ctx) => {
      const id = await ctx.db.insert("reports", {
        projectId: f.projectId,
        content: REPORT_DOC,
        version: 1,
        generatedAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.delete(id);
      return id;
    });
    expect(
      await errorCode(() =>
        f.owner.mutation(api.reports.updateReportContent, {
          reportId: missingReportId,
          content: EDITED_DOC,
          expectedRevisionNumber: 0,
        })
      )
    ).toBe("NOT_FOUND");
  });
});

describe("applyProposal write boundary", () => {
  it("rejects ineligible actors and writes nothing", async () => {
    const f = await setup();
    const beforeReport = await reportRow(f);
    const beforeProposal = await proposalRow(f);
    const beforeSnapshots = await snapshotIds(f);
    for (const [label, actor, code] of rejectedActors(f)) {
      expect(
        await errorCode(() =>
          actor.mutation(api.chatV2.applyProposal, { proposalId: f.proposalId })
        ),
        label
      ).toBe(code);
      expect(await reportRow(f), `${label}: report row`).toEqual(beforeReport);
      expect(await proposalRow(f), `${label}: proposal row`).toEqual(
        beforeProposal
      );
      expect(await snapshotIds(f), `${label}: snapshots`).toEqual(
        beforeSnapshots
      );
    }
  });

  it("still applies for an eligible owner, with the snapshot and revision bump", async () => {
    const f = await setup();
    const beforeSnapshots = await snapshotIds(f);
    const result = await f.owner.mutation(api.chatV2.applyProposal, {
      proposalId: f.proposalId,
    });
    expect(result).toMatchObject({ applied: true, count: 1 });
    const report = await reportRow(f);
    expect(report?.content).toContain("measured the alloy");
    expect(report?.revisionNumber).toBe(1);
    expect((await proposalRow(f))?.state).toBe("applied");
    expect((await snapshotIds(f)).length).toBe(beforeSnapshots.length + 1);
  });

  it("still applies for an elevated actor who is not the project owner", async () => {
    const f = await setup();
    const result = await f.admin.mutation(api.chatV2.applyProposal, {
      proposalId: f.proposalId,
    });
    expect(result).toMatchObject({ applied: true, count: 1 });
  });
});

describe("inherited query and action blast radius", () => {
  it("rejects ineligible actors on inherited queries", async () => {
    const f = await setup();
    for (const [label, actor, code] of rejectedActors(f)) {
      expect(
        await errorCode(() =>
          actor.query(api.chatV2.listMessages, {
            threadId: "ra-thread",
            paginationOpts: { numItems: 10, cursor: null },
          })
        ),
        `${label}: listMessages`
      ).toBe(code);
      expect(
        await errorCode(() =>
          actor.query(api.projectEvidence.getReadiness, {
            projectId: f.projectId,
          })
        ),
        `${label}: getReadiness`
      ).toBe(code);
      expect(
        await errorCode(() =>
          actor.query(api.reports.preflightExport, { reportId: f.reportId })
        ),
        `${label}: preflightExport`
      ).toBe(code);
      expect(
        await errorCode(() =>
          actor.query(api.reviews.getMyQaItemFeedback, {
            target: { reportId: f.reportId },
          })
        ),
        `${label}: getMyQaItemFeedback`
      ).toBe(code);
    }
  });

  it("rejects ineligible actors on inherited actions", async () => {
    const f = await setup();
    const destinationDocuments = async () =>
      await f.t.run((ctx) =>
        ctx.db
          .query("projectDocuments")
          .withIndex("by_projectId", (q) =>
            q.eq("projectId", f.destinationProjectId)
          )
          .collect()
      );
    const projectCount = async () =>
      (await f.t.run((ctx) => ctx.db.query("projects").take(50))).length;
    const beforeProjects = await projectCount();
    expect(await destinationDocuments()).toEqual([]);

    for (const [label, actor, code] of rejectedActors(f)) {
      expect(
        await errorCode(() =>
          actor.action(api.projectDuplication.copyProjectContent, {
            fromProjectId: f.projectId,
            toProjectId: f.destinationProjectId,
            targetTranscriptId: f.destinationTranscriptId,
          })
        ),
        `${label}: copyProjectContent`
      ).toBe(code);
      expect(
        await errorCode(() =>
          actor.action(api.reviewFromProject.createReviewFromProject, {
            projectId: f.projectId,
          })
        ),
        `${label}: createReviewFromProject`
      ).toBe(code);
      expect(await destinationDocuments(), `${label}: copied rows`).toEqual([]);
      expect(await projectCount(), `${label}: project count`).toBe(
        beforeProjects
      );
    }
  });

  it("still serves eligible actors on the inherited read paths", async () => {
    const f = await setup();
    const readiness = await f.owner.query(api.projectEvidence.getReadiness, {
      projectId: f.projectId,
    });
    expect(readiness.ready).toBe(false);
    expect(Array.isArray(readiness.blockers)).toBe(true);

    const preflight = await f.manager.query(api.reports.preflightExport, {
      reportId: f.reportId,
    });
    expect(preflight.reportId).toBe(f.reportId);

    expect(
      await f.admin.query(api.reviews.getMyQaItemFeedback, {
        target: { reportId: f.reportId },
      })
    ).toEqual([]);
  });

  it("still copies project content for an eligible actor", async () => {
    const f = await setup();
    const result = await f.owner.action(
      api.projectDuplication.copyProjectContent,
      {
        fromProjectId: f.projectId,
        toProjectId: f.destinationProjectId,
        targetTranscriptId: f.destinationTranscriptId,
      }
    );
    expect(result.reportCopied).toBe(true);
  });
});
