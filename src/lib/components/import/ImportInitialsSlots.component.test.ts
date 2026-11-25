import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import { toast } from "svelte-sonner";
import ImportInitialsSlots from "./ImportInitialsSlots.svelte";
import {
  __mutationCalls,
  __resetConvexStub,
  __setMutationHandler,
} from "$lib/test/convex-svelte-stub.svelte";
import type { Id } from "../../../../convex/_generated/dataModel";

const one = (selector: string) => document.querySelector<HTMLElement>(selector);
const text = (node: Element | null | undefined) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();

describe("ImportInitialsSlots", () => {
  beforeEach(async () => {
    __resetConvexStub();
    vi.spyOn(toast, "success").mockImplementation(() => "t");
    vi.spyOn(toast, "error").mockImplementation(() => "t");
    document.body.innerHTML = "";
    await page.viewport(1024, 768);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shifts initials between slots, supports multi-client and co-writers, and saves the payload", async () => {
    __setMutationHandler("ingestion:reassignFileInitials", () => ({ ok: true }));

    await render(ImportInitialsSlots, {
      fileId: "item-1" as Id<"ingestionItems">,
      writerInitials: "DW",
      reviewerInitials: "MO",
      clientInitials: "BM",
      financialInitials: "FK",
      initialsGroups: ["DW", "MO", "BM", "JT", "FK"],
      reviewerInProgress: true,
    });

    // Shows raw filename groups when more than 4 groups were parsed.
    expect(text(one("[data-import-initials-raw-groups]"))).toBe("Filename groups: DW · MO · BM · JT · FK");

    // Shift Reviewer right -> swaps MO and BM (primary client).
    await userEvent.click(one('[data-import-initials-shift-right="reviewer"]')!);
    await expect.poll(() => (one('[data-import-initials-input="reviewer"]') as HTMLInputElement).value).toBe("BM");
    await expect.poll(() => (one('[data-import-initials-input="client"]') as HTMLInputElement).value).toBe("MO");

    // Shift back so MO is Reviewer and BM is Client, then add a second client and co-writers.
    await userEvent.click(one('[data-import-initials-shift-left="client"]')!);
    await userEvent.fill(one('[data-import-initials-input="client"]')!, "BM, JT");

    await userEvent.click(one("[data-import-initials-add-cowriter]")!);
    // Include DW (same as primary writer) to verify primary writer is filtered out cleanly.
    await userEvent.fill(one('[data-import-initials-input="cowriters"]')!, "DW, AL, KP");

    // Toggle reviewer-in-progress off.
    await userEvent.click(one("[data-import-initials-reviewer-in-progress]")!);

    await userEvent.click(one("[data-import-initials-save]")!);
    await expect.poll(() => __mutationCalls("ingestion:reassignFileInitials").length).toBe(1);
    expect(__mutationCalls("ingestion:reassignFileInitials")[0]).toEqual({
      id: "item-1",
      writerInitials: "DW",
      reviewerInitials: "MO",
      clientInitials: "BM",
      financialInitials: "FK",
      coWriterInitials: ["AL", "KP"],
      extraClientInitials: ["JT"],
      reviewerInProgress: false,
    });
  });

  it("shows live Section C client matches and warns when the Financial slot matches a Section C contact", async () => {
    await render(ImportInitialsSlots, {
      fileId: "item-2" as Id<"ingestionItems">,
      writerInitials: "DW",
      reviewerInitials: "PN",
      clientInitials: "BM",
      financialInitials: "JT",
      companyName: "Northwind Labs",
      documentClientNames: [
        { name: "Ben Mercer", source: "section_c" },
        { name: "Jules Tremblay", source: "section_c" },
      ],
    });

    expect(text(one("[data-import-initials-client-matches]"))).toContain("BM - Ben Mercer");
    expect(text(one("[data-import-initials-financial-hint]"))).toContain("JT matches Section C contact Jules Tremblay");

    // Add JT to Client and clear Financial -> both match under Section C and the Financial hint disappears.
    await userEvent.fill(one('[data-import-initials-input="client"]')!, "BM, JT");
    await userEvent.clear(one('[data-import-initials-input="financial"]')!);
    await expect.poll(() => text(one("[data-import-initials-client-matches]"))).toBe(
      "Section C match: BM - Ben Mercer, JT - Jules Tremblay"
    );
    expect(one("[data-import-initials-financial-hint]")).toBeNull();
  });

  it("shows unassigned extra filename groups and lets an admin explicitly remove one", async () => {
    __setMutationHandler("ingestion:reassignFileInitials", () => ({ ok: true }));

    await render(ImportInitialsSlots, {
      fileId: "item-3" as Id<"ingestionItems">,
      writerInitials: "TL",
      reviewerInitials: "PN",
      clientInitials: "BM",
      financialInitials: "JT",
      initialsGroups: ["TL", "PN", "BM", "JT", "FR"],
    });

    expect(text(one("[data-import-initials-unassigned]"))).toContain("FR");
    await userEvent.click(one('[data-import-initials-drop-unassigned="FR"]')!);
    await expect.poll(() => one("[data-import-initials-unassigned]")).toBeNull();

    await userEvent.click(one("[data-import-initials-save]")!);
    await expect.poll(() => __mutationCalls("ingestion:reassignFileInitials").length).toBe(1);
    expect(__mutationCalls("ingestion:reassignFileInitials")[0]).toEqual({
      id: "item-3",
      writerInitials: "TL",
      reviewerInitials: "PN",
      clientInitials: "BM",
      financialInitials: "JT",
      coWriterInitials: null,
      extraClientInitials: null,
      dropUnassignedInitials: ["FR"],
      reviewerInProgress: false,
    });
  });
});
