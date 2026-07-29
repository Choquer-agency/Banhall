import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { userEvent } from "vitest/browser";
import OwnerTransferDialog, { type OwnerCandidate } from "./OwnerTransferDialog.svelte";

const candidates: OwnerCandidate[] = [
  {
    userId: "candidate-user" as OwnerCandidate["userId"],
    label: "Morgan Manager",
    initials: "MM",
    email: "morgan@example.com",
    role: "manager",
  },
];

describe("OwnerTransferDialog", () => {
  it("renders eligible candidate details and submits the selected owner", async () => {
    const onSubmit = vi.fn();
    await render(OwnerTransferDialog, {
      open: true,
      currentOwnerLabel: "Olivia Owner",
      candidates,
      onSubmit,
    });
    expect(document.body.textContent).toContain("Morgan Manager");
    expect(document.body.textContent).toContain("morgan@example.com");
    expect(document.body.textContent).toContain("Manager");
    const candidate = document.body.querySelector<HTMLButtonElement>('[role="radio"]')!;
    await userEvent.click(candidate);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const submit = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Transfer ownership"
    )!;
    await userEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith(candidates[0].userId, undefined);
    expect(candidate.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  });

  it("supports arrow-key radiogroup navigation", async () => {
    const second = { ...candidates[0], userId: "second-user" as OwnerCandidate["userId"], label: "Taylor Writer" };
    await render(OwnerTransferDialog, {
      open: true,
      currentOwnerLabel: "Olivia Owner",
      candidates: [...candidates, second],
      onSubmit: vi.fn(),
    });
    const rows = [...document.body.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    rows[0].focus();
    rows[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(rows[1].getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(rows[1]);
  });

  it("preserves the audit note while stale ownership values are reviewed", async () => {
    const onUseLatest = vi.fn();
    const view = await render(OwnerTransferDialog, {
      open: true,
      currentOwnerLabel: "Olivia Owner",
      candidates,
      onSubmit: vi.fn(),
    });
    await userEvent.click(document.body.querySelector<HTMLButtonElement>('[role="radio"]')!);
    await userEvent.fill(document.body.querySelector("textarea")!, "Coverage change");

    await view.rerender({
      open: true,
      currentOwnerLabel: "Olivia Owner",
      latestOwnerLabel: "Taylor Writer",
      candidates: [],
      stale: true,
      onUseLatest,
      onSubmit: vi.fn(),
    });

    expect(document.body.querySelector('[role="status"]')?.textContent).toContain(
      "current owner is Taylor Writer"
    );
    expect(document.body.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
      "Coverage change"
    );
    const latest = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Use latest values"
    )!;
    await userEvent.click(latest);
    expect(onUseLatest).toHaveBeenCalledOnce();
  });

  it("shows loading, empty, truncated, and error states", async () => {
    const loading = await render(OwnerTransferDialog, {
      open: true,
      currentOwnerLabel: null,
      candidates: [],
      loading: true,
      onSubmit: vi.fn(),
    });
    expect(document.body.textContent).toContain("Loading eligible owners");
    loading.unmount();

    await render(OwnerTransferDialog, {
      open: true,
      currentOwnerLabel: null,
      candidates: [],
      failed: true,
      truncated: true,
      errorMessage: "The project workflow changed.",
      onSubmit: vi.fn(),
    });
    expect(document.body.textContent).not.toContain("No other eligible Consultants or Managers");
    expect(document.body.textContent).toContain("Eligible owners could not be loaded");
    expect(document.body.textContent).toContain("larger than this bounded list");
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain("workflow changed");
  });
});
