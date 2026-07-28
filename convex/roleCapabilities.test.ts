/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { requireCapability } from "./lib/roleCapabilities";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => ({
    writerId: await ctx.db.insert("users", {
      authId: "cap-writer",
      role: "writer",
    }),
    managerId: await ctx.db.insert("users", {
      authId: "cap-manager",
      role: "manager",
    }),
    adminId: await ctx.db.insert("users", {
      authId: "cap-admin",
      role: "admin",
    }),
    noRoleId: await ctx.db.insert("users", { authId: "cap-no-role" }),
  }));
  return { t, ...ids };
}

function identityFor(role: "writer" | "manager" | "admin" | "no-role") {
  return { subject: `cap-${role}` };
}

describe("server capability enforcement", () => {
  it("returns typed authentication and permission errors", async () => {
    const { t } = await setup();
    await expect(
      t.run(async (ctx) => requireCapability(ctx, "project.create"))
    ).rejects.toThrow(/NOT_AUTHENTICATED|Authentication required/i);
    await expect(
      t.withIdentity(identityFor("writer")).run(async (ctx) =>
        requireCapability(ctx, "roles.manage")
      )
    ).rejects.toThrow(/NOT_AUTHORIZED|permission/i);
  });

  it("allows all-level capabilities without object scope", async () => {
    const { t } = await setup();
    const result = await t.withIdentity(identityFor("manager")).run(async (ctx) =>
      requireCapability(ctx, "pipeline.view")
    );
    expect(result.level).toBe("all");
  });

  it("allows own-level capabilities only with a matching caller-supplied scope", async () => {
    const { t, writerId, managerId } = await setup();
    const allowed = await t.withIdentity(identityFor("writer")).run(async (ctx) =>
      requireCapability(ctx, "project.transferOwnership", {
        ownedBy: [writerId],
      })
    );
    expect(allowed.level).toBe("own");

    await expect(
      t.withIdentity(identityFor("writer")).run(async (ctx) =>
        requireCapability(ctx, "project.transferOwnership", {
          ownedBy: [managerId],
        })
      )
    ).rejects.toThrow(/NOT_AUTHORIZED|permission/i);
    await expect(
      t.withIdentity(identityFor("writer")).run(async (ctx) =>
        requireCapability(ctx, "project.transferOwnership")
      )
    ).rejects.toThrow(/NOT_AUTHORIZED|permission/i);
  });

  it("denies users without a stored role", async () => {
    const { t } = await setup();
    await expect(
      t.withIdentity(identityFor("no-role")).run(async (ctx) =>
        requireCapability(ctx, "project.readInternal")
      )
    ).rejects.toThrow(/NOT_AUTHORIZED|permission/i);
  });

  it("keeps the planned Financial role unstorable until PSOS-28", async () => {
    const { t } = await setup();
    await expect(
      t.run(async (ctx) =>
        // @ts-expect-error Financial is capability data only in PSOS-26.
        ctx.db.insert("users", { authId: "cap-financial", role: "financial" })
      )
    ).rejects.toThrow();
  });

  it("accepts multiple ownership facts without additional database reads", async () => {
    const { t, writerId, managerId, adminId } = await setup();
    const ownedBy: Id<"users">[] = [managerId, writerId, adminId];
    const result = await t.withIdentity(identityFor("writer")).run(async (ctx) =>
      requireCapability(ctx, "workItem.cancelOrReassign", { ownedBy })
    );
    expect(result.user._id).toBe(writerId);
  });
});
