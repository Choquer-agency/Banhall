/**
 * Test helper for the reordered Step-by-step start (owner decision 32,
 * 2026-09-25). A seed generation's startup opens the seed stage and
 * schedules the analysis and Brain retrieval as a separate background
 * action. Tests that need those inputs run that action to its end here,
 * under real or fake timers, without running it twice.
 */
import type { TestConvexForDataModel } from "convex-test";
import { makeFunctionReference } from "convex/server";
import type { DataModel, Id } from "./_generated/dataModel";

export const prepareSeedDraftingInputsRef = makeFunctionReference<
  "action",
  { generationId: Id<"generations">; attempt: number },
  null
>("ai/iterative:prepareSeedDraftingInputs");

/**
 * Take over every pending background attempt (cancel its scheduled job and
 * run it directly) and wait for any that already started. Returns the
 * attempts it ran.
 */
export async function runSeedDraftingInputs(
  t: TestConvexForDataModel<DataModel>
): Promise<Array<{ generationId: Id<"generations">; attempt: number }>> {
  const pending = await t.run(async (ctx) => {
    const jobs = await ctx.db.system.query("_scheduled_functions").collect();
    const mine = jobs.filter(
      (job) =>
        job.name.includes("prepareSeedDraftingInputs") && job.state.kind === "pending"
    );
    for (const job of mine) await ctx.scheduler.cancel(job._id);
    return mine.map(
      (job) => job.args[0] as { generationId: Id<"generations">; attempt: number }
    );
  });
  await t.finishInProgressScheduledFunctions();
  for (const args of pending) await t.action(prepareSeedDraftingInputsRef, args);
  return pending;
}

const startFirstBatchRef = makeFunctionReference<
  "mutation",
  { generationId: Id<"generations"> },
  unknown
>("seedRuns:startFirstBatch");

const generateBatchRef = makeFunctionReference<
  "action",
  { batchId: Id<"seedBatches"> },
  unknown
>("ai/seeds:generateBatch");

/** Take over every pending job of one function, wait for any running one. */
async function takeOverJobs<Args>(
  t: TestConvexForDataModel<DataModel>,
  name: string
): Promise<Args[]> {
  const pending = await t.run(async (ctx) => {
    const jobs = await ctx.db.system.query("_scheduled_functions").collect();
    const mine = jobs.filter((job) => job.name.includes(name) && job.state.kind === "pending");
    for (const job of mine) await ctx.scheduler.cancel(job._id);
    return mine.map((job) => job.args[0] as Args);
  });
  await t.finishInProgressScheduledFunctions();
  return pending;
}

/**
 * Owner decision 65: the seed stage opening schedules the server's first
 * Seed Batch. Tests that build their decisions by hand settle it here, under
 * real or fake timers, so its dispatch and attempt have run exactly once
 * before they read the stage version.
 */
export async function settleFirstSeedBatch(t: TestConvexForDataModel<DataModel>): Promise<void> {
  for (const args of await takeOverJobs<{ generationId: Id<"generations"> }>(t, "startFirstBatch")) {
    await t.mutation(startFirstBatchRef, args);
  }
  for (const args of await takeOverJobs<{ batchId: Id<"seedBatches"> }>(t, "generateBatch")) {
    await t.action(generateBatchRef, args);
  }
}
