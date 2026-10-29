import { beforeEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import FrameRail from "./FrameRail.svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __isQueryActive, __resetConvexStub, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";
import { viewAs } from "$lib/shell/viewAs.svelte";
import { board } from "$lib/test/boardScale";

/** The page frame's fixed labelled rail (owner, 2026-10-28; Paper S9, S11). */
const USERS = {
  consultant: { _id: "u-c", firstName: "Jane", lastName: "Ellis", role: "writer" },
  manager: { _id: "u-m", firstName: "Mo", lastName: "Reyes", role: "manager" },
  admin: { _id: "u-a", firstName: "Ada", lastName: "Admin", role: "admin" },
  developerAdmin: { _id: "u-d", firstName: "Johnny", lastName: "Nguyen", role: "admin", isDeveloper: true },
  developerConsultant: { _id: "u-dc", firstName: "Dev", lastName: "Writer", role: "writer", isDeveloper: true },
} as const;

function seed(user: keyof typeof USERS, attention = 0) {
  __setQueryData("users:getCurrentUser", { imageUrl: null, ...USERS[user] });
  __setQueryData("adminAttention:getAttention", { total: attention, ingestionFailed: attention });
}

const nav = () => document.querySelector<HTMLElement>("[data-frame-rail]")!;
const item = (id: string) => nav().querySelector<HTMLAnchorElement>(`[data-rail-item="${id}"]`);
const labels = () => Array.from(nav().querySelectorAll<HTMLElement>("[data-rail-item]")).map((link) => link.textContent?.trim());
const style = (element: Element) => getComputedStyle(element);

describe("FrameRail", () => {
  beforeEach(async () => {
    __resetPage();
    __resetConvexStub();
    viewAs.clear();
    document.body.innerHTML = "";
    await page.viewport(1440, 900);
  });

  it("a Consultant gets Projects and Companies, the spacer, then Settings", async () => {
    seed("consultant");
    await render(FrameRail, { projectsHref: "/projects" });
    await expect.poll(labels).toEqual(["Projects", "Companies", "Settings"]);
    expect(__isQueryActive("adminAttention:getAttention")).toBe(false);
    // No Home, search, What's new, Assistant or developer rows.
    expect(nav().textContent).not.toMatch(/Home|Search|What's new|Assistant|Alerts|Feature requests/);
  });

  it("a Manager adds Team; an Admin adds Team and Admin at the foot", async () => {
    seed("manager");
    const view = await render(FrameRail, { projectsHref: "/projects" });
    await expect.poll(labels).toEqual(["Projects", "Companies", "Team", "Settings"]);
    view.unmount();
    seed("admin", 1);
    await render(FrameRail, { projectsHref: "/projects" });
    await expect.poll(labels).toEqual(["Projects", "Companies", "Team", "Admin", "Settings"]);
    await expect.poll(() => item("admin")!.querySelector("[data-rail-attention]")).not.toBeNull();
    expect(item("admin")!.getAttribute("aria-label")).toBe("Admin, needs a look");
    expect(item("team")!.getAttribute("href")).toBe("/team");
    expect(item("admin")!.getAttribute("href")).toBe("/admin/house-rules");
    expect(item("settings")!.getAttribute("href")).toBe("/settings");
    // Companies opens All companies, its own section since 2026-10-28.
    expect(item("companies")!.getAttribute("href")).toBe("/companies");
  });

  it("Companies opens All companies and is selected there and on every company page, not on Projects (2026-10-28)", async () => {
    seed("consultant");
    __setPageUrl("/projects?layout=list&client=acme");
    await render(FrameRail, { projectsHref: "/projects?layout=list&client=acme" });
    await expect.poll(() => item("companies")).not.toBeNull();
    expect(item("projects")!.getAttribute("href")).toBe("/projects?layout=list&client=acme");
    expect(item("companies")!.getAttribute("href")).toBe("/companies");
    // A company chosen on Projects stays under Projects.
    expect(item("projects")!.getAttribute("aria-current")).toBe("page");
    expect(item("companies")!.getAttribute("aria-current")).toBeNull();

    for (const path of ["/companies", "/companies/cedarline%20systems"]) {
      __setPageUrl(path);
      await expect.poll(() => item("companies")!.getAttribute("aria-current")).toBe("page");
      expect(item("projects")!.getAttribute("aria-current")).toBeNull();
      expect(item("companies")!.querySelector("[data-rail-tile]")!.className).toContain("bg-frame-tile");
    }
  });

  it("a developer Consultant gets no Admin and no developer rows (they sit in the Admin sidebar)", async () => {
    seed("developerConsultant");
    await render(FrameRail, { projectsHref: "/projects" });
    await expect.poll(labels).toEqual(["Projects", "Companies", "Settings"]);
  });

  it("View as shows the viewed role's rail", async () => {
    seed("developerAdmin");
    viewAs.enter("consultant");
    await render(FrameRail, { projectsHref: "/projects" });
    await expect.poll(labels).toEqual(["Projects", "Companies", "Settings"]);
    viewAs.exit();
    await expect.poll(labels).toEqual(["Projects", "Companies", "Team", "Admin", "Settings"]);
  });

  it("S9 values: 80px wide, 10 8 14 padding, 6px apart; 64px items with a 40 by 36 tile over a 12/16 label", async () => {
    seed("admin");
    __setPageUrl("/projects");
    await render(FrameRail, { projectsHref: "/projects" });
    await expect.poll(() => item("admin")).not.toBeNull();
    const rail = style(nav());
    expect(nav().getBoundingClientRect().width).toBeCloseTo(board(80), 1);
    expect([rail.paddingTop, rail.paddingLeft, rail.paddingBottom, rail.rowGap].map(parseFloat)).toEqual(
      [10, 8, 14, 6].map(board)
    );
    const projects = item("projects")!;
    expect(projects.getBoundingClientRect().width).toBeCloseTo(board(64), 1);
    expect(projects.getBoundingClientRect().height).toBeCloseTo(board(56), 1);
    const tile = projects.querySelector<HTMLElement>("[data-rail-tile]")!;
    expect([tile.getBoundingClientRect().width, tile.getBoundingClientRect().height]).toEqual([board(40), board(36)]);
    expect(style(tile).borderRadius).toBe(`${board(10)}px`);
    // Active: the frame tile, ink label at 500, the active duotone icon.
    expect(projects.getAttribute("aria-current")).toBe("page");
    expect(style(tile).backgroundColor).toBe("rgb(228, 228, 228)");
    const label = projects.querySelector<HTMLElement>("[data-rail-label]")!;
    expect([label.textContent, style(label).fontSize, style(label).lineHeight, style(label).fontWeight, style(label).color]).toEqual([
      "Projects",
      `${board(12)}px`,
      `${board(16)}px`,
      "500",
      "rgb(22, 33, 31)",
    ]);
    const icon = projects.querySelector<SVGElement>('[data-frame-icon="projects"]')!;
    expect(icon.hasAttribute("data-frame-icon-active")).toBe(true);
    expect(icon.getBoundingClientRect().width).toBeCloseTo(board(20), 1);
    // At rest: no tile fill, secondary ink, weight 400, the quiet duotone.
    const team = item("team")!;
    expect(style(team.querySelector("[data-rail-tile]")!).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    const teamLabel = team.querySelector<HTMLElement>("[data-rail-label]")!;
    expect([style(teamLabel).fontWeight, style(teamLabel).color]).toEqual(["400", "rgb(79, 97, 93)"]);
    expect(team.querySelector("[data-frame-icon]")!.hasAttribute("data-frame-icon-active")).toBe(false);
    // The spacer pushes Admin and Settings to the foot.
    nav().style.height = "800px";
    const bottom = nav().getBoundingClientRect().bottom;
    expect(bottom - item("settings")!.getBoundingClientRect().bottom).toBeCloseTo(board(14), 0);
  });

  it("marks Projects on Home, every project page and New project; Admin on Alerts and Feature requests", async () => {
    seed("developerAdmin");
    await render(FrameRail, { projectsHref: "/projects" });
    await expect.poll(() => item("admin")).not.toBeNull();
    const current = () => nav().querySelector("[aria-current='page']")?.getAttribute("data-rail-item") ?? null;
    for (const [url, expected] of [
      ["/my-work", "projects"],
      ["/projects?client=acme", "projects"],
      ["/project/p1", "projects"],
      ["/project/new", "projects"],
      ["/team", "team"],
      ["/admin/models", "admin"],
      ["/alerts", "admin"],
      ["/requests", "admin"],
      ["/settings/account", "settings"],
      ["/changelog", null],
      ["/projects-archive", null],
    ] as const) {
      __setPageUrl(url);
      await expect.poll(current).toBe(expected);
    }
  });
});
