import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import FirmNamesSetting from "./FirmNamesSetting.svelte";
import ModelsPage from "../../../routes/admin/models/+page.svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import { __mutationCalls, __resetConvexStub, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";
import { __resetAuthState } from "$lib/test/convex-auth-stub";

// Audit wave 2 (2026-09-26): the firm-name setting. Names are fictional.
describe("FirmNamesSetting", () => {
  it("starts with one empty row and saves the names typed, trimmed", async () => {
    const onSave = vi.fn(async () => {});
    await render(FirmNamesSetting, { names: [], onSave });
    const save = page.getByRole("button", { name: "Save names" });
    await expect.element(save).toBeDisabled();
    await userEvent.fill(page.getByRole("textbox", { name: "Firm name 1" }), "  Northwind   Advisory ");
    await page.getByRole("button", { name: "Add a name" }).click();
    await userEvent.fill(page.getByRole("textbox", { name: "Firm name 2" }), "NWA");
    await save.click();
    expect(onSave).toHaveBeenCalledWith(["Northwind Advisory", "NWA"]);
    await expect.element(page.getByRole("status")).toHaveTextContent("Saved");
  });

  it("removes a name and saves the rest", async () => {
    const onSave = vi.fn(async () => {});
    await render(FirmNamesSetting, { names: ["Northwind Advisory", "NWA"], onSave });
    await page.getByRole("button", { name: "Remove firm name 2" }).click();
    await page.getByRole("button", { name: "Save names" }).click();
    expect(onSave).toHaveBeenCalledWith(["Northwind Advisory"]);
  });

  it("shows a name that cannot be hidden on its row and keeps Save off", async () => {
    const onSave = vi.fn(async () => {});
    await render(FirmNamesSetting, { names: [], onSave });
    await userEvent.fill(page.getByRole("textbox", { name: "Firm name 1" }), "N");
    await expect.element(page.getByText('"N" is too short to hide. Use at least 2 characters.')).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Save names" })).toBeDisabled();
    await userEvent.fill(page.getByRole("textbox", { name: "Firm name 1" }), "42");
    await expect.element(page.getByText('"42" has no letters, so it cannot be hidden.')).toBeVisible();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("shows the server's refusal", async () => {
    const onSave = vi.fn(async () => {
      throw new Error("List at most 12 names.");
    });
    await render(FirmNamesSetting, { names: [], onSave });
    await userEvent.fill(page.getByRole("textbox", { name: "Firm name 1" }), "Northwind");
    await page.getByRole("button", { name: "Save names" }).click();
    await expect.element(page.getByRole("alert")).toBeVisible();
  });
});

describe("the Models page", () => {
  beforeEach(() => {
    __resetConvexStub();
    __resetAuthState();
    __resetPage();
    __resetNavigation();
    __setPageUrl("/admin/models");
  });

  it("shows the firm-name card to an admin and saves through setFirmNames", async () => {
    __setQueryData("generations:modelStats", {
      total: 0,
      overall: [],
      mine: [],
      scoreStats: [],
      recommendation: "Not enough data yet.",
    });
    __setQueryData("appSettings:getFirmNames", { names: [], updatedAt: null });
    await render(ModelsPage);
    await userEvent.fill(page.getByRole("textbox", { name: "Firm name 1" }), "Northwind Advisory");
    await page.getByRole("button", { name: "Save names" }).click();
    await expect
      .poll(() => __mutationCalls("appSettings:setFirmNames"))
      .toEqual([{ names: ["Northwind Advisory"] }]);
  });

  it("hides the card from anyone but an admin", async () => {
    __setQueryData("generations:modelStats", {
      total: 0,
      overall: [],
      mine: [],
      scoreStats: [],
      recommendation: "Not enough data yet.",
    });
    __setQueryData("appSettings:getFirmNames", null);
    await render(ModelsPage);
    await expect.element(page.getByText("Not enough data yet.")).toBeVisible();
    expect(page.getByRole("heading", { name: "Firm name" }).elements()).toHaveLength(0);
  });
});
