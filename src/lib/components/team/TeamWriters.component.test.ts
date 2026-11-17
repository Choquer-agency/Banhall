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
 * with no login) with Add a name, Link to an account, the same-initials
 * hint and Delete. Made-up people only.
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
  // Only initials, and one member has them too: the quiet hint with Link.
  { _id: "w-dw", name: null, initials: "DW", label: "DW", fileCount: 12, canDelete: false, sameInitialsAs: { userId: "u-dana", name: "Dana Whitlock", canLink: true } },
  { _id: "w-jordan", name: "Jordan Ellis", initials: "JE", label: "Jordan Ellis", fileCount: 0, canDelete: true, sameInitialsAs: null },
  { _id: "w-so", name: "Sam Okafor", initials: "SO", label: "Sam Okafor", fileCount: 3, canDelete: false, sameInitialsAs: null },
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

  it("lists Past writers under the invites, with initials, PDs, Add a name and the same-initials hint", async () => {
    seed(ADMIN);
    await render(TeamPage, { origin: "https://example.com" });
    await expect.poll(() => one("[data-past-writers]")).not.toBeNull();
    const section = one("[data-past-writers]")!;
    const invites = one("#team-pending-invites")!;
    expect(invites.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(text(one("h2", section))).toBe("Past writers 3");
    expect(all('[role="columnheader"]', section).map((node) => text(node))).toEqual(["Writer", "Initials", "PDs", "Actions"]);
    expect(all("[data-past-writer-name]").map((node) => text(node))).toEqual(["DW", "Jordan Ellis", "Sam Okafor"]);
    expect(all("[data-past-writer-pds]").map((node) => text(node))).toEqual(["12", "0", "3"]);
    // Only a writer with no name gets "Add a name".
    expect(all("[data-past-writer-add-name]").map((node) => node.closest("[data-past-writer-row]")?.getAttribute("data-past-writer-row"))).toEqual(["w-dw"]);
    expect(text(one("[data-past-writer-hint]", writerRow("w-dw")))).toBe("Same initials as Dana Whitlock Link");
    expect(one("[data-past-writer-hint]", writerRow("w-jordan"))).toBeNull();
    // Weight 500 at most.
    expect(Number(getComputedStyle(one("[data-past-writer-name]")!).fontWeight)).toBeLessThanOrEqual(500);
  });

  it("marks a name read from a PD with a quiet \"From a PD\", and Edit name starts from that name", async () => {
    seed(ADMIN, [
      ...PAST_WRITERS,
      { _id: "w-pn", name: "Priya Nair", initials: "PN", label: "Priya Nair", nameFromDocument: true, fileCount: 2, canDelete: false, sameInitialsAs: null },
    ]);
    __setMutationHandler("users:renamePastWriter", (args) => ({ label: (args as { name: string }).name }));
    await render(TeamPage, { origin: "https://example.com" });
    await expect.poll(() => one('[data-past-writer-row="w-pn"]')).not.toBeNull();
    // Only the name a PD gave has the note; a name an Admin typed and initials alone do not.
    expect(all("[data-past-writer-from-pd]").map((node) => node.closest("[data-past-writer-row]")?.getAttribute("data-past-writer-row"))).toEqual(["w-pn"]);
    const note = one("[data-past-writer-from-pd]", writerRow("w-pn"))!;
    expect(text(note)).toBe("From a PD");
    expect(text(one("[data-past-writer-name]", writerRow("w-pn")))).toBe("Priya Nair");
    expect(note.className).toContain("text-ink-muted");
    expect(Number(getComputedStyle(note).fontWeight)).toBeLessThanOrEqual(500);
    // It has a name, so no "Add a name".
    expect(one("[data-past-writer-add-name]", writerRow("w-pn"))).toBeNull();
    writerRow("w-pn").scrollIntoView({ block: "center" });
    await page.screenshot({ path: `${CAPTURES}/team-from-a-pd.png` });

    await openMenu('[data-past-writer-menu="w-pn"]');
    await page.getByRole("menuitem", { name: "Edit name" }).click();
    await expect.element(page.getByRole("heading", { name: "Edit the name of Priya Nair" })).toBeVisible();
    await expect.element(page.getByRole("textbox", { name: "Name" })).toHaveValue("Priya Nair");
    await userEvent.click(one("[data-writer-name-save]")!);
    await expect.poll(() => __mutationCalls("users:renamePastWriter")).toEqual([{ writerId: "w-pn", name: "Priya Nair" }]);
  });

  it("names a past writer, links it to an account after saying what moves, and deletes one with no PDs after a confirm", async () => {
    seed(ADMIN);
    __setMutationHandler("users:renamePastWriter", (args) => ({ label: (args as { name: string }).name }));
    __setMutationHandler("users:linkPastWriter", () => ({ label: "Dana Whitlock" }));
    __setMutationHandler("users:deletePastWriter", () => null);
    await render(TeamPage, { origin: "https://example.com" });
    await expect.poll(() => one("[data-past-writers]")).not.toBeNull();

    await userEvent.click(one("[data-past-writer-add-name]", writerRow("w-dw"))!);
    await expect.element(page.getByRole("heading", { name: "Add a name for DW" })).toBeVisible();
    await userEvent.fill(page.getByRole("textbox", { name: "Name" }), "Dana Whitlock");
    await userEvent.click(one("[data-writer-name-save]")!);
    await expect.poll(() => __mutationCalls("users:renamePastWriter")).toEqual([{ writerId: "w-dw", name: "Dana Whitlock" }]);
    await expect.poll(() => one('[data-testid="writer-name-dialog"]')).toBeNull();

    // The hint's Link starts with that member, and says what will move before anything does.
    await userEvent.click(one("[data-past-writer-hint-link]", writerRow("w-dw"))!);
    await expect.element(page.getByRole("heading", { name: "Link DW to an account" })).toBeVisible();
    await expect.poll(() => text(one("[data-link-writer-confirm]"))).toBe(
      "The past PDs of DW will show under Dana Whitlock."
    );
    expect(__mutationCalls("users:linkPastWriter")).toEqual([]);
    await userEvent.click(one("[data-link-writer-save]")!);
    await expect.poll(() => __mutationCalls("users:linkPastWriter")).toEqual([{ writerId: "w-dw", userId: "u-dana" }]);
    await expect.poll(() => one('[data-testid="link-writer-dialog"]')).toBeNull();

    // From the menu, the list leaves out a member who already has a past writer linked (Kim).
    await openMenu('[data-past-writer-menu="w-so"]');
    expect(one('[data-menu-item="delete"]')).toBeNull();
    await page.getByRole("menuitem", { name: "Link to an account" }).click();
    await userEvent.click(page.getByRole("combobox", { name: "Team member" }));
    await expect.poll(() => all('[role="option"]').map((node) => text(node))).toEqual(["Dana Whitlock", "Priya Nair", "Sam Okafor"]);
    await userEvent.keyboard("{Escape}");
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => one('[data-testid="link-writer-dialog"]')).toBeNull();

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
    expect(all("[data-past-writer-menu], [data-past-writer-add-name], [data-past-writer-hint-link], [data-member-menu]")).toEqual([]);
    // The hint still says it.
    expect(text(one("[data-past-writer-hint]", writerRow("w-dw")))).toBe("Same initials as Dana Whitlock");

    document.body.innerHTML = "";
    seed(ADMIN, []);
    await render(TeamPage, { origin: "https://example.com" });
    await expect.poll(() => all("[data-member-row]").length).toBe(4);
    expect(one("[data-past-writers]")).toBeNull();
  });

  it("captures the Team page with Past writers and the initials dialog at 1280 and 1100 wide", async () => {
    seed(ADMIN);
    for (const width of [1280, 1100]) {
      document.body.innerHTML = "";
      await page.viewport(width, 1000);
      await render(TeamPage, { origin: "https://example.com" });
      await expect.poll(() => one("[data-past-writers]")).not.toBeNull();
      // Nothing runs past the window, and the members and past writers fit with no scroll of their own.
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      for (const table of [one("[data-team-members]")!, one("[data-past-writers] .overflow-x-auto")!]) {
        expect(table.scrollWidth, `${width}`).toBeLessThanOrEqual(table.clientWidth);
      }
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
