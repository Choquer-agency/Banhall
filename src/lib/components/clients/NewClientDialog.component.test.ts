import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { ConvexError } from "convex/values";
import NewClientDialog from "./NewClientDialog.svelte";
import {
  __activeQueryArgs,
  __mutationCalls,
  __queryArgsHistory,
  __resetConvexStub,
  __setMutationError,
  __setMutationResult,
  __setQueryData,
  __setQueryDataForArgs,
  __setQueryError,
} from "$lib/test/convex-svelte-stub.svelte";

/**
 * New client (Paper W6 and W9; 2026-10-14 amendment, "Create a client").
 * The same name refuses Create and offers "Use that client"; a name that
 * only looks alike warns and leaves Create on; Create sends the name, the
 * usual year end and the industry; the server's refusal shows inline.
 */
const text = (node: Element | null | undefined) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();
const dialog = () => document.querySelector<HTMLElement>('[data-testid="new-client-dialog"]');
const nameField = () => document.querySelector<HTMLInputElement>("#new-client-name")!;
const createButton = () => document.querySelector<HTMLButtonElement>("[data-create-client]")!;
const NO_MATCH = { exact: null, similar: [] };

beforeEach(async () => {
  await page.viewport(1280, 900);
  __resetConvexStub();
  __setQueryData("projects:listIndustries", []);
  __setQueryData("clients:findSimilarClients", NO_MATCH);
});

