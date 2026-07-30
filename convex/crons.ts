import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "recover stale report generations",
  { minutes: 10 },
  internal.generations.failStaleGenerations,
  { olderThanMinutes: 30 }
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

export default crons;
