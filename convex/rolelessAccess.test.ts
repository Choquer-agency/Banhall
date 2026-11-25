/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// Security wave 1 (audit 2026-09-25, a2 P3-3) + 2026-11-21 owner-approved
// amendment: a signed-in account with no internal role, or a stored anonymous
// record, is not an internal user. Internal project, industry, view, feature
// request, changelog, writing-mode and tag reads refuse them, and listProjects
// omits shareToken so client review links are not broadcast on list queries.

async function setup() {
  const t = convexTest(schema, modules);
  const { sourceId, projectId, reportId, featureRequestId } = await t.run(async (ctx) => {
    const writerId = await ctx.db.insert("users", { authId: "rl-writer", role: "writer" });
    await ctx.db.insert("users", { authId: "rl-roleless" });
    await ctx.db.insert("users", { authId: "rl-anon-admin", role: "admin", isAnonymous: true });
    const sourceId = await ctx.db.insert("brainSources", {
      kind: "pd_pair", status: "approved", title: "Source", industry: "test", writerTier: 1,
      docType: "pd", content: "text", ragKey: "rk", sourceHash: "hash", createdBy: "x", createdAt: 1,
    });
    const projectId = await ctx.db.insert("projects", {
      title: "Secret Project",
      clientName: "Acme Corp",
      industry: "Manufacturing",
      status: "draft",
      createdBy: writerId,
      ownerId: writerId,
      shareToken: "secret-client-token-123",
      createdAt: 1,
      updatedAt: 1,
    });
    const reportId = await ctx.db.insert("reports", {
      projectId,
      content: "Report",
      version: 1,
      generatedAt: 1,
      updatedAt: 1,
    });
    const featureRequestId = await ctx.db.insert("errorReports", {
      kind: "manual",
      reportType: "feature",
      message: "Add keyboard shortcut",
      url: "https://app.banhall.com/projects",
      breadcrumbs: [],
      status: "open",
      createdAt: 1,
    });
    return { sourceId, projectId, reportId, featureRequestId };
  });
  return {
    t,
    sourceId,
    projectId,
    reportId,
    featureRequestId,
    writer: t.withIdentity({ subject: "rl-writer" }),
    roleless: t.withIdentity({ subject: "rl-roleless" }),
    anonAdmin: t.withIdentity({ subject: "rl-anon-admin" }),
  };
}

async function code(call: () => Promise<unknown>): Promise<string> {
  try {
    await call();
    return "NO_ERROR";
  } catch (error) {
    const data = (error as { data?: { code?: string } }).data;
    return data?.code ?? `UNTYPED: ${(error as Error).message}`;
  }
}

describe("internal reads need an internal role", () => {
  const reads = [
    ["changelog.listEntries", (c: ReturnType<typeof convexTest>) => c.query(api.changelog.listEntries, {})],
    ["changelog.unseenCount", (c: ReturnType<typeof convexTest>) => c.query(api.changelog.unseenCount, {})],
    ["houseStyle.getModesForMe", (c: ReturnType<typeof convexTest>) => c.query(api.houseStyle.getModesForMe, {})],
    ["projects.listProjects", (c: ReturnType<typeof convexTest>) => c.query(api.projects.listProjects, {})],
    ["projects.listIndustries", (c: ReturnType<typeof convexTest>) => c.query(api.projects.listIndustries, {})],
    ["reportViews.getLastViewedMap", (c: ReturnType<typeof convexTest>) => c.query(api.reportViews.getLastViewedMap, {})],
  ] as const;

  it.each(reads)("%s refuses a roleless or anonymous account and serves a writer", async (_name, read) => {
    const f = await setup();
    expect(await code(() => read(f.roleless as never))).toBe("NOT_AUTHORIZED");
    expect(await code(() => read(f.anonAdmin as never))).toBe("NOT_AUTHENTICATED");
    expect(await code(() => read(f.writer as never))).toBe("NO_ERROR");
  });

  it("projects.listProjects omits shareToken from returned rows", async () => {
    const f = await setup();
    const list = await f.writer.query(api.projects.listProjects, {});
    expect(list).toHaveLength(1);
    expect("shareToken" in list[0]!).toBe(false);
  });

  it("tags.listTags and errorReports.listFeatureRequests return nothing to roleless/anonymous accounts", async () => {
    const f = await setup();
    await f.t.run((ctx) => ctx.db.insert("tags", { name: "Hardware", createdAt: 1 } as never));
    expect(await f.roleless.query(api.tags.listTags, {})).toEqual([]);
    expect(await f.writer.query(api.tags.listTags, {})).toHaveLength(1);

    expect(await f.roleless.query(api.errorReports.listFeatureRequests, {})).toEqual([]);
    expect(await f.anonAdmin.query(api.errorReports.listFeatureRequests, {})).toEqual([]);
    expect(await f.writer.query(api.errorReports.listFeatureRequests, {})).toHaveLength(1);

    expect(
      await code(() =>
        f.roleless.mutation(api.errorReports.toggleUpvote, { id: f.featureRequestId })
      )
    ).toBe("NOT_AUTHORIZED");
    expect(
      await code(() =>
        f.anonAdmin.mutation(api.errorReports.toggleUpvote, { id: f.featureRequestId })
      )
    ).toBe("NOT_AUTHENTICATED");
    expect(
      await code(() =>
        f.writer.mutation(api.errorReports.toggleUpvote, { id: f.featureRequestId })
      )
    ).toBe("NO_ERROR");
  });
});

describe("admin checks refuse an anonymous record with role admin", () => {
  it("tags, brain, invites and usage", async () => {
    const f = await setup();
    expect(await code(() => f.anonAdmin.mutation(api.tags.createTag, { name: "Nope" }))).toBe("NOT_AUTHENTICATED");
    expect(await code(() => f.anonAdmin.mutation(api.brain.revokeSource, { sourceId: f.sourceId })))
      .toBe("UNTYPED: Not authenticated");
    expect(await f.anonAdmin.query(api.invites.listTeamInvites, {})).toEqual([]);
    expect(await f.anonAdmin.query(api.aiUsage.usageReportAccess, {})).toBe(false);
  });
});
