/**
 * Test fixture (F2, 2026-10-27): finishes a project copy job the way the
 * copy action does, for tests that start one with
 * `projects.prepareProjectContentCopy` directly: the rest of the rows, each
 * pending file's text (no originals to clone), then the last step. No
 * Convex functions here.
 */
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/** A convex-test instance (or one with an identity). */
type Runner = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mutation: (...args: any[]) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: (...args: any[]) => Promise<any>;
};

export async function completeProjectCopy(
  t: Runner,
  plan: { jobId: Id<"projectCopyJobs">; leaseToken: string }
): Promise<void> {
  const lease = { jobId: plan.jobId, leaseToken: plan.leaseToken };
  for (;;) {
    const step: { result?: { prepared: boolean } } = await t.mutation(internal.projects.continueProjectContentCopy, lease);
    if (!step.result || step.result.prepared) break;
  }
  for (;;) {
    const next: { documentId: Id<"projectDocuments"> } | null = await t.query(internal.projects.nextProjectCopyFile, lease);
    if (!next) break;
    await t.mutation(internal.projects.copyProjectFile, { ...lease, documentId: next.documentId });
  }
  await t.mutation(internal.projects.finishProjectContentCopy, { ...lease, transcriptCopies: [] });
}
