/**
 * Round 2 rail model (boards A1 to A5, decision 53). Pure: the rail, the
 * collapsed rail and the tests all read the same groups, so who sees what is
 * decided in one place. Takes the effective viewer (View as applied), never
 * the raw user. UI visibility is not authorization: every page and function
 * still checks access on the server.
 */
import { hasCapability } from "../../../shared/capabilities";
import type { Role } from "../../../shared/roles";

export type RailViewer = {
  role: Role | null;
  isOwner: boolean;
  isDeveloper: boolean;
};

export type RailItemId =
  | "home"
  | "projects"
  | "companies"
  | "team"
  | "admin"
  | "alerts"
  | "requests"
  | "changelog"
  | "settings";

export type RailBadge = { count: number; tone: "primary" | "danger" };

export type RailItem = {
  id: RailItemId;
  label: string;
  href: string;
  /** Count badge (What's new, Alerts). */
  badge?: RailBadge | null;
  /** Amber attention dot (Admin). */
  attention?: boolean;
};

export type RailGroup = {
  id: "workspace" | "manage" | "developer" | "other";
  label: string;
  items: RailItem[];
};

export type RailBadges = {
  unseenChangelog: number;
  openAlerts: number;
  adminAttention: number;
};

export type RailHrefs = {
  myWorkHref: string;
  projectsHref: string;
  companiesHref: string;
  teamHref: string;
  adminHref: string;
  alertsHref: string;
  requestsHref: string;
  changelogHref: string;
  settingsHref: string;
};

/** Team is for Managers and Admins (owner decision 47, `team.view`). */
export function canViewTeam(role: Role | null): boolean {
  return hasCapability(role, "team.view");
}

/** Admin shows to the Admin role (decision 53), whatever the display flags. */
export function canSeeAdmin(viewer: RailViewer): boolean {
  return hasCapability(viewer.role, "settings.configure");
}

/** Alerts need `ops.viewAlerts` on top of the developer flag (decision 49). */
export function canSeeAlerts(viewer: RailViewer): boolean {
  return viewer.isDeveloper && hasCapability(viewer.role, "ops.viewAlerts");
}

function countBadge(count: number, tone: RailBadge["tone"]): RailBadge | null {
  return count > 0 ? { count, tone } : null;
}

/** "99+" above 99; the rail badge never grows wider than that. */
export function badgeLabel(count: number): string {
  return count > 99 ? "99+" : String(count);
}

export function railGroups(viewer: RailViewer, hrefs: RailHrefs, badges: RailBadges): RailGroup[] {
  const groups: RailGroup[] = [
    {
      id: "workspace",
      label: "Workspace",
      items: [
        { id: "home", label: "Home", href: hrefs.myWorkHref },
        { id: "projects", label: "Projects", href: hrefs.projectsHref },
        { id: "companies", label: "Companies", href: hrefs.companiesHref },
      ],
    },
  ];

  const manage: RailItem[] = [];
  if (canViewTeam(viewer.role)) manage.push({ id: "team", label: "Team", href: hrefs.teamHref });
  if (canSeeAdmin(viewer)) {
    manage.push({
      id: "admin",
      label: "Admin",
      href: hrefs.adminHref,
      attention: badges.adminAttention > 0,
    });
  }
  if (manage.length > 0) groups.push({ id: "manage", label: "Manage", items: manage });

  if (viewer.isDeveloper) {
    const developer: RailItem[] = [];
    if (canSeeAlerts(viewer)) {
      developer.push({
        id: "alerts",
        label: "Alerts",
        href: hrefs.alertsHref,
        badge: countBadge(badges.openAlerts, "danger"),
      });
    }
    developer.push({ id: "requests", label: "Feature requests", href: hrefs.requestsHref });
    groups.push({ id: "developer", label: "Developer", items: developer });
  }

  groups.push({
    id: "other",
    label: "Other",
    items: [
      {
        id: "changelog",
        label: "What's new",
        href: hrefs.changelogHref,
        badge: countBadge(badges.unseenChangelog, "primary"),
      },
      { id: "settings", label: "Settings", href: hrefs.settingsHref },
    ],
  });

  return groups;
}

/**
 * Which rail row is selected. Companies has no page of its own yet: it opens
 * the Projects view grouped by client, which is also the Projects default
 * grouping, so the Projects route always selects Projects (the spec's
 * "Companies selected on group=client" cannot be told apart from Projects).
 */
export function selectedRailItem(url: { pathname: string; search: string }): RailItemId | null {
  const { pathname } = url;
  const under = (prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);
  if (under("/my-work")) return "home";
  if (under("/projects")) return "projects";
  if (under("/team")) return "team";
  if (under("/admin")) return "admin";
  if (under("/alerts")) return "alerts";
  if (under("/requests")) return "requests";
  if (under("/changelog")) return "changelog";
  if (under("/settings")) return "settings";
  return null;
}

/** Companies: the Projects view grouped by client (no page of its own yet). */
export function companiesHrefFrom(projectsHref: string): string {
  const [path, query = ""] = projectsHref.split("?");
  const params = new URLSearchParams(query);
  params.set("group", "client");
  return `${path}?${params.toString()}`;
}

/** Role-gated pages that show the D4 hidden state while viewing as a role. */
export type ViewAsGate = "admin" | "alerts" | "requests" | "team";

export const VIEW_AS_GATE_PAGE_NAMES: Record<ViewAsGate, string> = {
  admin: "Admin",
  alerts: "Alerts",
  requests: "Feature requests",
  team: "Team",
};

/** Whether the effective viewer could open a gated page (presentation only). */
export function viewerCanOpen(gate: ViewAsGate, viewer: RailViewer): boolean {
  switch (gate) {
    case "admin":
      return canSeeAdmin(viewer);
    case "alerts":
      return canSeeAlerts(viewer);
    case "requests":
      return viewer.isDeveloper;
    case "team":
      return canViewTeam(viewer.role);
  }
}
