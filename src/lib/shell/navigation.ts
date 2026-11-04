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
 * Which rail row is selected. Companies is its own section since 2026-10-28
 * (`/companies` and every company page); the Projects route always selects
 * Projects, including a company chosen there.
 */
export function selectedRailItem(url: { pathname: string; search: string }): RailItemId | null {
  const { pathname } = url;
  const under = (prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);
  if (under("/my-work")) return "home";
  if (under("/projects")) return "projects";
  if (under("/companies")) return "companies";
  if (under("/team")) return "team";
  if (under("/admin")) return "admin";
  if (under("/alerts")) return "alerts";
  if (under("/requests")) return "requests";
  if (under("/changelog")) return "changelog";
  if (under("/settings")) return "settings";
  return null;
}

/**
 * The page frame's fixed labelled rail (owner, 2026-10-28; Paper S9, S11):
 * Projects, Companies and Team (team.view) at the top, then after the spacer
 * What's new (every signed-in person, 2026-11-02, client request), Admin
 * (settings.configure) and Settings. No Home, search or developer rows: Home
 * sits in the Projects sidebar, and Alerts and Feature requests at the foot
 * of the Admin sidebar. What's new keeps the global bar's bell too; both
 * show the same unseen state. The drawer below 1024px keeps `railGroups`.
 */
export type FrameRailItemId = "projects" | "companies" | "team" | "changelog" | "admin" | "settings";

export type FrameRailItem = {
  id: FrameRailItemId;
  label: string;
  href: string;
  /** Amber attention dot (Admin). */
  attention?: boolean;
  /** Unseen updates (What's new): the primary dot, as on the bell. */
  unseen?: number;
};

export type FrameRailHrefs = {
  projectsHref: string;
  companiesHref: string;
  teamHref: string;
  changelogHref: string;
  adminHref: string;
  settingsHref: string;
};

/** The What's new link's accessible name, shared by the bell and the rail. */
export function whatsNewLabel(unseen: number): string {
  return unseen > 0 ? `What's new, ${unseen} new update${unseen === 1 ? "" : "s"}` : "What's new";
}

export function frameRailItems(
  viewer: RailViewer,
  hrefs: FrameRailHrefs,
  badges: { adminAttention: number; unseenChangelog?: number }
): { top: FrameRailItem[]; bottom: FrameRailItem[] } {
  const top: FrameRailItem[] = [
    { id: "projects", label: "Projects", href: hrefs.projectsHref },
    { id: "companies", label: "Companies", href: hrefs.companiesHref },
  ];
  if (canViewTeam(viewer.role)) top.push({ id: "team", label: "Team", href: hrefs.teamHref });
  const bottom: FrameRailItem[] = [
    { id: "changelog", label: "What's new", href: hrefs.changelogHref, unseen: Math.max(0, badges.unseenChangelog ?? 0) },
  ];
  if (canSeeAdmin(viewer)) {
    bottom.push({ id: "admin", label: "Admin", href: hrefs.adminHref, attention: badges.adminAttention > 0 });
  }
  bottom.push({ id: "settings", label: "Settings", href: hrefs.settingsHref });
  return { top, bottom };
}

function under(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * The active rail item. Home, every project page and New project sit under
 * Projects; Alerts and Feature requests under Admin, whose sidebar lists
 * them. Companies is selected on All companies and every company page
 * (2026-10-28); a company chosen on the Projects page stays under Projects.
 * What's new is selected on its page (2026-11-02).
 */
export function selectedFrameRailItem(pathname: string): FrameRailItemId | null {
  if (pathname === "/" || under(pathname, "/my-work") || under(pathname, "/projects") || under(pathname, "/project")) {
    return "projects";
  }
  if (under(pathname, "/companies")) return "companies";
  if (under(pathname, "/team")) return "team";
  if (under(pathname, "/admin") || under(pathname, "/alerts") || under(pathname, "/requests")) return "admin";
  if (under(pathname, "/changelog")) return "changelog";
  if (under(pathname, "/settings")) return "settings";
  return null;
}

/** The sections that draw an inner sidebar in the white card. */
export type FrameSection = "projects" | "companies" | "team" | "admin" | "settings";

/**
 * Which section sidebar a page draws (owner answers 1 and 5, 2026-10-28):
 * Home and Projects share the Projects sidebar; Companies, Team, Admin and
 * Settings have their own. New project, What's new, Alerts, Feature requests and the
 * project page draw none. The loading frame reads it so nothing jumps.
 */
export function frameSectionForPath(pathname: string): FrameSection | null {
  if (pathname === "/" || under(pathname, "/my-work") || under(pathname, "/projects")) return "projects";
  if (under(pathname, "/companies")) return "companies";
  if (under(pathname, "/team")) return "team";
  if (under(pathname, "/admin")) return "admin";
  if (under(pathname, "/settings")) return "settings";
  return null;
}

/**
 * The Projects view grouped by client, Companies' link before the Companies
 * section existed (2026-10-28); kept for links that still carry it.
 */
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
