/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// Audit CAP-1: requireInternalProjectAccess must reject anonymous auth
// records and role-less users the same way getInternalProjectAccessOrNull does.
const authIds = {
  writer: "auth-authz-writer",
  manager: "auth-authz-manager",
  anonymous: "auth-authz-anonymous",
  roleless: "auth-authz-roleless",
} as const;

type Actor = keyof typeof authIds;

const TARGET = "exact target";
const REPLACEMENT = "approved replacement";
const reportContent = JSON.stringify({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: `Replace the ${TARGET} here.` }],
    },
  ],
});

async function setup() {
  const t = convexTest(schema, modules);
  // chatV2.ts imports @convex-dev/agent, so the agent component must be
  // registered for applyProposal to load; updateReportContent does not need it.
  agentTest.register(t);
  const ids = await t.run(async (ctx) => {
    const writerId = await ctx.db.insert("users", {
      authId: authIds.writer,
      role: "writer",
    });
    // Explicit isAnonymous: false with an elevated role must still pass, so a
    // future `isAnonymous !== false` reading of the gate would be caught.
    await ctx.db.insert("users", {
      authId: authIds.manager,
      role: "manager",
      isAnonymous: false,
    });
    // Anonymous fixture deliberately carries a role: proves isAnonymous wins
    // over a present role (mirrors the comment in requireRole).
    await ctx.db.insert("users", {
      authId: authIds.anonymous,
      role: "writer",
      isAnonymous: true,
    });
    await ctx.db.insert("users", { authId: authIds.roleless });
    const now = Date.now();
    const projectId = await ctx.db.insert("projects", {
      title: "Authz project",
      clientName: "Client",
      status: "review",
      createdBy: writerId,
      shareToken: "authz-project-token",
      createdAt: now,
      updatedAt: now,
    });
    const reportId = await ctx.db.insert("reports", {
      projectId,
      content: reportContent,
      version: 1,
      revisionNumber: 3,
      generatedAt: now,
      updatedAt: now,
    });
    const proposalId = await ctx.db.insert("chatProposals", {
      agentThreadId: "thread-authz",
      projectId,
      reportId,
      kind: "edit",
      targetText: TARGET,
      newText: REPLACEMENT,
      state: "pending",
      createdAt: now,
    });
    return { writerId, projectId, reportId, proposalId };
  });
  return { t, ...ids };
}

type Setup = Awaited<ReturnType<typeof setup>>;

function asActor(t: Setup["t"], actor: Actor) {
  return t.withIdentity({ subject: authIds[actor] });
}

async function errorCode(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(ConvexError);
    return (err as ConvexError<{ code: string }>).data.code;
  }
  throw new Error("expected the call to reject");
}

async function getReport(t: Setup["t"], reportId: Id<"reports">) {
  return await t.run(async (ctx) => ctx.db.get(reportId));
}

async function getProposal(t: Setup["t"], proposalId: Id<"chatProposals">) {
  return await t.run(async (ctx) => ctx.db.get(proposalId));
}

