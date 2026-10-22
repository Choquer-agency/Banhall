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

  it("falls back to the seven 2026-10-22 tier models only while capabilities load", () => {
    expect(pickerModels(undefined).map((model) => model.id)).toEqual([
      "claude-opus-5-5",
      "claude-sonnet-5-5",
      "claude-haiku-5-5",
      "openai/gpt-6.1-sol",
      "openai/gpt-6-luna",
      "google/gemini-3.1-pro-preview",
      "google/gemini-3.8-flash",
    ]);
    expect(pickerModels(undefined).map((model) => model.label)).toEqual([
      "Opus 5.5",
      "Sonnet 5.5",
      "Haiku 5.5",
      "GPT-6.1 Sol",
      "GPT-6 Luna",
      "Gemini 3.1 Pro",
      "Gemini 3.8 Flash",
    ]);
    for (const model of pickerModels(undefined)) expect(model.description, model.id).not.toMatch(/[\u2013\u2014]/);
    expect(singleModelItemsFor(undefined)[0]).toEqual({ value: "", label: "Default (Sonnet 5.5)" });
    expect(modelLabelFor("x-ai/grok-4.7", { models: [grok] })).toBe("Grok 4.7");
    expect(modelLabelFor("unknown/model", undefined)).toBe("unknown/model");
  });

  it("never lists a superseded model or Fable 5.1, but still names them for older generations", () => {
    const items = singleModelItemsFor(undefined).map((item) => item.value);
    for (const id of [
      "claude-sonnet-5",
      "claude-opus-4-8",
      "claude-haiku-4-5-20251001",
      "openai/gpt-6-sol",
      "openai/gpt-5.6-sol",
      "openai/gpt-5.6-luna",
      "google/gemini-3.5-flash",
      "claude-fable-5-1",
    ]) {
      expect(items, id).not.toContain(id);
    }
    expect(modelLabelFor("claude-fable-5-1", undefined)).toBe("Fable 5.1");
    expect(modelLabelFor("claude-sonnet-5", undefined)).toBe("Sonnet 5");
    expect(modelLabelFor("openai/gpt-6-sol", undefined)).toBe("GPT-6 Sol");
    // A tier version the daily job moves to later is named from its id.
    expect(modelLabelFor("claude-opus-6", undefined)).toBe("Opus 6");
    // The OpenRouter listings of the direct Anthropic models are not seeds.
    expect(pickerModels(undefined).find((model) => model.id === "anthropic/claude-opus-5.5")).toBeUndefined();
  });
});
