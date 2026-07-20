import { env } from "../_generated/server";
import { domainError } from "./contracts";

export type AnthropicCapability =
  | "generation"
  | "review"
  | "chat"
  | "financial";

export function anthropicConfiguration() {
  const configured = Boolean(env.ANTHROPIC_API_KEY?.trim());
  return {
    state: configured ? ("configured" as const) : ("unconfigured" as const),
    message: configured
      ? "Configured; billing, quota, network access, and model entitlement are verified only by a live request."
      : "Anthropic is not configured for this deployment.",
  };
}

export function brainConfiguration() {
  const configured = Boolean(env.VOYAGE_API_KEY?.trim());
  return {
    state: configured ? ("configured" as const) : ("unconfigured" as const),
    message: configured
      ? "Configured; model access and corpus compatibility are verified only by live retrieval."
      : "Voyage is not configured; Brain retrieval and ingestion are unavailable.",
  };
}

// OpenRouter carries the non-Anthropic generation models (OpenAI, Google).
// Anthropic models never route through it — see shared/generationModels.ts.
export function openRouterConfiguration() {
  const configured = Boolean(env.OPENROUTER_API_KEY?.trim());
  return {
    state: configured ? ("configured" as const) : ("unconfigured" as const),
    message: configured
      ? "Configured; credits and model availability are verified only by a live request."
      : "OpenRouter is not configured; OpenAI and Google models are unavailable.",
  };
}

export function requireOpenRouterConfigured(): string {
  const key = env.OPENROUTER_API_KEY?.trim();
  if (!key) {
    domainError(
      "PROVIDER_NOT_CONFIGURED",
      "OpenRouter is not configured — OpenAI and Google models need OPENROUTER_API_KEY"
    );
  }
  return key;
}

export function requireAnthropicConfigured(
  capability: AnthropicCapability
): string {
  const key = env.ANTHROPIC_API_KEY?.trim();
  if (!key) {
    domainError(
      "PROVIDER_NOT_CONFIGURED",
      `Anthropic is not configured for ${capability}`
    );
  }
  return key;
}

export function requireBrainConfigured(): string {
  const key = env.VOYAGE_API_KEY?.trim();
  if (!key) {
    domainError(
      "PROVIDER_NOT_CONFIGURED",
      "Voyage is not configured for Brain ingestion or retrieval"
    );
  }
  return key;
}
