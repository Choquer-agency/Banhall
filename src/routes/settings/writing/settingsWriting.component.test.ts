import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import SettingsWritingPage from "./+page.svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import {
  __mutationCalls,
  __resetConvexStub,
  __setMutationError,
  __setMutationResult,
  __setQueryData,
} from "$lib/test/convex-svelte-stub.svelte";
import {
  DEFAULT_HOUSE_RULE_MODES,
  NO_STYLE_OVERRIDES,
  STYLE_OVERRIDE_KEYS,
  type StyleOverrideKey,
} from "../../../../shared/styleOverrides";

vi.mock("svelte-sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const TEXT =
  "Short sentences, active voice, and the client's own product names. Never say leverage, robust or cutting-edge.";
const MODES = { ...DEFAULT_HOUSE_RULE_MODES, repetitionCaps: "enforced" as const, openingClauses: "off" as const };

function coverage(addressed: StyleOverrideKey[]) {
  return {
    textHash: "hash",
    analyzedAt: 1,
    categories: Object.fromEntries(
      STYLE_OVERRIDE_KEYS.map((key) => [
        key,
        addressed.includes(key) ? { addressed: true, evidence: `evidence for ${key}` } : { addressed: false, evidence: null },
      ]),
    ),
  };
}

function seedProfile(overrides: Record<string, unknown> = {}) {
  __setQueryData("writerProfiles:getMyProfile", {
    customInstructions: TEXT,
    enabled: true,
    styleOverrides: { ...NO_STYLE_OVERRIDES, bannedWords: true },
    coverage: coverage(["bannedWords", "sentenceConstruction", "reportSkeleton"]),
    ...overrides,
  });
}

const switchFor = (label: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="switch"]')].find((el) => el.getAttribute("aria-label") === label);
const saveButton = () =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "Save preferences");
const text = () => document.body.textContent ?? "";

