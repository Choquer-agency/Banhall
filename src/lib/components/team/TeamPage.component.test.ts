import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import { toast } from "svelte-sonner";
import TeamPage from "./TeamPage.svelte";
import {
  __activeQueryCount,
  __mutationCalls,
  __resetConvexStub,
  __setMutationResult,
  __setQueryData,
} from "$lib/test/convex-svelte-stub.svelte";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import { __resetPage } from "$lib/test/app-state-stub.svelte";
import { viewAs } from "$lib/shell/viewAs.svelte";
import { board, boardPx } from "$lib/test/boardScale";
import { reloadSectionSidebar } from "$lib/workspace/sectionSidebar.svelte";

const enter = (role: Parameters<typeof viewAs.enter>[0]) => viewAs.enter(role);
const exit = () => viewAs.exit();

const NOW = Date.parse("2026-09-26T19:00:00Z");
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

const ADMIN = { _id: "u-admin", firstName: "Bryce", lastName: "Choquer", email: "bryce@banhall.com", role: "admin", isOwner: true };
const MANAGER = { _id: "u-manager", firstName: "Sam", lastName: "Chen", email: "sam@banhall.com", role: "manager" };

const MEMBERS = [
  { _id: "u-admin", name: "Bryce Choquer", firstName: "Bryce", lastName: "Choquer", email: "bryce@banhall.com", role: "admin", isOwner: true, isDeveloper: false, lastActiveAt: null, isSelf: true },
  { _id: "u-larry", name: "Larry Moss", firstName: "Larry", lastName: "Moss", email: "larry@banhall.com", role: "writer", isOwner: false, isDeveloper: false, lastActiveAt: NOW - 12 * MIN, isSelf: false },
  { _id: "u-sam", name: "Sam Chen", firstName: "Sam", lastName: "Chen", email: "sam@banhall.com", role: "manager", isOwner: false, isDeveloper: false, lastActiveAt: NOW - 60 * MIN, isSelf: false },
  { _id: "u-new", name: "New Person", firstName: "New", lastName: "Person", email: "new@banhall.com", role: "writer", isOwner: false, isDeveloper: true, lastActiveAt: null, isSelf: false },
];

const INVITES = [
  { _id: "i-ana", email: "ana.ruiz@banhall.com", role: "writer", invitedByName: "Bryce Choquer", sentAt: NOW - 2 * DAY, expiresAt: NOW + 5 * DAY, expired: false, canManage: true, token: "tok-ana" },
  { _id: "i-mt", email: "m.tremblay@banhall.com", role: "manager", invitedByName: "Sam Chen", sentAt: Date.parse("2026-09-10T18:00:00Z"), expiresAt: Date.parse("2026-09-17T18:00:00Z"), expired: true, canManage: true, token: "tok-mt" },
  { _id: "i-boss", email: "boss@banhall.com", role: "admin", invitedByName: "Bryce Choquer", sentAt: NOW - DAY, expiresAt: NOW + 6 * DAY, expired: false, canManage: false },
];

function seed(user: unknown, invites: unknown[] = INVITES) {
  __setQueryData("users:getCurrentUser", user);
  __setQueryData("team:listMembers", MEMBERS);
  __setQueryData("invites:listTeamInvites", invites);
}

const text = () => document.body.textContent ?? "";
const row = (email: string) => document.querySelector<HTMLElement>(`[data-invite-row="${email}"]`);

