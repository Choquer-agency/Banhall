import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { tick } from "svelte";
import NotDraftedBanner from "./NotDraftedBanner.svelte";

const banner = () => document.querySelector<HTMLElement>("[data-not-drafted-banner]");
const action = () => document.querySelector<HTMLButtonElement>("[data-draft-rest]")!;

describe("NotDraftedBanner", () => {
  it("lists the missing Sections and offers Draft the rest", async () => {
    await render(NotDraftedBanner, {
      missingSections: [{ number: "244" }, { number: "246" }],
      onDraftRest: vi.fn(),
    });
    const text = banner()!.textContent!.replace(/\s+/g, " ");
    expect(text).toContain("Writing stopped. Sections 244 and 246 were not drafted.");
    expect(text).toContain("Draft the rest writes only the missing sections into this report. Your edits stay as they are.");
    expect(action().textContent?.trim()).toBe("Draft the rest");
  });

  it("uses the singular for one Section and renders nothing without any", async () => {
    const view = await render(NotDraftedBanner, { missingSections: [{ number: "246" }], onDraftRest: vi.fn() });
    expect(banner()!.textContent).toContain("Section 246 was not drafted.");
    await view.rerender({ missingSections: [] });
    expect(banner()).toBeNull();
  });

  it("calls the callback once and shows the pending state", async () => {
    let resolve!: () => void;
    const onDraftRest = vi.fn(() => new Promise<void>((done) => (resolve = done)));
    await render(NotDraftedBanner, { missingSections: [{ number: "246" }], onDraftRest });
    action().click();
    await tick();
    expect(onDraftRest).toHaveBeenCalledTimes(1);
    expect(action().disabled).toBe(true);
    expect(action().textContent?.trim()).toBe("Drafting…");
    expect(banner()!.querySelector('[role="status"]')?.textContent).toContain("Drafting the missing sections");
    action().click();
    expect(onDraftRest).toHaveBeenCalledTimes(1);
    resolve();
    await new Promise((done) => setTimeout(done, 0));
    await tick();
    expect(action().disabled).toBe(false);
  });

  it("shows a retry message when starting fails, and a host error when given", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const view = await render(NotDraftedBanner, {
      missingSections: [{ number: "246" }],
      onDraftRest: vi.fn(async () => {
        throw new Error("offline");
      }),
    });
    action().click();
    await new Promise((done) => setTimeout(done, 0));
    await tick();
    expect(banner()!.querySelector('[role="alert"]')?.textContent).toBe(
      "Could not start drafting the missing sections. Try again."
    );
    expect(action().disabled).toBe(false);
    await view.rerender({ errorMessage: "Another draft is running." });
    expect(banner()!.querySelector('[role="alert"]')?.textContent).toBe("Another draft is running.");
    errorSpy.mockRestore();
  });

  it("shows a failed attempt with its reason and a retry, until a newer attempt runs", async () => {
    const onDraftRest = vi.fn();
    const view = await render(NotDraftedBanner, {
      missingSections: [{ number: "244" }, { number: "246" }],
      onDraftRest,
      failedAttempt: { error: "The model did not respond in time." },
    });
    expect(banner()!.querySelector('[role="alert"]')?.textContent?.trim()).toBe(
      "Drafting the missing sections did not finish. The model did not respond in time."
    );
    expect(action().textContent?.trim()).toBe("Try again");
    action().click();
    expect(onDraftRest).toHaveBeenCalledTimes(1);
    // A newer attempt is running: the failure gives way to the pending state.
    await view.rerender({ pending: true });
    expect(banner()!.querySelector("[data-redraft-failed]")).toBeNull();
    expect(banner()!.querySelector('[role="status"]')?.textContent?.trim()).toBe(
      "Drafting the missing sections. Editing resumes when they are in."
    );
    // Without a reason the notice still says the attempt did not finish.
    await view.rerender({ pending: false, failedAttempt: { error: null } });
    expect(banner()!.querySelector('[role="alert"]')?.textContent?.trim()).toBe("Drafting the missing sections did not finish.");
    // A start error takes the place of the attempt failure.
    await view.rerender({ errorMessage: "Another draft is running." });
    expect(banner()!.querySelector('[role="alert"]')?.textContent).toBe("Another draft is running.");
    expect(action().textContent?.trim()).toBe("Draft the rest");
  });

  it("respects host pending and disabled states", async () => {
    const onDraftRest = vi.fn();
    const view = await render(NotDraftedBanner, { missingSections: [{ number: "246" }], onDraftRest, pending: true });
    expect(action().disabled).toBe(true);
    await view.rerender({ pending: false, disabled: true });
    action().click();
    expect(onDraftRest).not.toHaveBeenCalled();
  });
});
