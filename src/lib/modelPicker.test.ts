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
});
