import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import WorkspaceRail from "./WorkspaceRail.svelte";
import { authClient } from "$lib/authClient";
import { clearAllOutboxes } from "$lib/uploads/attemptOutbox";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __navigationCalls, __resetNavigation } from "$lib/test/app-navigation-stub";
import { __isQueryActive, __resetConvexStub, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";
import { viewAs } from "$lib/shell/viewAs.svelte";
import { RAIL_PREFERENCES_KEY } from "$lib/workspace/railPreferences";

vi.mock("$lib/authClient", () => ({ authClient: { signOut: vi.fn(async () => {}) } }));
vi.mock("$lib/uploads/attemptOutbox", async (importOriginal) => {
  const actual = await importOriginal<typeof import("$lib/uploads/attemptOutbox")>();
  return { ...actual, clearAllOutboxes: vi.fn() };
});

/** Round 2 rail (boards A1 to A5, B1, B2; decision 53). */
function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    variant: "rail" as const,
    displayedView: "all_projects" as const,
    myWorkAvailable: true,
    myWorkHref: "/my-work?layout=board",
    projectsHref: "/projects?layout=board",
    onFocusSearch: () => {},
    ...overrides,
  };
}

const USERS = {
  consultant: { _id: "u-c", firstName: "Jane", lastName: "Ellis", email: "jane@banhall.com", role: "writer" },
  manager: { _id: "u-m", firstName: "Mo", lastName: "Reyes", role: "manager" },
  admin: { _id: "u-a", firstName: "Ada", lastName: "Admin", role: "admin" },
  owner: { _id: "u-o", firstName: "Olu", lastName: "Owner", role: "admin", isOwner: true },
  developerAdmin: {
    _id: "u-d",
    firstName: "Johnny",
    lastName: "Nguyen",
    email: "johnny@banhall.com",
    role: "admin",
    isDeveloper: true,
  },
  developerConsultant: { _id: "u-dc", firstName: "Dev", lastName: "Writer", role: "writer", isDeveloper: true },
} as const;

function seed(user: keyof typeof USERS, extra: { openAlerts?: number; unseen?: number; failed?: number } = {}) {
  __setQueryData("users:getCurrentUser", { imageUrl: null, ...USERS[user] });
  __setQueryData("errorReports:openCount", extra.openAlerts ?? 0);
  __setQueryData("changelog:unseenCount", extra.unseen ?? 0);
  const failed = extra.failed ?? 0;
  __setQueryData("adminAttention:getAttention", { total: failed > 0 ? 1 : 0, ingestionFailed: failed });
}

const nav = () => document.querySelector<HTMLElement>('nav[aria-label="Workspace"]')!;
const item = (id: string) => nav().querySelector<HTMLElement>(`[data-rail-item="${id}"]`);
const groupLabels = () =>
  Array.from(nav().querySelectorAll<HTMLElement>("[data-rail-group]")).map((group) => [
    group.querySelector("p")?.textContent?.trim(),
    Array.from(group.querySelectorAll<HTMLElement>("[data-rail-item]")).map((row) =>
      row.textContent?.replace(/\s+/g, " ").trim()
    ),
  ]);

