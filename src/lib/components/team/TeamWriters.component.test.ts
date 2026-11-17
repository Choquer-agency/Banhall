import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import { toast } from "svelte-sonner";
import TeamPage from "./TeamPage.svelte";
import {
  __mutationCalls,
  __resetConvexStub,
  __setMutationHandler,
  __setQueryData,
} from "$lib/test/convex-svelte-stub.svelte";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import { __resetPage } from "$lib/test/app-state-stub.svelte";
import { viewAs } from "$lib/shell/viewAs.svelte";
import { reloadSectionSidebar } from "$lib/workspace/sectionSidebar.svelte";

/**
 * Team, writers from initials (2026-11-16): each member's saved initials
 * with an Admin's "Edit initials", and the Past writers section (writers
 * with no login). Since 2026-11-17 (owner) Past writers use the members'
 * columns, show no PD count or where a name came from, and an Admin
 * invites, links, names or deletes one from its row menu, in dialogs.
 * Made-up people only.
 */
const CAPTURES = "../../../../.vitest-attachments/import-writers";
const text = (node: Element | null | undefined) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();
const one = (selector: string, root: ParentNode = document) => root.querySelector<HTMLElement>(selector);
const all = (selector: string, root: ParentNode = document) => [...root.querySelectorAll<HTMLElement>(selector)];

const ADMIN = { _id: "u-dana", firstName: "Dana", lastName: "Whitlock", email: "dana@example.com", role: "admin" };
const MANAGER = { _id: "u-sam", firstName: "Sam", lastName: "Okafor", email: "sam@example.com", role: "manager" };

const member = (id: string, name: string, role: string, initials: string | null, extra: Record<string, unknown> = {}) => {
  const [firstName, lastName] = name.split(" ");
  return {
    _id: id,
    name,
    firstName,
    lastName,
    email: `${firstName.toLowerCase()}@example.com`,
    role,
    isOwner: false,
    isDeveloper: false,
    lastActiveAt: null,
    isSelf: id === "u-dana",
    initials,
    linkedWriter: null,
    ...extra,
  };
};

const MEMBERS = [
  member("u-dana", "Dana Whitlock", "admin", "DW"),
  member("u-kim", "Kim Tran", "writer", "KT", {
    linkedWriter: { writerId: "w-kt", label: "KT", initials: "KT", fileCount: 4 },
  }),
  member("u-priya", "Priya Nair", "writer", "PN"),
  member("u-sam", "Sam Okafor", "manager", null),
];

const PAST_WRITERS = [
  // Only initials, and one member has them too: the Link dialog starts with her.
  { _id: "w-dw", name: null, initials: "DW", label: "DW", nameFromDocument: false, fileCount: 12, canDelete: false, invitePending: false, sameInitialsAs: { userId: "u-dana", name: "Dana Whitlock", canLink: true } },
  // A name read from a PD, and no files: Delete is offered. The server keeps
  // where the name came from; the page never shows it. An Admin invited
  // Jordan: the invite waits under Pending invites (INVITES below).
  { _id: "w-jordan", name: "Jordan Ellis", initials: "JE", label: "Jordan Ellis", nameFromDocument: true, fileCount: 0, canDelete: true, invitePending: true, sameInitialsAs: null },
  // Only initials no member has saved.
  { _id: "w-so", name: null, initials: "SO", label: "SO", nameFromDocument: false, fileCount: 3, canDelete: false, invitePending: false, sameInitialsAs: null },
];

const INVITES = [
  { _id: "i-1", email: "jordan.ellis@example.com", role: "writer", invitedByName: "Dana Whitlock", sentAt: Date.now(), expiresAt: Date.now() + 86_400_000, expired: false, canManage: true, token: "tok" },
];

function seed(user: unknown, pastWriters: unknown[] = PAST_WRITERS) {
  __setQueryData("users:getCurrentUser", user);
  __setQueryData("team:listMembers", MEMBERS);
  __setQueryData("invites:listTeamInvites", INVITES);
  __setQueryData("users:listPastWriters", pastWriters);
}

const memberRow = (id: string) => one(`[data-member-row="${id}"]`)!;
const writerRow = (id: string) => one(`[data-past-writer-row="${id}"]`)!;

