import { describe, expect, test } from "vitest";
import fixture from "./__fixtures__/openrouter-models-2026-10-22.json";
import {
  MODEL_TRACK_IDS,
  TRACK_SEED_MODEL_IDS,
  appModelIdForListing,
  compareVersions,
  directAnthropicId,
  isExcludedModelId,
  isNewerInTrack,
  newestInTrack,
  openRouterIdForDirectClaude,
  parseTrackId,
  trackLabel,
  trackLabelFor,
  trackOf,
} from "./modelTracks";
import { CANDIDATE_MODELS, RETIRED_SEED_LABELS } from "./generationModels";
import { MODEL_PRICING } from "./modelPricing";
import { OPENROUTER_ANTHROPIC_REQUEST_IDS } from "./anthropicTransport";
import { SEED_CANONICAL_SLUGS } from "./modelCatalog";

const liveIds = (fixture as { data: Array<{ id: string }> }).data.map((row) => row.id);

describe("parseTrackId", () => {
  test.each([
    // Direct Anthropic ids.
    ["claude-sonnet-5-5", "claude-sonnet", "5.5", "direct"],
    ["claude-sonnet-5", "claude-sonnet", "5", "direct"],
    ["claude-sonnet-4-6", "claude-sonnet", "4.6", "direct"],
    ["claude-opus-5-5", "claude-opus", "5.5", "direct"],
    ["claude-opus-5", "claude-opus", "5", "direct"],
    ["claude-opus-4-8", "claude-opus", "4.8", "direct"],
    ["claude-haiku-5-5", "claude-haiku", "5.5", "direct"],
    ["claude-haiku-4-5", "claude-haiku", "4.5", "direct"],
    ["claude-haiku-4-5-20251001", "claude-haiku", "4.5", "direct"],
    // OpenRouter ids and dated canonical slugs.
    ["anthropic/claude-sonnet-5.5", "claude-sonnet", "5.5", "openrouter"],
    ["anthropic/claude-sonnet-5.5-20260928", "claude-sonnet", "5.5", "openrouter"],
    ["anthropic/claude-sonnet-5", "claude-sonnet", "5", "openrouter"],
    ["anthropic/claude-haiku-5.5-20261007", "claude-haiku", "5.5", "openrouter"],
    // The older slug word order.
    ["anthropic/claude-4.8-opus-20260528", "claude-opus", "4.8", "openrouter"],
    ["anthropic/claude-4.5-haiku-20251001", "claude-haiku", "4.5", "openrouter"],
    ["anthropic/claude-4.6-sonnet-20260217", "claude-sonnet", "4.6", "openrouter"],
    // OpenAI.
    ["openai/gpt-6.1-sol", "gpt-sol", "6.1", "openrouter"],
    ["openai/gpt-6.1-sol-20260929", "gpt-sol", "6.1", "openrouter"],
    ["openai/gpt-6-sol", "gpt-sol", "6", "openrouter"],
    ["openai/gpt-5.6-sol", "gpt-sol", "5.6", "openrouter"],
    ["openai/gpt-6-luna", "gpt-luna", "6", "openrouter"],
    ["openai/gpt-5.6-luna-20260709", "gpt-luna", "5.6", "openrouter"],
    // Google.
    ["google/gemini-3.1-pro-preview", "gemini-pro", "3.1", "openrouter"],
    ["google/gemini-3.1-pro-preview-20260219", "gemini-pro", "3.1", "openrouter"],
    ["google/gemini-2.5-pro", "gemini-pro", "2.5", "openrouter"],
    ["google/gemini-3.8-flash", "gemini-flash", "3.8", "openrouter"],
    ["google/gemini-3.5-flash-20260519", "gemini-flash", "3.5", "openrouter"],
    ["google/gemini-3-flash-preview", "gemini-flash", "3", "openrouter"],
  ])("%s is %s %s", (id, track, version, form) => {
    const parsed = parseTrackId(id);
    expect(parsed?.track).toBe(track);
    expect(parsed?.form).toBe(form);
    expect(parsed && (parsed.version.hasMinor ? `${parsed.version.major}.${parsed.version.minor}` : `${parsed.version.major}`)).toBe(version);
  });

  test.each([
    "claude-fable-5-1",
    "anthropic/claude-fable-5.1",
    "claude-mythos-5-1",
    "openai/gpt-6-astra",
    "openai/gpt-6.1-sol-pro",
    "openai/gpt-6-luna-pro-20260922",
    "openai/gpt-5.6-terra",
    "openai/gpt-5.3-codex",
    "openai/gpt-5.5",
    "google/gemini-3.5-flash-lite",
    "google/gemini-3.1-flash-image",
    "google/gemini-3-pro-image",
    "google/gemini-3.1-pro-preview-customtools",
    "google/gemini-4-argon",
    "google/gemini-nano-banana-2.1",
    "anthropic/claude-sonnet-5.5:batch",
    "~anthropic/claude-sonnet-latest",
    "perplexity/sonar-deep-research",
    "xiaomi/mimo-v2.6-pro",
    "voyage-3-large",
  ])("%s is on no track", (id) => {
    expect(parseTrackId(id)).toBeNull();
    expect(trackOf(id)).toBeNull();
  });

  test("the exclusion list covers the top tiers and the variants", () => {
    for (const id of ["openai/gpt-6-astra", "anthropic/claude-fable-5.1", "openai/gpt-6.1-sol-pro", "openai/gpt-5.6-terra", "google/gemini-3.5-flash-lite", "google/gemini-3.1-flash-image", "openai/gpt-5.3-codex", "google/gemini-3.1-pro-preview-customtools", "google/gemini-3.8-flash:batch"]) {
      expect(isExcludedModelId(id)).toBe(true);
    }
    expect(isExcludedModelId("google/gemini-3.1-pro-preview")).toBe(false);
    expect(isExcludedModelId("openai/gpt-6.1-sol")).toBe(false);
  });
});

