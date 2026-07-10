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
