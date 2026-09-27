/// <reference types="vite/client" />
/**
 * Decision 65, stage 2 (re-check 2026-09-26, P2-A): a promotion step that
 * always fails never holds the project in "being set up" forever. After the
 * sweep's resumes run out (or 30 minutes), the promotion ends with what was
 * installed, the project is released, every file that did not install is
 * recorded as not saved on the project's receipt, and the draft is purged.
 * One file is made to fail every time it is installed here.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { intakeDraftRefs } from "./lib/intakeDraftRefs";

vi.mock("../shared/documentStatus", async (importOriginal) => {
  const original = await importOriginal<typeof import("../shared/documentStatus")>();
  return {
    ...original,
    deriveProcessingStatus: (facts: Parameters<typeof original.deriveProcessingStatus>[0]) => {
      if (facts.fileName === "never-installs.txt") throw new Error("This file always fails to install");
      return original.deriveProcessingStatus(facts);
    },
  };
});

const modules = import.meta.glob("./**/*.ts");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-26T15:00:00Z"));
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("No provider call is expected"); }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("a step that always fails ends the promotion: the project is released, the missing files are recorded, the draft is purged", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => ctx.db.insert("users", { authId: "cap-writer", role: "writer", name: "Wren Writer" }));
  const writer = t.withIdentity({ subject: "cap-writer" });
  const draftId = await writer.mutation(intakeDraftRefs.createIntakeDraft, {});
  const long = (index: number) =>
    Array.from({ length: 14000 }, (_, line) => `Priya Raman: Line ${line} of call ${index}.`).join("\n\n").slice(0, 440_000);
  const keys = ["long-key-1", "long-key-2", "long-key-3", "long-key-4"];
  for (const [index, key] of keys.entries()) {
    await writer.mutation(intakeDraftRefs.saveIntakeSource, {
      draftId, sourceKey: key, kind: "transcript", position: index, label: `Call ${index}`, content: long(index), sourceFormat: "txt",
    });
  }
  await writer.mutation(intakeDraftRefs.saveIntakeSource, {
    draftId, sourceKey: "poison-key-1", kind: "document", position: 1000, label: "never-installs.txt",
    content: "Notes that never install.", fileType: "txt", category: "other", intake: "file", extractionOutcome: "ok",
  });
  const receipt = await writer.mutation(intakeDraftRefs.promoteIntakeDraft, {
    draftId, commandId: "cap", sourceKeys: [...keys, "poison-key-1"], project: { title: "Feeder rig", clientName: "Verdant Grid" },
  });
  if ("ended" in receipt) throw new Error("ended");
  expect(receipt.complete).toBe(false);
  const run = async () => {
    for (let step = 0; step < 8; step += 1) {
      vi.advanceTimersByTime(1_600);
      await t.finishInProgressScheduledFunctions().catch(() => undefined);
    }
  };
  await run();
  // The remaining step fails every time: the project is still being set up.
  await expect(
    writer.mutation(api.generations.requestGeneration, { projectId: receipt.projectId, candidateMode: "iterative" })
  ).rejects.toThrow(/still being set up/);
  // The sweep resumes it (it fails again) until the cap, then ends it.
  for (let sweep = 0; sweep < 7; sweep += 1) {
    vi.setSystemTime(Date.now() + 15 * 60 * 1000);
    await t.mutation(intakeDraftRefs.sweepIntakeDrafts, {});
    await run();
  }
  const state = await t.run(async (ctx) => ({
    draft: (await ctx.db.get(draftId))!,
    transcripts: await ctx.db.query("transcripts").withIndex("by_projectId", (q) => q.eq("projectId", receipt.projectId)).collect(),
    attempts: await ctx.db.query("documentUploadAttempts").withIndex("by_projectId", (q) => q.eq("projectId", receipt.projectId)).collect(),
    sources: (await ctx.db.query("intakeSources").collect()).filter((row) => row.draftId === draftId),
  }));
  expect(state.draft).toMatchObject({ status: "promoted", promotionIncomplete: true });
  expect(state.draft.contentPurgedAt).toBeDefined();
  expect(state.sources).toHaveLength(0);
  // What was installed stays; what did not is on the project's receipt as not saved.
  expect(state.transcripts.length).toBeGreaterThanOrEqual(3);
  const installedLabels = new Set(state.transcripts.map((row) => row.label));
  const missing = [...keys.map((_, index) => `Call ${index}`).filter((label) => !installedLabels.has(label)), "never-installs.txt"];
  expect(state.attempts.map((row) => [row.fileName, row.status, row.failureCode]).sort()).toEqual(
    missing.map((name) => [name, "failed", "upload_failed"]).sort()
  );
  // The project is no longer "being set up": a start now meets the next
  // check instead (no provider in this test), not PROJECT_SETTING_UP.
  const refusal = await writer
    .mutation(api.generations.requestGeneration, { projectId: receipt.projectId, candidateMode: "iterative" })
    .catch((caught: unknown) => caught);
  expect((refusal as { data?: { code?: string } }).data?.code).toBe("PROVIDER_NOT_CONFIGURED");
}, 120_000);
