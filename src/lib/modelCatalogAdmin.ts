/**
 * Types and formatting for the admin model catalog panel
 * (src/lib/components/admin/ModelCatalogPanel.svelte).
 */
import type { FunctionReturnType } from "convex/server";
import type { adminStateRef } from "../../convex/lib/modelCatalogRefs";

export type ModelAdminState = NonNullable<FunctionReturnType<typeof adminStateRef>>;
export type ModelAdminRole = ModelAdminState["roles"][number];
export type ModelAdminEvaluation = ModelAdminState["evaluations"][number];
export type ModelAdminCatalogRow = ModelAdminState["catalog"][number];

export type CostCapInput = {
  maxInputUsdPerMTok: number;
  maxOutputUsdPerMTok: number;
  maxCostRatio: number;
};

export function formatUsdPerMTok(value: number | null): string {
  if (value === null) return "n/a";
  return value >= 1 ? `$${value.toFixed(2)}` : `$${value.toFixed(3)}`;
}

export function formatTokens(value: number | null): string {
  if (value === null) return "n/a";
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}

export function formatUsd(value: number | null): string {
  if (value === null) return "n/a";
  return value < 1 ? `$${value.toFixed(3)}` : `$${value.toFixed(2)}`;
}

export function formatDate(at: number | null): string {
  if (at === null) return "never";
  return new Date(at).toLocaleDateString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const REASONS: Record<string, string> = {
  evaluation_passed: "passed every evaluation gate",
  production_error_rate: "too many failed calls",
  admin_rollback: "rolled back by an admin",
  admin_choice: "chosen by an admin",
};

export function switchReason(reason: string): string {
  return REASONS[reason] ?? reason.replace(/_/g, " ");
}

const STATUS_LABELS: Record<string, string> = {
  queued: "Queued",
  running: "Running",
  passed: "Passed",
  failed: "Held back",
  incomplete: "Incomplete",
  error: "Stopped",
  candidate: "Candidate",
  enabled: "Enabled",
  retired: "Retired",
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}