describe("/settings/writing (I2)", () => {
  beforeEach(() => {
    __resetPage();
    __resetNavigation();
    __resetConvexStub();
    __resetAuthState();
    __setPageUrl("/settings/writing");
    __setQueryData("houseStyle:getModesForMe", { ...MODES });
    __setMutationResult("ai/stylePreview:previewMyStyle", {
      status: "ready",
      cached: false,
      paragraphs: ["Cedarline did not know.", "The team ran three builds."],
    });
  });

  it("sums up coverage with the ring and the heading", async () => {
    seedProfile();
    await render(SettingsWritingPage, {});
    await expect.poll(() => document.querySelector("[data-coverage-ring]")?.getAttribute("data-coverage-ring")).toBe("3/6");
    expect(text()).toContain("Your preferences cover 3 of 6 areas");
    expect(document.querySelector("[data-coverage-subtitle]")?.textContent?.trim()).toBe(
      "Banhall follows them in every new draft. House rules fill in the rest.",
    );
  });

  it("matches I2: ring, card radii, preview type, instructions type, ticks, locks and switches", async () => {
    seedProfile();
    await render(SettingsWritingPage, {});
    await expect.poll(() => document.querySelector("[data-preview-paragraph]")).not.toBeNull();
    const style = (selector: string) => getComputedStyle(document.querySelector<HTMLElement>(selector)!);

    const ring = document.querySelector<HTMLElement>("[data-coverage-ring]")!;
    expect([ring.getBoundingClientRect().width, ring.getBoundingClientRect().height]).toEqual([72, 72]);
    expect((ring.firstElementChild as HTMLElement).getBoundingClientRect().width).toBe(58);
    expect(ring.style.backgroundImage).toContain("conic-gradient");
    expect(ring.style.backgroundImage).toContain("var(--color-settings-ring-pink) 50%, var(--aurora-track) 50%");

    expect(style("[data-coverage-summary]").borderRadius).toBe("14px");
    expect(style("[data-edit-instructions]").borderRadius).toBe("8px");
    const on = switchFor("Use my writing preferences")!;
    expect([on.getBoundingClientRect().width, on.getBoundingClientRect().height]).toEqual([36, 20]);
    expect(getComputedStyle(on).backgroundColor).toBe("rgb(10, 58, 56)");

    const preview = style("[data-style-preview]");
    expect(preview.borderRadius).toBe("14px");
    expect(preview.borderTopColor).toBe("rgb(233, 240, 239)");
    expect(preview.paddingTop).toBe("22px");
    expect(preview.boxShadow).toContain("rgba(5, 42, 40, 0.04) 0px 8px 24px 0px");
    expect(style("[data-preview-heading]").fontSize).toBe("20px");
    expect(style("[data-preview-heading]").lineHeight).toBe("26px");
    expect(style("[data-preview-section]").letterSpacing).toBe("normal");
    const active = document.querySelector<HTMLElement>('[data-preview-segment="preferences"]')!;
    expect(getComputedStyle(active).backgroundColor).toBe("rgb(255, 255, 255)");
    expect(getComputedStyle(active).boxShadow).toContain("rgba(5, 42, 40, 0.08) 0px 1px 2px 0px");
    const mark = document.querySelector<HTMLElement>("[data-style-preview] [data-ai-mark]")!;
    expect(mark.getBoundingClientRect().width).toBe(14);

    expect(style("[data-instructions-excerpt]").fontSize).toBe("13px");
    expect(style("[data-instructions-excerpt]").lineHeight).toBe("20px");
    expect(style("[data-instructions-count]").color).toBe("rgb(147, 165, 161)");
    expect(style("[data-instructions-edit]").fontSize).toBe("12px");

    const tick = document.querySelector<HTMLElement>('[data-coverage-row="bannedWords"] [data-covered-tick]')!;
    expect(getComputedStyle(tick).backgroundColor).toBe("rgb(207, 241, 238)");
    expect(getComputedStyle(tick).color).toBe("rgb(10, 58, 56)");
    const check = tick.querySelector("svg")!;
    expect(check.querySelector("path")?.getAttribute("d")).toBe("M20 6 9 17l-5-5");
    expect([check.getAttribute("width"), check.getAttribute("stroke-width")]).toEqual(["11", "3.2"]);
    const lastRow = Array.from(document.querySelectorAll<HTMLElement>("[data-coverage-row]")).at(-1)!;
    expect(getComputedStyle(lastRow).borderBottomWidth).toBe("1px");

    expect(style('[data-win-card="bannedWords"]').borderRadius).toBe("12px");
    const win = switchFor("Word list")!;
    expect([win.getBoundingClientRect().width, win.getBoundingClientRect().height]).toEqual([36, 20]);
    const lock = document.querySelector<SVGElement>('[data-win-card="repetitionCaps"] [data-locked] svg')!;
    expect(lock.querySelector("path")?.getAttribute("d")).toBe(
      "M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z M8 11V8a4 4 0 0 1 8 0v3",
    );
    expect([lock.getAttribute("width"), lock.getAttribute("stroke-width")]).toEqual(["11", "2.2"]);

    const save = saveButton()!;
    expect(getComputedStyle(save).backgroundColor).toBe("rgb(227, 235, 233)");
    expect(getComputedStyle(save).borderRadius).toBe("8px");
    expect(style("[data-settings-save-bar]").marginTop).toBe("0px");
  });

  it("says when nothing is covered", async () => {
    seedProfile({ coverage: undefined });
    await render(SettingsWritingPage, {});
    await expect.poll(text).toContain("Your preferences do not cover any area yet");
    expect(document.querySelector("[data-coverage-ring]")?.getAttribute("data-coverage-ring")).toBe("0/6");
  });

  it("shows the excerpt and character count, or the empty state", async () => {
    seedProfile();
    await render(SettingsWritingPage, {});
    await expect.poll(() => document.querySelector("[data-instructions-excerpt]")?.textContent).toBe(`"${TEXT}"`);
    expect(document.querySelector("[data-instructions-count]")?.textContent?.trim()).toBe(
      `${TEXT.length} of 75,000 characters. You can paste your own writing here too.`,
    );
  });

  it("offers Add instructions when there are none", async () => {
    seedProfile({ customInstructions: "", coverage: undefined });
    await render(SettingsWritingPage, {});
    await expect.poll(() => document.querySelector("[data-instructions-empty]")?.textContent?.trim()).toBe(
      "No instructions yet. Paste how you write, or a sample of your writing.",
    );
    await page.getByRole("button", { name: "Add instructions" }).click();
    await expect.poll(() => document.querySelector("#style-instructions")).not.toBeNull();
  });

  it("lists what the instructions cover for writer-choice areas only", async () => {
    seedProfile();
    await render(SettingsWritingPage, {});
    await expect.poll(() => document.querySelectorAll("[data-coverage-row]").length).toBe(4);
    const row = (key: string) => document.querySelector<HTMLElement>(`[data-coverage-row="${key}"]`);
    expect(row("bannedWords")?.getAttribute("data-covered")).toBe("true");
    expect(row("bannedWords")?.textContent).toContain("Word list");
    expect(row("bannedWords")?.textContent).toContain('"evidence for bannedWords"');
    expect(row("paragraphDensity")?.textContent).toContain("Not in your instructions");
    expect(row("repetitionCaps")).toBeNull();
    expect(row("openingClauses")).toBeNull();
  });

  it("locks the areas the organization sets and stages the rest until Save", async () => {
    seedProfile();
    await render(SettingsWritingPage, {});
    await expect.poll(() => switchFor("Word list")?.getAttribute("aria-checked")).toBe("true");
    for (const key of ["repetitionCaps", "openingClauses"]) {
      expect(document.querySelector(`[data-win-card="${key}"]`)?.textContent).toContain("Set by your organization");
    }
    expect(switchFor("Repeated phrases")).toBeUndefined();
    expect(text()).toContain("No changes yet. Changes apply to new drafts only.");
    expect(saveButton()?.disabled).toBe(true);

    await userEvent.click(switchFor("Paragraph length")!);
    await userEvent.click(switchFor("Use my writing preferences")!);
    await expect.poll(() => saveButton()?.disabled).toBe(false);
    expect(document.querySelector("[data-coverage-subtitle]")?.textContent?.trim()).toBe(
      "Off. New drafts follow the house rules only.",
    );
    expect(__mutationCalls("writerProfiles:saveMyProfile")).toEqual([]);

    saveButton()!.click();
    await expect.poll(() => __mutationCalls("writerProfiles:saveMyProfile")).toEqual([
      {
        customInstructions: TEXT,
        enabled: false,
        styleOverrides: { ...NO_STYLE_OVERRIDES, bannedWords: true, paragraphDensity: true },
      },
    ]);
    // The text did not change, so no new analysis runs.
    expect(__mutationCalls("ai/styleAnalysis:analyzeMyInstructions")).toEqual([]);
  });

  it("Discard puts the draft back", async () => {
    seedProfile();
    await render(SettingsWritingPage, {});
    await expect.poll(() => switchFor("Paragraph length")).toBeDefined();
    await userEvent.click(switchFor("Paragraph length")!);
    await page.getByRole("button", { name: "Discard" }).click();
    await expect.poll(() => switchFor("Paragraph length")?.getAttribute("aria-checked")).toBe("false");
    expect(saveButton()?.disabled).toBe(true);
  });

  it("Check again stores coverage and pre-ticks only writer-choice areas", async () => {
    seedProfile({ coverage: undefined });
    __setMutationResult("ai/styleAnalysis:analyzeMyInstructions", {
      categories: coverage(["paragraphDensity", "repetitionCaps"]).categories,
      lockedConflicts: [{ excerpt: "Skip the hypothesis", rule: "Hypothesis content" }],
    });
    await render(SettingsWritingPage, {});
    await expect.poll(() => document.querySelector<HTMLButtonElement>("[data-check-again]")?.disabled).toBe(false);
    document.querySelector<HTMLButtonElement>("[data-check-again]")!.click();

    await expect.poll(() => __mutationCalls("ai/styleAnalysis:analyzeMyInstructions")).toEqual([
      { text: TEXT, persist: true },
    ]);
    await expect.poll(() => switchFor("Paragraph length")?.getAttribute("aria-checked")).toBe("true");
    // Word list stays on (never un-ticked); the enforced area has no switch.
    expect(switchFor("Word list")?.getAttribute("aria-checked")).toBe("true");
    expect(switchFor("Repeated phrases")).toBeUndefined();
    expect(saveButton()?.disabled).toBe(false);
    await page.getByRole("button", { name: "Some instructions can't be followed" }).click();
    await expect.poll(text).toContain('"Skip the hypothesis"');
  });

  it("re-checks coverage after a save that changed the text", async () => {
    seedProfile();
    __setMutationResult("ai/styleAnalysis:analyzeMyInstructions", {
      categories: coverage([]).categories,
      lockedConflicts: [],
    });
    await render(SettingsWritingPage, {});
    await page.getByRole("button", { name: "Edit instructions" }).click();
    await expect.poll(() => document.querySelector("#style-instructions")).not.toBeNull();
    const area = document.querySelector<HTMLTextAreaElement>("#style-instructions")!;
    area.value = "Plain words only. ";
    area.dispatchEvent(new Event("input", { bubbles: true }));
    await page.getByRole("button", { name: "Back to settings" }).click();
    await expect.poll(() => saveButton()?.disabled).toBe(false);
    saveButton()!.click();
    await expect.poll(() => __mutationCalls("ai/styleAnalysis:analyzeMyInstructions")).toEqual([
      { text: "Plain words only.", persist: true },
    ]);
  });

  it("previews with and without the preferences", async () => {
    seedProfile();
    await render(SettingsWritingPage, {});
    await expect.poll(() => [...document.querySelectorAll("[data-preview-paragraph]")].map((p) => p.textContent)).toEqual([
      "Cedarline did not know.",
      "The team ran three builds.",
    ]);
    expect(text()).toContain("A sample 242 paragraph written with your preferences.");
    expect(__mutationCalls("ai/stylePreview:previewMyStyle")).toEqual([{ variant: "preferences" }]);

    await page.getByRole("radio", { name: "House style" }).click();
    await expect.poll(() => __mutationCalls("ai/stylePreview:previewMyStyle")).toEqual([
      { variant: "preferences" },
      { variant: "house" },
    ]);
    await expect.poll(text).toContain("A sample 242 paragraph written with the house rules.");
    // Switching back reuses the sample already written.
    await page.getByRole("radio", { name: "With your preferences" }).click();
    expect(__mutationCalls("ai/stylePreview:previewMyStyle")).toHaveLength(2);
  });

  it("offers a retry when the preview fails and shows the daily limit", async () => {
    seedProfile();
    __setMutationError("ai/stylePreview:previewMyStyle", new Error("boom"));
    await render(SettingsWritingPage, {});
    await expect.poll(() => document.querySelector("[data-preview-error]")?.textContent).toContain(
      "The preview could not be written. Try again.",
    );
    __setMutationResult("ai/stylePreview:previewMyStyle", {
      status: "limit",
      message: "You have used today's previews. Try again tomorrow.",
    });
    await page.getByRole("button", { name: "Try again" }).click();
    await expect.poll(() => document.querySelector("[data-preview-limit]")?.textContent).toBe(
      "You have used today's previews. Try again tomorrow.",
    );
  });

  it("refuses to save instructions over the limit", async () => {
    seedProfile({ customInstructions: "x".repeat(75_001), coverage: undefined });
    await render(SettingsWritingPage, {});
    await expect.poll(() => document.querySelector("[data-instructions-count]")?.textContent).toContain(
      "Shorten your instructions to save them.",
    );
    await userEvent.click(switchFor("Paragraph length")!);
    expect(saveButton()?.disabled).toBe(true);
  });
});
