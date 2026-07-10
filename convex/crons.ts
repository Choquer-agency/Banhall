import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "recover stale report generations",
  { minutes: 10 },
  internal.generations.failStaleGenerations,
  { olderThanMinutes: 30 }
);

export default crons;