async function openMenu(selector: string) {
  await userEvent.click(one(selector)!);
  await expect.poll(() => one('[role="menu"]')).not.toBeNull();
}

describe("Team: writers from initials", () => {
  beforeEach(async () => {
    localStorage.clear();
    reloadSectionSidebar();
    __resetConvexStub();
    __resetAuthState();
    __resetPage();
    viewAs.exit();
    vi.spyOn(toast, "success").mockImplementation(() => "t");
    vi.spyOn(toast, "error").mockImplementation(() => "t");
    document.body.innerHTML = "";
    await page.viewport(1280, 800);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows each member's initials, and an Admin edits them in a dialog that says who has them too", async () => {
    seed(ADMIN);
    __setMutationHandler("users:setUserInitials", (args) => ({ initials: (args as { initials: string }).initials, sharedWith: [] }));
    await render(TeamPage, { origin: "https://example.com" });
    await expect.poll(() => all("[data-member-row]").length).toBe(4);
    expect(all("[data-member-initials]").map((node) => text(node))).toEqual(["DW", "KT", "PN", ""]);
    expect(all('[data-team-members] [role="columnheader"]').map((node) => text(node)).slice(0, 2)).toEqual(["Name", "Initials"]);

    await openMenu('[data-member-menu="u-sam"]');
    await page.getByRole("menuitem", { name: "Edit initials" }).click();
    const input = page.getByRole("textbox", { name: "Initials" });
    await expect.element(input).toBeVisible();
    // The shared field (ui/Input), focused when the dialog opens.
    await expect.poll(() => document.activeElement?.id).toBe("member-initials");
    expect(one("#member-initials")!.classList.contains("field-control")).toBe(true);
    await userEvent.fill(input, "pn");
    // Another member has them: said, and still saved.
    await expect.poll(() => text(one("[data-initials-shared]"))).toBe(
      'Priya Nair has these initials too. New files with them will show "Choose writer"; files that already have a writer keep it.'
    );
    // Sam has a real name: no note about it.
    expect(one("[data-initials-no-name]")).toBeNull();
    await userEvent.fill(input, "ABCDE");
    await userEvent.click(one("[data-initials-save]")!);
    await expect.element(page.getByText("Initials are 1 to 4 letters, such as DW.")).toBeVisible();
    expect(__mutationCalls("users:setUserInitials")).toEqual([]);
    await userEvent.fill(input, "pn");
    await userEvent.click(one("[data-initials-save]")!);
    await expect.poll(() => __mutationCalls("users:setUserInitials")).toEqual([{ userId: "u-sam", initials: "PN" }]);
    await expect.poll(() => one('[data-testid="initials-dialog"]')).toBeNull();
    expect(toast.success).toHaveBeenCalledWith("Initials for Sam Okafor saved as PN.");
  });

  it("tells an Admin that a member with no name is shown on files by their initials, never their email", async () => {
    __setQueryData("users:getCurrentUser", ADMIN);
    __setQueryData("team:listMembers", [
      ...MEMBERS,
      member("u-pat", "pat@example.com", "writer", null, { firstName: null, lastName: null, email: "pat@example.com" }),
    ]);
    __setQueryData("invites:listTeamInvites", INVITES);
    __setQueryData("users:listPastWriters", PAST_WRITERS);
    await render(TeamPage, { origin: "https://example.com" });
    await expect.poll(() => all("[data-member-row]").length).toBe(5);
    await openMenu('[data-member-menu="u-pat"]');
    await page.getByRole("menuitem", { name: "Edit initials" }).click();
    await expect.poll(() => text(one("[data-initials-no-name]"))).toBe(
      "This person has no name yet, so their files show these initials, never their email."
    );
  });

  it("lists Past writers under the invites in the members' own columns, with a quiet No login tag and no PD details", async () => {
    seed(ADMIN);
    await render(TeamPage, { origin: "https://example.com" });
    await expect.poll(() => one("[data-past-writers]")).not.toBeNull();
    const section = one("[data-past-writers]")!;
    const membersTable = one("[data-team-members]")!;
    const invites = one("#team-pending-invites")!;
    expect(invites.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(text(one("h2", section))).toBe("Past writers 3");
    const headers = (root: ParentNode) => all('[role="columnheader"]', root);
    expect(headers(section).map((node) => text(node))).toEqual(["Name", "Initials", "Email", "Role", "Last active", "Actions"]);
    expect(headers(membersTable).map((node) => text(node))).toEqual(headers(section).map((node) => text(node)));
    // Every column starts and ends where the members' column does.
    const box = (node: HTMLElement) => node.getBoundingClientRect();
    headers(section).slice(0, 5).forEach((node, index) => {
      const above = headers(membersTable)[index]!;
      expect(Math.round(box(node).left), text(node)).toBe(Math.round(box(above).left));
      expect(Math.round(box(node).width), text(node)).toBe(Math.round(box(above).width));
    });
    expect(Math.round(box(writerRow("w-dw")).height)).toBe(Math.round(box(memberRow("u-dana")).height));
    expect(all("[data-past-writer-name]").map((node) => text(node))).toEqual(["DW", "Jordan Ellis", "SO"]);
    expect(all("[data-past-writer-initials]").map((node) => text(node))).toEqual(["DW", "JE", "SO"]);
    expect(all("[data-past-writer-email]").map((node) => text(node))).toEqual(["", "", ""]);
    expect(all("[data-past-writer-role]").map((node) => text(node))).toEqual(["No login", "No login", "No login"]);
    expect(all("[data-past-writer-last-active]").map((node) => text(node))).toEqual(["", "Invite sent", ""]);
    // The tag sits where a member's role chip does, at the chip's height.
    expect(Math.round(box(one("[data-past-writer-role]")!).left)).toBe(Math.round(box(one("[data-role-chip]", memberRow("u-dana"))!).left));
    expect(Math.round(box(one("[data-past-writer-role]")!).height)).toBe(Math.round(box(one("[data-role-chip]", memberRow("u-dana"))!).height));
    // Gone from the page: the PD count, where a name came from, the inline hint and Add a name.
    expect(section.textContent).not.toContain("From a PD");
    expect(one('[role="table"]', section)!.textContent).not.toContain("PDs");
    expect(section.textContent).not.toContain("Same initials");
    expect(all("[data-past-writer-pds], [data-past-writer-from-pd], [data-past-writer-hint], [data-past-writer-add-name]")).toEqual([]);
    // Weight 500 at most.
    for (const node of [one("[data-past-writer-name]")!, one("[data-past-writer-role]")!]) {
      expect(Number(getComputedStyle(node).fontWeight)).toBeLessThanOrEqual(500);
    }
  });

  it("offers an Admin Invite to Banhall, Link to a team member, Edit name and Delete, and no second invite while one waits", async () => {
    seed(ADMIN);
    await render(TeamPage, { origin: "https://example.com" });
    await expect.poll(() => one("[data-past-writers]")).not.toBeNull();
    const items = () => all('[role="menuitem"]').map((node) => text(node));
    await openMenu('[data-past-writer-menu="w-dw"]');
    expect(items()).toEqual(["Invite to Banhall", "Link to a team member", "Edit name"]);
    await userEvent.keyboard("{Escape}");
    await openMenu('[data-past-writer-menu="w-jordan"]');
    expect(items()).toEqual(["Link to a team member", "Edit name", "Delete"]);
    await userEvent.keyboard("{Escape}");
    await openMenu('[data-past-writer-menu="w-so"]');
    expect(items()).toEqual(["Invite to Banhall", "Link to a team member", "Edit name"]);
    await userEvent.keyboard("{Escape}");
  });

  it("invites a past writer with the Invite people dialog, for that one person, and sends the writer with the invite", async () => {
    seed(ADMIN);
    __setMutationHandler("invites:createInvites", (args) => {
      const { emails } = args as { emails: string[] };
      return emails.map((email) => ({ email, status: "created", inviteId: "i-new", token: "tok-new" }));
    });
    await render(TeamPage, { origin: "https://example.com" });
    await expect.poll(() => one("[data-past-writers]")).not.toBeNull();
    await openMenu('[data-past-writer-menu="w-so"]');
    await page.getByRole("menuitem", { name: "Invite to Banhall" }).click();
    await expect.element(page.getByRole("heading", { name: "Invite SO" })).toBeVisible();
    await expect.poll(() => one('[role="menu"]')).toBeNull();
    const dialog = one('[data-testid="invite-dialog"]')!;
    expect(text(dialog)).toContain("When they join, their past PDs show under their account.");
    expect(text(dialog)).toContain("Email address");
    // Starts empty, with the dialog's usual role.
    expect(all("[data-email-chip]", dialog)).toEqual([]);
    expect(one('input[name="invite-role"]:checked', dialog)?.getAttribute("value")).toBe("writer");
    const send = () => one("[data-send-invites]") as HTMLButtonElement;
    expect(text(send())).toBe("Send invite");
    // Two addresses pasted at once: said, and nothing to send.
    const pasted = new DataTransfer();
    pasted.setData("text", "s.okafor@example.com, other@example.com");
    one("#invite-emails", dialog)!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: pasted, bubbles: true, cancelable: true }));
    await expect.poll(() => text(one("[data-invite-too-many]"))).toBe("Add one email address for SO.");
    expect(text(send())).toBe("Send invite");
    expect(send().disabled).toBe(true);
    await page.getByRole("button", { name: "Remove other@example.com" }).click();
    // One address: the field takes no more.
    await expect.poll(() => one("[data-invite-too-many]")).toBeNull();
    expect(one("#invite-emails", dialog)).toBeNull();
    expect(text(send())).toBe("Send invite");
    expect(send().disabled).toBe(false);
    await page.screenshot({ path: `${CAPTURES}/team-invite-past-writer.png` });
    await userEvent.click(send());
    await expect.poll(() => __mutationCalls("invites:createInvites")).toEqual([
      { emails: ["s.okafor@example.com"], role: "writer", pdWriterId: "w-so" },
    ]);
    await expect.element(page.getByRole("heading", { name: "1 invite ready" })).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Done" }));
    await expect.poll(() => one('[data-testid="invite-dialog"]')).toBeNull();

    // Invite people from the top bar is the plain dialog again, with no writer.
    await userEvent.click(page.getByRole("button", { name: "Invite people" }).first());
    await expect.element(page.getByRole("heading", { name: "Invite people" })).toBeVisible();
    await page.getByLabelText("Email addresses").click();
    await userEvent.keyboard("kim@example.com,");
    await userEvent.click(one("[data-send-invites]")!);
    await expect.poll(() => __mutationCalls("invites:createInvites").at(-1)).toEqual({ emails: ["kim@example.com"], role: "writer" });
  });

  it("says what to do when a past writer's address is already invited or already has an account", async () => {
    seed(ADMIN);
    let status = "already_invited";
    __setMutationHandler("invites:createInvites", (args) => (args as { emails: string[] }).emails.map((email) => ({ email, status })));
    await render(TeamPage, { origin: "https://example.com" });
    await expect.poll(() => one("[data-past-writers]")).not.toBeNull();
    for (const [result, line] of [
      ["already_invited", "Already invited without this writer. Revoke that invite, then invite again from Past writers."],
      ["already_member", "Already has an account. Use Link to a team member."],
    ] as const) {
      status = result;
      await openMenu('[data-past-writer-menu="w-dw"]');
      await page.getByRole("menuitem", { name: "Invite to Banhall" }).click();
      await expect.element(page.getByRole("heading", { name: "Invite DW" })).toBeVisible();
      await page.getByLabelText("Email address", { exact: true }).click();
      await userEvent.keyboard("dw@example.com,");
      await userEvent.click(one("[data-send-invites]")!);
      await expect.poll(() => text(one(`[data-invite-result="${result}"]`))).toBe(`dw@example.com ${line}`);
      await userEvent.click(page.getByRole("button", { name: "Done" }));
      await expect.poll(() => one('[data-testid="invite-dialog"]')).toBeNull();
    }
  });

  it("links a past writer to a team member in a dialog that starts with the one member who has its initials", async () => {
    seed(ADMIN);
    __setMutationHandler("users:linkPastWriter", () => ({ label: "Dana Whitlock" }));
    await render(TeamPage, { origin: "https://example.com" });
    await expect.poll(() => one("[data-past-writers]")).not.toBeNull();
    await openMenu('[data-past-writer-menu="w-dw"]');
    await page.getByRole("menuitem", { name: "Link to a team member" }).click();
    await expect.element(page.getByRole("heading", { name: "Link DW to a team member" })).toBeVisible();
    await expect.poll(() => one('[role="menu"]')).toBeNull();
    await expect.poll(() => text(one("[data-link-writer-same-initials]"))).toBe("Dana Whitlock has the same initials.");
    expect(text(one("[data-link-writer-confirm]"))).toBe("The past PDs of DW will show under Dana Whitlock.");
    expect(__mutationCalls("users:linkPastWriter")).toEqual([]);
    await page.screenshot({ path: `${CAPTURES}/team-link-past-writer.png` });
    await userEvent.click(one("[data-link-writer-save]")!);
    await expect.poll(() => __mutationCalls("users:linkPastWriter")).toEqual([{ writerId: "w-dw", userId: "u-dana" }]);
    await expect.poll(() => one('[data-testid="link-writer-dialog"]')).toBeNull();

    // No one with the same initials: no line, nothing chosen, and a member who already has a past writer (Kim) is left out.
    await openMenu('[data-past-writer-menu="w-so"]');
    await page.getByRole("menuitem", { name: "Link to a team member" }).click();
    await expect.element(page.getByRole("heading", { name: "Link SO to a team member" })).toBeVisible();
    expect(one("[data-link-writer-same-initials]")).toBeNull();
    expect(one("[data-link-writer-confirm]")).toBeNull();
    expect((one("[data-link-writer-save]") as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(page.getByRole("combobox", { name: "Team member" }));
    await expect.poll(() => all('[role="option"]').map((node) => text(node))).toEqual(["Dana Whitlock", "Priya Nair", "Sam Okafor"]);
    await userEvent.keyboard("{Escape}");
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => one('[data-testid="link-writer-dialog"]')).toBeNull();
  });

  it("edits a past writer's name from its menu, starting from the name it has, and deletes one with no PDs after a confirm", async () => {
    seed(ADMIN);
    __setMutationHandler("users:renamePastWriter", (args) => ({ label: (args as { name: string }).name }));
    __setMutationHandler("users:deletePastWriter", () => null);
    await render(TeamPage, { origin: "https://example.com" });
    await expect.poll(() => one("[data-past-writers]")).not.toBeNull();

    await openMenu('[data-past-writer-menu="w-dw"]');
    await page.getByRole("menuitem", { name: "Edit name" }).click();
    await expect.element(page.getByRole("heading", { name: "Add a name for DW" })).toBeVisible();
    // The shared field (ui/Input), focused when the dialog opens.
    await expect.poll(() => document.activeElement?.id).toBe("writer-name");
    expect(one("#writer-name")!.classList.contains("field-control")).toBe(true);
    await userEvent.fill(page.getByRole("textbox", { name: "Name" }), "Dana Whitlock");
    await userEvent.click(one("[data-writer-name-save]")!);
    await expect.poll(() => __mutationCalls("users:renamePastWriter")).toEqual([{ writerId: "w-dw", name: "Dana Whitlock" }]);
    await expect.poll(() => one('[data-testid="writer-name-dialog"]')).toBeNull();

    await openMenu('[data-past-writer-menu="w-jordan"]');
    await page.getByRole("menuitem", { name: "Edit name" }).click();
    await expect.element(page.getByRole("heading", { name: "Edit the name of Jordan Ellis" })).toBeVisible();
    await expect.element(page.getByRole("textbox", { name: "Name" })).toHaveValue("Jordan Ellis");
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => one('[data-testid="writer-name-dialog"]')).toBeNull();

    // Delete asks first, and Cancel keeps the writer.
    await openMenu('[data-past-writer-menu="w-jordan"]');
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await expect.element(page.getByRole("heading", { name: "Delete Jordan Ellis?" })).toBeVisible();
    expect(text(one('[data-testid="delete-writer-dialog"]'))).toContain("a pick that names it goes too");
    await userEvent.click(one("[data-writer-confirm-cancel]")!);
    await expect.poll(() => one('[data-testid="delete-writer-dialog"]')).toBeNull();
    expect(__mutationCalls("users:deletePastWriter")).toEqual([]);
    await openMenu('[data-past-writer-menu="w-jordan"]');
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await userEvent.click(page.getByRole("button", { name: "Delete writer" }));
    await expect.poll(() => __mutationCalls("users:deletePastWriter")).toEqual([{ writerId: "w-jordan" }]);
    await expect.poll(() => one('[data-testid="delete-writer-dialog"]')).toBeNull();
  });

  it("unlinks a past writer from the member it was linked to, after a confirm", async () => {
    seed(ADMIN);
    __setMutationHandler("users:unlinkPastWriter", () => null);
    await render(TeamPage, { origin: "https://example.com" });
    await expect.poll(() => all("[data-member-row]").length).toBe(4);
    await openMenu('[data-member-menu="u-priya"]');
    expect(one('[data-menu-item="unlink-writer"]')).toBeNull();
    await userEvent.keyboard("{Escape}");
    await openMenu('[data-member-menu="u-kim"]');
    await page.getByRole("menuitem", { name: "Unlink past writer KT" }).click();
    // Asked first, saying what changes.
    await expect.element(page.getByRole("heading", { name: "Unlink KT from Kim Tran?" })).toBeVisible();
    expect(text(one('[data-testid="unlink-writer-dialog"]'))).toContain(
      "Its past PDs will show as KT again, with no login, and it goes back under Past writers."
    );
    expect(__mutationCalls("users:unlinkPastWriter")).toEqual([]);
    await userEvent.click(page.getByRole("button", { name: "Unlink", exact: true }));
    await expect.poll(() => __mutationCalls("users:unlinkPastWriter")).toEqual([{ writerId: "w-kt" }]);
    await expect.poll(() => one('[data-testid="unlink-writer-dialog"]')).toBeNull();
    expect(toast.success).toHaveBeenCalledWith("KT is unlinked from Kim Tran. It is listed under Past writers again.");
  });


  it("shows Past writers read only to a Manager, and no section when there are none", async () => {
    seed(MANAGER);
    await render(TeamPage, { origin: "https://example.com" });
    await expect.poll(() => one("[data-past-writers]")).not.toBeNull();
    expect(all("[data-past-writer-menu], [data-member-menu]")).toEqual([]);
    expect(all('[role="columnheader"]', one("[data-past-writers]")!).map((node) => text(node))).toEqual(["Name", "Initials", "Email", "Role", "Last active"]);
    // The waiting invite still shows.
    expect(text(one("[data-past-writer-last-active]", writerRow("w-jordan")))).toBe("Invite sent");

    document.body.innerHTML = "";
    seed(ADMIN, []);
    await render(TeamPage, { origin: "https://example.com" });
    await expect.poll(() => all("[data-member-row]").length).toBe(4);
    expect(one("[data-past-writers]")).toBeNull();
  });

  it("captures the Team page with members and Past writers lined up at 1440 and 1100 wide, and the initials dialog", async () => {
    seed(ADMIN);
    for (const width of [1440, 1100]) {
      document.body.innerHTML = "";
      await page.viewport(width, 1000);
      await render(TeamPage, { origin: "https://example.com" });
      await expect.poll(() => one("[data-past-writers]")).not.toBeNull();
      // Nothing runs past the window, and the members and past writers fit with no scroll of their own.
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      for (const table of [one("[data-team-members]")!, one("[data-past-writers] [role=table]")!.parentElement!]) {
        expect(table.scrollWidth, `${width}`).toBeLessThanOrEqual(table.clientWidth);
      }
      // Name and Initials line up at every width.
      const left = (selector: string) => Math.round(one(selector)!.getBoundingClientRect().left);
      expect(left("[data-past-writer-initials]"), `${width}`).toBe(left("[data-member-initials]"));
      expect(left("[data-past-writer-name]"), `${width}`).toBe(left("[data-member-name]"));
      await page.screenshot({ path: `${CAPTURES}/team-${width}.png` });
      await openMenu('[data-member-menu="u-sam"]');
      await page.getByRole("menuitem", { name: "Edit initials" }).click();
      await userEvent.fill(page.getByRole("textbox", { name: "Initials" }), "PN");
      await expect.poll(() => one("[data-initials-shared]")).not.toBeNull();
      await page.screenshot({ path: `${CAPTURES}/team-initials-${width}.png` });
      await userEvent.keyboard("{Escape}");
      await expect.poll(() => one('[data-testid="initials-dialog"]')).toBeNull();
    }
  });
});
