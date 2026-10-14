/// <reference types="vite/client" />
/**
 * 2026-10-14 amendment: bulkUpdateProjects gains industry and science code.
 * Validation mirrors updateProjectIndustry / updateProjectScienceCode; the
 * 2026-09-15 scope (Consultants change only projects they own, others are
 * skipped, 200 at most) is unchanged.
 */
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const authIds = {
  owner: "bf-owner",
  writer: "bf-writer",
  manager: "bf-manager",
  admin: "bf-admin",
} as const;

type Actor = keyof typeof authIds;

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { authId: authIds.owner, role: "writer" });
    const writerId = await ctx.db.insert("users", { authId: authIds.writer, role: "writer" });
    await ctx.db.insert("users", { authId: authIds.manager, role: "manager" });
    await ctx.db.insert("users", { authId: authIds.admin, role: "admin" });
    const now = Date.now();
    const projectId = await ctx.db.insert("projects", {
      title: "Owner project",
      clientName: "Client",
      status: "review",
      createdBy: ownerId,
      ownerId,
      shareToken: "bf-owner-project",
      createdAt: now,
      updatedAt: now,
    });
    const otherProjectId = await ctx.db.insert("projects", {
      title: "Other project",
      clientName: "Other client",
      status: "review",
      createdBy: writerId,
      ownerId: writerId,
      shareToken: "bf-other-project",
      createdAt: now,
      updatedAt: now,
    });
    return { projectId, otherProjectId };
  });
  return { t, ...ids };
}

type Setup = Awaited<ReturnType<typeof setup>>;

function asActor(t: Setup["t"], actor: Actor) {
  return t.withIdentity({ subject: authIds[actor] });
}

async function getProject(t: Setup["t"], projectId: Id<"projects">) {
  return await t.run(async (ctx) => await ctx.db.get(projectId));
}

describe("bulk edit of industry and science code", () => {
  test("sets both across the selection and refreshes the search projection", async () => {
    const { t, projectId, otherProjectId } = await setup();

    const result = await asActor(t, "manager").mutation(api.projects.bulkUpdateProjects, {
      projectIds: [projectId, otherProjectId],
      industry: "Life Sciences",
      scienceCode: " 1.02.01 ",
    });

    expect(result).toEqual({ updated: 2, skipped: 0 });
    for (const id of [projectId, otherProjectId]) {
      const project = await getProject(t, id);
      expect(project).toMatchObject({ industry: "life-sciences", scienceCode: "1.02.01" });
      expect(project?.dashboardSearchText).toContain("1.02.01");
      expect(project?.dashboardSearchText).toContain("life-sciences");
    }
  });

  test("null or an empty value clears them; omitted leaves them", async () => {
    const { t, projectId } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.patch(projectId, { industry: "software", scienceCode: "1.02.01" });
    });

    await asActor(t, "owner").mutation(api.projects.bulkUpdateProjects, {
      projectIds: [projectId],
      clientName: "Kept Fields Co",
    });
    await expect(getProject(t, projectId)).resolves.toMatchObject({
      industry: "software",
      scienceCode: "1.02.01",
    });

    await asActor(t, "owner").mutation(api.projects.bulkUpdateProjects, {
      projectIds: [projectId],
      industry: null,
      scienceCode: "",
    });
    const cleared = await getProject(t, projectId);
    expect(cleared).not.toHaveProperty("industry");
    expect(cleared).not.toHaveProperty("scienceCode");

    await t.run(async (ctx) => {
      await ctx.db.patch(projectId, { industry: "software", scienceCode: "1.02.01" });
    });
    await asActor(t, "owner").mutation(api.projects.bulkUpdateProjects, {
      projectIds: [projectId],
      industry: "  ",
      scienceCode: null,
    });
    const clearedAgain = await getProject(t, projectId);
    expect(clearedAgain).not.toHaveProperty("industry");
    expect(clearedAgain).not.toHaveProperty("scienceCode");
  });

  test("an industry or science code alone is enough to update", async () => {
    const { t, projectId } = await setup();
    await expect(
      asActor(t, "owner").mutation(api.projects.bulkUpdateProjects, {
        projectIds: [projectId],
        scienceCode: "1.02.01",
      })
    ).resolves.toEqual({ updated: 1, skipped: 0 });
  });

  test("validates like the single-project edits, before any write", async () => {
    const { t, projectId } = await setup();
    const before = await getProject(t, projectId);

    await expect(
      asActor(t, "owner").mutation(api.projects.bulkUpdateProjects, {
        projectIds: [projectId],
        scienceCode: "9.99.99",
      })
    ).rejects.toMatchObject({
      data: { code: "INVALID_INPUT", message: "Select a valid CRA science code" },
    });
    // A new industry is admin-only.
    await expect(
      asActor(t, "manager").mutation(api.projects.bulkUpdateProjects, {
        projectIds: [projectId],
        industry: "Aerospace",
      })
    ).rejects.toMatchObject({ data: { code: "NOT_AUTHORIZED" } });
    await expect(getProject(t, projectId)).resolves.toEqual(before);

    await asActor(t, "admin").mutation(api.projects.bulkUpdateProjects, {
      projectIds: [projectId],
      industry: "Aerospace",
    });
    await expect(getProject(t, projectId)).resolves.toMatchObject({ industry: "aerospace" });
  });

  test("a writer's edit still touches only the projects they own", async () => {
    const { t, projectId, otherProjectId } = await setup();
    const notOwned = await getProject(t, projectId);

    const result = await asActor(t, "writer").mutation(api.projects.bulkUpdateProjects, {
      projectIds: [projectId, otherProjectId],
      industry: "software",
      scienceCode: "1.02.01",
    });

    expect(result).toEqual({ updated: 1, skipped: 1 });
    await expect(getProject(t, otherProjectId)).resolves.toMatchObject({
      industry: "software",
      scienceCode: "1.02.01",
    });
    await expect(getProject(t, projectId)).resolves.toEqual(notOwned);
  });
});
