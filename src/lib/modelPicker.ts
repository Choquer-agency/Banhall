/**
 * Picker data from the model catalog. `providerReadiness.getCapabilities`
 * returns the models a writer may pick today (each tier's newest version,
 * 2026-10-22 decision) and the writing role's current default; these
 * helpers fall back to the seven 2026-10-22 models only while that query is
 * loading.
 */
import {
  RETIRED_SEED_LABELS,
  PICKER_SEED_MODELS,
  MODEL,
  modelById,
  modelLabelOf,
  singleModelItems,
} from "../../shared/generationModels";

export type PickerModel = {
  id: string;
  label: string;
  provider: string;
  gateway: "anthropic" | "openrouter";
  description: string;
  available: boolean;
};

export type PickerCapabilities =
  | {
      models?: PickerModel[];
      defaultModel?: string;
      defaultModelLabel?: string;
    }
  | null
  | undefined;

const SEED_MODELS: PickerModel[] = PICKER_SEED_MODELS.map((model) => ({
  id: model.id,
  label: model.label,
  provider: model.provider,
  gateway: model.gateway,
  description: model.description,
  available: true,
}));

export function pickerModels(capabilities: PickerCapabilities): PickerModel[] {
  return capabilities?.models ?? SEED_MODELS;
}

export function defaultModelIdFor(capabilities: PickerCapabilities): string {
  return capabilities?.defaultModel ?? MODEL;
}

/**
 * A model's display label: catalog list, then the seed, then a label built
 * from its tier and version (a newer track model), then the id.
 */
export function modelLabelFor(id: string, capabilities: PickerCapabilities): string {
  return (
    pickerModels(capabilities).find((model) => model.id === id)?.label ??
    modelById(id)?.label ??
    RETIRED_SEED_LABELS[id] ??
    modelLabelOf(id)
  );
}

/** "Default (<current default>)" plus every selectable model. */
export function singleModelItemsFor(capabilities: PickerCapabilities) {
  const models = pickerModels(capabilities);
  const defaultId = defaultModelIdFor(capabilities);
  const withDefault = models.some((model) => model.id === defaultId)
    ? models
    : [
        ...models,
        {
          id: defaultId,
          label: capabilities?.defaultModelLabel ?? modelLabelFor(defaultId, capabilities),
        },
      ];
  const [first, ...rest] = singleModelItems(withDefault, defaultId);
  return [first, ...rest.filter((item) => models.some((model) => model.id === item.value))];
}
