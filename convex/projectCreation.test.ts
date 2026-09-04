/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const actors = [
  { authId: "create-writer", role: "writer" as const, firstName: "Writer" },
  { authId: "create-manager", role: "manager" as const, firstName: "Manager" },
  { authId: "create-admin", role: "admin" as const, firstName: "Admin" },
];

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const entries = await Promise.all(
      actors.map(async (actor) => [actor.authId, await ctx.db.insert("users", actor)] as const)
    );
    return Object.fromEntries(entries) as Record<(typeof actors)[number]["authId"], (typeof entries)[number][1]>;
  });
  return { t, ids };
}

describe("project creator ownership", () => {
  it("defaults every permitted project creator to themselves", async () => {
    const { t, ids } = await setup();
    for (const actor of actors) {
      const result = await t.withIdentity({ subject: actor.authId }).query(api.projectCreation.getOwnerOptions, {});
      expect(result).toMatchObject({
        requiresSelection: false,
        defaultOwnerId: ids[actor.authId],
        candidates: [expect.objectContaining({ userId: ids[actor.authId], role: actor.role })],
        truncated: false,
      });
    }
  });

  it.each(actors)("sets a $role creator as the initial Owner", async (actor) => {
    const { t, ids } = await setup();
    const caller = t.withIdentity({ subject: actor.authId });
    const result = await caller.mutation(api.projects.createProject, {
      title: `${actor.role} project`,
      clientName: "Creator-owned client",
      transcripts: [{ content: "Interview notes" }],
    });
    const stored = await t.run(async (ctx) => {
      const project = await ctx.db.get(result.projectId);
      const events = await ctx.db
        .query("projectEvents")
        .withIndex("by_projectId", (q) => q.eq("projectId", result.projectId))
        .take(10);
      return { project, events };
    });
    expect(stored.project).toMatchObject({
      ownerId: ids[actor.authId],
      createdBy: ids[actor.authId],
    });
    expect(stored.events).toContainEqual(
      expect.objectContaining({
        type: "ownership_transferred",
        actorId: ids[actor.authId],
        to: ids[actor.authId],
        note: "creation:initial-owner",
      })
    );
  });

  it("rejects a stale client trying to assign another initial Owner", async () => {
    const { t, ids } = await setup();
    await expect(
      t.withIdentity({ subject: "create-admin" }).mutation(api.projects.createProject, {
        title: "Stale admin form",
        clientName: "Creator-owned client",
        transcripts: [{ content: "Interview notes" }],
        ownerId: ids["create-manager"],
      })
    ).rejects.toThrow(/initially owned by the person creating them|NOT_AUTHORIZED/i);
  });
});
