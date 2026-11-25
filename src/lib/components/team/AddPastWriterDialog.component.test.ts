import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import AddPastWriterDialog, { type PastWriterFormValues } from "./AddPastWriterDialog.svelte";

const one = (selector: string) => document.querySelector<HTMLElement>(selector);
const text = (node: Element | null | undefined) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();

describe("AddPastWriterDialog writer weight visibility", () => {
  beforeEach(async () => {
    document.body.innerHTML = "";
    await page.viewport(1024, 768);
  });

  it("hides the custom weight field and role weight defaults when canSetWeight is false", async () => {
    const submitted: PastWriterFormValues[] = [];
    const onSubmit = vi.fn(async (values: PastWriterFormValues) => {
      submitted.push(values);
    });

    await render(AddPastWriterDialog, {
      open: true,
      mode: "create",
      canSetWeight: false,
      onSubmit,
    });

    await expect.poll(() => one('[data-testid="past-writer-dialog"]')).not.toBeNull();
    expect(one("[data-past-writer-weight-input]")).toBeNull();
    const roleInput = one("#past-writer-staff-role") as HTMLInputElement;
    expect(roleInput).not.toBeNull();
    expect(one("[data-past-writer-staff-role-select] select")).toBeNull();

    // Open SelectInput dropdown and confirm weights are hidden for non-weight managers.
    await userEvent.click(roleInput);
    await expect.poll(() => document.querySelectorAll('[role="option"]').length).toBeGreaterThan(1);
    const optionsText = [...document.querySelectorAll('[role="option"]')].map((el) => text(el)).join(" | ");
    expect(optionsText).not.toContain("default weight");
    expect(optionsText).toContain("Technical Writer");

    const techWriterOption = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (el) => text(el) === "Technical Writer"
    );
    expect(techWriterOption).not.toBeUndefined();
    await userEvent.click(techWriterOption!);

    await userEvent.fill(one("[data-past-writer-name-input]")!, "Jordan Ellis");
    await userEvent.fill(one("[data-past-writer-initials-input]")!, "je");
    await userEvent.click(one('[data-past-writer-status="former"]')!);
    await userEvent.click(one("[data-past-writer-save]")!);

    await expect.poll(() => submitted.length).toBe(1);
    expect(submitted[0]).toEqual({
      name: "Jordan Ellis",
      initials: "JE",
      staffRole: "technical_writer",
      isActive: false,
      weight: null,
    });
  });

  it("shows custom weight and validates/submits it when canSetWeight is true", async () => {
    const submitted: PastWriterFormValues[] = [];
    const onSubmit = vi.fn(async (values: PastWriterFormValues) => {
      submitted.push(values);
    });

    await render(AddPastWriterDialog, {
      open: true,
      mode: "create",
      canSetWeight: true,
      onSubmit,
    });

    await expect.poll(() => one("[data-past-writer-weight-input]")).not.toBeNull();
    const roleInput = one("#past-writer-staff-role") as HTMLInputElement;
    await userEvent.click(roleInput);
    await expect.poll(() => document.querySelectorAll('[role="option"]').length).toBeGreaterThan(1);
    const optionsText = [...document.querySelectorAll('[role="option"]')].map((el) => text(el)).join(" | ");
    expect(optionsText).toContain("default weight");
    await userEvent.keyboard("{Escape}");

    await userEvent.fill(one("[data-past-writer-name-input]")!, "Nadia Patel");
    await userEvent.fill(one("[data-past-writer-initials-input]")!, "np");
    await userEvent.fill(one("[data-past-writer-weight-input]")!, "9.9");
    await userEvent.click(one("[data-past-writer-save]")!);

    await expect.poll(() => text(one('[role="alert"]'))).toContain("0");
    expect(submitted).toEqual([]);

    await userEvent.fill(one("[data-past-writer-weight-input]")!, "0.85");
    await userEvent.click(one("[data-past-writer-save]")!);

    await expect.poll(() => submitted.length).toBe(1);
    expect(submitted[0]).toEqual({
      name: "Nadia Patel",
      initials: "NP",
      staffRole: null,
      isActive: true,
      weight: 0.85,
    });
  });
});
