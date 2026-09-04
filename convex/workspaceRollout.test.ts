/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  const writerId = await t.run(async (ctx) => {
    await ctx.db.insert("users", { authId: "ws-admin", role: "admin", firstName: "Admin" });
    await ctx.db.insert("users", { authId: "ws-manager", role: "manager", firstName: "Manager" });
    await ctx.db.insert("users", { authId: "ws-roleless", firstName: "NoRole" });
    await ctx.db.insert("users", { authId: "ws-anon", role: "writer", isAnonymous: true });
    return await ctx.db.insert("users", { authId: "ws-writer", role: "writer", firstName: "Writer" });
  });
  return {
    t,
    writerId,
    admin: t.withIdentity({ subject: "ws-admin" }),
    writer: t.withIdentity({ subject: "ws-writer" }),
    manager: t.withIdentity({ subject: "ws-manager" }),
    roleless: t.withIdentity({ subject: "ws-roleless" }),
    anonymous: t.withIdentity({ subject: "ws-anon" }),
  };
}

describe("workspace dashboard exposure", () => {
  it.each(["admin", "writer", "manager"] as const)(
    "gives the preview to a signed-in %s with no rollout configuration",
    async (role) => {
      const f = await setup();
      expect(await f[role].query(api.workspaceRollout.getAccess, {})).toEqual({ available: true });
    }
  );

  it("denies unauthenticated, anonymous, and roleless callers", async () => {
    const f = await setup();
    await expect(f.t.query(api.workspaceRollout.getAccess, {})).rejects.toThrow(/authentication/i);
    await expect(f.anonymous.query(api.workspaceRollout.getAccess, {})).rejects.toThrow(/authentication/i);
    await expect(f.roleless.query(api.workspaceRollout.getAccess, {})).rejects.toThrow(/internal role/i);
  });

  it("ignores leftover rollout rows: a disabled access row no longer withholds the preview", async () => {
    const f = await setup();
    await f.t.run(async (ctx) => {
      await ctx.db.insert("workspaceDashboardAccess", {
        userId: f.writerId,
        enabled: false,
        updatedBy: f.writerId,
        updatedAt: Date.now(),
        version: 1,
      });
    });
    expect(await f.writer.query(api.workspaceRollout.getAccess, {})).toEqual({ available: true });
  });
});
