import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import ClientCombobox from "./ClientCombobox.svelte";
import {
  __queryArgsHistory,
  __resetConvexStub,
  __setQueryData,
  __setQueryError,
} from "$lib/test/convex-svelte-stub.svelte";
import type { ClientOption } from "$lib/clients/clientOptions";

/**
 * The Client field on New project (Paper W7 and W8; 2026-10-14 amendment,
 * "Pick a client on New project"): options come from clients.listClients,
 * typing filters them, text naming a listed client is picked, and text
 * naming nothing offers New client with the typed name.
 */
const text = (node: Element | null | undefined) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();
const option = (name: string, extra: Partial<ClientOption> = {}): ClientOption => ({
  key: name.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("en-CA"),
  clientId: null,
  name,
  projectCount: 2,
  ...extra,
});
const CLIENTS = [
  option("Cedarline Systems", { clientId: "client-1", fiscalYearEndMonth: 9, fiscalYearEndDay: 30, industry: "manufacturing" }),
  option("Cedar Ridge Analytics"),
  option("Mercedes Tooling"),
  option("Éclair Foods"),
];
const shown = () => [...document.querySelectorAll("[data-client-option]")].map((node) => text(node));
const input = () => document.querySelector<HTMLInputElement>("#clientName")!;

beforeEach(async () => {
  await page.viewport(1280, 800);
  __resetConvexStub();
});

