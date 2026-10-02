/// <reference types="vite/client" />
import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";
import type { Id } from "./_generated/dataModel";
import { decisionFixture } from "./seedDecision.fixture";

/**
 * The release suite's read side (scripts/seed-plan-eval.mjs): internal,
 * read-only, and limited to projects named with the release-eval prefix so
 * it never hands a client project's text to the script. References are
 * built by name until codegen adds the module to `internal`.
 */
const ref = <Args extends Record<string, unknown>>(name: string) =>
  makeFunctionReference<"query", Args, any>(`seedPlanEval:${name}`);
const evalActor = ref<{ email: string }>("evalActor");
const listEvalProjects = ref<{ ownerId: Id<"users"> }>("listEvalProjects");
const latestGeneration = ref<{ projectId: Id<"projects"> }>("latestGeneration");
const progress = ref<{ generationId: Id<"generations"> }>("progress");
const briefExclusions = ref<{ generationId: Id<"generations"> }>("briefExclusions");
const collect = ref<{ generationId: Id<"generations"> }>("collect");

async function evalFixture() {
  const fixture = await decisionFixture();
  await fixture.t.run(async (ctx) => {
    await ctx.db.patch(fixture.projectId, { title: "Release eval - Fictional kiln" });
    await ctx.db.patch(fixture.userId, { email: "reviewer@example.com" });
  });
  return fixture;
}

describe("seedPlanEval reads", () => {
  it("finds the reviewer to act as only when they have a role", async () => {
    const { t, userId } = await evalFixture();
    expect(await t.query(evalActor, { email: " Reviewer@Example.com " })).toEqual({
      userId,
      authId: "seed-run-writer",
      role: "writer",
    });
    expect(await t.query(evalActor, { email: "nobody@example.com" })).toBeNull();
    await t.run(async (ctx) => {
      await ctx.db.patch(userId, { role: undefined });
    });
    expect(await t.query(evalActor, { email: "reviewer@example.com" })).toBeNull();
  });

  it("lists only the reviewer's release eval projects", async () => {
    const { t, userId, projectId } = await evalFixture();
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", {
        title: "Fictional client PD",
        clientName: "Client",
        ownerId: userId,
        createdBy: userId,
        shareToken: crypto.randomUUID(),
        status: "draft",
        createdAt: 2,
        updatedAt: 2,
      });
    });
    const projects = await t.query(listEvalProjects, { ownerId: userId });
    expect(projects.map((project: { projectId: string }) => project.projectId)).toEqual([projectId]);
  });

  it("refuses every generation outside a release eval project", async () => {
    const { t, projectId, generationId } = await decisionFixture();
    await expect(t.query(progress, { generationId })).rejects.toThrow(/Not a release eval project/);
    await expect(t.query(collect, { generationId })).rejects.toThrow(/Not a release eval project/);
    await expect(t.query(briefExclusions, { generationId })).rejects.toThrow(/Not a release eval project/);
    await expect(t.query(latestGeneration, { projectId })).rejects.toThrow(/Not a release eval project/);
  });

  it("reads the seed stage, the Brief's exclusions and the run's records", async () => {
    const { t, projectId, generationId, briefId, sourceId } = await evalFixture();
    await t.run(async (ctx) => {
      await ctx.db.insert("generationBriefEntries", {
        briefId,
        projectId,
        group: "claimExclusion",
        text: "Moving the billing portal to a new host",
        reason: "routine_engineering",
        sourceId,
        sourceContentHash: "source-hash",
        startOffset: 0,
        endOffset: 8,
        exactExcerpt: "Evidence",
        createdAt: 1,
      });
    });
    expect(await t.query(latestGeneration, { projectId })).toEqual({ generationId });
    expect(await t.query(progress, { generationId })).toMatchObject({
      status: "awaiting_input",
      gatedWorkflow: "seeds",
      seedSubsections: 13,
      draftingInputs: "ready",
      reportId: null,
    });
    expect(await t.query(briefExclusions, { generationId })).toEqual([
      expect.objectContaining({ text: "Moving the billing portal to a new host", reason: "routine_engineering", exactExcerpt: "Evidence" }),
    ]);
    const collected = await t.query(collect, { generationId });
    expect(collected.project).toEqual({ projectId, title: "Release eval - Fictional kiln" });
    // 2026-10-02 (alert 7): the writer settings the generation ran under.
    expect(collected.generation.writerSettings).toEqual({
      profileState: "missing",
      source: "none",
      fileName: null,
      matchesProfile: false,
      savedProfileSuperseded: false,
      waiverAnalysis: "none",
      truncated: false,
      addressedCategories: null,
    });
    // A settings document applied from Writer's Notes is read back whole.
    await t.run(async (ctx) => {
      await ctx.db.patch(generationId, {
        writerSettings: {
          profileState: "applied",
          source: "writer_notes",
          fileName: "pd-writing-customized-settings.md",
          matchesProfile: false,
          savedProfileSuperseded: true,
          waiverAnalysis: "analyzed",
          truncated: false,
          addressedCategories: ["bannedWords", "openingClauses"],
        },
      });
    });
    expect((await t.query(collect, { generationId })).generation.writerSettings).toEqual({
      profileState: "applied",
      source: "writer_notes",
      fileName: "pd-writing-customized-settings.md",
      matchesProfile: false,
      savedProfileSuperseded: true,
      waiverAnalysis: "analyzed",
      truncated: false,
      addressedCategories: ["bannedWords", "openingClauses"],
    });
    // A generation that recorded no writer settings reads back null.
    await t.run(async (ctx) => {
      await ctx.db.patch(generationId, { writerSettings: undefined });
    });
    expect((await t.query(collect, { generationId })).generation.writerSettings).toBeNull();
    expect(collected.subsections).toHaveLength(13);
    expect(collected.summary).toBeNull();
    expect(collected.report).toBeNull();
    expect(collected.briefEntries).toEqual([
      expect.objectContaining({ group: "claimExclusion", text: "Moving the billing portal to a new host" }),
    ]);
    expect(collected.truncated).toEqual([]);
  });
});
