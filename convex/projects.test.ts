/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const authIds = {
  owner: "auth-owner",
  writer: "auth-writer",
  manager: "auth-manager",
  admin: "auth-admin",
} as const;

type Actor = keyof typeof authIds;

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", {
      authId: authIds.owner,
      role: "writer",
    });
    const writerId = await ctx.db.insert("users", {
      authId: authIds.writer,
      role: "writer",
    });
    const managerId = await ctx.db.insert("users", {
      authId: authIds.manager,
      role: "manager",
    });
    const adminId = await ctx.db.insert("users", {
      authId: authIds.admin,
      role: "admin",
    });
    const now = Date.now();
    const projectId = await ctx.db.insert("projects", {
      title: "Owner project",
      clientName: "Client",
      status: "review",
      createdBy: ownerId,
      shareToken: "owner-project-token",
      createdAt: now,
      updatedAt: now,
    });
    const otherProjectId = await ctx.db.insert("projects", {
      title: "Other project",
      clientName: "Other client",
      status: "review",
      createdBy: writerId,
      shareToken: "other-project-token",
      createdAt: now,
      updatedAt: now,
    });
    const reportId = await ctx.db.insert("reports", {
      projectId,
      content: "Owner report",
      version: 1,
      generatedAt: now,
      updatedAt: now,
    });
    const otherReportId = await ctx.db.insert("reports", {
      projectId: otherProjectId,
      content: "Other report",
      version: 1,
      generatedAt: now,
      updatedAt: now,
    });
    return {
      ownerId,
      writerId,
      managerId,
      adminId,
      projectId,
      otherProjectId,
      reportId,
      otherReportId,
    };
  });
  return { t, ...ids };
}

function asActor(t: Awaited<ReturnType<typeof setup>>["t"], actor: Actor) {
  return t.withIdentity({ subject: authIds[actor] });
}

async function getProject(
  t: Awaited<ReturnType<typeof setup>>["t"],
  projectId: Awaited<ReturnType<typeof setup>>["projectId"]
) {
  return await t.run(async (ctx) => await ctx.db.get(projectId));
}

describe("project review publishing", () => {
  test.each([
    ["creator", "owner"],
    ["non-owner admin", "admin"],
  ] as const)("allows %s to publish a report", async (_label, actor) => {
    const { t, projectId, reportId } = await setup();

    await asActor(t, actor).mutation(api.projects.publishForReview, {
      projectId,
      reportId,
    });

    await expect(getProject(t, projectId)).resolves.toMatchObject({
      sharedReportId: reportId,
      status: "client_review",
    });
  });

  test.each([
    ["non-owner writer", "writer"],
    ["non-owner manager", "manager"],
  ] as const)("denies %s from publishing", async (_label, actor) => {
    const { t, projectId, reportId } = await setup();

    await expect(
      asActor(t, actor).mutation(api.projects.publishForReview, {
        projectId,
        reportId,
      })
    ).rejects.toMatchObject({
      data: { code: "NOT_AUTHORIZED" },
    });
    const project = await getProject(t, projectId);
    expect(project).toMatchObject({ status: "review" });
    expect(project).not.toHaveProperty("sharedReportId");
  });

  test("denies unauthenticated and unmapped identities", async () => {
    const { t, projectId, reportId } = await setup();

    await expect(
      t.mutation(api.projects.publishForReview, { projectId, reportId })
    ).rejects.toMatchObject({
      data: { code: "NOT_AUTHENTICATED" },
    });
    await expect(
      t.withIdentity({ subject: "missing-auth-id" }).mutation(
        api.projects.publishForReview,
        { projectId, reportId }
      )
    ).rejects.toMatchObject({
      data: { code: "NOT_AUTHENTICATED" },
    });
    const project = await getProject(t, projectId);
    expect(project).toMatchObject({ status: "review" });
    expect(project).not.toHaveProperty("sharedReportId");
  });

  test.each([
    ["creator", "owner"],
    ["non-owner admin", "admin"],
  ] as const)("rejects another project's report for %s", async (_label, actor) => {
    const { t, projectId, otherReportId } = await setup();

    await expect(
      asActor(t, actor).mutation(api.projects.publishForReview, {
        projectId,
        reportId: otherReportId,
      })
    ).rejects.toMatchObject({
      data: { code: "NOT_AUTHORIZED" },
    });
    const project = await getProject(t, projectId);
    expect(project).toMatchObject({ status: "review" });
    expect(project).not.toHaveProperty("sharedReportId");
  });
});

describe("project review unpublishing", () => {
  test.each([
    ["creator", "owner"],
    ["non-owner admin", "admin"],
  ] as const)("allows %s to unpublish a report", async (_label, actor) => {
    const { t, projectId, reportId } = await setup();
    await asActor(t, "owner").mutation(api.projects.publishForReview, {
      projectId,
      reportId,
    });

    await asActor(t, actor).mutation(api.projects.unpublishReview, {
      projectId,
    });

    const project = await getProject(t, projectId);
    expect(project).toMatchObject({ status: "review" });
    expect(project).not.toHaveProperty("sharedReportId");
  });

  test.each([
    ["non-owner writer", "writer"],
    ["non-owner manager", "manager"],
  ] as const)("denies %s from unpublishing", async (_label, actor) => {
    const { t, projectId, reportId } = await setup();
    await asActor(t, "owner").mutation(api.projects.publishForReview, {
      projectId,
      reportId,
    });

    await expect(
      asActor(t, actor).mutation(api.projects.unpublishReview, { projectId })
    ).rejects.toMatchObject({
      data: { code: "NOT_AUTHORIZED" },
    });
    await expect(getProject(t, projectId)).resolves.toMatchObject({
      status: "client_review",
      sharedReportId: reportId,
    });
  });
});
