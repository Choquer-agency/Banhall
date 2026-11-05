import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import CompanyPeople from "./CompanyPeople.svelte";
import {
  __activeQueryArgs,
  __mutationCalls,
  __resetConvexStub,
  __setMutationError,
  __setQueryData,
} from "$lib/test/convex-svelte-stub.svelte";

/**
 * 2026-11-04 (the company profile, Paper section 5): a company's People
 * tab. The list (initials, role under the name, Main contact, "Not added"
 * for no phone), Find a person, Add person with its required fields and
 * inline errors, Edit, Make main contact, Remove after confirming, the empty
 * state, and read-only viewers with no Add person or row menu.
 */
const text = (node: Element | null | undefined) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();

function contact(id: string, firstName: string, lastName: string, overrides: Record<string, unknown> = {}) {
  return {
    _id: id,
    firstName,
    lastName,
    role: "Lab lead",
    email: `${firstName.toLowerCase()}@cedarline.example`,
    phone: null,
    isMain: false,
    createdAt: Date.parse("2026-08-21T12:00:00"),
    updatedAt: Date.parse("2026-08-21T12:00:00"),
    ...overrides,
  };
}

const CEDARLINE = [
  contact("p1", "Dana", "Whitlock", { role: "VP Engineering", phone: "(604) 555-0142", isMain: true, createdAt: Date.parse("2025-01-14T12:00:00") }),
  contact("p2", "Marc", "Teo"),
  contact("p3", "Rachel", "Kim", { role: "Controller", phone: "(604) 555-0190", createdAt: Date.parse("2026-10-02T12:00:00") }),
];

async function mount(options: { contacts?: unknown[]; canManage?: boolean; onCount?: (count: number | null) => void } = {}) {
  if (options.contacts !== undefined) {
    __setQueryData("companyContacts:listCompanyContacts", { contacts: options.contacts, truncated: false });
    __setQueryData("companyContacts:countCompanyContacts", { count: options.contacts.length, more: false });
  }
  await page.viewport(1440, 900);
  return render(CompanyPeople, {
    companyKey: "cedarline systems",
    companyName: "Cedarline Systems",
    active: true,
    canManage: options.canManage ?? true,
    onCount: options.onCount,
  });
}

const rows = () => [...document.querySelectorAll("[data-person-row]")];
const dialog = () => document.querySelector<HTMLElement>("[data-person-dialog]");

async function openMenu(id: string) {
  document.querySelector<HTMLButtonElement>(`[data-person-menu="${id}"]`)!.click();
  await expect.poll(() => document.querySelector("[data-person-action]")).not.toBeNull();
}

async function fill(id: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(`#person-${id}`)!;
  await userEvent.clear(input);
  if (value) await userEvent.type(input, value);
}

beforeEach(() => {
  __resetConvexStub();
});