describe("NewClientDialog", () => {
  it("opens on the name with W6's copy and no dashes", async () => {
    await render(NewClientDialog, { open: true });
    await expect.poll(dialog).not.toBeNull();
    await expect.element(page.getByRole("dialog", { name: "New client" })).toBeInTheDocument();
    expect(text(dialog())).toContain("Clients appear in the Client list when you start a project.");
    expect(text(dialog())).toContain("Fills the fiscal year on new projects. You can change it on any project.");
    expect(text(dialog())).not.toMatch(/[\u2010-\u2015\u00b7]/);
    await expect.poll(() => document.activeElement).toBe(nameField());
    // Nothing typed: Create waits for a name.
    expect(createButton().disabled).toBe(true);
  });

  it("refuses the same name and offers Use that client, which hands it back", async () => {
    __setQueryDataForArgs("clients:findSimilarClients", { name: "Cedarline Systems" }, {
      exact: { key: "cedarline systems", name: "Cedarline Systems", projectCount: 6 },
      similar: [],
    });
    const onCreated = vi.fn();
    await render(NewClientDialog, { open: true, onCreated });
    await userEvent.fill(nameField(), "Cedarline Systems");
    await expect.poll(() => text(document.querySelector("[data-client-exists]"))).toBe(
      "Cedarline Systems already exists, with 6 projects. Use that client"
    );
    expect(createButton().disabled).toBe(true);

    await userEvent.click(page.getByRole("button", { name: "Use that client" }));
    expect(onCreated).toHaveBeenCalledWith({ clientId: null, key: "cedarline systems", name: "Cedarline Systems" });
    await expect.poll(dialog).toBeNull();
    expect(__mutationCalls("clients:createClient")).toEqual([]);
  });

  it("asks only after typing stops for 250ms", async () => {
    await render(NewClientDialog, { open: true });
    await userEvent.fill(nameField(), "Ced");
    await userEvent.fill(nameField(), "Cedarline");
    expect(__activeQueryArgs("clients:findSimilarClients")).toEqual([]);
    await expect.poll(() => __activeQueryArgs("clients:findSimilarClients")).toEqual([{ name: "Cedarline" }]);
  });

  it("warns about a name that looks alike and still lets Create run (W6)", async () => {
    __setQueryDataForArgs("clients:findSimilarClients", { name: "Cedarline Systems Inc" }, {
      exact: null,
      similar: [{ key: "cedarline systems", name: "Cedarline Systems", projectCount: 1 }],
    });
    await render(NewClientDialog, { open: true });
    await userEvent.fill(nameField(), "Cedarline Systems Inc");
    await expect.poll(() => text(document.querySelector("[data-client-similar]"))).toBe(
      "Cedarline Systems already exists, with 1 project. Use that client"
    );
    expect(createButton().disabled).toBe(false);
  });

  it("creates the client with the year end and industry it was opened with (W9)", async () => {
    __setMutationResult("clients:createClient", { clientId: "client-9", key: "northwind robotics", name: "Northwind Robotics" });
    const onCreated = vi.fn();
    await render(NewClientDialog, {
      open: true,
      initialName: "Northwind Robotics",
      initialFiscalYearEnd: { month: 6, day: 30 },
      initialIndustry: "manufacturing",
      description: "Once created, it fills the Client field on this project.",
      onCreated,
    });
    await expect.poll(() => nameField()?.value).toBe("Northwind Robotics");
    expect(text(dialog())).toContain("Once created, it fills the Client field on this project.");
    expect(text(document.querySelector("[data-year-end-helper]"))).toBe(
      "Filled from this project. New projects for this client start with it."
    );
    expect(document.querySelector<HTMLInputElement>("#new-client-year-end-month")!.value).toBe("June");
    expect(document.querySelector<HTMLInputElement>("#new-client-year-end-day")!.value).toBe("30");
    expect(document.querySelector<HTMLInputElement>("#new-client-industry")!.value).toBe("Manufacturing");

    await expect.poll(() => createButton().disabled).toBe(false);
    await userEvent.click(createButton());
    await expect.poll(() => __mutationCalls("clients:createClient")).toEqual([
      { name: "Northwind Robotics", fiscalYearEndMonth: 6, fiscalYearEndDay: 30, industry: "manufacturing" },
    ]);
    // The saved year end and industry go back with it, so the page can fill
    // an empty fiscal year and industry on its first pick.
    expect(onCreated.mock.calls).toEqual([
      [
        {
          clientId: "client-9",
          key: "northwind robotics",
          name: "Northwind Robotics",
          fiscalYearEndMonth: 6,
          fiscalYearEndDay: 30,
          industry: "manufacturing",
        },
      ],
    ]);
    await expect.poll(dialog).toBeNull();
  });

  it("keeps Create off until the name check has answered for the name as typed", async () => {
    // Regression: Enter before the 250ms pause, or while the check ran,
    // made a look-alike with no warning.
    __setMutationResult("clients:createClient", { clientId: "client-3", key: "cedarline systems inc", name: "Cedarline Systems Inc" });
    __setQueryData("clients:findSimilarClients", undefined);
    await render(NewClientDialog, { open: true });
    await userEvent.fill(nameField(), "Cedarline Systems Inc");
    await userEvent.keyboard("{Enter}");
    expect(__mutationCalls("clients:createClient")).toEqual([]);
    expect(createButton().disabled).toBe(true);
    // Asked, but no answer yet.
    await expect.poll(() => __activeQueryArgs("clients:findSimilarClients")).toEqual([{ name: "Cedarline Systems Inc" }]);
    await userEvent.keyboard("{Enter}");
    expect(createButton().disabled).toBe(true);
    // Nothing alarming while it waits.
    expect(document.querySelector('[data-testid="new-client-dialog"] [role="alert"]')).toBeNull();
    expect(__mutationCalls("clients:createClient")).toEqual([]);

    __setQueryDataForArgs("clients:findSimilarClients", { name: "Cedarline Systems Inc" }, {
      exact: null,
      similar: [{ key: "cedarline systems", name: "Cedarline Systems", projectCount: 1 }],
    });
    await expect.poll(() => document.querySelector("[data-client-similar]")).not.toBeNull();
    expect(createButton().disabled).toBe(false);
    // A new name waits for its own answer.
    await userEvent.fill(nameField(), "Cedarline Systems Incorporated");
    expect(createButton().disabled).toBe(true);
    await userEvent.keyboard("{Enter}");
    expect(__mutationCalls("clients:createClient")).toEqual([]);
  });

  it("says when the name could not be checked, keeps Create off, and tries again", async () => {
    __setQueryError("clients:findSimilarClients", new Error("boom"));
    await render(NewClientDialog, { open: true });
    await userEvent.fill(nameField(), "Borealis");
    await expect.poll(() => text(document.querySelector("[data-client-check-error]"))).toBe(
      "We could not check this name. Try again"
    );
    expect(createButton().disabled).toBe(true);
    await userEvent.keyboard("{Enter}");
    expect(__mutationCalls("clients:createClient")).toEqual([]);
    expect(text(dialog())).not.toMatch(/[\u2010-\u2015\u00b7]/);

    const before = __queryArgsHistory("clients:findSimilarClients").length;
    await userEvent.click(page.getByRole("button", { name: "Try again" }));
    // The failed check is dropped and asked again.
    await expect.poll(() => __queryArgsHistory("clients:findSimilarClients").slice(before)).toEqual([
      "skip",
      { name: "Borealis" },
    ]);
    __setQueryData("clients:findSimilarClients", NO_MATCH);
    await expect.poll(() => document.querySelector("[data-client-check-error]")).toBeNull();
    expect(createButton().disabled).toBe(false);
  });

  it("sends no year end or industry when they are left empty", async () => {
    __setMutationResult("clients:createClient", { clientId: "client-2", key: "borealis", name: "Borealis" });
    await render(NewClientDialog, { open: true });
    await userEvent.fill(nameField(), "Borealis");
    await userEvent.click(createButton());
    await expect.poll(() => __mutationCalls("clients:createClient")).toEqual([{ name: "Borealis" }]);
  });

  it("shows the server's refusal inline and keeps the dialog open", async () => {
    __setMutationError(
      "clients:createClient",
      new ConvexError({ code: "CLIENT_EXISTS", message: "Cedarline Systems already exists." })
    );
    const onCreated = vi.fn();
    await render(NewClientDialog, { open: true, onCreated });
    await userEvent.fill(nameField(), "Cedarline Systems");
    await userEvent.click(createButton());
    await expect.poll(() => text(document.querySelector("[data-new-client-error]"))).toBe("Cedarline Systems already exists.");
    expect(onCreated).not.toHaveBeenCalled();
    expect(dialog()).not.toBeNull();
  });

  it("starts clean each time it opens", async () => {
    const screen = await render(NewClientDialog, { open: true, initialName: "First" });
    await expect.poll(() => nameField()?.value).toBe("First");
    await userEvent.fill(nameField(), "Typed over");
    await screen.rerender({ open: false });
    await expect.poll(dialog).toBeNull();
    await screen.rerender({ open: true, initialName: "Second" });
    await expect.poll(() => nameField()?.value).toBe("Second");
    expect(text(document.querySelector("[data-year-end-helper]"))).toBe(
      "Fills the fiscal year on new projects. You can change it on any project."
    );
  });
});