describe("ClientCombobox", () => {
  it("lists the saved clients from listClients and filters them as you type", async () => {
    __setQueryData("clients:listClients", { clients: CLIENTS, truncated: false });
    await render(ClientCombobox, { value: "" });
    await userEvent.click(input());
    await expect.poll(shown).toEqual(["Cedarline Systems", "Cedar Ridge Analytics", "Mercedes Tooling", "Éclair Foods"]);

    await userEvent.fill(input(), "ced");
    await expect.poll(shown).toEqual(["Cedarline Systems", "Cedar Ridge Analytics", "Mercedes Tooling"]);
    // Case and accents do not matter.
    await userEvent.fill(input(), "ECLAIR");
    await expect.poll(shown).toEqual(["Éclair Foods"]);
  });

  it("uses injected options instead of the query", async () => {
    __setQueryData("clients:listClients", { clients: [option("From the query")], truncated: false });
    await render(ClientCombobox, { value: "", clients: [option("Injected Ltd")] });
    await userEvent.click(input());
    await expect.poll(shown).toEqual(["Injected Ltd"]);
  });

  it("picks a listed client, by choosing it or typing its name, and hands back its year end and industry", async () => {
    const onPick = vi.fn();
    await render(ClientCombobox, { value: "", clients: CLIENTS, onPick });
    await userEvent.fill(input(), "Cedarl");
    await expect.poll(shown).toEqual(["Cedarline Systems"]);
    expect(input().dataset.clientPicked).toBeUndefined();
    await userEvent.click(page.getByRole("option", { name: "Cedarline Systems" }));
    await expect.poll(() => input().value).toBe("Cedarline Systems");
    await expect.poll(() => input().dataset.clientPicked).toBe("true");
    expect(onPick).toHaveBeenLastCalledWith(
      expect.objectContaining({ key: "cedarline systems", fiscalYearEndMonth: 9, fiscalYearEndDay: 30, industry: "manufacturing" })
    );

    // Typing the name in another case picks the same client; changing it drops the pick.
    await userEvent.fill(input(), "cedar ridge analytics");
    await expect.poll(() => onPick.mock.lastCall?.[0]?.name).toBe("Cedar Ridge Analytics");
    await userEvent.fill(input(), "Cedar Ridge");
    await expect.poll(() => onPick.mock.lastCall?.[0]).toBeNull();
    expect(input().dataset.clientPicked).toBeUndefined();
  });

  it("shows No client named and a New client row for a name that matches nothing (W8)", async () => {
    const onNewClient = vi.fn();
    await render(ClientCombobox, { value: "", clients: CLIENTS, onNewClient });
    await userEvent.fill(input(), "Northwind Robotics");
    await expect.poll(() => document.querySelector("[data-client-no-match]")).not.toBeNull();
    expect(text(document.querySelector("[data-client-no-match]"))).toBe(
      "No client named Northwind Robotics Check the spelling, or add it as a new client."
    );
    const row = document.querySelector<HTMLElement>("[data-new-client-option]")!;
    expect(text(row)).toBe("New client");
    expect(getComputedStyle(row).fontWeight).toBe("500");
    await userEvent.click(row);
    expect(onNewClient).toHaveBeenCalledWith("Northwind Robotics");
    await expect.poll(() => document.querySelector("[data-client-suggestions]")).toBeNull();
    // The typed name stays in the field, not the row's words.
    expect(input().value).toBe("Northwind Robotics");
  });

  it("offers New client for the typed name below names that only contain it", async () => {
    const onNewClient = vi.fn();
    await render(ClientCombobox, { value: "", clients: CLIENTS, onNewClient });
    await userEvent.fill(input(), "Cedar");
    await expect.poll(shown).toEqual(["Cedarline Systems", "Cedar Ridge Analytics"]);
    // Suggestions show, so no "No client named" block.
    expect(document.querySelector("[data-client-no-match]")).toBeNull();
    const row = document.querySelector<HTMLElement>("[data-new-client-option]")!;
    expect(text(row)).toBe('New client "Cedar"');
    // Below the suggestions, after a divider.
    const options = [...document.querySelectorAll('[role="option"]')];
    expect(options.at(-1)).toBe(row);
    expect(row.previousElementSibling?.getAttribute("aria-hidden")).toBe("true");
    await userEvent.click(row);
    expect(onNewClient).toHaveBeenCalledWith("Cedar");
    await expect.poll(() => document.querySelector("[data-client-suggestions]")).toBeNull();
    expect(input().value).toBe("Cedar");

    // A typed name that is a listed client needs no New client row.
    await userEvent.fill(input(), "Cedarline Systems");
    await userEvent.fill(input(), "Cedar Ridge Analytics");
    await expect.poll(() => input().dataset.clientPicked).toBe("true");
    expect(document.querySelector("[data-new-client-option]")).toBeNull();
  });

  it("leaves New client out when the page does not offer it", async () => {
    await render(ClientCombobox, { value: "", clients: CLIENTS });
    await userEvent.fill(input(), "Northwind Robotics");
    await expect.poll(() => text(document.querySelector("[data-client-no-match]"))).toBe(
      "No client named Northwind Robotics Check the spelling."
    );
    expect(document.querySelector("[data-new-client-option]")).toBeNull();
    // Nor below suggestions.
    await userEvent.fill(input(), "Cedar");
    await expect.poll(shown).toEqual(["Cedarline Systems", "Cedar Ridge Analytics"]);
    expect(document.querySelector("[data-new-client-option]")).toBeNull();
  });

  it("says nothing about a missing client while the list loads", async () => {
    const onPick = vi.fn();
    await render(ClientCombobox, { value: "", onPick, onNewClient: vi.fn() });
    await userEvent.fill(input(), "Cedarline Systems");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(document.querySelector("[data-client-no-match]")).toBeNull();
    expect(onPick).not.toHaveBeenCalled();

    __setQueryData("clients:listClients", { clients: CLIENTS, truncated: false });
    await expect.poll(() => onPick.mock.lastCall?.[0]?.key).toBe("cedarline systems");
  });

  it("counts a client added on the page before the list catches up", async () => {
    const onPick = vi.fn();
    await render(ClientCombobox, {
      value: "Northwind Robotics",
      clients: CLIENTS,
      extraClients: [option("Northwind Robotics", { projectCount: 0 })],
      onPick,
    });
    await expect.poll(() => onPick.mock.lastCall?.[0]?.name).toBe("Northwind Robotics");
  });

  it("shows a name set from outside even while the field has focus (New client, Use that client)", async () => {
    // Regression: the field kept the typed text while the page held another
    // name, so a project could start under a name nobody saw.
    const screen = await render(ClientCombobox, { value: "", clients: CLIENTS, onNewClient: vi.fn() });
    await userEvent.fill(input(), "Northwind Robotcs");
    expect(document.activeElement).toBe(input());
    await screen.rerender({ value: "Northwind Robotics Inc" });
    await expect.poll(() => input().value).toBe("Northwind Robotics Inc");
    // Typing still works after the outside change.
    await userEvent.fill(input(), "Cedarline Systems");
    expect(input().value).toBe("Cedarline Systems");
  });

  it("says the client list could not be loaded and tries again", async () => {
    __setQueryError("clients:listClients", new Error("boom"));
    await render(ClientCombobox, { value: "Cedarline Systems" });
    await expect.poll(() => text(document.querySelector("[data-client-list-error]"))).toBe(
      "The client list could not be loaded. Try again"
    );
    await userEvent.click(page.getByRole("button", { name: "Try again" }));
    // The failed subscription is dropped and made again.
    await expect.poll(() => __queryArgsHistory("clients:listClients")).toEqual([{}, "skip", {}]);
    __setQueryData("clients:listClients", { clients: CLIENTS, truncated: false });
    await expect.poll(() => document.querySelector("[data-client-list-error]")).toBeNull();
    expect(input().getAttribute("data-client-picked")).toBe("true");
  });
});
