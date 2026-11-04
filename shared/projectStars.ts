/**
 * Project stars (2026-11-02): a person's private flag on the projects they
 * are working on. One star per person and project, at most
 * `MAX_PROJECT_STARS` per person, so the Starred view and the star on every
 * card come from one bounded read.
 */
export const MAX_PROJECT_STARS = 200;

export const PROJECT_STAR_LIMIT_MESSAGE = `You can star up to ${MAX_PROJECT_STARS} projects. Unstar one first.`;
