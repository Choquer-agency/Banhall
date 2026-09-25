import { describe, expect, it } from "vitest";
import { modelLabelFor, pickerModels, singleModelItemsFor, type PickerModel } from "./modelPicker";

const grok: PickerModel = {
  id: "x-ai/grok-4.7",
  label: "Grok 4.7",
  provider: "xAI",
  gateway: "openrouter",
  description: "",
  available: true,
};
const sonnet: PickerModel = {
  id: "claude-sonnet-5",
  label: "Sonnet 5",
  provider: "Anthropic",
  gateway: "anthropic",
  description: "",
  available: true,
};

describe("single-model picker items", () => {
  it("labels Default with the writing role's current model, not the registry's first entry", () => {
    const items = singleModelItemsFor({ models: [sonnet, grok], defaultModel: grok.id, defaultModelLabel: "Grok 4.7" });
    expect(items[0]).toEqual({ value: "", label: "Default (Grok 4.7)" });
    expect(items.slice(1).map((item) => item.value)).toEqual([sonnet.id, grok.id]);
  });

  it("names a default that is not itself selectable without listing it", () => {
    const items = singleModelItemsFor({ models: [sonnet], defaultModel: grok.id, defaultModelLabel: "Grok 4.7" });
    expect(items).toEqual([
      { value: "", label: "Default (Grok 4.7)" },
      { value: sonnet.id, label: "Sonnet 5" },
    ]);
  });

  it("falls back to the seed list only while capabilities load", () => {
    expect(pickerModels(undefined).map((model) => model.id)).toContain("claude-sonnet-5");
    expect(singleModelItemsFor(undefined)[0]).toEqual({ value: "", label: "Default (Sonnet 5)" });
    expect(modelLabelFor("x-ai/grok-4.7", { models: [grok] })).toBe("Grok 4.7");
    expect(modelLabelFor("unknown/model", undefined)).toBe("unknown/model");
  });

  it("lists Opus 5.5, GPT-6 Sol and GPT-6 Luna in the seed fallback, and not Fable 5.1", () => {
    const seed = pickerModels(undefined);
    const byId = (id: string) => seed.find((model) => model.id === id);
    expect(byId("claude-opus-5-5")).toMatchObject({ label: "Opus 5.5", provider: "Anthropic", gateway: "anthropic" });
    expect(byId("claude-fable-5-1")).toBeUndefined();
    expect(byId("openai/gpt-6-sol")).toMatchObject({ label: "GPT-6 Sol", provider: "OpenAI", gateway: "openrouter" });
    expect(byId("openai/gpt-6-luna")).toMatchObject({ label: "GPT-6 Luna", provider: "OpenAI", gateway: "openrouter" });
    const items = singleModelItemsFor(undefined).map((item) => item.value);
    expect(items).toEqual(expect.arrayContaining(["claude-opus-5-5", "openai/gpt-6-sol", "openai/gpt-6-luna"]));
    expect(items).not.toContain("claude-fable-5-1");
    // The OpenRouter listings of the direct Anthropic models are not seeds.
    expect(byId("anthropic/claude-opus-5.5")).toBeUndefined();
    expect(byId("anthropic/claude-fable-5.1")).toBeUndefined();
  });
});
