import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import SavedPreferencesCard from "./SavedPreferencesCard.svelte";

const callbacks = () => ({
  onApprove: vi.fn(async (_id: string) => null as string | null),
  onDismiss: vi.fn(async (_id: string) => null as string | null),
  onSave: vi.fn(async (_id: string | null, _text: string) => null as string | null),
  onSetOn: vi.fn(async (_id: string, _on: boolean) => null as string | null),
  onDelete: vi.fn(async (_id: string) => null as string | null),
  onDeleteAll: vi.fn(async () => null as string | null),
});

const props = (overrides: Record<string, unknown> = {}) => ({
  suggestions: [{ _id: "s1", text: "Prefers 'we' to 'the company'.", support: 3 }],
  saved: [
    { _id: "p1", text: "Uses Canadian spelling.", on: true },
    { _id: "p2", text: "Keeps sentences under 25 words.", on: false },
  ],
  limit: 30,
  ...callbacks(),
  ...overrides,
});

const button = (name: string) => page.getByRole("button", { name, exact: true });

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("SavedPreferencesCard (Phase E, E1b)", () => {
  it("shows suggestions with their support, and saved preferences with a switch each", async () => {
    const { container } = await render(SavedPreferencesCard, props());
    expect(container.querySelector("[data-suggestion]")?.textContent).toContain("Prefers 'we' to 'the company'.");
    expect(container.querySelector("[data-suggestion]")?.textContent).toContain("From 3 of your recent edits");
    expect(container.querySelectorAll("[data-preference]")).toHaveLength(2);
    expect(container.textContent).toContain("Your preferences (2 of 30)");
    expect(container.textContent).toContain("Only you can see them.");
    for (const element of container.querySelectorAll("*")) {
      expect(Number.parseInt(getComputedStyle(element).fontWeight, 10)).toBeLessThanOrEqual(500);
    }
    expect(/[–—]/.test(container.textContent ?? "")).toBe(false);
  });

  it("approves, dismisses, and saves an edited suggestion", async () => {
    const p = props();
    await render(SavedPreferencesCard, p);
    await button("Approve").click();
    expect(p.onApprove).toHaveBeenCalledWith("s1");
    await button("Dismiss").click();
    expect(p.onDismiss).toHaveBeenCalledWith("s1");
    await page.getByRole("listitem").filter({ hasText: "Prefers" }).getByRole("button", { name: "Edit" }).click();
    const field = page.getByLabelText("Edit the suggestion");
    await field.clear();
    await field.fill("Prefers 'we' to 'the team'.");
    await button("Save").click();
    expect(p.onSave).toHaveBeenCalledWith("s1", "Prefers 'we' to 'the team'.");
  });

  it("turns a preference off, deletes one, and adds one", async () => {
    const p = props();
    await render(SavedPreferencesCard, p);
    await page.getByRole("switch", { name: "Use: Uses Canadian spelling." }).click();
    await expect.poll(() => p.onSetOn.mock.calls).toEqual([["p1", false]]);
    await page.getByRole("listitem").filter({ hasText: "Canadian" }).getByRole("button", { name: "Delete" }).click();
    expect(p.onDelete).toHaveBeenCalledWith("p1");
    await page.getByLabelText("Add a preference").fill("Avoids the passive voice.");
    await button("Add").click();
    expect(p.onSave).toHaveBeenCalledWith(null, "Avoids the passive voice.");
  });

  it("shows a refusal from the server, and asks before deleting everything", async () => {
    const p = props({ onSave: vi.fn(async () => "A preference cannot hold the name of a company, project or person.") });
    const { container } = await render(SavedPreferencesCard, p);
    await page.getByLabelText("Add a preference").fill("Mentions Acme by name.");
    await button("Add").click();
    await expect
      .poll(() => container.querySelector("[data-preference-error]")?.textContent)
      .toBe("A preference cannot hold the name of a company, project or person.");
    // The text stays, so the writer can fix it.
    expect((container.querySelector("#new-preference") as HTMLInputElement).value).toBe("Mentions Acme by name.");

    await button("Delete all saved preferences").click();
    expect(p.onDeleteAll).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Delete every saved preference and suggestion? This cannot be undone.");
    await button("Delete all").click();
    expect(p.onDeleteAll).toHaveBeenCalledTimes(1);
  });

  it("says when there is nothing saved, and hides Add at the limit", async () => {
    const { container } = await render(SavedPreferencesCard, props({ suggestions: [], saved: [] }));
    expect(container.querySelector("[data-no-preferences]")?.textContent).toBe("No saved preferences yet.");
    document.body.innerHTML = "";
    const full = Array.from({ length: 2 }, (_, index) => ({ _id: `p${index}`, text: `Preference ${index}.`, on: true }));
    const { container: atLimit } = await render(SavedPreferencesCard, props({ saved: full, limit: 2 }));
    expect(atLimit.querySelector("[data-add-preference]")).toBeNull();
  });
});

export { userEvent };
