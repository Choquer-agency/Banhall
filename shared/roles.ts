// Three-tier roles. The stored value for the first tier stays "writer"
// (no DB migration — the literal is reused in unrelated unions); it is
// DISPLAYED as "Consultant" everywhere in the UI.
export type Role = "writer" | "manager" | "admin";

export const ROLE_LABELS: Record<Role, string> = {
  writer: "Consultant",
  manager: "Manager",
  admin: "Admin",
};

/** Managers and admins are trusted to reclassify QA issue severity
 * (deduction ↔ warning); consultants may only vote/comment. */
export function canOverrideQaSeverity(role: Role | undefined | null): boolean {
  return role === "manager" || role === "admin";
}
