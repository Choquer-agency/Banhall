export const PROJECT_TYPES = [
  "writing",
  "review",
  "background_research",
  "financial",
] as const;

export type ProjectType = (typeof PROJECT_TYPES)[number];

export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  writing: "Writing",
  review: "Review",
  background_research: "Background research",
  financial: "Financial",
};

/**
 * Widen-phase dual read. Review mode is authoritative for legacy review
 * projects; every other pre-projectType row is ordinary writing work.
 */
export function effectiveProjectType(project: {
  projectType?: ProjectType;
  mode?: "generate" | "review";
}): ProjectType {
  return project.projectType ?? (project.mode === "review" ? "review" : "writing");
}

