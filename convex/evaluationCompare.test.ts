/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { preferenceTextKey } from "./lib/preferenceCheck";
import { releaseEvalProjectTitle } from "../shared/releaseEval";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// E3 review: evaluation projects are made only on a local backend (or where
// allowed); these tests run as one.
beforeEach(() => vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210"));
afterEach(() => vi.unstubAllEnvs());

/**
 * 2026-10-27 (Phase E, E3): the release suite's --compare arms. A lesson set
 * or a list of saved preferences is set on an evaluation project only, and
 * drafting on that project uses it in place of the published set and the
 * writer's own. Every name and passage here is fictional.
 */

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const writerId = await ctx.db.insert("users", { authId: "compare-writer", role: "writer", name: "Wren" });
    const project = (title: string, evaluation: boolean) =>
      ctx.db.insert("projects", {
        title, clientName: "Quillmere Analytics Ltd.", status: "draft", createdBy: writerId, ownerId: writerId,
        shareToken: `token-${title}`, createdAt: 1, updatedAt: 1, ...(evaluation ? { evaluation: { markedAt: 1 } } : {}),
      });
    const digest = (content: string, feedbackCutoff: number, extra: { userId?: Id<"users">; kind?: "draft_style" | "qa_calibration" } = {}) =>
      ctx.db.insert("learningDigests", {
        kind: extra.kind ?? "draft_style", content, sourceCount: 3, feedbackCutoff, model: "m", createdAt: 1_000,
        ...(extra.userId ? { userId: extra.userId } : {}),
      });
    const published = await digest("Published lessons.", 5);
    await ctx.db.insert("learningDigestSelections", { kind: "draft_style", selectedDigestId: published, actorKind: "system", action: "select", selectedAt: 1 });
    const candidate = await digest("Candidate lessons.", 10);
    // A set built after a feedback item it drew on was withdrawn.
    const withdrawn = await digest("Withdrawn lessons.", 100);
    await ctx.db.insert("brainFeedbackQueue", {
      fromUserId: writerId, body: "Withdrawn feedback body.", status: "approved", createdAt: 1, withdrawnAt: 60, withdrawnApprovedAt: 50,
    });
    const personal = await digest("Personal lessons.", 10, { userId: writerId });
    for (const [index, text] of ["Uses Canadian spelling.", "Keeps sentences short."].entries()) {
      await ctx.db.insert("writerMemories", {
        userId: writerId, text, textKey: preferenceTextKey(text), state: "on", origin: "written",
        checkedTextKey: preferenceTextKey(text), createdAt: index, decidedAt: index, updatedAt: index,
      });
    }
    return {
      writerId,
      evaluation: await project(releaseEvalProjectTitle("Burner model (with)"), true),
      unmarked: await project(releaseEvalProjectTitle("Burner model (unmarked)"), false),
      client: await project("Burner model", false),
      published,
      candidate,
      withdrawn,
      personal,
    };
  });
  const set = (args: Record<string, unknown>) => t.mutation(internal.seedPlanEval.setEvaluationCompare, args as never);
  const active = (projectId?: Id<"projects">) =>
    t.query(internal.learning.getActiveDigest, { kind: "draft_style", ...(projectId ? { projectId } : {}) });
  const style = (projectId: Id<"projects">, settingsDocument?: string) =>
    t.query(internal.writerProfiles.getGenerationWriterStyle, {
      userId: ids.writerId,
      projectId,
      ...(settingsDocument ? { settingsDocument: { text: settingsDocument, supplyPath: "attachment" as const, addressedCategories: null } } : {}),
    });
  return { t, ...ids, set, active, style };
}