describe("versions", () => {
  test("major, then minor, then GA over preview", () => {
    const v = (id: string) => parseTrackId(id)!;
    expect(compareVersions(v("claude-sonnet-5-5"), v("claude-sonnet-5"))).toBeGreaterThan(0);
    expect(compareVersions(v("claude-opus-5"), v("claude-opus-4-8"))).toBeGreaterThan(0);
    expect(compareVersions(v("openai/gpt-6-sol"), v("openai/gpt-6.1-sol"))).toBeLessThan(0);
    expect(compareVersions(v("google/gemini-3.1-pro"), v("google/gemini-3.1-pro-preview"))).toBeGreaterThan(0);
    expect(compareVersions(v("google/gemini-3.1-pro-preview"), v("google/gemini-3.1-pro-preview-20260219"))).toBe(0);
    expect(isNewerInTrack("anthropic/claude-opus-6", "claude-opus-5-5")).toBe(true);
    expect(isNewerInTrack("anthropic/claude-opus-5.5", "claude-opus-5-5")).toBe(false);
    expect(isNewerInTrack("anthropic/claude-opus-6", "claude-sonnet-5-5")).toBe(false);
  });

  test("labels come from the track and the version", () => {
    expect(trackLabelFor("claude-opus-5-5")).toBe("Opus 5.5");
    expect(trackLabelFor("claude-sonnet-5-5")).toBe("Sonnet 5.5");
    expect(trackLabelFor("claude-haiku-5-5")).toBe("Haiku 5.5");
    expect(trackLabelFor("openai/gpt-6.1-sol")).toBe("GPT-6.1 Sol");
    expect(trackLabelFor("openai/gpt-6-luna")).toBe("GPT-6 Luna");
    expect(trackLabelFor("google/gemini-3.1-pro-preview")).toBe("Gemini 3.1 Pro");
    expect(trackLabelFor("google/gemini-3.8-flash")).toBe("Gemini 3.8 Flash");
    expect(trackLabel("claude-opus", { major: 6, minor: 0, hasMinor: false })).toBe("Opus 6");
    for (const label of MODEL_TRACK_IDS.map((track) => trackLabelFor(TRACK_SEED_MODEL_IDS[track]))) {
      expect(label).not.toMatch(/[\u2013\u2014]/);
    }
  });

  test("direct and OpenRouter Claude ids convert both ways", () => {
    expect(directAnthropicId("claude-sonnet", parseTrackId("anthropic/claude-sonnet-5.5")!.version)).toBe("claude-sonnet-5-5");
    expect(directAnthropicId("claude-opus", parseTrackId("anthropic/claude-opus-6")!.version)).toBe("claude-opus-6");
    expect(directAnthropicId("gpt-sol", parseTrackId("openai/gpt-6.1-sol")!.version)).toBeNull();
    expect(openRouterIdForDirectClaude("claude-haiku-5-5")).toBe("anthropic/claude-haiku-5.5");
    expect(openRouterIdForDirectClaude("claude-opus-6")).toBe("anthropic/claude-opus-6");
    expect(openRouterIdForDirectClaude("claude-haiku-4-5-20251001")).toBeNull();
    expect(openRouterIdForDirectClaude("claude-fable-5-1")).toBeNull();
    expect(appModelIdForListing("claude-sonnet", "anthropic/claude-sonnet-5.5")).toBe("claude-sonnet-5-5");
    expect(appModelIdForListing("gpt-sol", "openai/gpt-6.1-sol")).toBe("openai/gpt-6.1-sol");
    expect(appModelIdForListing("gpt-sol", "openai/gpt-6-luna")).toBeNull();
  });
});

