/**
 * The release-blocking semantic suite (Step by step, CAP-13) names every
 * project it creates with this prefix, so the runs are easy to find and
 * delete, and the suite's read functions refuse any other project.
 */
export const RELEASE_EVAL_PROJECT_PREFIX = "Release eval - ";

export function releaseEvalProjectTitle(fixtureTitle: string): string {
  return `${RELEASE_EVAL_PROJECT_PREFIX}${fixtureTitle}`;
}

export function isReleaseEvalProjectTitle(title: string): boolean {
  return (
    title.startsWith(RELEASE_EVAL_PROJECT_PREFIX) &&
    title.length > RELEASE_EVAL_PROJECT_PREFIX.length
  );
}
