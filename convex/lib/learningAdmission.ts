import { v, type Infer } from "convex/values";

/** Internal provenance never forms part of the provider-facing payload. */
export type LearningSignal<Payload> = {
  signalId: string;
  producerId: string | null;
  projectId: string | null;
  updatedAt: number;
  payload: Payload;
};

const producerCount = v.object({ producerId: v.string(), count: v.number() });
export const admissionValidator = v.object({
  admittedCount: v.number(),
  excludedCount: v.number(),
  feedbackCutoff: v.union(v.number(), v.null()),
  producers: v.array(producerCount),
  streams: v.array(
    v.object({
      stream: v.string(),
      admittedCount: v.number(),
      excludedCount: v.number(),
      signalIds: v.array(v.string()),
      producers: v.array(producerCount),
      missingWriterCount: v.number(),
      missingProjectCount: v.number(),
      insufficientDiversityCount: v.number(),
      writerCount: v.number(),
      projectCount: v.number(),
    }),
  ),
});
export type AdmissionSnapshot = Infer<typeof admissionValidator>;
export const attemptOutcomeValidator = v.union(
  v.literal("insufficient_inputs"),
  v.literal("unchanged_inputs"),
  v.literal("unsupported_rules"),
  v.literal("failed"),
  v.literal("saved"),
  v.literal("deduplicated"),
);
export type AttemptOutcome = Infer<typeof attemptOutcomeValidator>;

function producerCounts(rows: LearningSignal<unknown>[]) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.producerId)
      counts.set(row.producerId, (counts.get(row.producerId) ?? 0) + 1);
  }
  return [...counts].map(([producerId, count]) => ({ producerId, count }));
}

/** Apply only after the caller's meaningful-signal filters, to bounded windows.
 * Missing-reason counts may overlap; diversity counts cover only attributable
 * rows. excludedCount counts each excluded row once, never sums reasons.
 */
export function admitStream<Payload>(
  stream: string,
  rows: LearningSignal<Payload>[],
) {
  const attributed = rows.filter((row) => row.producerId && row.projectId);
  const writerCount = new Set(attributed.map((row) => row.producerId)).size;
  const projectCount = new Set(attributed.map((row) => row.projectId)).size;
  const admitted = writerCount >= 2 && projectCount >= 2 ? attributed : [];
  return {
    admitted,
    snapshot: {
      stream,
      admittedCount: admitted.length,
      excludedCount: rows.length - admitted.length,
      signalIds: admitted.map((row) => row.signalId),
      producers: producerCounts(admitted),
      missingWriterCount: rows.filter((row) => !row.producerId).length,
      missingProjectCount: rows.filter((row) => !row.projectId).length,
      insufficientDiversityCount: attributed.length - admitted.length,
      writerCount,
      projectCount,
    },
  };
}

/** Combine already independently admitted streams; never pool diversity. */
export function summarizeAdmission(
  streams: {
    admitted: LearningSignal<unknown>[];
    snapshot: AdmissionSnapshot["streams"][number];
  }[],
): AdmissionSnapshot {
  const admitted = streams.flatMap((stream) => stream.admitted);
  return {
    admittedCount: admitted.length,
    excludedCount: streams.reduce(
      (sum, stream) => sum + stream.snapshot.excludedCount,
      0,
    ),
    feedbackCutoff: admitted.length
      ? Math.max(...admitted.map((row) => row.updatedAt))
      : null,
    producers: producerCounts(admitted),
    streams: streams.map((stream) => stream.snapshot),
  };
}