describe("newestInTrack on OpenRouter's 2026-10-22 list", () => {
  test("each track's newest is the version the owner named", () => {
    const newest = Object.fromEntries(MODEL_TRACK_IDS.map((track) => [track, newestInTrack(track, liveIds)]));
    expect(newest).toEqual({
      "claude-opus": "anthropic/claude-opus-5.5",
      "claude-sonnet": "anthropic/claude-sonnet-5.5",
      "claude-haiku": "anthropic/claude-haiku-5.5",
      "gpt-sol": "openai/gpt-6.1-sol",
      "gpt-luna": "openai/gpt-6-luna",
      "gemini-pro": "google/gemini-3.1-pro-preview",
      "gemini-flash": "google/gemini-3.8-flash",
    });
    for (const track of MODEL_TRACK_IDS) {
      expect(appModelIdForListing(track, newest[track]!)).toBe(TRACK_SEED_MODEL_IDS[track]);
    }
  });

  test("Gemini 4 Argon is listed but on no track", () => {
    expect(liveIds).toContain("google/gemini-4-argon");
    expect(trackOf("google/gemini-4-argon")).toBeNull();
  });

  test("a GA id beats its preview at the same version, and dated slugs are ignored", () => {
    expect(newestInTrack("gemini-pro", ["google/gemini-3.1-pro-preview", "google/gemini-3.1-pro", "google/gemini-2.5-pro"])).toBe("google/gemini-3.1-pro");
    expect(newestInTrack("claude-opus", ["anthropic/claude-opus-6-20270101", "anthropic/claude-opus-5.5"])).toBe("anthropic/claude-opus-5.5");
    expect(newestInTrack("claude-opus", ["claude-opus-6"])).toBeNull();
  });
});

describe("every model id the app has used maps to its track", () => {
  const used = new Set<string>([
    ...CANDIDATE_MODELS.map((model) => model.id),
    ...Object.keys(MODEL_PRICING),
    ...Object.keys(OPENROUTER_ANTHROPIC_REQUEST_IDS),
    ...Object.values(OPENROUTER_ANTHROPIC_REQUEST_IDS),
    ...Object.keys(SEED_CANONICAL_SLUGS),
    ...Object.values(SEED_CANONICAL_SLUGS),
    ...Object.keys(RETIRED_SEED_LABELS),
    // Models the evaluation switches moved roles to (2026-10-03 onward).
    "openai/gpt-6.1-sol",
    "openai/gpt-6-sol",
    "anthropic/claude-sonnet-5.5",
  ]);
  // The top tiers, research and embedding models are deliberately on no track.
  const untracked = new Set([
    "claude-fable-5-1",
    "anthropic/claude-fable-5.1",
    "voyage-3-large",
    "rerank-2.5",
    "perplexity/sonar-deep-research",
  ]);
  test.each([...used].filter((id) => !untracked.has(id)))("%s has a track", (id) => {
    expect(trackOf(id)).not.toBeNull();
  });
});
