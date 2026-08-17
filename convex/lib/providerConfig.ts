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

// OpenRouter carries the non-Anthropic report-generation models and the
// provider-diverse Contextual Research pipeline. Direct report-generation
// Anthropic models still use ANTHROPIC_API_KEY — see shared/generationModels.ts.
export function openRouterConfiguration() {
  const configured = Boolean(env.OPENROUTER_API_KEY?.trim());
  return {
    state: configured ? ("configured" as const) : ("unconfigured" as const),
    message: configured
      ? "Configured; credits and model availability are verified only by a live request."
      : "OpenRouter is not configured; OpenRouter-backed models are unavailable.",
  };
}

export function requireOpenRouterConfigured(): string {
  const key = env.OPENROUTER_API_KEY?.trim();
  if (!key) {
    domainError(
      "PROVIDER_NOT_CONFIGURED",
      "OpenRouter is not configured — OpenRouter-backed models need OPENROUTER_API_KEY"
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

// Microsoft Graph app-only access to the client's OneDrive corpus (BNH-17).
export type GraphConfig = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  driveId: string;
  rootPath: string;
};

export function graphConfiguration() {
  const configured = Boolean(
    env.MS_TENANT_ID?.trim() &&
      env.MS_CLIENT_ID?.trim() &&
      env.MS_CLIENT_SECRET?.trim() &&
      env.MS_DRIVE_ID?.trim()
  );
  return {
    state: configured ? ("configured" as const) : ("unconfigured" as const),
    message: configured
      ? "Configured; drive access and consent are verified only by a live sync."
      : "Microsoft Graph is not configured; OneDrive sync is unavailable (needs MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_DRIVE_ID).",
  };
}

export function requireGraphConfigured(): GraphConfig {
  const tenantId = env.MS_TENANT_ID?.trim();
  const clientId = env.MS_CLIENT_ID?.trim();
  const clientSecret = env.MS_CLIENT_SECRET?.trim();
  const driveId = env.MS_DRIVE_ID?.trim();
  if (!tenantId || !clientId || !clientSecret || !driveId) {
    domainError(
      "PROVIDER_NOT_CONFIGURED",
      "Microsoft Graph is not configured — OneDrive sync needs MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, and MS_DRIVE_ID"
    );
  }
  return {
    tenantId,
    clientId,
    clientSecret,
    driveId,
    rootPath: env.MS_ROOT_PATH?.trim() || "Applications",
  };
}