describe("setting a compare arm (Phase E, E3)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("sets a lesson set or saved preferences on an evaluation project, keeping its mark", async () => {
    const s = await setup();
    await s.set({ projectId: s.evaluation, lessons: { kind: "draft_style", learningDigestId: s.candidate } });
    await s.set({ projectId: s.evaluation, preferences: ["  Uses   the active voice. "] });
    expect((await s.t.run((ctx) => ctx.db.get(s.evaluation)))!.evaluation).toEqual({
      markedAt: 1,
      lessons: { kind: "draft_style", learningDigestId: s.candidate },
      preferences: ["Uses the active voice."],
    });
  });

  it("refuses a project that is not an evaluation project, a set that admitted withdrawn feedback, a personal or unknown set, and production", async () => {
    const s = await setup();
    for (const projectId of [s.unmarked, s.client]) {
      await expect(s.set({ projectId, preferences: [] })).rejects.toThrow(/Not an evaluation project/);
    }
    await expect(s.set({ projectId: s.evaluation, lessons: { kind: "draft_style", learningDigestId: s.withdrawn } })).rejects.toThrow(
      /admitted withdrawn feedback/
    );
    await expect(s.set({ projectId: s.evaluation, lessons: { kind: "draft_style", learningDigestId: s.personal } })).rejects.toThrow(
      /No shared draft_style lesson set/
    );
    await expect(s.set({ projectId: s.evaluation, lessons: { kind: "qa_calibration", learningDigestId: s.candidate } })).rejects.toThrow(
      /No shared qa_calibration lesson set/
    );
    await expect(s.set({ projectId: s.evaluation, preferences: Array.from({ length: 31 }, (_, i) => `Keeps rule ${i}.`) })).rejects.toThrow(/At most 30/);
    await expect(s.set({ projectId: s.evaluation, preferences: ["x".repeat(161)] })).rejects.toThrow(/1 to 160 characters/);
    await expect(s.set({ projectId: s.evaluation, preferences: ["   "] })).rejects.toThrow(/1 to 160 characters/);
    vi.stubEnv("CONVEX_CLOUD_URL", "https://energized-salamander-237.convex.cloud");
    await expect(s.set({ projectId: s.evaluation, preferences: [] })).rejects.toThrow(/never made on production/);
    expect((await s.t.run((ctx) => ctx.db.get(s.evaluation)))!.evaluation).toEqual({ markedAt: 1 });
  });

  it("names a lesson set before a run, and says whether it admitted withdrawn feedback", async () => {
    const s = await setup();
    expect(await s.t.query(internal.seedPlanEval.compareLessonSet, { learningDigestId: s.candidate })).toEqual({
      id: s.candidate, kind: "draft_style", createdAt: 1_000, sourceCount: 3, admittedWithdrawn: false,
    });
    expect(await s.t.query(internal.seedPlanEval.compareLessonSet, { learningDigestId: s.withdrawn })).toMatchObject({ admittedWithdrawn: true });
    expect(await s.t.query(internal.seedPlanEval.compareLessonSet, { learningDigestId: s.personal })).toBeNull();
    expect(await s.t.query(internal.seedPlanEval.compareLessonSet, { learningDigestId: "not-an-id" })).toBeNull();
  });
});

describe("drafting on a compare arm (Phase E, E3)", () => {
  it("uses the arm's lesson set, or none, in place of the published one", async () => {
    const s = await setup();
    expect((await s.active(s.evaluation))?._id).toBe(s.published);
    await s.set({ projectId: s.evaluation, lessons: { kind: "draft_style", learningDigestId: s.candidate } });
    expect((await s.active(s.evaluation))?._id).toBe(s.candidate);
    // Other projects and the QA kind still read the published sets.
    expect((await s.active(s.client))?._id).toBe(s.published);
    expect((await s.active())?._id).toBe(s.published);
    expect(await s.t.query(internal.learning.getActiveDigest, { kind: "qa_calibration", projectId: s.evaluation })).toBeNull();

    await s.set({ projectId: s.evaluation, lessons: { kind: "draft_style", learningDigestId: null } });
    expect(await s.active(s.evaluation)).toBeNull();
  });

  it("never uses an arm's set once feedback it admitted is withdrawn", async () => {
    const s = await setup();
    await s.set({ projectId: s.evaluation, lessons: { kind: "draft_style", learningDigestId: s.candidate } });
    // A feedback item approved before the candidate's cutoff is withdrawn later.
    await s.t.run((ctx) =>
      ctx.db.insert("brainFeedbackQueue", {
        fromUserId: s.writerId, body: "Later withdrawn.", status: "approved", createdAt: 1, withdrawnAt: 70, withdrawnApprovedAt: 8,
      })
    );
    expect(await s.active(s.evaluation)).toBeNull();
  });

  it("uses the arm's saved preferences in place of the writer's own, under the same rules", async () => {
    const s = await setup();
    // As usual: the writer's own.
    expect((await s.style(s.evaluation)).customInstructions).toBe("Saved preferences:\n- Uses Canadian spelling.\n- Keeps sentences short.");

    await s.set({ projectId: s.evaluation, preferences: ["Uses the active voice."] });
    const withArm = await s.style(s.evaluation);
    expect(withArm.customInstructions).toBe("Saved preferences:\n- Uses the active voice.");
    expect(withArm.savedPreferences?.count).toBe(1);
    // A settings document replaces the profile, so no saved preference applies.
    const withDocument = await s.style(s.evaluation, "Writer settings: keep Lines short.");
    expect(withDocument.savedPreferences).toBeUndefined();
    expect(withDocument.customInstructions).not.toContain("Saved preferences:");

    await s.set({ projectId: s.evaluation, preferences: [] });
    const without = await s.style(s.evaluation);
    expect(without.customInstructions).toBeNull();
    expect(without.savedPreferences).toBeUndefined();

    // Another project still reads the writer's own; nothing changed on the account.
    expect((await s.style(s.client)).savedPreferences?.count).toBe(2);
    expect(await s.t.run(async (ctx) => (await ctx.db.query("writerMemories").collect()).length)).toBe(2);
  });
});
