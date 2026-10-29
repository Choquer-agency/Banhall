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
const RECENT_COMPANIES_KEY = "banhall.recentCompanies.v1:u-c";

vi.mock("$lib/authClient", () => ({ authClient: { signOut: vi.fn(async () => {}) } }));
vi.mock("$lib/uploads/attemptOutbox", async (importOriginal) => {
  const actual = await importOriginal<typeof import("$lib/uploads/attemptOutbox")>();
  return { ...actual, clearAllOutboxes: vi.fn() };
});

/**
 * The drawer below 1024px (Rail v3, Paper board Z11a), kept as it was by the
 * owner's 2026-10-28 frame answer 6. The desktop rail is `FrameRail`.
 */
function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    variant: "drawer" as const,
    displayedView: "all_projects" as const,
    myWorkAvailable: true,
    myWorkHref: "/my-work?layout=board",
    projectsHref: "/projects",
    onFocusSearch: () => {},
    ...overrides,
  };
}

/** Mount inside a drawer element, so a fine pointer gets the drawer's 36px rows. */
async function mount(props: Record<string, unknown>) {
  const view = await render(WorkspaceRail, props as ReturnType<typeof baseProps>);
  view.container.setAttribute("data-workspace-drawer", "");
  return view;
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
const rows = (group: "top" | "bottom") =>
  Array.from(nav().querySelectorAll<HTMLElement>(`[data-rail-group="${group}"] [data-rail-item]`)).map((row) =>
    row.textContent?.replace(/\s+/g, " ").trim()
  );
const railRows = () => ({ top: rows("top"), bottom: rows("bottom") });
const style = (element: Element) => getComputedStyle(element);

describe("WorkspaceRail, the drawer (Rail v3)", () => {
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

  it("a Consultant gets Home, Projects and Companies, then Settings, with no group labels and no What's new", async () => {
    seed("consultant", { unseen: 2 });
    await mount(baseProps());
    await expect.poll(railRows).toEqual({ top: ["Home", "Projects", "Companies"], bottom: ["Settings"] });
    expect(nav().querySelector("[data-rail-group-label]")).toBeNull();
    expect(item("changelog")).toBeNull();
    expect(nav().textContent).not.toContain("What's new");
    expect(nav().textContent).not.toContain("Flag issue");
    // Board header: the 22px fir B tile and "Banhall" at 16/500.
    const tile = nav().querySelector<HTMLElement>("[data-rail-brand-tile]")!;
    expect(tile.getBoundingClientRect().width).toBe(22);
    expect(style(tile).backgroundColor).toBe("rgb(10, 58, 56)");
    const home = nav().querySelector<HTMLAnchorElement>('a[aria-label="Banhall home"]')!;
    expect(home.getAttribute("href")).toBe("/my-work?layout=board");
    const name = home.querySelector<HTMLElement>("span:not([data-rail-brand-tile])")!;
    expect([name.textContent, style(name).fontSize, style(name).fontWeight]).toEqual(["Banhall", "16px", "500"]);
    // The person's name at 14/500 and the role at 13 in muted ink, no chip or avatar.
    const identity = nav().querySelector<HTMLElement>("[data-rail-identity]")!;
    const person = identity.querySelector<HTMLElement>("[data-rail-identity-name]")!;
    const role = identity.querySelector<HTMLElement>("[data-rail-identity-role]")!;
    expect([person.textContent, style(person).fontSize, style(person).fontWeight]).toEqual(["Jane Ellis", "14px", "500"]);
    expect([role.textContent, style(role).fontSize, style(role).color]).toEqual(["Consultant", "13px", "rgb(107, 127, 123)"]);
    expect(identity.querySelector("[data-role-chip], [data-avatar]")).toBeNull();
  });

  it("Z11a values: 36px rows with 15px labels, the selected wash and the 36px search field", async () => {
    seed("admin");
    await mount(baseProps());
    await expect.poll(() => item("team")).not.toBeNull();
    const projects = item("projects")!;
    const homeRow = item("home")!;
    expect(projects.getBoundingClientRect().height).toBe(36);
    expect(style(projects).borderRadius).toBe("8px");
    expect([style(projects).paddingLeft, style(projects).columnGap]).toEqual(["10px", "10px"]);
    expect(projects.getAttribute("aria-current")).toBe("page");
    expect(style(projects).backgroundColor).toBe("rgb(241, 250, 249)");
    expect([style(projects).color, style(projects).fontWeight]).toEqual(["rgb(8, 122, 117)", "500"]);
    expect([style(homeRow).fontSize, style(homeRow).lineHeight, style(homeRow).color]).toEqual(["15px", "20px", "rgb(79, 97, 93)"]);
    expect(style(homeRow).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    // Board icons: 16px at stroke 1.7, drawn from the board.
    const paths: Record<string, string> = {
      home: "M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z",
      projects: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
      companies: "M4 20V6l7-3v17M11 9h8v11M7 9h1M7 13h1M15 13h1M15 16h1",
    };
    for (const [id, d] of Object.entries(paths)) {
      const icon = item(id)!.querySelector<SVGElement>(`[data-rail-icon="${id}"]`)!;
      expect([icon.getAttribute("width"), icon.getAttribute("stroke-width")]).toEqual(["16", "1.7"]);
      expect(icon.querySelector("path")?.getAttribute("d")).toBe(d);
    }
    // Search: 36px, white, a soft line, radius 8, "Search" at 14px muted.
    const search = nav().querySelector<HTMLElement>("[data-rail-search]")!;
    expect(search.getBoundingClientRect().height).toBe(36);
    expect([style(search).backgroundColor, style(search).borderTopColor, style(search).borderRadius]).toEqual([
      "rgb(255, 255, 255)",
      "rgb(233, 240, 239)",
      "8px",
    ]);
    expect(search.textContent?.trim()).toBe("Search");
    expect([style(search).fontSize, style(search).color]).toEqual(["14px", "rgb(107, 127, 123)"]);
    // Header: 38px, with no collapse control (the drawer never had one).
    expect(nav().querySelector<HTMLElement>("[data-rail-header]")!.getBoundingClientRect().height).toBe(38);
    expect(nav().querySelector("[data-rail-toggle]")).toBeNull();
    // A hairline under Settings, above the person.
    const bottom = nav().querySelector<HTMLElement>('[data-rail-group="bottom"]')!;
    expect([style(bottom).borderBottomWidth, style(bottom).borderBottomColor]).toEqual(["1px", "rgb(233, 240, 239)"]);
  });

  it("shows the Projects and Companies counts at 13px in muted ink", async () => {
    seed("consultant");
    __setQueryData("dashboard:getFacets", { total: 42, truncated: false, stageCounts: {} });
    __setQueryData("clients:listClients", {
      clients: Array.from({ length: 5 }, (_, index) => ({ key: `c${index}`, clientId: null, name: `C${index}`, projectCount: 1 })),
      truncated: true,
    });
    await mount(baseProps());
    await expect.poll(() => item("projects")?.querySelector("[data-rail-count]")?.textContent).toBe("42");
    const count = item("projects")!.querySelector<HTMLElement>("[data-rail-count]")!;
    expect([style(count).fontSize, style(count).color, style(count).fontWeight]).toEqual(["13px", "rgb(107, 127, 123)", "400"]);
    expect(item("companies")!.querySelector("[data-rail-count]")?.textContent).toBe("5+");
    expect(item("home")!.querySelector("[data-rail-count]")).toBeNull();
  });

  it("reads no count outside the Projects page", async () => {
    seed("consultant");
    await mount(baseProps({ displayedView: "my_work" }));
    await expect.poll(() => item("projects")).not.toBeNull();
    expect(__isQueryActive("dashboard:getFacets")).toBe(false);
    expect(__isQueryActive("clients:listClients")).toBe(false);
  });

  it("lists this person's recent companies, linked to the Projects page", async () => {
    seed("consultant");
    // Another person's list on the same browser never shows.
    localStorage.setItem("banhall.recentCompanies.v1:someone-else", JSON.stringify([{ key: "acme", name: "Acme" }]));
    localStorage.setItem(
      RECENT_COMPANIES_KEY,
      JSON.stringify([
        { key: "cedarline systems", name: "Cedarline Systems" },
        { key: "delta hydraulics", name: "Delta Hydraulics" },
        { key: "alder research", name: "Alder Research" },
      ])
    );
    const view = await mount(baseProps());
    await expect.poll(() => nav().querySelectorAll("[data-rail-recent-company]").length).toBe(3);
    const label = nav().querySelector<HTMLElement>("[data-rail-recent-label]")!;
    expect([label.textContent, style(label).fontSize, style(label).color]).toEqual([
      "Recent companies",
      "13px",
      "rgb(107, 127, 123)",
    ]);
    const companies = Array.from(nav().querySelectorAll<HTMLAnchorElement>("[data-rail-recent-company]"));
    expect(companies.map((link) => [link.textContent?.trim(), link.getAttribute("href")])).toEqual([
      ["Cedarline Systems", "/projects?client=cedarline+systems"],
      ["Delta Hydraulics", "/projects?client=delta+hydraulics"],
      ["Alder Research", "/projects?client=alder+research"],
    ]);
    // The drawer's rows are 36px with a fine pointer, 44px on touch.
    expect(companies[0].getBoundingClientRect().height).toBe(36);
    expect([style(companies[0]).fontSize, style(companies[0]).color]).toEqual(["14px", "rgb(79, 97, 93)"]);
    view.unmount();

    // With no recent company, the section is not drawn.
    localStorage.removeItem(RECENT_COMPANIES_KEY);
    await mount(baseProps());
    await expect.poll(() => item("home")).not.toBeNull();
    expect(nav().querySelector("[data-rail-recent]")).toBeNull();
  });

  it("gives Home and Projects real links; Companies opens All companies (2026-10-28)", async () => {
    seed("consultant");
    await mount(baseProps({ projectsHref: "/projects?layout=board" }));
    await expect.poll(() => item("home")).not.toBeNull();
    expect(item("home")!.getAttribute("href")).toBe("/my-work?layout=board");
    expect(item("projects")!.getAttribute("href")).toBe("/projects?layout=board");
    expect(item("companies")!.getAttribute("href")).toBe("/companies");
    expect(item("companies")!.getAttribute("aria-current")).toBeNull();
  });

  it("keeps Home disabled while My Work is not ready", async () => {
    seed("consultant");
    await mount(baseProps({ myWorkAvailable: false }));
    await expect.poll(() => item("home")?.getAttribute("aria-disabled")).toBe("true");
  });

  it("a Manager gets Team above Settings", async () => {
    seed("manager");
    await mount(baseProps());
    await expect.poll(railRows).toEqual({ top: ["Home", "Projects", "Companies"], bottom: ["Team", "Settings"] });
    expect(__isQueryActive("adminAttention:getAttention")).toBe(false);
  });

  it.each(["admin", "owner"] as const)("%s gets Team, Admin with the attention dot, and Settings", async (user) => {
    seed(user, { failed: 1 });
    await mount(baseProps());
    await expect.poll(railRows).toEqual({ top: ["Home", "Projects", "Companies"], bottom: ["Team", "Admin", "Settings"] });
    await expect.poll(() => item("admin")!.querySelector("[data-rail-attention]")).not.toBeNull();
    expect(item("admin")!.querySelector("[data-rail-attention]")!.className).toContain("bg-stale-dot");
    expect(item("team")!.getAttribute("href")).toBe("/team");
    expect(nav().querySelector("[data-rail-identity-role]")?.textContent).toBe(user === "owner" ? "Owner" : "Admin");
  });

  it("a developer Admin gets Alerts with the red count and Feature requests above Settings", async () => {
    seed("developerAdmin", { openAlerts: 4 });
    await mount(baseProps());
    await expect.poll(railRows).toEqual({
      top: ["Home", "Projects", "Companies"],
      bottom: ["Team", "Admin", "Alerts 4", "Feature requests", "Settings"],
    });
    expect(item("alerts")!.querySelector("[data-rail-badge]")!.className).toContain("bg-danger");
    expect(nav().querySelector("[data-rail-identity-role]")?.textContent).toBe("Developer");
  });

  it("decision 49: a developer without ops.viewAlerts gets Feature requests only and no Alerts subscription", async () => {
    seed("developerConsultant", { openAlerts: 4 });
    await mount(baseProps());
    await expect.poll(railRows).toEqual({ top: ["Home", "Projects", "Companies"], bottom: ["Feature requests", "Settings"] });
    expect(__isQueryActive("errorReports:openCount")).toBe(false);
  });

  it("B1, B2: the Admin chevron sits on the right, down closed and up open, and the choice persists", async () => {
    seed("admin", { failed: 1 });
    await mount(baseProps());
    await expect.poll(() => item("admin")).not.toBeNull();
    const toggle = item("admin") as HTMLButtonElement;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const chevron = toggle.querySelector<SVGElement>("[data-admin-chevron]")!;
    expect(chevron.getAttribute("data-admin-chevron")).toBe("down");
    expect(toggle.lastElementChild).toBe(chevron);
    expect(nav().querySelector("[data-rail-admin-links]")).toBeNull();
    expect(toggle.querySelector("[data-rail-attention]")).not.toBeNull();

    toggle.click();
    await expect.poll(() => toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.querySelector("[data-admin-chevron]")!.getAttribute("data-admin-chevron")).toBe("up");
    await expect.poll(() => style(toggle).color).toBe("rgb(22, 33, 31)");
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
    expect(links[0].getBoundingClientRect().height).toBe(36);
    expect(style(links[0]).fontSize).toBe("14px");
    expect(links[3].querySelector("[data-rail-attention]")).not.toBeNull();
    expect(JSON.parse(localStorage.getItem(RAIL_PREFERENCES_KEY)!).adminOpen).toBe(true);
  });

  it("B2: opens the Admin group on any admin page and marks the page", async () => {
    seed("admin");
    __setPageUrl("/admin/models");
    await mount(baseProps({ displayedView: null }));
    await expect.poll(() => item("admin")?.getAttribute("aria-expanded")).toBe("true");
    const models = nav().querySelector<HTMLAnchorElement>('[data-admin-link="/admin/models"]')!;
    expect(models.getAttribute("aria-current")).toBe("page");
    expect(style(models).backgroundColor).toBe("rgb(241, 250, 249)");
    expect(item("projects")!.getAttribute("aria-current")).toBeNull();
  });

  it("Projects stays selected inside a project and on New project", async () => {
    seed("consultant");
    __setPageUrl("/project/p1");
    await mount(baseProps({ displayedView: null }));
    await expect.poll(() => item("projects")?.getAttribute("aria-current")).toBe("page");
    expect(item("home")!.getAttribute("aria-current")).toBeNull();
    __setPageUrl("/project/new");
    await expect.poll(() => item("projects")?.getAttribute("aria-current")).toBe("page");
    __setPageUrl("/projects-archive");
    await expect.poll(() => item("projects")?.getAttribute("aria-current")).toBeNull();
  });

  it("search opens the palette, and the drawer draws no collapse control", async () => {
    seed("consultant");
    const onFocusSearch = vi.fn();
    await mount(baseProps({ onFocusSearch }));
    await expect.poll(() => item("home")).not.toBeNull();
    nav().querySelector<HTMLButtonElement>("[data-rail-search]")!.click();
    expect(onFocusSearch).toHaveBeenCalledOnce();
    expect(document.querySelector("[data-rail-toggle]")).toBeNull();
    expect(item("home")!.className).toContain("min-h-11");
  });

  it("D1: the name opens the account menu; developers get View as, everyone gets Flag an issue", async () => {
    seed("developerAdmin");
    await mount(baseProps());
    await expect.poll(() => nav().querySelector("[data-rail-identity]")?.textContent).toContain("Johnny Nguyen");
    await page.getByRole("button", { name: "Johnny Nguyen, account menu" }).click();
    const menu = page.getByRole("menu");
    await expect.element(menu).toBeVisible();
    const row = nav().querySelector<HTMLElement>("[data-rail-identity]")!;
    await expect.poll(() => style(row).backgroundColor).toBe("rgb(233, 241, 239)");
    expect(style(row).borderRadius).toBe("8px");
    const menuPanel = document.querySelector<HTMLElement>("[data-identity-menu]")!;
    await expect
      .poll(() => Math.round(row.getBoundingClientRect().top - menuPanel.getBoundingClientRect().bottom))
      .toBe(8);
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
    await mount(baseProps());
    await page.getByRole("button", { name: "Jane Ellis, account menu" }).click();
    await expect.element(page.getByRole("menuitem", { name: "Account" })).toBeVisible();
    expect(page.getByRole("menuitem", { name: /View as/ }).elements()).toHaveLength(0);
  });

  it("D3: the account menu's avatar keeps the person's own role colour while viewing as another role", async () => {
    seed("developerAdmin");
    viewAs.enter("consultant");
    await mount(baseProps());
    await page.getByRole("button", { name: "Johnny Nguyen, account menu" }).click();
    await expect
      .poll(() => {
        const avatar = document.querySelector<HTMLElement>("[data-identity-menu-header] [data-avatar]");
        return avatar ? style(avatar).backgroundColor : null;
      })
      .toBe("rgb(126, 34, 206)");
  });

  it("D1: Sign out needs no confirm; it signs out, clears outboxes and View as, then goes to login", async () => {
    seed("developerAdmin");
    viewAs.enter("consultant");
    await mount(baseProps());
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
    await mount(baseProps());
    await page.getByRole("button", { name: "Johnny Nguyen, account menu" }).click();
    await page.getByRole("menuitem", { name: "Account" }).click();
    await expect.poll(() => __navigationCalls).toEqual([{ kind: "goto", url: "/settings/account" }]);
    await page.getByRole("button", { name: "Johnny Nguyen, account menu" }).click();
    await page.getByRole("menuitem", { name: /View as another role/ }).click();
    expect(viewAs.dialogOpen).toBe(true);
    viewAs.dialogOpen = false;
  });

  it.each([
    ["consultant", ["Settings"], "Viewing as Consultant"],
    ["manager", ["Team", "Settings"], "Viewing as Manager"],
    ["admin", ["Team", "Admin", "Settings"], "Viewing as Admin"],
    ["owner", ["Team", "Admin", "Settings"], "Viewing as Owner"],
  ] as const)("D3: viewing as %s shows that role's rail and names the role under the person", async (role, bottom, label) => {
    seed("developerAdmin", { openAlerts: 2 });
    viewAs.enter(role);
    await mount(baseProps());
    await expect.poll(railRows).toEqual({ top: ["Home", "Projects", "Companies"], bottom: [...bottom] });
    expect(nav().querySelector("[data-rail-identity-role]")?.textContent).toBe(label);
  });

  it("View as is ignored for someone who is not a developer", async () => {
    seed("admin");
    sessionStorage.setItem("banhall.viewAs.v1", "consultant");
    viewAs.reload();
    await mount(baseProps());
    await expect.poll(railRows).toEqual({ top: ["Home", "Projects", "Companies"], bottom: ["Team", "Admin", "Settings"] });
    expect(nav().querySelector("[data-rail-identity-role]")?.textContent).toBe("Admin");
  });

  it("the keyboard reaches each control once, in order", async () => {
    seed("admin");
    await mount(baseProps());
    await expect.poll(() => item("admin")).not.toBeNull();
    (nav().querySelector('a[aria-label="Banhall home"]') as HTMLElement).focus();
    const reached: string[] = [];
    for (let step = 0; step < 8; step += 1) {
      await userEvent.keyboard("{Tab}");
      const active = document.activeElement as HTMLElement;
      reached.push(
        active.dataset.railItem ??
          (active.hasAttribute("data-rail-toggle")
            ? "toggle"
            : active.hasAttribute("data-rail-search")
              ? "search"
              : active.hasAttribute("data-rail-identity")
                ? "identity"
                : "?")
      );
    }
    expect(reached).toEqual(["search", "home", "projects", "companies", "team", "admin", "settings", "identity"]);
  });
});
