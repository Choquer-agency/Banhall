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

const NOW = Date.UTC(2026, 8, 24, 12);
const cap = { maxInputUsdPerMTok: 5, maxOutputUsdPerMTok: 30, maxCostRatio: 2 };

function adminState(overrides: Partial<ModelAdminState> = {}): ModelAdminState {
  return {
    autoSwitch: true,
    evalBudget: { monthlyUsd: 20, spentUsd: 1.25 },
    lastRefreshAt: NOW,
    catalogSize: 312,
    thresholds: { benchmarkMargin: 2, rubricMargin: 0.5, maxEvaluationsPerRun: 2, maxErrorRate: 0.2, errorMinCalls: 20 },
    hasArtificialAnalysisScores: true,
    roles: [
      {
        role: "writing",
        label: "Writing",
        description: "Default model for report generation, seeds and redrafts.",
        autoSwitch: true,
        modelId: "x-ai/grok-4.7",
        modelLabel: "Grok 4.7",
        previousModelId: "claude-sonnet-5",
        previousLabel: "Sonnet 5",
        assignedAt: NOW,
        assignedBy: "system",
        cap,
        history: [
          {
            id: "event-1" as never,
            kind: "promotion",
            reason: "evaluation_passed",
            fromLabel: "Sonnet 5",
            toLabel: "Grok 4.7",
            actor: "system",
            at: NOW,
            rubric: { candidate: 8.2, incumbent: 7.4 },
            errorRate: null,
          },
        ],
      },
      {
        role: "chat",
        label: "Chat",
        description: "The report chat assistant.",
        autoSwitch: false,
        modelId: "claude-sonnet-5",
        modelLabel: "Sonnet 5",
        previousModelId: null,
        previousLabel: null,
        assignedAt: null,
        assignedBy: null,
        cap,
        history: [],
      },
    ],
    catalog: [
      {
        modelId: "x-ai/grok-4.7",
        displayName: "Grok 4.7",
        provider: "SpaceXAI",
        gateway: "openrouter",
        status: "enabled",
        inUse: true,
        inputUsdPerMTok: 1.6,
        outputUsdPerMTok: 4.8,
        cacheReadUsdPerMTok: null,
        contextLength: 500_000,
        maxOutputTokens: 450_000,
        supportsTools: true,
        supportsStructuredOutputs: true,
        reasoning: true,
        score: 46.4,
        scoreSource: "openrouter_aa",
        expirationDate: null,
        missing: false,
        lastSeenAt: NOW,
      },
    ],
    evaluations: [
      {
        id: "evaluation-1" as never,
        role: "writing",
        roleLabel: "Writing",
        modelLabel: "Grok 4.7",
        incumbentLabel: "Sonnet 5",
        status: "passed",
        outcome: "promoted",
        error: null,
        candidate: { schemaValidity: 1, contractPassRate: 1, rubricScore: 8.2, costUsd: 0.1, tasks: 3 },
        incumbent: { schemaValidity: 1, contractPassRate: 1, rubricScore: 7.4, costUsd: 0.09, tasks: 3 },
        gates: [],
        evalCostUsd: 0.31,
        estimatedCostUsd: 0.5,
        createdAt: NOW,
      },
    ],
    ...overrides,
  };
}

function callbacks() {
  return {
    onToggleAutoSwitch: vi.fn(),
    onRollback: vi.fn(),
    onSaveCap: vi.fn(),
    onSaveBudget: vi.fn(),
    onRefresh: vi.fn(),
  };
}

describe("ModelCatalogPanel", () => {
  it("shows each role's model, rollback target, history, evaluations and the catalog with attribution", async () => {
    const handlers = callbacks();
    await render(ModelCatalogPanel, { admin: adminState(), ...handlers });

    await expect.element(page.getByText("$1.25 of $20.00 used")).toBeVisible();
    await expect.element(page.getByText("312 models, last refreshed", { exact: false })).toBeVisible();

    const rollback = page.getByRole("button", { name: "Roll back to Sonnet 5" });
    await rollback.click();
    expect(handlers.onRollback).toHaveBeenCalledWith("writing");
    await expect.element(page.getByRole("button", { name: "Nothing to roll back" })).toBeDisabled();

    await page.getByRole("button", { name: "History (1)" }).click();
    await expect
      .element(page.getByText("From Sonnet 5 to Grok 4.7, passed every evaluation gate (automatic).", { exact: false }))
      .toBeVisible();

    await expect.element(page.getByRole("cell", { name: "promoted", exact: false })).toBeVisible();
    await expect.element(page.getByText("46.4")).toBeVisible();
    await expect
      .element(page.getByTestId("aa-attribution"))
      .toHaveTextContent("Source: Artificial Analysis (artificialanalysis.ai). For internal use only");
  });

  it("toggles the kill switch and saves caps and the budget as numbers", async () => {
    const handlers = callbacks();
    await render(ModelCatalogPanel, { admin: adminState(), ...handlers });

    const toggle = page.getByRole("switch", { name: "Switch models automatically" });
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

    await page.getByLabelText("Monthly budget, USD").fill("35");
    await page.getByRole("button", { name: "Save budget" }).click();
    expect(handlers.onSaveBudget).toHaveBeenCalledWith(35);

    await page.getByRole("button", { name: "Refresh now" }).click();
    expect(handlers.onRefresh).toHaveBeenCalledTimes(1);
  });

  it("hides the attribution line when no row carries a score", async () => {
    await render(ModelCatalogPanel, {
      admin: adminState({
        catalog: adminState().catalog.map((row) => ({ ...row, score: null, scoreSource: null })),
        evaluations: [],
      }),
      ...callbacks(),
    });
    await expect.element(page.getByText("No evaluations yet.")).toBeVisible();
    expect(document.querySelector("[data-testid='aa-attribution']")).toBeNull();
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
        { id: "claude-sonnet-5", label: "Sonnet 5", provider: "Anthropic", gateway: "anthropic", description: "", available: true },
        { id: "x-ai/grok-4.7", label: "Grok 4.7", provider: "SpaceXAI", gateway: "openrouter", description: "", available: true },
      ],
      defaultModel: "x-ai/grok-4.7",
      defaultModelLabel: "Grok 4.7",
    });
    __setQueryData("modelCatalog:adminState", adminState());
  });

  it("wires the kill switch and rollback to the catalog mutations", async () => {
    await render(ModelsPage);
    await page.getByRole("switch", { name: "Switch models automatically" }).click();
    await expect.poll(() => __mutationCalls("modelCatalog:setAutoSwitch")).toEqual([{ enabled: false }]);
    await page.getByRole("button", { name: "Roll back to Sonnet 5" }).click();
    await expect.poll(() => __mutationCalls("modelCatalog:rollbackRole")).toEqual([{ role: "writing" }]);
  });
});
