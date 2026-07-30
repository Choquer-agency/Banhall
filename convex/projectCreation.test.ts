/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("project creation owner options", () => {
  it("defaults Consultants and Managers to themselves and requires Admin selection", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => ({
      writerId: await ctx.db.insert("users", { authId: "create-writer", role: "writer", firstName: "Writer" }),
      managerId: await ctx.db.insert("users", { authId: "create-manager", role: "manager", firstName: "Manager" }),
      adminId: await ctx.db.insert("users", { authId: "create-admin", role: "admin", firstName: "Admin" }),
    }));
    const writer = await t.withIdentity({ subject: "create-writer" }).query(api.projectCreation.getOwnerOptions, {});
    expect(writer).toMatchObject({ requiresSelection: false, defaultOwnerId: ids.writerId });
    const manager = await t.withIdentity({ subject: "create-manager" }).query(api.projectCreation.getOwnerOptions, {});
    expect(manager).toMatchObject({ requiresSelection: false, defaultOwnerId: ids.managerId });
    const admin = await t.withIdentity({ subject: "create-admin" }).query(api.projectCreation.getOwnerOptions, {});
    expect(admin).toMatchObject({ requiresSelection: true, defaultOwnerId: null });
    expect(admin.candidates.map((candidate) => candidate.userId)).toEqual(expect.arrayContaining([ids.writerId, ids.managerId]));
    expect(admin.candidates.map((candidate) => candidate.userId)).not.toContain(ids.adminId);
  });
});