describe("WorkspaceRail (round 2)", () => {
  beforeEach(() => {
    __resetPage();
    __resetNavigation();
    __resetConvexStub();
    localStorage.clear();
    sessionStorage.clear();
    viewAs.clear();
    vi.mocked(authClient.signOut).mockClear();
    vi.mocked(clearAllOutboxes).mockClear();
  });

  it("A1: a Consultant sees Workspace and Other, with the identity chip and no Flag issue or search row", async () => {
    seed("consultant", { unseen: 2 });
    await render(WorkspaceRail, baseProps());
    await expect.poll(groupLabels).toEqual([
      ["Workspace", ["Home", "Projects", "Companies"]],
      ["Other", ["What's new 2", "Settings"]],
    ]);
    expect(nav().textContent).not.toContain("Flag issue");
    expect(nav().textContent).not.toContain("Current dashboard");
    expect(nav().querySelector('button[aria-label="Search projects"]')).toBeNull();
    const identity = nav().querySelector<HTMLElement>("[data-rail-identity]")!;
    expect(identity.textContent).toContain("Jane Ellis");
    expect(identity.querySelector("[data-role-chip]")?.textContent?.trim()).toBe("Consultant");
    expect(nav().querySelector("[data-banhall-rail-mark]")).not.toBeNull();
    // Count badge: 18px, primary-selected on What's new.
    const badge = item("changelog")!.querySelector<HTMLElement>("[data-rail-badge]")!;
    expect(badge.getBoundingClientRect().height).toBe(18);
    expect(badge.className).toContain("bg-primary-selected");
  });

  it("A1 to A3 values: muted 11px group labels, board icons at 15 / 1.5, and the 16px collapse glyph", async () => {
    seed("developerAdmin", { openAlerts: 4 });
    await render(WorkspaceRail, baseProps({ onToggleRail: () => {} }));
    await expect.poll(() => item("alerts")).not.toBeNull();
    const labels = Array.from(nav().querySelectorAll<HTMLElement>("[data-rail-group-label]"));
    expect(labels.map((label) => label.textContent?.trim())).toEqual(["Workspace", "Manage", "Developer", "Other"]);
    for (const label of labels) {
      expect(getComputedStyle(label).color).toBe("rgb(107, 127, 123)");
      expect(getComputedStyle(label).fontSize).toBe("11px");
      expect(getComputedStyle(label).lineHeight).toBe("16px");
    }
    const paths: Record<string, string> = {
      home: "M3 10l9-7 9 7v10H3Z M9 20v-7h6v7",
      projects: "M3 6h6l2 2h10v12H3Z",
      team: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M2 21a7 7 0 0 1 14 0 M16 3.5a4 4 0 0 1 0 7 M18 14a7 7 0 0 1 4 7",
      admin: "M12 3 5 6v5.5c0 4.3 3 7.7 7 9.5 4-1.8 7-5.2 7-9.5V6Z",
      alerts: "M12 9v4 M12 17h.01 M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
    };
    for (const [id, d] of Object.entries(paths)) {
      const icon = item(id)!.querySelector<SVGElement>(`[data-rail-icon="${id}"]`)!;
      expect(icon.getAttribute("viewBox")).toBe("0 0 24 24");
      expect(icon.getAttribute("width")).toBe("15");
      expect(icon.getAttribute("stroke-width")).toBe("1.5");
      expect(icon.querySelector("path")?.getAttribute("d")).toBe(d);
    }
    // Admin chevron: the board's 14px, stroke 1.8, in muted ink.
    const chevron = item("admin")!.querySelector<SVGElement>("[data-admin-chevron]")!;
    expect(chevron.getAttribute("width")).toBe("14");
    expect(chevron.getAttribute("stroke-width")).toBe("1.8");
    expect(chevron.querySelector("path")?.getAttribute("d")).toBe("m6 9 6 6 6-6");
    expect(getComputedStyle(chevron).color).toBe("rgb(107, 127, 123)");
    const toggle = nav().querySelector<SVGElement>('[data-rail-toggle] svg[data-rail-toggle-icon="collapse"]')!;
    expect(toggle.getAttribute("width")).toBe("16");
    expect(toggle.querySelector("rect")).not.toBeNull();
    expect(nav().querySelector('[data-rail-toggle] svg:not([data-rail-toggle-icon])')).toBeNull();
    // The identity row: 44px, name 12/16 in ink.
    const identity = nav().querySelector<HTMLElement>("[data-rail-identity]")!;
    expect(identity.getBoundingClientRect().height).toBe(44);
  });

  it("gives Home and Projects real links; Companies is the Projects view grouped by client", async () => {
    seed("consultant");
    await render(WorkspaceRail, baseProps());
    await expect.poll(() => item("home")).not.toBeNull();
    expect(item("home")!.getAttribute("href")).toBe("/my-work?layout=board");
    expect(item("projects")!.getAttribute("href")).toBe("/projects?layout=board");
    expect(item("companies")!.getAttribute("href")).toBe("/projects?layout=board&group=client");
    expect(item("projects")!.getAttribute("aria-current")).toBe("page");
    expect(item("projects")!.className).toContain("bg-workspace-rail-selected");
    expect(item("projects")!.className).toContain("text-fir");
    expect(item("companies")!.getAttribute("aria-current")).toBeNull();
    expect(item("home")!.getBoundingClientRect().height).toBe(32);
  });

  it("keeps Home disabled while My Work is not ready", async () => {
    seed("consultant");
    await render(WorkspaceRail, baseProps({ myWorkAvailable: false }));
    await expect.poll(() => item("home")?.getAttribute("aria-disabled")).toBe("true");
  });

  it("a Manager gets Team only under Manage", async () => {
    seed("manager");
    await render(WorkspaceRail, baseProps());
    await expect.poll(groupLabels).toEqual([
      ["Workspace", ["Home", "Projects", "Companies"]],
      ["Manage", ["Team"]],
      ["Other", ["What's new", "Settings"]],
    ]);
    expect(__isQueryActive("adminAttention:getAttention")).toBe(false);
  });

  it.each(["admin", "owner"] as const)("A2: %s gets Team and Admin (decision 53), with the attention dot", async (user) => {
    seed(user, { failed: 1 });
    await render(WorkspaceRail, baseProps());
    await expect.poll(groupLabels).toEqual([
      ["Workspace", ["Home", "Projects", "Companies"]],
      ["Manage", ["Team", "Admin"]],
      ["Other", ["What's new", "Settings"]],
    ]);
    await expect.poll(() => item("admin")!.querySelector("[data-rail-attention]")).not.toBeNull();
    expect(item("admin")!.querySelector("[data-rail-attention]")!.className).toContain("bg-stale-dot");
    expect(item("team")!.getAttribute("href")).toBe("/team");
    const chip = nav().querySelector("[data-rail-identity] [data-role-chip]")!;
    expect(chip.textContent?.trim()).toBe(user === "owner" ? "Owner" : "Admin");
  });

  it("A3: a developer Admin gets the Developer group with the red Alerts count", async () => {
    seed("developerAdmin", { openAlerts: 4 });
    await render(WorkspaceRail, baseProps());
    await expect.poll(groupLabels).toEqual([
      ["Workspace", ["Home", "Projects", "Companies"]],
      ["Manage", ["Team", "Admin"]],
      ["Developer", ["Alerts 4", "Feature requests"]],
      ["Other", ["What's new", "Settings"]],
    ]);
    expect(item("alerts")!.querySelector("[data-rail-badge]")!.className).toContain("bg-danger");
    expect(nav().querySelector("[data-rail-identity] [data-role-chip]")?.textContent?.trim()).toBe("Developer");
  });

  it("decision 49: a developer without ops.viewAlerts gets Feature requests only and no Alerts subscription", async () => {
    seed("developerConsultant", { openAlerts: 4 });
    await render(WorkspaceRail, baseProps());
    await expect.poll(groupLabels).toEqual([
      ["Workspace", ["Home", "Projects", "Companies"]],
      ["Developer", ["Feature requests"]],
      ["Other", ["What's new", "Settings"]],
    ]);
    expect(__isQueryActive("errorReports:openCount")).toBe(false);
  });

  it("B1, B2: the Admin chevron points down closed and up open, and the choice persists", async () => {
    seed("admin", { failed: 1 });
    await render(WorkspaceRail, baseProps());
    await expect.poll(() => item("admin")).not.toBeNull();
    const toggle = item("admin") as HTMLButtonElement;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.querySelector("[data-admin-chevron]")!.getAttribute("data-admin-chevron")).toBe("down");
    expect(nav().querySelector("[data-rail-admin-links]")).toBeNull();

    expect(getComputedStyle(toggle.querySelector("span")!).color).toBe("rgb(79, 97, 93)");
    expect(toggle.querySelector("[data-rail-attention]")).not.toBeNull();

    toggle.click();
    await expect.poll(() => toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.querySelector("[data-admin-chevron]")!.getAttribute("data-admin-chevron")).toBe("up");
    // B2: open, the label is ink and the dot moves down to OneDrive import.
    await expect.poll(() => getComputedStyle(toggle.querySelector("span")!).color).toBe("rgb(22, 33, 31)");
    expect(toggle.querySelector("[data-rail-attention]")).toBeNull();
    const links = Array.from(nav().querySelectorAll<HTMLAnchorElement>("[data-admin-link]"));
    expect(links.map((link) => [link.textContent?.trim(), link.getAttribute("href")])).toEqual([
      ["House rules", "/admin/house-rules"],
      ["Project tags", "/admin/tags"],
      ["The Brain", "/admin/brain"],
      ["OneDrive import", "/admin/ingestion"],
      ["Models", "/admin/models"],
      ["QA reviews", "/admin/reviews"],
      ["Learning health", "/admin/learning"],
      ["AI usage and cost", "/admin/usage"],
    ]);
    expect(links[0].getBoundingClientRect().height).toBe(28);
    expect(links[3].querySelector("[data-rail-attention]")).not.toBeNull();
    expect(nav().textContent).not.toContain("Users and roles");
    expect(JSON.parse(localStorage.getItem(RAIL_PREFERENCES_KEY)!).adminOpen).toBe(true);
  });

  it("B2: opens the Admin group on any admin page and marks the page", async () => {
    seed("admin");
    __setPageUrl("/admin/models");
    await render(WorkspaceRail, baseProps({ displayedView: null }));
    await expect.poll(() => item("admin")?.getAttribute("aria-expanded")).toBe("true");
    const models = nav().querySelector<HTMLAnchorElement>('[data-admin-link="/admin/models"]')!;
    expect(models.getAttribute("aria-current")).toBe("page");
    expect(models.className).toContain("bg-workspace-rail-selected");
    // B3: the open group's label is ink; its shield stays secondary; the chevron points up.
    const admin = item("admin")!;
    expect(getComputedStyle(admin.querySelector("span")!).color).toBe("rgb(22, 33, 31)");
    expect(getComputedStyle(admin.querySelector('[data-rail-icon="admin"]')!).color).toBe("rgb(79, 97, 93)");
    expect(admin.querySelector("[data-admin-chevron]")!.getAttribute("data-admin-chevron")).toBe("up");
  });

  it("A4: the collapsed rail is icons only in board order, with tooltips' names and no role chip", async () => {
    seed("admin", { unseen: 3, failed: 1 });
    await render(WorkspaceRail, baseProps({ collapsed: true, onToggleRail: () => {} }));
    await expect.poll(() => item("admin")).not.toBeNull();
    const order = Array.from(nav().querySelectorAll<HTMLElement>("[data-rail-item], [data-rail-search], [data-rail-toggle]")).map(
      (element) => element.getAttribute("data-rail-item") ?? (element.hasAttribute("data-rail-search") ? "search" : "toggle")
    );
    expect(order).toEqual(["toggle", "search", "home", "projects", "companies", "team", "admin", "changelog", "settings"]);
    for (const id of ["home", "projects", "companies", "team", "changelog", "settings"]) {
      expect(item(id)!.getAttribute("aria-label")).toBeTruthy();
      expect(item(id)!.getBoundingClientRect().width).toBe(36);
    }
    // No labels: only the avatar's initials are text.
    expect(nav().textContent?.trim()).toBe("AA");
    expect(nav().querySelector("[data-role-chip]")).toBeNull();
    // What's new is a 7px dot here, not a count.
    expect(item("changelog")!.querySelector("[data-rail-dot]")).not.toBeNull();
    expect(item("changelog")!.querySelector("[data-rail-badge]")).toBeNull();
    expect(item("admin")!.querySelector("[data-rail-attention]")).not.toBeNull();
    expect(nav().querySelector<HTMLElement>("[data-rail-identity] [data-avatar]")!.getBoundingClientRect().width).toBe(30);
    // A4: 17px icons at stroke 1.5, the 17px expand glyph and the search glass.
    expect(item("home")!.querySelector("svg")!.getAttribute("width")).toBe("17");
    expect(item("home")!.querySelector("svg")!.getAttribute("stroke-width")).toBe("1.5");
    expect(nav().querySelector('[data-rail-toggle] svg')!.getAttribute("width")).toBe("17");
    const search = nav().querySelector<SVGElement>("[data-rail-search] svg")!;
    expect(search.getAttribute("width")).toBe("17");
    expect(search.querySelector("path")?.getAttribute("d")).toBe("M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z M20 20l-4-4");
  });

  it("A5: the collapsed developer rail puts Alerts with a count and Feature requests near the bottom", async () => {
    seed("developerAdmin", { openAlerts: 4 });
    await render(WorkspaceRail, baseProps({ collapsed: true }));
    await expect.poll(() => item("alerts")).not.toBeNull();
    const ids = Array.from(nav().querySelectorAll<HTMLElement>("[data-rail-item]")).map((el) => el.dataset.railItem);
    expect(ids).toEqual(["home", "projects", "companies", "team", "admin", "alerts", "requests", "changelog", "settings"]);
    expect(item("alerts")!.querySelector("[data-rail-badge]")?.textContent?.trim()).toBe("4");
  });

  it("collapse and expand toggles are wired, and search opens the palette from the collapsed rail", async () => {
    seed("consultant");
    const onToggleRail = vi.fn();
    const onFocusSearch = vi.fn();
    const view = await render(WorkspaceRail, baseProps({ onToggleRail, onFocusSearch }));
    const collapse = nav().querySelector<HTMLButtonElement>('[data-rail-toggle][data-rail-direction="collapse"]')!;
    expect(collapse.getAttribute("aria-controls")).toBe("workspace-rail");
    collapse.click();
    expect(onToggleRail).toHaveBeenCalledOnce();
    view.unmount();

    await render(WorkspaceRail, baseProps({ collapsed: true, onToggleRail, onFocusSearch }));
    nav().querySelector<HTMLButtonElement>('[data-rail-toggle][data-rail-direction="expand"]')!.click();
    expect(onToggleRail).toHaveBeenCalledTimes(2);
    nav().querySelector<HTMLButtonElement>("[data-rail-search]")!.click();
    expect(onFocusSearch).toHaveBeenCalledOnce();
  });

  it("does not render the desktop collapse control inside the mobile drawer and keeps 44px rows there", async () => {
    seed("consultant");
    await render(WorkspaceRail, baseProps({ variant: "drawer", onToggleRail: () => {} }));
    await expect.poll(() => item("home")).not.toBeNull();
    expect(document.querySelector("[data-rail-toggle]")).toBeNull();
    expect(item("home")!.className).toContain("min-h-11");
  });

  it("D1: the identity row opens the account menu; developers get View as, everyone gets Flag an issue", async () => {
    seed("developerAdmin");
    await render(WorkspaceRail, baseProps());
    await expect.poll(() => nav().querySelector("[data-rail-identity]")?.textContent).toContain("Johnny Nguyen");
    await page.getByRole("button", { name: "Johnny Nguyen, account menu" }).click();
    const menu = page.getByRole("menu");
    await expect.element(menu).toBeVisible();
    // D1: the open row takes the selected fill at radius 8; the menu sits 8px above it.
    const row = nav().querySelector<HTMLElement>("[data-rail-identity]")!;
    await expect.poll(() => getComputedStyle(row).backgroundColor).toBe("rgb(233, 241, 239)");
    expect(getComputedStyle(row).borderRadius).toBe("8px");
    const menuPanel = document.querySelector<HTMLElement>("[data-identity-menu]")!;
    await expect
      .poll(() => Math.round(row.getBoundingClientRect().top - menuPanel.getBoundingClientRect().bottom))
      .toBe(8);
    const menuIcons = Array.from(menuPanel.querySelectorAll<SVGElement>('[role="menuitem"] svg'));
    expect(menuIcons.map((icon) => icon.getAttribute("width"))).toEqual(["15", "15", "15", "15"]);
    expect(menuIcons.map((icon) => icon.getAttribute("stroke-width"))).toEqual(["1.5", "1.5", "1.5", "1.5"]);
    expect(menuIcons[0].querySelector("path")?.getAttribute("d")).toBe("M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M4 21a8 8 0 0 1 16 0");
    expect(menuIcons[3].querySelector("path")?.getAttribute("d")).toBe("M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4 M10 16l-4-4 4-4 M6 12h10");
    const items = Array.from(document.querySelectorAll<HTMLElement>('[data-identity-menu] [role="menuitem"]')).map(
      (element) => element.textContent?.replace(/\s+/g, " ").trim()
    );
    expect(items[0]).toBe("Account");
    expect(items[1]).toMatch(/^View as another role (⇧V|Shift V)$/);
    expect(items.slice(2)).toEqual(["Flag an issue", "Sign out"]);
    expect(document.querySelector("[data-identity-menu-header]")?.textContent).toContain("johnny@banhall.com");

    const flagged = vi.fn();
    window.addEventListener("banhall:flag-issue", flagged, { once: true });
    await page.getByRole("menuitem", { name: "Flag an issue" }).click();
    expect(flagged).toHaveBeenCalledOnce();
  });

  it("D1: a Consultant's menu has no View as", async () => {
    seed("consultant");
    await render(WorkspaceRail, baseProps());
    await page.getByRole("button", { name: "Jane Ellis, account menu" }).click();
    await expect.element(page.getByRole("menuitem", { name: "Account" })).toBeVisible();
    expect(page.getByRole("menuitem", { name: /View as/ }).elements()).toHaveLength(0);
  });

  it("D1: Sign out needs no confirm; it signs out, clears outboxes and View as, then goes to login", async () => {
    seed("developerAdmin");
    viewAs.enter("consultant");
    await render(WorkspaceRail, baseProps());
    await page.getByRole("button", { name: "Johnny Nguyen, account menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect.poll(() => __navigationCalls).toEqual([{ kind: "goto", url: "/login" }]);
    expect(authClient.signOut).toHaveBeenCalledOnce();
    expect(clearAllOutboxes).toHaveBeenCalledOnce();
    expect(viewAs.role).toBeNull();
    expect(sessionStorage.getItem("banhall.viewAs.v1")).toBeNull();
  });

  it("D1: Account goes to /settings/account and View as opens the dialog state", async () => {
    seed("developerAdmin");
    await render(WorkspaceRail, baseProps());
    await page.getByRole("button", { name: "Johnny Nguyen, account menu" }).click();
    await page.getByRole("menuitem", { name: "Account" }).click();
    await expect.poll(() => __navigationCalls).toEqual([{ kind: "goto", url: "/settings/account" }]);
    await page.getByRole("button", { name: "Johnny Nguyen, account menu" }).click();
    await page.getByRole("menuitem", { name: /View as another role/ }).click();
    expect(viewAs.dialogOpen).toBe(true);
    viewAs.dialogOpen = false;
  });

  it.each([
    ["consultant", [["Workspace", ["Home", "Projects", "Companies"]], ["Other", ["What's new", "Settings"]]], "Viewing as Consultant"],
    ["manager", [["Workspace", ["Home", "Projects", "Companies"]], ["Manage", ["Team"]], ["Other", ["What's new", "Settings"]]], "Viewing as Manager"],
    ["admin", [["Workspace", ["Home", "Projects", "Companies"]], ["Manage", ["Team", "Admin"]], ["Other", ["What's new", "Settings"]]], "Viewing as Admin"],
    ["owner", [["Workspace", ["Home", "Projects", "Companies"]], ["Manage", ["Team", "Admin"]], ["Other", ["What's new", "Settings"]]], "Viewing as Owner"],
  ] as const)("D3: viewing as %s shows that role's rail and a Viewing as chip", async (role, groups, chip) => {
    seed("developerAdmin", { openAlerts: 2 });
    viewAs.enter(role);
    await render(WorkspaceRail, baseProps());
    await expect.poll(groupLabels).toEqual(groups);
    const chipElement = nav().querySelector<HTMLElement>("[data-rail-identity] [data-role-chip]")!;
    expect(chipElement.textContent?.trim()).toBe(chip);
    expect(chipElement.dataset.roleChip).toBe(role);
  });

  it("View as is ignored for someone who is not a developer", async () => {
    seed("admin");
    sessionStorage.setItem("banhall.viewAs.v1", "consultant");
    viewAs.reload();
    await render(WorkspaceRail, baseProps());
    await expect.poll(groupLabels).toEqual([
      ["Workspace", ["Home", "Projects", "Companies"]],
      ["Manage", ["Team", "Admin"]],
      ["Other", ["What's new", "Settings"]],
    ]);
    expect(nav().querySelector("[data-rail-identity] [data-role-chip]")?.textContent?.trim()).toBe("Admin");
  });

  it("the keyboard reaches each row once, in order", async () => {
    seed("admin");
    await render(WorkspaceRail, baseProps({ onToggleRail: () => {} }));
    await expect.poll(() => item("admin")).not.toBeNull();
    (nav().querySelector('a[aria-label="Banhall home"]') as HTMLElement).focus();
    const reached: string[] = [];
    for (let step = 0; step < 9; step += 1) {
      await userEvent.keyboard("{Tab}");
      const active = document.activeElement as HTMLElement;
      reached.push(active.dataset.railItem ?? (active.hasAttribute("data-rail-toggle") ? "toggle" : active.hasAttribute("data-rail-identity") ? "identity" : "?"));
    }
    expect(reached).toEqual(["toggle", "home", "projects", "companies", "team", "admin", "changelog", "settings", "identity"]);
  });
});