describe("a company's People tab", () => {
  it("lists contacts with initials, role, Main contact, phone or Not added, and the date added", async () => {
    const counts: Array<number | null> = [];
    await mount({ contacts: CEDARLINE, onCount: (count) => counts.push(count) });
    await expect.poll(() => rows().length).toBe(3);
    const [dana, marc, rachel] = rows();
    expect(text(dana)).toContain("DW");
    expect(text(dana.querySelector("[data-person-name]"))).toBe("Dana Whitlock");
    expect(text(dana.querySelector("[data-person-role]"))).toBe("VP Engineering");
    expect(dana.querySelector("[data-person-main-badge]")).not.toBeNull();
    expect(text(dana)).toContain("dana@cedarline.example");
    expect(text(dana)).toContain("(604) 555-0142");
    expect(text(dana)).toContain("Jan 14, 2025");
    expect(marc.querySelector("[data-person-main-badge]")).toBeNull();
    expect(text(marc)).toContain("Not added");
    expect(text(rachel)).toContain("Oct 2, 2026");
    expect(text(document.querySelector("#company-people-title"))).toBe("People");
    expect(text(document.querySelector("[data-company-people]"))).toContain("Your contacts at Cedarline Systems.");
    await expect.poll(() => counts.at(-1)).toBe(3);

    // The design's columns: 260, 220, 150, the rest, 32, with 24px gaps.
    const header = document.querySelector('[data-people-table] [role="row"]') as HTMLElement;
    const widths = [...header.children].map((cell) => Math.round(cell.getBoundingClientRect().width));
    const scale = parseFloat(getComputedStyle(document.documentElement).fontSize) / 16;
    expect(widths[0]).toBe(Math.round(260 * scale));
    expect(widths[1]).toBe(Math.round(220 * scale));
    expect(widths[2]).toBe(Math.round(150 * scale));
    expect(widths[4]).toBe(Math.round(32 * scale));
    expect(getComputedStyle(header).columnGap).toBe(`${24 * scale}px`);
  });

  it("finds a person by name, role or email", async () => {
    await mount({ contacts: CEDARLINE });
    await expect.poll(() => rows().length).toBe(3);
    const search = document.querySelector<HTMLInputElement>("[data-people-search]")!;
    await userEvent.type(search, "control");
    await expect.poll(() => rows().map((row) => text(row.querySelector("[data-person-name]")))).toEqual(["Rachel Kim"]);
    await userEvent.clear(search);
    await userEvent.type(search, "zzz");
    await expect.poll(() => document.querySelector("[data-people-no-match]")).not.toBeNull();
  });

  it("adds a person, showing each missing required field's error on submit", async () => {
    await mount({ contacts: CEDARLINE });
    await expect.poll(() => rows().length).toBe(3);
    document.querySelector<HTMLButtonElement>("[data-people-add]")!.click();
    await expect.poll(() => dialog()).not.toBeNull();
    expect(text(dialog())).toContain("Add person");
    expect(text(dialog())).toContain("Fields marked * are required.");
    expect(text(dialog())).toContain("Optional");
    // Nothing is shown as wrong before a first try.
    expect(dialog()!.querySelector('[aria-invalid="true"]')).toBeNull();

    await fill("firstName", "Owen");
    await fill("lastName", "Patel");
    dialog()!.querySelector<HTMLButtonElement>("[data-person-save]")!.click();
    await expect.poll(() => text(dialog())).toContain("Enter their role");
    expect(text(dialog())).toContain("Enter their email");
    expect(document.querySelector("#person-role")!.getAttribute("aria-invalid")).toBe("true");
    // The shared form control, with the designed red line inset for an error.
    const role = document.querySelector<HTMLInputElement>("#person-role")!;
    expect(role.classList.contains("field-control")).toBe(true);
    expect(getComputedStyle(role).boxShadow).toContain("inset");
    expect(getComputedStyle(role).boxShadow).toContain("rgb(185, 28, 28)");
    expect(document.activeElement?.id).toBe("person-role");
    expect(__mutationCalls("companyContacts:addCompanyContact")).toEqual([]);

    await fill("role", "CFO");
    await fill("email", "owen@cedarline");
    await expect.poll(() => text(dialog())).not.toContain("Enter their role");
    expect(text(dialog())).toContain("Enter an email like name@example.com");
    await fill("email", "owen@cedarline.example");
    await fill("phone", "604-555-0100");
    dialog()!.querySelector<HTMLButtonElement>("[data-person-save]")!.click();
    await expect.poll(() => dialog()).toBeNull();
    expect(__mutationCalls("companyContacts:addCompanyContact")).toEqual([
      {
        companyKey: "cedarline systems",
        firstName: "Owen",
        lastName: "Patel",
        role: "CFO",
        email: "owen@cedarline.example",
        phone: "604-555-0100",
        isMain: false,
      },
    ]);
  });

  it("keeps the dialog open and says why when the server refuses", async () => {
    __setMutationError("companyContacts:addCompanyContact", new Error("A company can list up to 200 people. Remove someone first."));
    await mount({ contacts: CEDARLINE });
    await expect.poll(() => rows().length).toBe(3);
    document.querySelector<HTMLButtonElement>("[data-people-add]")!.click();
    await expect.poll(() => dialog()).not.toBeNull();
    await fill("firstName", "Owen");
    await fill("lastName", "Patel");
    await fill("role", "CFO");
    await fill("email", "owen@cedarline.example");
    dialog()!.querySelector<HTMLButtonElement>("[data-person-save]")!.click();
    await expect.poll(() => text(document.querySelector("[data-person-failure]"))).toContain("Remove someone first");
    expect(dialog()).not.toBeNull();
  });

  it("edits a person in the same dialog, filled in", async () => {
    await mount({ contacts: CEDARLINE });
    await expect.poll(() => rows().length).toBe(3);
    await openMenu("p2");
    document.querySelector<HTMLElement>('[data-person-action="edit"]')!.click();
    await expect.poll(() => dialog()?.getAttribute("data-person-dialog")).toBe("edit");
    expect(text(dialog())).toContain("Edit person");
    expect(document.querySelector<HTMLInputElement>("#person-firstName")!.value).toBe("Marc");
    expect(document.querySelector<HTMLInputElement>("#person-email")!.value).toBe("marc@cedarline.example");
    await fill("role", "Head of lab");
    document.querySelector<HTMLElement>("#person-isMain")!.click();
    dialog()!.querySelector<HTMLButtonElement>("[data-person-save]")!.click();
    await expect.poll(() => dialog()).toBeNull();
    expect(__mutationCalls("companyContacts:updateCompanyContact")).toEqual([
      {
        contactId: "p2",
        firstName: "Marc",
        lastName: "Teo",
        role: "Head of lab",
        email: "marc@cedarline.example",
        phone: "",
        isMain: true,
      },
    ]);
  });

  it("makes someone the main contact from the row menu (not offered for the main contact)", async () => {
    await mount({ contacts: CEDARLINE });
    await expect.poll(() => rows().length).toBe(3);
    await openMenu("p1");
    expect(document.querySelector('[data-person-action="main"]')).toBeNull();
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => document.querySelector("[data-person-action]")).toBeNull();
    await openMenu("p3");
    const items = [...document.querySelectorAll("[data-person-action]")].map((item) => text(item));
    expect(items).toEqual(["Edit", "Make main contact", "Remove"]);
    document.querySelector<HTMLElement>('[data-person-action="main"]')!.click();
    await expect.poll(() => __mutationCalls("companyContacts:setMainCompanyContact")).toEqual([{ contactId: "p3" }]);
  });

  it("removes a person after confirming", async () => {
    await mount({ contacts: CEDARLINE });
    await expect.poll(() => rows().length).toBe(3);
    await openMenu("p2");
    document.querySelector<HTMLElement>('[data-person-action="remove"]')!.click();
    await expect.poll(() => document.querySelector("[data-person-remove-dialog]")).not.toBeNull();
    const confirm = document.querySelector("[data-person-remove-dialog]")!;
    expect(text(confirm)).toContain("Remove Marc Teo from Cedarline Systems?");
    expect(text(confirm)).toContain("They won't be listed as a contact anymore. Projects and files stay as they are.");
    expect(__mutationCalls("companyContacts:removeCompanyContact")).toEqual([]);
    document.querySelector<HTMLElement>("[data-person-remove-confirm]")!.click();
    await expect.poll(() => __mutationCalls("companyContacts:removeCompanyContact")).toEqual([{ contactId: "p2" }]);
    await expect.poll(() => document.querySelector("[data-person-remove-dialog]")).toBeNull();
  });

  it("shows No one added yet with Add person when the company has no contacts", async () => {
    const onCount = vi.fn();
    await mount({ contacts: [], onCount });
    await expect.poll(() => document.querySelector("[data-people-empty]")).not.toBeNull();
    const empty = document.querySelector("[data-people-empty]")!;
    expect(text(empty)).toContain("No one added yet");
    expect(text(empty)).toContain("Add the people you talk to at Cedarline Systems.");
    expect(document.querySelector("[data-people-search]")).toBeNull();
    expect(document.querySelectorAll("[data-people-add]")).toHaveLength(1);
    await expect.poll(() => onCount.mock.calls.at(-1)?.[0]).toBe(0);
    empty.querySelector<HTMLButtonElement>("[data-people-add]")!.click();
    await expect.poll(() => dialog()).not.toBeNull();
    // The first person added is the main contact unless unticked.
    expect(document.querySelector("#person-isMain")!.getAttribute("data-state")).toBe("checked");
  });

  it("read-only viewers see the list with no Add person and no row menu", async () => {
    await mount({ contacts: CEDARLINE, canManage: false });
    await expect.poll(() => rows().length).toBe(3);
    expect(document.querySelector("[data-people-add]")).toBeNull();
    expect(document.querySelector("[data-person-menu]")).toBeNull();
    expect(document.querySelector("[data-people-search]")).not.toBeNull();
  });

  it("read-only viewers of a company with no contacts get no Add person", async () => {
    await mount({ contacts: [], canManage: false });
    await expect.poll(() => document.querySelector("[data-people-empty]")).not.toBeNull();
    expect(document.querySelector("[data-people-add]")).toBeNull();
    expect(text(document.querySelector("[data-people-empty]"))).toContain("No one has added contacts for Cedarline Systems yet.");
  });

  it("reads no list while hidden, but still reports the count for the tab", async () => {
    const counts: Array<number | null> = [];
    __setQueryData("companyContacts:countCompanyContacts", { count: 3, more: false });
    await page.viewport(1440, 900);
    await render(CompanyPeople, { companyKey: "cedarline systems", companyName: "Cedarline Systems", active: false, onCount: (count) => counts.push(count) });
    await expect.poll(() => counts.at(-1)).toBe(3);
    expect(__activeQueryArgs("companyContacts:listCompanyContacts")).toEqual([]);
    expect(__activeQueryArgs("companyContacts:countCompanyContacts")).toEqual([{ companyKey: "cedarline systems" }]);
  });

  it("reports no count while the count is loading", async () => {
    const counts: Array<number | null> = [];
    await page.viewport(1440, 900);
    await render(CompanyPeople, { companyKey: "cedarline systems", companyName: "Cedarline Systems", active: true, onCount: (count) => counts.push(count) });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(counts.length).toBeGreaterThan(0);
    expect(counts.every((count) => count === null)).toBe(true);
    expect(document.querySelector("[data-people-loading]")).not.toBeNull();
  });
});
