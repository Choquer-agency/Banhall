import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import { toast } from "svelte-sonner";
import ImportCompanyBand from "./ImportCompanyBand.svelte";
import type { ImportCategory, SheetBand } from "./importFormat";
import {
  __mutationCalls,
  __resetConvexStub,
  __setMutationHandler,
} from "$lib/test/convex-svelte-stub.svelte";
import type { Id } from "../../../../convex/_generated/dataModel";

const one = (selector: string) => document.querySelector<HTMLElement>(selector);
const text = (node: Element | null | undefined) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();

function makeBand(overrides: Partial<SheetBand> = {}): SheetBand {
  return {
    companyKey: "zenith robotics",
    displayName: "Zenith Robotics",
    total: 4,
    needsCheck: 0,
    ready: 4,
    beingRead: 0,
    newFiles: 0,
    brainCheck: 0,
    categories: {
      final_pd: { total: 4, needsCheck: 0, fiscalYears: { "2025": 4 } },
    },
    company: null,
    isNew: true,
    suggestedCompanies: [
      { id: "c-zenith" as Id<"clients">, name: "Zenith Robotics Inc.", companyKey: "zenith robotics inc." },
    ],
    ...overrides,
  } as SheetBand;
}

describe("ImportCompanyBand canonical company suggestions & live display name", () => {
  beforeEach(async () => {
    __resetConvexStub();
    vi.spyOn(toast, "error").mockImplementation(() => "t");
    document.body.innerHTML = "";
    await page.viewport(1280, 800);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens the Similar popover and snaps files to the suggested existing company", async () => {
    __setMutationHandler("ingestion:snapBandToCompany", () => ({
      moved: 4,
      hasMore: false,
      targetName: "Zenith Robotics Inc.",
    }));

    await render(ImportCompanyBand, {
      band: makeBand(),
      tab: "review",
      onlyToCheck: false,
      open: false,
      openSections: new Set<ImportCategory>(),
      onToggle: () => {},
      onToggleSection: () => {},
    });

    const trigger = one('[data-import-band-similar="zenith robotics"]')!;
    expect(text(trigger)).toContain("Similar to Zenith Robotics Inc.?");
    await userEvent.click(trigger);

    await expect.poll(() => one("[data-import-band-similar-popover]")).not.toBeNull();
    expect(text(one("[data-import-band-similar-popover]"))).toContain("existing company");

    await userEvent.click(one('[data-import-band-snap="c-zenith"]')!);
    await expect.poll(() => __mutationCalls("ingestion:snapBandToCompany").length).toBe(1);
    expect(__mutationCalls("ingestion:snapBandToCompany")[0]).toEqual({
      fromCompanyKey: "zenith robotics",
      targetClientId: "c-zenith",
    });
  });

  it("marks a suggested new company as separate when confirmed distinct", async () => {
    __setMutationHandler("ingestion:confirmNewCompanyDistinct", () => ({ ok: true }));

    await render(ImportCompanyBand, {
      band: makeBand(),
      tab: "review",
      onlyToCheck: false,
      open: false,
      openSections: new Set<ImportCategory>(),
      onToggle: () => {},
      onToggleSection: () => {},
    });

    await userEvent.click(one('[data-import-band-similar="zenith robotics"]')!);
    await expect.poll(() => one("[data-import-band-keep-separate]")).not.toBeNull();

    await userEvent.click(one("[data-import-band-keep-separate]")!);
    await expect.poll(() => __mutationCalls("ingestion:confirmNewCompanyDistinct").length).toBe(1);
    expect(__mutationCalls("ingestion:confirmNewCompanyDistinct")[0]).toEqual({
      companyKey: "zenith robotics",
      distinct: true,
    });
  });

  it("prefers the live company name over stale band displayName when linked", async () => {
    await render(ImportCompanyBand, {
      band: makeBand({
        displayName: "Zenith Old Label",
        isNew: false,
        suggestedCompanies: undefined,
        company: {
          via: "name",
          clientId: "c-zenith" as Id<"clients">,
          name: "Zenith Robotics Inc.",
          industry: "Software",
        },
      }),
      tab: "review",
      onlyToCheck: false,
      open: false,
      openSections: new Set<ImportCategory>(),
      onToggle: () => {},
      onToggleSection: () => {},
    });

    expect(text(one("[data-import-band-name]"))).toBe("Zenith Robotics Inc.");
  });
});
