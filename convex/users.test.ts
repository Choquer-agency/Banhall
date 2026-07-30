/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("team roster access", () => {
  it("fails closed for unauthenticated, anonymous, and roleless identities", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { authId: "roster-writer", role: "writer", firstName: "Writer", email: "writer@example.com" });
      await ctx.db.insert("users", { authId: "roster-anon", role: "writer", isAnonymous: true, firstName: "Anonymous" });
      await ctx.db.insert("users", { authId: "roster-roleless", firstName: "Roleless" });
    });
    await expect(t.query(api.users.listTeam, {})).resolves.toEqual([]);
    await expect(t.withIdentity({ subject: "roster-anon" }).query(api.users.listTeam, {})).resolves.toEqual([]);
    await expect(t.withIdentity({ subject: "roster-roleless" }).query(api.users.listTeam, {})).resolves.toEqual([]);
    await expect(t.withIdentity({ subject: "roster-writer" }).query(api.users.listTeam, {})).resolves.toEqual([
      expect.objectContaining({ name: "Writer", email: "writer@example.com", role: "writer" }),
    ]);
  });
});
