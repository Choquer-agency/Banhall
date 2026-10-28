import { describe, expect, it } from "vitest";
import { hasCapability } from "../../../shared/capabilities";
import {
  canViewTeam,
  companiesHrefFrom,
  frameRailItems,
  frameSectionForPath,
  railGroups,
  selectedFrameRailItem,
  selectedRailItem,
  type RailViewer,
} from "./navigation";

const hrefs = {
  myWorkHref: "/my-work",
  projectsHref: "/projects",
  companiesHref: "/projects?group=client",
  teamHref: "/team",
  adminHref: "/admin",
  alertsHref: "/alerts",
  requestsHref: "/requests",
  changelogHref: "/changelog",
  settingsHref: "/settings",
};
const noBadges = { unseenChangelog: 0, openAlerts: 0, adminAttention: 0 };

function shape(viewer: RailViewer, badges = noBadges) {
  return railGroups(viewer, hrefs, badges).map((group) => [
    group.label,
    group.items.map((item) => item.label),
  ]);
}

const consultant = { role: "writer", isOwner: false, isDeveloper: false } as const;
const manager = { role: "manager", isOwner: false, isDeveloper: false } as const;
const admin = { role: "admin", isOwner: false, isDeveloper: false } as const;

describe("railGroups: role by flag matrix", () => {
  it("Consultant sees Workspace and Other only (A1)", () => {
    expect(shape(consultant)).toEqual([
      ["Workspace", ["Home", "Projects", "Companies"]],
      ["Other", ["What's new", "Settings"]],
    ]);
  });

  it("Manager sees Team under Manage, no Admin", () => {
    expect(shape(manager)).toEqual([
      ["Workspace", ["Home", "Projects", "Companies"]],
      ["Manage", ["Team"]],
      ["Other", ["What's new", "Settings"]],
    ]);
  });

  it("Admin sees Team and Admin (A2, decision 53: no developer or Owner flag needed)", () => {
    expect(shape(admin)).toEqual([
      ["Workspace", ["Home", "Projects", "Companies"]],
      ["Manage", ["Team", "Admin"]],
      ["Other", ["What's new", "Settings"]],
    ]);
  });

  it("an Owner is an Admin in the rail", () => {
    expect(shape({ ...admin, isOwner: true })).toEqual(shape(admin));
  });

  it("a developer Admin gets the Developer group with Alerts (A3, decision 49)", () => {
    expect(shape({ ...admin, isDeveloper: true })).toEqual([
      ["Workspace", ["Home", "Projects", "Companies"]],
      ["Manage", ["Team", "Admin"]],
      ["Developer", ["Alerts", "Feature requests"]],
      ["Other", ["What's new", "Settings"]],
    ]);
  });

  it("a developer without ops.viewAlerts gets Feature requests only", () => {
    expect(shape({ ...consultant, isDeveloper: true })).toEqual([
      ["Workspace", ["Home", "Projects", "Companies"]],
      ["Developer", ["Feature requests"]],
      ["Other", ["What's new", "Settings"]],
    ]);
    expect(shape({ ...manager, isDeveloper: true })[2]).toEqual(["Developer", ["Feature requests"]]);
  });

  it("a roleless viewer sees no Manage group", () => {
    expect(shape({ role: null, isOwner: false, isDeveloper: false })).toEqual(shape(consultant));
  });

  it("never lists Flag issue, search or the current dashboard escape", () => {
    const labels = railGroups({ ...admin, isDeveloper: true }, hrefs, noBadges).flatMap((group) =>
      group.items.map((item) => item.label)
    );
    expect(labels).not.toContain("Flag issue");
    expect(labels).not.toContain("Current dashboard");
    expect(labels).not.toContain("Search");
  });
});

describe("railGroups: badges and attention", () => {
  it("counts What's new and Alerts, marks Admin attention", () => {
    const groups = railGroups({ ...admin, isDeveloper: true }, hrefs, {
      unseenChangelog: 2,
      openAlerts: 4,
      adminAttention: 1,
    });
    const items = groups.flatMap((group) => group.items);
    expect(items.find((item) => item.id === "changelog")?.badge).toEqual({ count: 2, tone: "primary" });
    expect(items.find((item) => item.id === "alerts")?.badge).toEqual({ count: 4, tone: "danger" });
    expect(items.find((item) => item.id === "admin")?.attention).toBe(true);
  });

  it("zero counts show no badge and no dot", () => {
    const items = railGroups({ ...admin, isDeveloper: true }, hrefs, noBadges).flatMap(
      (group) => group.items
    );
    expect(items.find((item) => item.id === "changelog")?.badge).toBeNull();
    expect(items.find((item) => item.id === "alerts")?.badge).toBeNull();
    expect(items.find((item) => item.id === "admin")?.attention).toBe(false);
  });
});