describe("TeamPage", () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    reloadSectionSidebar();
    __resetConvexStub();
    __resetAuthState();
    __resetPage();
    exit();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    vi.spyOn(toast, "success").mockImplementation(() => "t");
    vi.spyOn(toast, "error").mockImplementation(() => "t");
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    exit();
  });

  it("shows the Admin view: subtitle, Invite button, members and member actions", async () => {
    seed(ADMIN);
    await render(TeamPage, { origin: "https://banhall.app" });

    await expect.poll(() => document.querySelector("[data-team-subtitle]")?.textContent).toBe(
      "Everyone who works in Banhall. Managers and above can invite. An Admin changes roles.",
    );
    expect(document.querySelector("[data-top-bar-primary]")).not.toBeNull();
    const names = [...document.querySelectorAll("[data-member-row]")].map((el) => el.textContent);
    expect(names[0]).toContain("Bryce Choquer");
    expect(names[0]).toContain("Owner");
    expect(names[0]).toContain("Now");
    expect(names[1]).toContain("12 min ago");
    expect(names[1]).toContain("Consultant");
    expect(names[2]).toContain("1 hour ago");
    expect(names[3]).toContain("Not yet");
    expect(names[3]).toContain("Developer");
    expect(document.querySelectorAll("[data-member-menu]")).toHaveLength(4);
  });

  it("shows plain names: no avatar beside a member and no circle beside an invite (owner rule, Paper S11)", async () => {
    seed(ADMIN);
    await render(TeamPage, { origin: "https://banhall.app" });
    await expect.poll(() => document.querySelectorAll("[data-member-row]").length).toBe(4);
    expect(document.querySelectorAll('[data-member-row] [data-avatar], [data-member-row] [role="cell"]:first-child svg')).toHaveLength(0);
    expect(document.querySelector('[data-member-row="u-admin"] [role="cell"]')?.children).toHaveLength(1);
    expect(document.querySelector('[data-member-row="u-admin"] [data-member-name]')?.textContent).toBe("Bryce Choquer");
    const invite = row("ana.ruiz@banhall.com")!;
    expect(invite.querySelector(".border-dashed, [data-avatar]")).toBeNull();
    expect(invite.querySelector('[role="cell"]')?.textContent?.trim()).toBe("ana.ruiz@banhall.com");
  });

  it("shows the Manager view without member actions and with read-only Admin invites", async () => {
    seed(MANAGER);
    await render(TeamPage, { origin: "https://banhall.app" });

    await expect.poll(() => document.querySelector("[data-team-subtitle]")?.textContent).toBe(
      "Everyone who works in Banhall. You can invite Consultants and Managers. An Admin changes roles.",
    );
    expect(document.querySelector("[data-top-bar-primary]")).not.toBeNull();
    expect(document.querySelectorAll("[data-member-menu]")).toHaveLength(0);
    expect(row("boss@banhall.com")?.querySelector("[data-invite-menu]")).toBeNull();
    expect(row("ana.ruiz@banhall.com")?.querySelector("[data-invite-menu]")).not.toBeNull();
  });

  it("lists pending invites with sent and expired states and a count", async () => {
    seed(ADMIN);
    await render(TeamPage, { origin: "https://banhall.app" });

    await expect.poll(() => document.querySelector("[data-pending-count]")?.textContent).toBe("3");
    expect(row("ana.ruiz@banhall.com")?.textContent).toContain("Sent 2 days ago");
    expect(row("ana.ruiz@banhall.com")?.querySelector("[data-resend]")).toBeNull();
    expect(row("m.tremblay@banhall.com")?.textContent).toContain("Expired, sent Sep 10");
    expect(row("m.tremblay@banhall.com")?.querySelector("[data-resend]")).not.toBeNull();
    expect(row("ana.ruiz@banhall.com")?.textContent).toContain("Bryce Choquer");
  });

  it("with no pending invites, keeps the section with one muted line, and the sidebar row reaches it", async () => {
    seed(ADMIN, []);
    await page.viewport(1440, 900);
    await render(TeamPage, { origin: "https://banhall.app" });
    await expect.poll(() => document.querySelectorAll("[data-member-row]").length).toBe(4);
    const section = document.querySelector<HTMLElement>("#team-pending-invites")!;
    expect(section.hasAttribute("data-pending-invites")).toBe(true);
    expect(section.querySelector("[data-pending-count]")?.textContent).toBe("0");
    expect(section.querySelector("[data-pending-empty]")?.textContent).toBe("No pending invites.");
    expect(section.querySelector('[role="table"]')).toBeNull();
    const link = document.querySelector<HTMLAnchorElement>('[data-team-sidebar="invites"]')!;
    expect(link.querySelector("[data-section-sidebar-count]")?.textContent).toBe("0");
    const target = document.getElementById(new URL(link.href).hash.slice(1));
    expect(target).toBe(section);
  });

  it("resends an expired invite, copies the new link and shows Link copied", async () => {
    seed(ADMIN);
    __setMutationResult("invites:resendInvite", { token: "fresh" });
    await render(TeamPage, { origin: "https://banhall.app" });

    await expect.poll(() => row("m.tremblay@banhall.com")?.querySelector("[data-resend]")).not.toBeNull();
    await userEvent.click(row("m.tremblay@banhall.com")!.querySelector<HTMLElement>("[data-resend]")!);
    await expect.poll(() => __mutationCalls("invites:resendInvite")).toEqual([{ inviteId: "i-mt" }]);
    await expect.poll(() => writeText.mock.calls).toEqual([["https://banhall.app/signup/fresh"]]);
    await expect.poll(() => row("m.tremblay@banhall.com")?.textContent).toContain("Link copied");
    expect(toast.success).toHaveBeenCalledWith(
      "New link for m.tremblay@banhall.com copied. The old link no longer works.",
    );
  });

  it("revokes through the confirm dialog", async () => {
    seed(ADMIN);
    await render(TeamPage, { origin: "https://banhall.app" });

    await expect.poll(() => row("ana.ruiz@banhall.com")?.querySelector("[data-invite-menu]")).not.toBeNull();
    await userEvent.click(row("ana.ruiz@banhall.com")!.querySelector<HTMLElement>("[data-invite-menu]")!);
    await page.getByRole("menuitem", { name: "Revoke invite" }).click();
    await expect.poll(() => text()).toContain("Revoke the invite for ana.ruiz@banhall.com?");
    await page.getByRole("button", { name: "Revoke invite" }).click();
    await expect.poll(() => __mutationCalls("invites:revokeInvite")).toEqual([{ inviteId: "i-ana" }]);
    await expect.poll(() => document.querySelector('[data-testid="revoke-invite-dialog"]')).toBeNull();
  });

  it("shows the hidden page when a developer views Team as a Consultant", async () => {
    seed({ ...ADMIN, isDeveloper: true });
    enter("consultant");
    await render(TeamPage, { origin: "https://banhall.app" });

    await expect.poll(() => document.querySelector("[data-view-as-hidden-page]")).not.toBeNull();
    expect(text()).toContain("Team is hidden in Consultant view");
    expect(document.querySelector("[data-top-bar-primary]")).toBeNull();
    expect(document.querySelector("[data-member-row]")).toBeNull();
  });

  it("tells a Consultant Team is for Managers and Admins without subscribing", async () => {
    seed({ _id: "u-c", firstName: "Cy", lastName: "C", role: "writer" });
    await render(TeamPage, { origin: "https://banhall.app" });

    await expect.poll(() => document.querySelector("[data-team-no-access]")?.textContent).toContain(
      "Team is for Managers and Admins.",
    );
    expect(text()).toContain("Back to Home");
    expect(document.querySelector("[data-top-bar-primary]")).toBeNull();
    expect(__activeQueryCount("team:listMembers")).toBe(0);
    expect(__activeQueryCount("invites:listTeamInvites")).toBe(0);
  });

  it("shows skeleton rows while members load", async () => {
    __setQueryData("users:getCurrentUser", ADMIN);
    await render(TeamPage, { origin: "https://banhall.app" });
    await expect.poll(() => document.querySelector("[data-team-loading]")).not.toBeNull();
    expect(document.querySelector("[data-member-row]")).toBeNull();
  });

  it("draws C1 in the page frame: the Team sidebar, the shared content inset, tables with plain names and status dots", async () => {
    seed(ADMIN);
    await page.viewport(1440, 900);
    try {
      await render(TeamPage, { origin: "https://banhall.app" });
      await expect.poll(() => document.querySelectorAll("[data-member-row]").length).toBe(4);

      // The page frame (Paper S11): the Team sidebar holds Invite people (a
      // 32px outlined button with a 14px plus), People and Pending invites with
      // their counts; the bar names the page with the people count.
      const sidebar = document.querySelector<HTMLElement>('[data-section-sidebar="team"]')!;
      const invite = sidebar.querySelector<HTMLElement>("[data-section-sidebar-action]")!;
      expect(invite.textContent?.trim()).toBe("Invite people");
      expect(invite.getBoundingClientRect().height).toBe(board(32));
      expect([getComputedStyle(invite).borderRadius, getComputedStyle(invite).backgroundColor, getComputedStyle(invite).borderTopColor]).toEqual([
        boardPx(8),
        "rgb(255, 255, 255)",
        "rgb(218, 229, 227)",
      ]);
      expect(invite.querySelector('[data-frame-icon="plus"]')).not.toBeNull();
      const people = sidebar.querySelector<HTMLElement>('[data-team-sidebar="people"]')!;
      expect([people.getAttribute("aria-current"), people.querySelector("[data-section-sidebar-count]")?.textContent]).toEqual(["page", "4"]);
      expect(people.getBoundingClientRect().height).toBe(board(32));
      expect(getComputedStyle(people).backgroundColor).toBe("rgb(241, 250, 249)");
      const invitesRow = sidebar.querySelector<HTMLElement>('[data-team-sidebar="invites"]')!;
      expect(invitesRow.querySelector("[data-section-sidebar-count]")?.textContent).toBe("3");
      expect(invitesRow.getAttribute("href")).toBe("/team#team-pending-invites");
      expect(document.querySelector("[data-page-top-bar] [data-page-count]")?.textContent).toBe("4 people");
      // The bar's copy of Invite people is for phones only.
      expect(document.querySelector<HTMLElement>("[data-top-bar-primary]")!.getBoundingClientRect().width).toBe(0);

      // The shared content inset (4px under the bar, 32px foot, 32px sides) and no second title.
      const body = getComputedStyle(document.querySelector<HTMLElement>("[data-team-page]")!);
      expect([body.paddingTop, body.paddingBottom, body.paddingLeft, body.paddingRight]).toEqual([boardPx(4), boardPx(32), boardPx(32), boardPx(32)]);
      expect(document.querySelector("[data-team-page] h1")).toBeNull();
      const subtitle = getComputedStyle(document.querySelector<HTMLElement>("[data-team-subtitle]")!);
      expect([subtitle.fontSize, subtitle.lineHeight, subtitle.color]).toEqual([boardPx(14), boardPx(20), "rgb(107, 127, 123)"]);

      const members = document.querySelector<HTMLElement>("[data-team-members]")!;
      const header = members.querySelector<HTMLElement>('[role="row"]')!;
      expect(header.getBoundingClientRect().height).toBe(board(36));
      expect(getComputedStyle(header).fontSize).toBe(boardPx(12));
      const widths = [...header.querySelectorAll<HTMLElement>('[role="columnheader"]')].map((cell) =>
        Math.round(cell.getBoundingClientRect().width),
      );
      expect(widths[0]).toBe(Math.round(board(260)));
      expect(widths[2]).toBe(Math.round(board(120)));
      expect(widths[3]).toBe(Math.round(board(110)));
      // C1: the Admin row menu takes no column of its own, so Last active
      // ends 16px inside the table and the menu sits over its right end.
      const lastActive = header.querySelectorAll<HTMLElement>('[role="columnheader"]')[3].getBoundingClientRect();
      expect(members.getBoundingClientRect().right - lastActive.right).toBeCloseTo(board(17), 0);
      const menu = members.querySelector<HTMLElement>("[data-member-row] [data-member-menu]")!.getBoundingClientRect();
      expect(Math.round(menu.right)).toBe(Math.round(lastActive.right));
      const firstRow = members.querySelector<HTMLElement>("[data-member-row]")!;
      expect(firstRow.getBoundingClientRect().height).toBe(board(48));
      expect(firstRow.querySelector("[data-avatar]")).toBeNull();

      const dot = (email: string) => row(email)!.querySelector<HTMLElement>("[data-invite-status] span")!;
      expect(getComputedStyle(dot("ana.ruiz@banhall.com")).backgroundColor).toBe("rgb(245, 158, 11)");
      expect(getComputedStyle(dot("m.tremblay@banhall.com")).backgroundColor).toBe("rgb(220, 38, 38)");
      const resend = row("m.tremblay@banhall.com")!.querySelector<HTMLElement>("[data-resend]")!;
      expect(resend.getBoundingClientRect().height).toBe(board(28));
      expect(getComputedStyle(resend).borderRadius).toBe(boardPx(6));
      expect(row("ana.ruiz@banhall.com")!.getBoundingClientRect().height).toBe(board(52));
    } finally {
      await page.viewport(1280, 800);
    }
  });

  it("shows the Team sidebar only once the viewer is known to be a Manager or Admin", async () => {
    __setQueryData("users:getCurrentUser", undefined);
    __setQueryData("team:listMembers", MEMBERS);
    __setQueryData("invites:listTeamInvites", INVITES);
    await page.viewport(1440, 900);
    await render(TeamPage, { origin: "https://banhall.app" });
    await expect.poll(() => document.querySelector("[data-team-loading]")).not.toBeNull();
    expect(document.querySelector("[data-section-sidebar]")).toBeNull();
    __setQueryData("users:getCurrentUser", { _id: "u-c", firstName: "Jane", lastName: "Ellis", role: "writer" });
    await expect.poll(() => document.querySelector("[data-team-no-access]")).not.toBeNull();
    expect(document.querySelector("[data-section-sidebar]")).toBeNull();
  });

  it("collapsed at 1440 (Mod \\), Team shows Invite people in its bar", async () => {
    seed(ADMIN);
    await page.viewport(1440, 900);
    await render(TeamPage, { origin: "https://banhall.app" });
    await expect.poll(() => document.querySelector("[data-section-sidebar-toggle]")).not.toBeNull();
    const barInvite = () => document.querySelector<HTMLElement>("[data-page-top-bar] [data-top-bar-primary]")!;
    expect(barInvite().getBoundingClientRect().width).toBe(0);
    document.querySelector<HTMLButtonElement>("[data-section-sidebar-toggle]")!.click();
    await expect.poll(() => barInvite().getBoundingClientRect().width).toBeGreaterThan(0);
    expect(barInvite().textContent?.trim()).toBe("Invite people");
    document.querySelector<HTMLButtonElement>("[data-section-sidebar-expand]")!.click();
    await expect.poll(() => barInvite().getBoundingClientRect().width).toBe(0);
  });
});
