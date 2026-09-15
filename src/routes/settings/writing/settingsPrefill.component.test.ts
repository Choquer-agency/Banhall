import { beforeEach, describe, expect, it } from "vitest";
import { tick } from "svelte";
import { render } from "vitest-browser-svelte";
import SettingsWritingPage from "./+page.svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import {
  __mutationCalls,
  __resetConvexStub,
  __setQueryData,
} from "$lib/test/convex-svelte-stub.svelte";
import {
  DEFAULT_HOUSE_RULE_MODES,
  NO_STYLE_OVERRIDES,
  STYLE_OVERRIDE_META,
  type StyleOverrideKey,
} from "../../../../shared/styleOverrides";

/**
 * Story 3 (CAP-8, AC 5) at the page: /settings/writing?fromGeneration=<id>
 * accepts that generation's save offer as a prefill. The preferences draft
 * holds the settings document's text, its analysed `writer_choice` waivers
 * are pre-ticked, Save is enabled, and nothing is saved until the writer
 * saves. The decision itself is the pure settingsPrefillDecision; this suite
 * proves the page's effect feeds it and applies the result.
 */
const GENERATION_ID = "generation-1";
const FILE_NAME = "PD Writing Customized Settings.docx";
const SAVED_TEXT = "Saved flavor: short declarative sentences.";
const OFFER_TEXT = "PD Writing Customized Settings\nUse my own report architecture. Any vocabulary is fine.";
const LOADED_NOTICE = `Loaded from ${FILE_NAME} in Writer's Notes. Review, then save to your Writer Profile.`;
const KEPT_EDITS_NOTICE = "Your unsaved edits were kept; the settings document was not loaded.";

const MODES = { ...DEFAULT_HOUSE_RULE_MODES, paragraphDensity: "enforced" as const };
const OFFER = {
  supplyPath: "writer_notes" as const,
  fileName: FILE_NAME,
  text: OFFER_TEXT,
  truncated: false,
  // reportSkeleton and bannedWords are writer_choice; paragraphDensity is
  // enforced by the org, so it is never pre-ticked.
  addressedCategories: ["bannedWords", "paragraphDensity", "reportSkeleton"] as StyleOverrideKey[],
};

function writerSettings() {
  return {
    profileState: "applied",
    source: "writer_notes",
    fileName: FILE_NAME,
    matchesProfile: false,
    savedProfileSuperseded: true,
    waiverAnalysis: "analyzed",
    noProfileLine: null,
    offer: { ...OFFER, addressedCategories: [...OFFER.addressedCategories] },
  };
}

const textarea = () => document.querySelector<HTMLTextAreaElement>("#style-instructions");
const statusTexts = () =>
  [...document.querySelectorAll<HTMLElement>('[role="status"]')].map((el) => el.textContent?.trim() ?? "");
const saveButton = () =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === "Save preferences"
  );

/** The bits-ui checkbox labelled with a category's label, by aria-labelledby. */
function checkboxFor(key: StyleOverrideKey): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>('[role="checkbox"]')].find((box) => {
    const labelId = box.getAttribute("aria-labelledby");
    const label = labelId ? document.getElementById(labelId) : null;
    return label?.textContent?.trim() === STYLE_OVERRIDE_META[key].label;
  });
}
const isChecked = (key: StyleOverrideKey) => checkboxFor(key)?.getAttribute("aria-checked");

function typeInto(el: HTMLTextAreaElement, value: string) {
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("/settings/writing ?fromGeneration prefill (AC 5)", () => {
  beforeEach(() => {
    __resetPage();
    __resetNavigation();
    __resetConvexStub();
    __resetAuthState();
    __setQueryData("writerProfiles:getMyProfile", {
      customInstructions: SAVED_TEXT,
      enabled: true,
      styleOverrides: { ...NO_STYLE_OVERRIDES },
    });
    __setQueryData("houseStyle:getModesForMe", { ...MODES });
    __setPageUrl(`/settings/writing?fromGeneration=${GENERATION_ID}`);
  });

  it("prefills the document text, pre-ticks its writer_choice waivers, enables Save and saves nothing", async () => {
    __setQueryData("writerProfiles:getGenerationWriterSettings", writerSettings());
    await render(SettingsWritingPage, {});

    await expect.poll(() => textarea()?.value).toBe(OFFER_TEXT);
    await expect.poll(() => statusTexts()).toContain(LOADED_NOTICE);
    // The offer's writer_choice waivers are ticked; the enforced one is not,
    // and a category the document did not address stays as it was.
    expect(isChecked("bannedWords")).toBe("true");
    expect(isChecked("reportSkeleton")).toBe("true");
    expect(isChecked("paragraphDensity")).toBe("false");
    // 2026-09-15 (second) amendment: opening clauses are off org-wide by
    // default, and the page renders an "off" category as a locked, ticked box.
    expect(isChecked("openingClauses")).toBe("true");
    // The draft is dirty, so Save is enabled — and nothing was saved.
    expect(saveButton()?.disabled).toBe(false);
    expect(__mutationCalls("writerProfiles:saveMyProfile")).toEqual([]);
  });

  it("keeps the applied notice and the prefill when the effect re-runs", async () => {
    __setQueryData("writerProfiles:getGenerationWriterSettings", writerSettings());
    await render(SettingsWritingPage, {});
    await expect.poll(() => statusTexts()).toContain(LOADED_NOTICE);

    // Every dependency of the prefill effect moves: fresh query objects and
    // a writer edit to the prefilled draft. The prefill is decided once per
    // fromGeneration, so the notice stays and nothing is re-applied.
    __setQueryData("writerProfiles:getGenerationWriterSettings", writerSettings());
    __setQueryData("houseStyle:getModesForMe", { ...MODES });
    await tick();
    typeInto(textarea()!, `${OFFER_TEXT}\nOne more line.`);
    await tick();

    await expect.poll(() => textarea()?.value).toBe(`${OFFER_TEXT}\nOne more line.`);
    expect(statusTexts()).toContain(LOADED_NOTICE);
    expect(isChecked("bannedWords")).toBe("true");
    expect(__mutationCalls("writerProfiles:saveMyProfile")).toEqual([]);
  });

  it("keeps unsaved edits already in the draft when the offer arrives, and says so", async () => {
    // The offer is still loading when the writer starts editing.
    await render(SettingsWritingPage, {});
    await expect.poll(() => textarea()?.value).toBe(SAVED_TEXT);
    typeInto(textarea()!, "My own unsaved edit.");
    await tick();

    __setQueryData("writerProfiles:getGenerationWriterSettings", writerSettings());

    await expect.poll(() => statusTexts()).toContain(KEPT_EDITS_NOTICE);
    expect(textarea()?.value).toBe("My own unsaved edit.");
    expect(statusTexts()).not.toContain(LOADED_NOTICE);
    expect(isChecked("bannedWords")).toBe("false");
    expect(__mutationCalls("writerProfiles:saveMyProfile")).toEqual([]);
  });
});
