import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import ModelCatalogPanel from "./ModelCatalogPanel.svelte";
import ModelsPage from "../../../routes/admin/models/+page.svelte";
import type { ModelAdminState } from "$lib/modelCatalogAdmin";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import { __mutationCalls, __resetConvexStub, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";
import { __resetAuthState } from "$lib/test/convex-auth-stub";

const NOW = Date.UTC(2026, 9, 22, 12);
const cap = { maxInputUsdPerMTok: 5, maxOutputUsdPerMTok: 30, maxCostRatio: 2 };

const track = (
  id: ModelAdminState["tracks"][number]["track"],
  name: string,
  modelId: string,
  modelLabel: string,
  extra: Partial<ModelAdminState["tracks"][number]> = {}
): ModelAdminState["tracks"][number] => ({
  track: id,
  name,
  modelId,
  modelLabel,
  previousModelId: null,
  previousLabel: null,
  switchedAt: null,
  lastCheckedAt: NOW,
  lastCheckNote: `Up to date on ${modelLabel}.`,
  rolledBackFrom: [],
  ...extra,
});

function adminState(overrides: Partial<ModelAdminState> = {}): ModelAdminState {
  return {
    autoSwitch: true,
    lastRefreshAt: NOW,
    catalogSize: 186,
    thresholds: { maxErrorRate: 0.2, errorMinCalls: 20 },
    hasArtificialAnalysisScores: true,
    tracks: [
      track("claude-opus", "Claude Opus", "claude-opus-5-5", "Opus 5.5"),
      track("claude-sonnet", "Claude Sonnet", "claude-sonnet-5-5", "Sonnet 5.5", {
        previousModelId: "claude-sonnet-5",
        previousLabel: "Sonnet 5",
        switchedAt: NOW,
        lastCheckNote: "Moved to Sonnet 5.5.",
      }),
      track("claude-haiku", "Claude Haiku", "claude-haiku-5-5", "Haiku 5.5", { rolledBackFrom: ["Haiku 5.6"] }),
      track("gpt-sol", "GPT Sol", "openai/gpt-6.1-sol", "GPT-6.1 Sol"),
      track("gpt-luna", "GPT Luna", "openai/gpt-6-luna", "GPT-6 Luna"),
      track("gemini-pro", "Gemini Pro", "google/gemini-3.1-pro-preview", "Gemini 3.1 Pro"),
      track("gemini-flash", "Gemini Flash", "google/gemini-3.8-flash", "Gemini 3.8 Flash"),
    ],
    roles: [
      {
        role: "writing",
        label: "Writing",
        description: "Default model a writer picks for the report.",
        track: "claude-sonnet",
        trackName: "Claude Sonnet",
        chosenByAdmin: false,
        modelId: "claude-sonnet-5-5",
        modelLabel: "Sonnet 5.5",
        cap,
      },
      {
        role: "retrieval_brief",
        label: "Retrieval brief",
        description: "Turns a transcript into Brain search queries.",
        track: "claude-haiku",
        trackName: "Claude Haiku",
        chosenByAdmin: false,
        modelId: "claude-haiku-5-5",
        modelLabel: "Haiku 5.5",
        cap: { maxInputUsdPerMTok: 1.5, maxOutputUsdPerMTok: 8, maxCostRatio: 2 },
      },
    ],
    log: [
      {
        id: "event-1",
        at: NOW,
        kind: "upgrade",
        automatic: true,
        text: "Claude Sonnet moved from Sonnet 5 to Sonnet 5.5: a newer version passed its check.",
      },
      {
        id: "notice-1",
        at: NOW - 1000,
        kind: "notice",
        automatic: true,
        text: "Gemini 3.5 Flash (google/gemini-3.5-flash) is no longer listed on OpenRouter.",
      },
    ],
    catalog: [
      {
        modelId: "claude-sonnet-5-5",
        displayName: "Sonnet 5.5",
        provider: "Anthropic",
        gateway: "anthropic",
        status: "enabled",
        inUse: true,
        inputUsdPerMTok: 2,
        outputUsdPerMTok: 10,
        cacheReadUsdPerMTok: null,
        contextLength: 1_000_000,
        maxOutputTokens: 128_000,
        supportsTools: true,
        supportsStructuredOutputs: true,
        reasoning: false,
        score: 52.1,
        scoreSource: "openrouter_aa",
        expirationDate: null,
        missing: false,
        lastSeenAt: NOW,
      },
    ],
    evaluations: [
      {
        id: "evaluation-1" as never,
        roleLabel: "Style analysis",
        modelLabel: "MiMo v2.6 Pro",
        incumbentLabel: "Sonnet 5",
        status: "passed",
        outcome: "promoted",
        error: null,
        evalCostUsd: 0.31,
        estimatedCostUsd: 0.5,
        createdAt: NOW - 86_400_000,
      },
    ],
    ...overrides,
  };
}

function callbacks() {
  return {
    onToggleAutoSwitch: vi.fn(),
    onMoveBack: vi.fn(),
    onSaveCap: vi.fn(),
    onRefresh: vi.fn(),
  };
}

describe("ModelCatalogPanel", () => {
  it("shows the seven tiers with their current and previous model, the roles, the log and the catalog with attribution", async () => {
    const handlers = callbacks();
    await render(ModelCatalogPanel, { admin: adminState(), ...handlers });

    await expect.element(page.getByText("186 models, last refreshed", { exact: false })).toBeVisible();
    expect(document.querySelectorAll("[data-track]")).toHaveLength(7);
    const sonnet = page.getByRole("button", { name: "Move back to Sonnet 5" });
    await sonnet.click();
    expect(handlers.onMoveBack).toHaveBeenCalledWith("claude-sonnet");
    await expect.element(page.getByRole("button", { name: "Nothing to move back to" }).first()).toBeDisabled();
    await expect.element(page.getByText("Moved to Sonnet 5.5.", { exact: false })).toBeVisible();
    await expect.element(page.getByTestId("rolled-back-from")).toHaveTextContent("Never used again on this tier: Haiku 5.6.");
    await expect.element(page.getByTestId("role-track").first()).toHaveTextContent("Follows Claude Sonnet, now Sonnet 5.5.");
    await expect
      .element(page.getByTestId("model-log"))
      .toHaveTextContent("Claude Sonnet moved from Sonnet 5 to Sonnet 5.5: a newer version passed its check. (automatic)");
    await expect.element(page.getByTestId("model-log")).toHaveTextContent("is no longer listed on OpenRouter.");
    await expect.element(page.getByText("52.1")).toBeVisible();
    await expect
      .element(page.getByTestId("aa-attribution"))
      .toHaveTextContent("Source: Artificial Analysis (artificialanalysis.ai). For internal use only");
    // The evaluation controls are gone; the last evaluations stay readable.
    expect(document.body.textContent).not.toContain("Save budget");
    expect(document.body.textContent).not.toContain("Max cost vs current");
    await page.getByRole("button", { name: "Earlier evaluations (1)" }).click();
    await expect.element(page.getByText("Evaluations ended on 2026-10-22", { exact: false })).toBeVisible();
    for (const text of [document.body.textContent ?? ""]) expect(text).not.toMatch(/[\u2013\u2014]/);
  });

  it("toggles the kill switch, saves a role's caps as numbers and refreshes", async () => {
    const handlers = callbacks();
    await render(ModelCatalogPanel, { admin: adminState(), ...handlers });

    const toggle = page.getByRole("switch", { name: "Update models automatically" });
    await expect.element(toggle).toHaveAttribute("aria-checked", "true");
    await toggle.click();
    expect(handlers.onToggleAutoSwitch).toHaveBeenCalledWith(false);

    const input = page.getByLabelText("Input cap ($/M)").first();
    await input.fill("3.5");
    await page.getByRole("button", { name: "Save cap" }).first().click();
    expect(handlers.onSaveCap).toHaveBeenCalledWith("writing", {
      maxInputUsdPerMTok: 3.5,
      maxOutputUsdPerMTok: 30,
      maxCostRatio: 2,
    });

    await page.getByRole("button", { name: "Refresh now" }).click();
    expect(handlers.onRefresh).toHaveBeenCalledTimes(1);
  });

  it("hides the attribution line when no row carries a score, and says when nothing is logged", async () => {
    await render(ModelCatalogPanel, {
      admin: adminState({
        catalog: adminState().catalog.map((row) => ({ ...row, score: null, scoreSource: null })),
        log: [],
        evaluations: [],
      }),
      ...callbacks(),
    });
    await expect.element(page.getByText("Nothing logged yet.")).toBeVisible();
    expect(document.querySelector("[data-testid='aa-attribution']")).toBeNull();
    expect(document.body.textContent).not.toContain("Earlier evaluations");
  });
});

describe("/admin/models route", () => {
  beforeEach(() => {
    __resetPage();
    __resetNavigation();
    __resetConvexStub();
    __resetAuthState();
    __setPageUrl("/admin/models");
    __setQueryData("myWork:getViewConfig", { killSwitch: false, ready: true });
    __setQueryData("generations:modelStats", {
      total: 0,
      overall: [],
      mine: [],
      scoreStats: [],
      recommendation: "Not enough selections yet.",
    });
    __setQueryData("providerReadiness:getCapabilities", {
      models: [
        { id: "claude-sonnet-5-5", label: "Sonnet 5.5", provider: "Anthropic", gateway: "anthropic", description: "", available: true },
        { id: "openai/gpt-6.1-sol", label: "GPT-6.1 Sol", provider: "OpenAI", gateway: "openrouter", description: "", available: true },
      ],
      defaultModel: "claude-sonnet-5-5",
      defaultModelLabel: "Sonnet 5.5",
    });
    __setQueryData("modelCatalog:adminState", adminState());
  });

  it("wires the kill switch and Move back to the catalog mutations", async () => {
    await render(ModelsPage);
    await page.getByRole("switch", { name: "Update models automatically" }).click();
    await expect.poll(() => __mutationCalls("modelCatalog:setAutoSwitch")).toEqual([{ enabled: false }]);
    await page.getByRole("button", { name: "Move back to Sonnet 5" }).click();
    await expect.poll(() => __mutationCalls("modelCatalog:moveTrackBack")).toEqual([{ track: "claude-sonnet" }]);
  });
});
