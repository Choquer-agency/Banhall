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
crons.daily(
  "refresh QA calibration digest",
  { hourUTC: 8, minuteUTC: 0 }, // ~3am ET, outside working hours
  internal.ai.learning.generateQaCalibrationDigest
);
crons.daily(
  "refresh draft style digest",
  { hourUTC: 8, minuteUTC: 15 },
  internal.ai.learning.generateDraftStyleDigest
);

export default crons;
