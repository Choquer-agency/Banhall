/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { MAX_PROJECT_STARS, PROJECT_STAR_LIMIT_MESSAGE } from "../shared/projectStars";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");

// 2026-11-02: a person's private star on a project (setProjectStar,
// isProjectStarred, dashboard.listStarredProjects).

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = 1_000;
    const writerId = await ctx.db.insert("users", { authId: "star-writer", role: "writer", firstName: "Wren" });
    const otherId = await ctx.db.insert("users", { authId: "star-other", role: "manager", firstName: "Mo" });
    await ctx.db.insert("users", { authId: "star-anon", role: "writer", isAnonymous: true });
    await ctx.db.insert("users", { authId: "star-roleless", firstName: "Rory" });
    const base = { clientName: "Acme", status: "draft" as const, createdBy: writerId, ownerId: writerId, createdAt: now, updatedAt: now };
    const firstId = await ctx.db.insert("projects", { ...base, title: "First", shareToken: "star-1" });
    const secondId = await ctx.db.insert("projects", { ...base, title: "Second", shareToken: "star-2" });
    const deletingId = await ctx.db.insert("projects", { ...base, title: "Deleting", shareToken: "star-3", deletionStartedAt: now });
    return { writerId, otherId, firstId, secondId, deletingId };
  });
  return {
    t,
    ...ids,
    writer: t.withIdentity({ subject: "star-writer" }),
    other: t.withIdentity({ subject: "star-other" }),
    anon: t.withIdentity({ subject: "star-anon" }),
    roleless: t.withIdentity({ subject: "star-roleless" }),
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function starRows(s: Setup) {
  return await s.t.run((ctx) => ctx.db.query("projectStars").collect());
}

describe("project stars", () => {
  it("stars and unstars a project, idempotently, one row per person and project", async () => {
    const s = await setup();
    expect(await s.writer.query(api.projects.isProjectStarred, { projectId: s.firstId })).toBe(false);

    expect(await s.writer.mutation(api.projects.setProjectStar, { projectId: s.firstId, starred: true })).toEqual({ starred: true });
    expect(await s.writer.mutation(api.projects.setProjectStar, { projectId: s.firstId, starred: true })).toEqual({ starred: true });
    expect(await starRows(s)).toHaveLength(1);
    expect(await s.writer.query(api.projects.isProjectStarred, { projectId: s.firstId })).toBe(true);

    expect(await s.writer.mutation(api.projects.setProjectStar, { projectId: s.firstId, starred: false })).toEqual({ starred: false });
    expect(await s.writer.mutation(api.projects.setProjectStar, { projectId: s.firstId, starred: false })).toEqual({ starred: false });
    expect(await starRows(s)).toHaveLength(0);
    expect(await s.writer.query(api.projects.isProjectStarred, { projectId: s.firstId })).toBe(false);
  });

  it("keeps a star private to its owner", async () => {
    const s = await setup();
    await s.writer.mutation(api.projects.setProjectStar, { projectId: s.firstId, starred: true });
    expect(await s.other.query(api.projects.isProjectStarred, { projectId: s.firstId })).toBe(false);
    expect(await s.other.query(api.dashboard.listStarredProjects, {})).toEqual([]);
    // Another person's unstar removes only their own (absent) row.
    await s.other.mutation(api.projects.setProjectStar, { projectId: s.firstId, starred: false });
    expect(await s.writer.query(api.projects.isProjectStarred, { projectId: s.firstId })).toBe(true);
    // Both may star the same project.
    await s.other.mutation(api.projects.setProjectStar, { projectId: s.firstId, starred: true });
    expect((await starRows(s)).map((row) => row.userId).sort()).toEqual([s.writerId, s.otherId].sort());
  });

  it("lists the caller's starred projects, newest star first, as dashboard rows", async () => {
    const s = await setup();
    await s.writer.mutation(api.projects.setProjectStar, { projectId: s.firstId, starred: true });
    // Stars made in the same millisecond keep insertion order; make the second clearly later.
    await s.t.run(async (ctx) => {
      await ctx.db.insert("projectStars", { userId: s.writerId, projectId: s.secondId, createdAt: Date.now() + 10_000 });
    });
    const rows = await s.writer.query(api.dashboard.listStarredProjects, {});
    expect(rows.map((row) => row.title)).toEqual(["Second", "First"]);
    expect(rows[0]).toMatchObject({ _id: s.secondId, clientName: "Acme", ownerLabel: "Wren" });
  });

  it("leaves out projects that are being deleted, and lets their star be removed", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      await ctx.db.insert("projectStars", { userId: s.writerId, projectId: s.deletingId, createdAt: 5 });
    });
    expect(await s.writer.query(api.dashboard.listStarredProjects, {})).toEqual([]);
    expect(await s.writer.query(api.projects.isProjectStarred, { projectId: s.deletingId })).toBe(false);
    await expect(
      s.writer.mutation(api.projects.setProjectStar, { projectId: s.deletingId, starred: true })
    ).rejects.toThrow(/being deleted/);
    await s.writer.mutation(api.projects.setProjectStar, { projectId: s.deletingId, starred: false });
    expect(await starRows(s)).toHaveLength(0);
  });

  it("refuses callers without project access and returns nothing to them", async () => {
    const s = await setup();
    for (const caller of [s.anon, s.roleless]) {
      await expect(caller.mutation(api.projects.setProjectStar, { projectId: s.firstId, starred: true })).rejects.toThrow();
      expect(await caller.query(api.projects.isProjectStarred, { projectId: s.firstId })).toBe(false);
      expect(await caller.query(api.dashboard.listStarredProjects, {})).toEqual([]);
    }
    await expect(s.t.mutation(api.projects.setProjectStar, { projectId: s.firstId, starred: true })).rejects.toThrow();
    expect(await starRows(s)).toHaveLength(0);
  });

  it("refuses a star past the limit with a plain message", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      for (let index = 0; index < MAX_PROJECT_STARS; index += 1) {
        const projectId: Id<"projects"> = await ctx.db.insert("projects", {
          title: `P${index}`, clientName: "Acme", status: "draft", createdBy: s.writerId, shareToken: `star-limit-${index}`, createdAt: 1, updatedAt: 1,
        });
        await ctx.db.insert("projectStars", { userId: s.writerId, projectId, createdAt: index });
      }
    });
    await expect(
      s.writer.mutation(api.projects.setProjectStar, { projectId: s.firstId, starred: true })
    ).rejects.toThrow(PROJECT_STAR_LIMIT_MESSAGE);
    // Another person is not affected by one person's limit.
    await s.other.mutation(api.projects.setProjectStar, { projectId: s.firstId, starred: true });
  });
});
