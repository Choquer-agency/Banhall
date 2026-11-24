import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import { toast } from "svelte-sonner";
import BulkImportClientsDialog from "./BulkImportClientsDialog.svelte";
import {
  __mutationCalls,
  __resetConvexStub,
  __setMutationHandler,
  __setQueryData,
} from "$lib/test/convex-svelte-stub.svelte";
import { __resetAuthState } from "$lib/test/convex-auth-stub";

const one = (selector: string) => document.querySelector<HTMLElement>(selector);
const all = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)];
const text = (node: Element | null | undefined) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();

describe("BulkImportClientsDialog", () => {
  beforeEach(async () => {
    __resetConvexStub();
    __resetAuthState();
    vi.spyOn(toast, "success").mockImplementation(() => "t");
    vi.spyOn(toast, "info").mockImplementation(() => "t");
    vi.spyOn(toast, "error").mockImplementation(() => "t");
    document.body.innerHTML = "";
    await page.viewport(1280, 800);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses input, defaults new to checked and similar to unchecked, and imports selected companies", async () => {
    __setQueryData("clients:previewBulkImportClients", {
      rows: [
        { index: 0, name: "Northwind Sensors", key: "northwind sensors", status: "new" },
        {
          index: 1,
          name: "Zenith Robotics",
          key: "zenith robotics",
          status: "similar",
          similarMatches: ["Zenith Robotics Inc."],
        },
        {
          index: 2,
          name: "Existing Co",
          key: "existing co",
          status: "exists",
          existingName: "Existing Co",
        },
        {
          index: 3,
          name: "Old Acme",
          key: "old acme",
          status: "merged",
          existingName: "Old Acme",
          mergedInto: "Zenith Robotics Inc.",
        },
      ],
      counts: { total: 4, new: 1, similar: 1, exists: 1, merged: 1, duplicate: 0, invalid: 0 },
      truncated: false,
    });
    __setMutationHandler("clients:bulkCreateClients", (args) => {
      const { names } = args as { names: string[] };
      return {
        createdCount: names.length,
        skippedExists: 0,
        skippedMerged: 0,
        skippedDuplicate: 0,
        skippedInvalid: 0,
        created: names.map((name, i) => ({ clientId: `c-${i}`, key: name.toLowerCase(), name })),
      };
    });

    const onImported = vi.fn();
    await render(BulkImportClientsDialog, { open: true, onImported });

    await expect.poll(() => one("[data-bulk-import-textarea]")).not.toBeNull();
    await userEvent.fill(
      one("[data-bulk-import-textarea]")!,
      "Company Name,Notes\nNorthwind Sensors,OK\nZenith Robotics,Check\nExisting Co,Old\nOld Acme,Merged"
    );
    await expect.poll(() => text(one("[data-bulk-import-parsed-count]"))).toBe("4 companies ready to check");

    await userEvent.click(one("[data-bulk-import-check]")!);
    await expect.poll(() => all("[data-bulk-import-row]").length).toBe(4);

    // "new" is checked by default; "similar" is unchecked by default; "exists" and "merged" are disabled.
    const newBox = one('[data-bulk-import-row="new"] input[type="checkbox"]') as HTMLInputElement;
    const similarBox = one('[data-bulk-import-row="similar"] input[type="checkbox"]') as HTMLInputElement;
    const existsBox = one('[data-bulk-import-row="exists"] input[type="checkbox"]') as HTMLInputElement;
    const mergedBox = one('[data-bulk-import-row="merged"] input[type="checkbox"]') as HTMLInputElement;

    expect(newBox.checked).toBe(true);
    expect(similarBox.checked).toBe(false);
    expect(existsBox.disabled).toBe(true);
    expect(mergedBox.disabled).toBe(true);
    expect(text(one("[data-bulk-import-selected-count]"))).toBe("1 company selected to add");

    // Opt in to the similar company too.
    await userEvent.click(similarBox);
    await expect.poll(() => text(one("[data-bulk-import-selected-count]"))).toBe("2 companies selected to add");

    await userEvent.click(one("[data-bulk-import-submit]")!);
    await expect.poll(() => __mutationCalls("clients:bulkCreateClients").length).toBe(1);
    expect(__mutationCalls("clients:bulkCreateClients")[0]).toEqual({
      names: ["Northwind Sensors", "Zenith Robotics"],
    });
    expect(onImported).toHaveBeenCalledWith({ createdCount: 2, skippedCount: 0 });
    expect(toast.success).toHaveBeenCalledWith("Added 2 companies.");
  });

  it("chunks submissions into sequential batches of 100", async () => {
    const names = Array.from({ length: 125 }, (_, i) => `Company ${i + 1} Inc.`);
    __setQueryData("clients:previewBulkImportClients", {
      rows: names.map((name, index) => ({
        index,
        name,
        key: name.toLowerCase(),
        status: "new",
      })),
      counts: { total: 125, new: 125, similar: 0, exists: 0, merged: 0, duplicate: 0, invalid: 0 },
      truncated: false,
    });
    __setMutationHandler("clients:bulkCreateClients", (args) => {
      const batch = (args as { names: string[] }).names;
      return {
        createdCount: batch.length,
        skippedExists: 0,
        skippedMerged: 0,
        skippedDuplicate: 0,
        skippedInvalid: 0,
        created: [],
      };
    });

    await render(BulkImportClientsDialog, { open: true });
    await expect.poll(() => one("[data-bulk-import-textarea]")).not.toBeNull();
    // Fill textarea directly for speed with 125 lines.
    const textarea = one("[data-bulk-import-textarea]") as HTMLTextAreaElement;
    textarea.value = names.join("\n");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));

    await expect.poll(() => text(one("[data-bulk-import-parsed-count]"))).toBe("125 companies ready to check");
    await userEvent.click(one("[data-bulk-import-check]")!);
    await expect.poll(() => text(one("[data-bulk-import-selected-count]"))).toBe("125 companies selected to add");

    await userEvent.click(one("[data-bulk-import-submit]")!);
    await expect.poll(() => __mutationCalls("clients:bulkCreateClients").length).toBe(2);
    const calls = __mutationCalls("clients:bulkCreateClients") as Array<{ names: string[] }>;
    expect(calls[0]!.names).toHaveLength(100);
    expect(calls[1]!.names).toHaveLength(25);
    expect(toast.success).toHaveBeenCalledWith("Added 125 companies.");
  });
});
