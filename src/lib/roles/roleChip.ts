import { ROLE_LABELS, type Role } from "../../../shared/roles";

/**
 * The five role chips of the round 2 boards (rail identity, Team table,
 * invite screens, View as). Owner and Developer are display flags on top of
 * the stored role, not roles of their own, so the chip resolves them the same
 * way the rail identity row does: Developer, then Owner, then the role.
 */
export type RoleChipKind = "owner" | "admin" | "manager" | "consultant" | "developer";

export const ROLE_CHIP_LABELS: Record<RoleChipKind, string> = {
  owner: "Owner",
  admin: ROLE_LABELS.admin,
  manager: ROLE_LABELS.manager,
  consultant: ROLE_LABELS.writer,
  developer: "Developer",
};

const ROLE_TO_CHIP: Record<Role, RoleChipKind> = {
  writer: "consultant",
  manager: "manager",
  admin: "admin",
};

export function roleChipKind(input: {
  role?: Role | null;
  isOwner?: boolean;
  isDeveloper?: boolean;
}): RoleChipKind | null {
  if (input.isDeveloper) return "developer";
  if (input.isOwner) return "owner";
  return input.role ? ROLE_TO_CHIP[input.role] : null;
}