describe("selectedRailItem", () => {
  it.each([
    ["/my-work", "", "home"],
    ["/projects", "", "projects"],
    ["/projects", "?layout=table", "projects"],
    ["/projects", "?group=client", "projects"],
    ["/projects", "?layout=board&group=client", "projects"],
    ["/projects", "?group=stage", "projects"],
    ["/team", "", "team"],
    ["/admin/house-rules", "", "admin"],
    ["/alerts", "", "alerts"],
    ["/requests", "", "requests"],
    ["/changelog", "", "changelog"],
    ["/settings/account", "", "settings"],
    ["/project/abc", "", null],
    ["/teams", "", null],
  ] as const)("%s%s selects %s", (pathname, search, expected) => {
    expect(selectedRailItem({ pathname, search })).toBe(expected);
  });
});

describe("Companies href", () => {
  it("Companies adds the client grouping and keeps other params", () => {
    expect(companiesHrefFrom("/projects")).toBe("/projects?group=client");
    expect(companiesHrefFrom("/projects?layout=table&group=stage")).toBe(
      "/projects?layout=table&group=client"
    );
  });

});

describe("canViewTeam", () => {
  it("follows the team.view capability for every role (decision 47)", () => {
    for (const role of ["writer", "manager", "admin", null] as const) {
      expect(canViewTeam(role)).toBe(hasCapability(role, "team.view"));
    }
    expect(canViewTeam("writer")).toBe(false);
    expect(canViewTeam("manager")).toBe(true);
    expect(canViewTeam("admin")).toBe(true);
  });
});

describe("frameRailItems: the page frame's fixed labelled rail (owner, 2026-10-28)", () => {
  const frameHrefs = {
    projectsHref: "/projects",
    companiesHref: "/projects",
    teamHref: "/team",
    adminHref: "/admin/house-rules",
    settingsHref: "/settings",
  };
  const labels = (viewer: RailViewer, adminAttention = 0) => {
    const items = frameRailItems(viewer, frameHrefs, { adminAttention });
    return { top: items.top.map((item) => item.label), bottom: items.bottom.map((item) => item.label) };
  };
  const developerConsultant = { role: "writer", isOwner: false, isDeveloper: true } as const;
  const developerAdmin = { role: "admin", isOwner: false, isDeveloper: true } as const;

  it("Projects, Companies and Team (team.view) at the top; Admin (settings.configure) and Settings at the foot", () => {
    expect(labels(consultant)).toEqual({ top: ["Projects", "Companies"], bottom: ["Settings"] });
    expect(labels(manager)).toEqual({ top: ["Projects", "Companies", "Team"], bottom: ["Settings"] });
    expect(labels(admin)).toEqual({ top: ["Projects", "Companies", "Team"], bottom: ["Admin", "Settings"] });
    expect(labels({ role: "financial", isOwner: false, isDeveloper: false })).toEqual({ top: ["Projects", "Companies"], bottom: ["Settings"] });
    expect(labels({ role: null, isOwner: false, isDeveloper: false })).toEqual({ top: ["Projects", "Companies"], bottom: ["Settings"] });
  });

  it("has no Home, search, What's new, Assistant or developer rows, whatever the flags", () => {
    for (const viewer of [developerConsultant, developerAdmin]) {
      const all = Object.values(labels(viewer)).flat();
      expect(all).not.toContain("Home");
      expect(all).not.toContain("What's new");
      expect(all).not.toContain("Assistant");
      expect(all).not.toContain("Alerts");
      expect(all).not.toContain("Feature requests");
    }
    expect(labels(developerConsultant)).toEqual({ top: ["Projects", "Companies"], bottom: ["Settings"] });
  });

  it("puts the attention dot on Admin only when something needs a look", () => {
    expect(frameRailItems(admin, frameHrefs, { adminAttention: 0 }).bottom[0].attention).toBe(false);
    expect(frameRailItems(admin, frameHrefs, { adminAttention: 2 }).bottom[0]).toEqual({
      id: "admin",
      label: "Admin",
      href: "/admin/house-rules",
      attention: true,
    });
  });

  it("marks Projects for Home and every project page, Admin for its pages, Alerts and Feature requests", () => {
    const cases: [string, string | null][] = [
      ["/", "projects"],
      ["/my-work", "projects"],
      ["/projects", "projects"],
      ["/project/abc", "projects"],
      ["/project/new", "projects"],
      ["/team", "team"],
      ["/admin/brain", "admin"],
      ["/alerts", "admin"],
      ["/requests", "admin"],
      ["/settings/writing", "settings"],
      ["/changelog", null],
      ["/projects-archive", null],
      ["/teams", null],
    ];
    for (const [path, expected] of cases) expect(selectedFrameRailItem(path)).toBe(expected);
  });

  it("names the section sidebar each page draws (owner answers 1 and 5)", () => {
    const cases: [string, string | null][] = [
      ["/", "projects"],
      ["/my-work", "projects"],
      ["/projects", "projects"],
      ["/team", "team"],
      ["/admin/house-rules", "admin"],
      ["/settings/account", "settings"],
      ["/project/abc", null],
      ["/project/new", null],
      ["/changelog", null],
      ["/alerts", null],
      ["/requests", null],
    ];
    for (const [path, expected] of cases) expect(frameSectionForPath(path)).toBe(expected);
  });
});