describe("updateReportContent internal access gate", () => {
  test("a role-holding writer edits the report and bumps the revision", async () => {
    const { t, reportId } = await setup();
    const next = await asActor(t, "writer").mutation(
      api.reports.updateReportContent,
      { reportId, content: "Edited by writer", expectedRevisionNumber: 3 }
    );
    expect(next).toBe(4);
    const report = await getReport(t, reportId);
    expect(report?.content).toBe("Edited by writer");
    expect(report?.revisionNumber).toBe(4);
  });

  test("a manager with explicit isAnonymous: false also passes the gate", async () => {
    const { t, reportId } = await setup();
    const next = await asActor(t, "manager").mutation(
      api.reports.updateReportContent,
      { reportId, content: "Edited by manager", expectedRevisionNumber: 3 }
    );
    expect(next).toBe(4);
    expect((await getReport(t, reportId))?.content).toBe("Edited by manager");
  });

  test("an anonymous auth record is rejected with NOT_AUTHORIZED", async () => {
    const { t, reportId } = await setup();
    const code = await errorCode(
      asActor(t, "anonymous").mutation(api.reports.updateReportContent, {
        reportId,
        content: "Anonymous edit",
        expectedRevisionNumber: 3,
      })
    );
    expect(code).toBe("NOT_AUTHORIZED");
    const report = await getReport(t, reportId);
    expect(report?.content).toBe(reportContent);
    expect(report?.revisionNumber).toBe(3);
  });

  test("a role-less user is rejected with NOT_AUTHORIZED", async () => {
    const { t, reportId } = await setup();
    const code = await errorCode(
      asActor(t, "roleless").mutation(api.reports.updateReportContent, {
        reportId,
        content: "Role-less edit",
        expectedRevisionNumber: 3,
      })
    );
    expect(code).toBe("NOT_AUTHORIZED");
    const report = await getReport(t, reportId);
    expect(report?.content).toBe(reportContent);
    expect(report?.revisionNumber).toBe(3);
  });

  test("no identity is rejected with NOT_AUTHENTICATED", async () => {
    const { t, reportId } = await setup();
    const code = await errorCode(
      t.mutation(api.reports.updateReportContent, {
        reportId,
        content: "Unauthenticated edit",
        expectedRevisionNumber: 3,
      })
    );
    expect(code).toBe("NOT_AUTHENTICATED");
    const report = await getReport(t, reportId);
    expect(report?.content).toBe(reportContent);
    expect(report?.revisionNumber).toBe(3);
  });

  test("a role holder whose project was deleted gets NOT_FOUND", async () => {
    const { t, projectId, reportId } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.delete(projectId);
    });
    const code = await errorCode(
      asActor(t, "writer").mutation(api.reports.updateReportContent, {
        reportId,
        content: "Orphaned edit",
        expectedRevisionNumber: 3,
      })
    );
    expect(code).toBe("NOT_FOUND");
    const report = await getReport(t, reportId);
    expect(report?.content).toBe(reportContent);
    expect(report?.revisionNumber).toBe(3);
  });

  test("the role gate runs before the project lookup: anonymous + deleted project is NOT_AUTHORIZED", async () => {
    const { t, projectId, reportId } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.delete(projectId);
    });
    const code = await errorCode(
      asActor(t, "anonymous").mutation(api.reports.updateReportContent, {
        reportId,
        content: "Orphaned anonymous edit",
        expectedRevisionNumber: 3,
      })
    );
    expect(code).toBe("NOT_AUTHORIZED");
  });
});

describe("applyProposal internal access gate", () => {
  test("a role-holding writer applies a pending edit proposal", async () => {
    const { t, reportId, proposalId } = await setup();
    const result = await asActor(t, "writer").mutation(
      api.chatV2.applyProposal,
      { proposalId }
    );
    expect(result).toMatchObject({ applied: true, count: 1 });
    const report = await getReport(t, reportId);
    expect(report?.content).toContain(REPLACEMENT);
    expect(report?.content).not.toContain(TARGET);
    expect(report?.revisionNumber).toBe(4);
    expect((await getProposal(t, proposalId))?.state).toBe("applied");
  });

  test("a role holder whose project was deleted gets NOT_FOUND", async () => {
    const { t, projectId, proposalId } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.delete(projectId);
    });
    const code = await errorCode(
      asActor(t, "writer").mutation(api.chatV2.applyProposal, { proposalId })
    );
    expect(code).toBe("NOT_FOUND");
    expect((await getProposal(t, proposalId))?.state).toBe("pending");
  });

  test("an anonymous auth record cannot apply and the proposal stays pending", async () => {
    const { t, reportId, proposalId } = await setup();
    const code = await errorCode(
      asActor(t, "anonymous").mutation(api.chatV2.applyProposal, { proposalId })
    );
    expect(code).toBe("NOT_AUTHORIZED");
    const report = await getReport(t, reportId);
    expect(report?.content).toBe(reportContent);
    expect(report?.revisionNumber).toBe(3);
    expect((await getProposal(t, proposalId))?.state).toBe("pending");
  });

  test("a role-less user cannot apply and the proposal stays pending", async () => {
    const { t, reportId, proposalId } = await setup();
    const code = await errorCode(
      asActor(t, "roleless").mutation(api.chatV2.applyProposal, { proposalId })
    );
    expect(code).toBe("NOT_AUTHORIZED");
    const report = await getReport(t, reportId);
    expect(report?.content).toBe(reportContent);
    expect(report?.revisionNumber).toBe(3);
    expect((await getProposal(t, proposalId))?.state).toBe("pending");
  });
});
