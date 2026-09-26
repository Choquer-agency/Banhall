import type { Doc } from "../../_generated/dataModel";

type ProjectStatus = Doc<"projects">["status"];

/**
 * The project status a generation returns the project to when it ends.
 * "generating" is never a status to return to: a generation reserved while
 * the project still read "generating" (a stuck run, say) would otherwise put
 * it back and lock it again on every reaper sweep (audit 2026-09-25 a4 #20).
 * It is stored as "draft", and a row stored before this rule is read the
 * same way.
 */
export function restorableProjectStatus(
  status: ProjectStatus | undefined
): Exclude<ProjectStatus, "generating"> {
  return status === undefined || status === "generating" ? "draft" : status;
}
