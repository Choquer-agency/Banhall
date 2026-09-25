import { env } from "../_generated/server";
import { domainError } from "./contracts";
import {
  parseAnthropicTransport,
  type AnthropicTransport,
} from "../../shared/anthropicTransport";

export type AnthropicCapability =
  | "generation"
  | "review"
  | "chat"
  | "financial";

/**
 * The transport switch (owner decision 30, 2026-09-25), declared in
 * convex.config.ts. Read through this widened view so the code compiles
 * both before and after `convex codegen` adds the names to the generated
 * Env type; at runtime `env` is `process.env` either way.
 */
const transportEnv = env as typeof env & {
  readonly ANTHROPIC_TRANSPORT?: string;
  readonly OPENROUTER_ANTHROPIC_API_KEY?: string;
};

const TRANSPORT_VALUES_MESSAGE =
  'ANTHROPIC_TRANSPORT must be "direct" or "openrouter" (unset means "direct")';

/**
 * Where Anthropic-gateway requests go: `direct` (api.anthropic.com, the
 * default and the rollback) or `openrouter` (OpenRouter's Messages endpoint
 * pinned to Anthropic). Read at each client build, so a changed value
 * applies to the next provider call. An unknown value is a configuration
 * error, never a guess.
 */
export function anthropicTransport(): AnthropicTransport {
  const transport = parseAnthropicTransport(transportEnv.ANTHROPIC_TRANSPORT);
  if (!transport) domainError("PROVIDER_NOT_CONFIGURED", TRANSPORT_VALUES_MESSAGE);
  return transport;
}

/** Whether the transport is (or defaults to) direct; false on a bad value. */
export function anthropicTransportIsDirect(): boolean {
  return parseAnthropicTransport(transportEnv.ANTHROPIC_TRANSPORT) === "direct";
}

/**
 * The OpenRouter key Anthropic-gateway requests use: a dedicated key when
 * one is set (so its guardrail can allow the Anthropic provider only),
 * otherwise the shared OPENROUTER_API_KEY.
 */
function openRouterAnthropicKey(): string | undefined {
  return transportEnv.OPENROUTER_ANTHROPIC_API_KEY?.trim() || env.OPENROUTER_API_KEY?.trim() || undefined;
}

/**
 * Readiness for one Anthropic capability, following the transport. The
 * report chat assistant always streams straight to Anthropic, so it needs
 * ANTHROPIC_API_KEY on either transport, and under `openrouter` its helper
 * calls also need the OpenRouter key.
 */
export function anthropicConfiguration(capability: AnthropicCapability = "generation") {
  const transport = parseAnthropicTransport(transportEnv.ANTHROPIC_TRANSPORT);
  if (!transport) {
    return { state: "unconfigured" as const, message: `${TRANSPORT_VALUES_MESSAGE}.` };
  }
  const directKey = Boolean(env.ANTHROPIC_API_KEY?.trim());
  const openRouterKey = Boolean(openRouterAnthropicKey());
  const configured =
    transport === "direct"
      ? directKey
      : openRouterKey && (capability !== "chat" || directKey);
  if (transport === "direct") {
    return {
      state: configured ? ("configured" as const) : ("unconfigured" as const),
      message: configured
        ? "Configured; billing, quota, network access, and model entitlement are verified only by a live request."
        : "Anthropic is not configured for this deployment.",
    };
  }
  return {
    state: configured ? ("configured" as const) : ("unconfigured" as const),
    message: configured
      ? "Configured through OpenRouter, pinned to Anthropic; credits and model access are verified only by a live request."
      : !openRouterKey
        ? "Anthropic models run through OpenRouter on this deployment, but neither OPENROUTER_ANTHROPIC_API_KEY nor OPENROUTER_API_KEY is set."
        : "The report chat assistant still calls Anthropic directly and needs ANTHROPIC_API_KEY.",
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
// provider-diverse Contextual Research pipeline. Anthropic-gateway models use
// ANTHROPIC_API_KEY, or OpenRouter when ANTHROPIC_TRANSPORT is "openrouter"
// (requireAnthropicClientConfig below; shared/anthropicTransport.ts).
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

/** The credential and endpoint an Anthropic SDK client is built with. */
export type AnthropicClientConfig =
  | { transport: "direct"; apiKey: string }
  | { transport: "openrouter"; authToken: string };

/**
 * The client configuration for an Anthropic-gateway request on the current
 * transport. Throws PROVIDER_NOT_CONFIGURED when the transport's key is
 * missing or the transport value is unknown.
 */
export function requireAnthropicClientConfig(
  capability: AnthropicCapability
): AnthropicClientConfig {
  if (anthropicTransport() === "openrouter") {
    const authToken = openRouterAnthropicKey();
    if (!authToken) {
      domainError(
        "PROVIDER_NOT_CONFIGURED",
        `Anthropic models run through OpenRouter on this deployment, but OpenRouter is not configured for ${capability} (set OPENROUTER_ANTHROPIC_API_KEY or OPENROUTER_API_KEY)`
      );
    }
    return { transport: "openrouter", authToken };
  }
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    domainError(
      "PROVIDER_NOT_CONFIGURED",
      `Anthropic is not configured for ${capability}`
    );
  }
  return { transport: "direct", apiKey };
}

/**
 * The precheck before work that calls Anthropic models: the current
 * transport's key must be set. The report chat assistant streams straight
 * to Anthropic on either transport (decision 30 moves it later), so `chat`
 * always needs ANTHROPIC_API_KEY as well.
 */
export function requireAnthropicConfigured(
  capability: AnthropicCapability
): string {
  const config = requireAnthropicClientConfig(capability);
  if (capability === "chat" && config.transport === "openrouter") {
    const key = env.ANTHROPIC_API_KEY?.trim();
    if (!key) {
      domainError(
        "PROVIDER_NOT_CONFIGURED",
        "Anthropic is not configured for chat (the report chat assistant calls Anthropic directly)"
      );
    }
    return key;
  }
  return config.transport === "direct" ? config.apiKey : config.authToken;
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
