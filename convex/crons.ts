import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
import { refreshCatalogRef } from "./lib/modelCatalogRefs";

const crons = cronJobs();

crons.interval(
  "recover stale report generations",
  { minutes: 10 },
  internal.generations.failStaleGenerations,
  { olderThanMinutes: 30 }
);

// Stuck-state reapers: a hard action death (deploy restart, timeout, OOM)
// strands a "running" row with no catch block left to fail it, and the UI
// spins forever behind an is-running guard. Each sweep is a cheap indexed
// read when healthy.
crons.interval(
  "recover stale PD reviews",
  { minutes: 10 },
  internal.pdReviews.failStalePdReviews,
  { olderThanMinutes: 15 }
);
crons.interval(
  "recover stale post-QA passes",
  { minutes: 10 },
  internal.generations.failStalePostQa,
  { olderThanMinutes: 15 }
);
crons.interval(
  "recover stale chat turns",
  { minutes: 10 },
  internal.chatV2.failStaleChatTurns,
  { olderThanMinutes: 15 }
);

// Learning loop: nightly safety nets for the feedback digests. The main
// triggers are debounced scheduling from saveQaItemFeedback / scoreCandidate;
// the actions no-op when there is no new feedback since the active digest.
crons.cron(
  "refresh QA calibration digest",
  "0 8 * * *", // ~3am ET, outside working hours
  internal.ai.learning.generateQaCalibrationDigest
);
crons.cron(
  "refresh draft style digest",
  "15 8 * * *",
  internal.ai.learning.generateDraftStyleDigest
);
crons.interval(
  "reconcile stalled oversight rebuilds",
  { minutes: 5 },
  internal.oversight.sweepStalled
);
crons.interval(
  "resume stalled My work backfills",
  { minutes: 5 },
  internal.myWorkBackfill.sweepStalled
);

// Model catalog (owner decision 21): refresh from OpenRouter, flag expiring
// or removed models, roll back failing switches and queue at most two
// evaluations. After the learning digests, still outside working hours.
crons.cron(
  "refresh model catalog",
  "45 8 * * *",
  refreshCatalogRef
);

// Files no row holds once they are a day old (an upload whose save never
// ran): they hold interview text that project erasure can never find.
// Reports only until an admin sets storage.sweepUnreferenced to "delete".
crons.cron(
  "release unreferenced files",
  "30 9 * * *",
  internal.transcripts.sweepUnreferencedStorage,
  {}
);

// Error reports: bug reports older than 30 days are deleted, a bounded batch
// at a time (review r1 P2-2). Feature requests are kept.
crons.cron(
  "prune old error reports",
  "50 9 * * *",
  internal.errorReports.pruneOldErrorReports,
  {}
);

export default crons;
