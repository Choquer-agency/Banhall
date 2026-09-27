/**
 * Direct Anthropic first, OpenRouter when the direct account cannot be
 * billed (owner decision 64, 2026-09-26).
 *
 * Direct stays the default transport. When a direct call is refused for
 * billing (the credit ran out, or a payment failed), the same request goes
 * through the Anthropic-pinned OpenRouter transport (shared/
 * anthropicTransport.ts) inside the same attempt. A deployment-wide latch
 * then sends later calls straight to OpenRouter. After
 * CREDIT_LATCH_COOLDOWN_MS one call (the probe) tries direct again: a
 * success clears the latch; a failure of any kind sends that same call
 * through OpenRouter and restarts the cool-down (lead decision, 2026-09-26).
 * A model with no OpenRouter id never takes part: its calls go direct and
 * fail as before.
 *
 * Pure: no Convex runtime imports.
 */

/** How long a latch holds before one call tries direct again. */
export const CREDIT_LATCH_COOLDOWN_MS = 15 * 60_000;

/**
 * How long one probe claim blocks the next. A probe that never reports
 * back (its action died) stops blocking after one Convex action limit.
 */
export const CREDIT_PROBE_CLAIM_MS = 10 * 60_000;

/** The Alerts board source for the notice (convex/errorReports.ts). */
export const ANTHROPIC_CREDIT_NOTICE_SOURCE = "anthropic-credit";

/** Raised once per latch (lead decision, 2026-09-26: covers both billing causes). */
export const ANTHROPIC_CREDIT_NOTICE =
  "Anthropic refused calls for billing (credit ran out or a payment failed). " +
  "Banhall is using OpenRouter until it is fixed. " +
  "It tries Anthropic again every 15 minutes and switches back by itself once a call works.";

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

/**
 * Whether a direct Anthropic answer refuses the call for billing, from its
 * HTTP status and parsed JSON body. Anthropic's error shape is
 * `{type: "error", error: {type, message}, request_id}`
 * (https://platform.claude.com/docs/en/api/errors, "Error shapes").
 *
 * Refused for billing:
 * - Any 402 `billing_error`: "There's an issue with your billing or payment
 *   information" (https://platform.claude.com/docs/en/api/errors, "HTTP
 *   errors"). That covers a declined card as well as an empty balance
 *   (lead decision, 2026-09-26). A 402 without a readable body counts too:
 *   on the direct API 402 is only ever this.
 * - The older answer for an empty prepaid balance: 400
 *   `invalid_request_error` whose message says "Your credit balance is too
 *   low to access the Anthropic API". The current docs no longer print this
 *   message; normalizeProviderError has matched "credit balance" since
 *   before this change, and it is matched here the same way.
 *
 * Never a billing refusal, so never a fallback: 429 `rate_limit_error` (a rate
 * limit, and also the tier spend cap, `error.details.error_code`
 * `enforced_spend_limit_reached`, which is a limit, not a balance:
 * https://platform.claude.com/docs/en/api/rate-limits, "Reaching your
 * spend cap"), 529 `overloaded_error`, 401 `authentication_error`, 403
 * `permission_error`, and every other 400, including a spend limit the
 * organization set itself ("You have reached your specified API usage
 * limits", same page, "Setting your own spend limit"): that limit is the
 * owner's own cap, which a fallback would get around.
 */
export function isAnthropicCreditAnswer(status: number | undefined, body: unknown, fallbackMessage = ""): boolean {
  const envelope = record(body);
  const inner = record(envelope?.error) ?? envelope;
  const type = typeof inner?.type === "string" ? inner.type : undefined;
  const message = typeof inner?.message === "string" ? inner.message : fallbackMessage;
  if (status === 402) return type === undefined || type === "error" || type === "billing_error";
  if (status === 400) {
    return (type === undefined || type === "invalid_request_error") && /credit balance is too low/i.test(message);
  }
  return false;
}

/**
 * The same check on an error the Anthropic SDK threw: its `status`, the
 * parsed body it keeps as `error`, and its message.
 */
export function isAnthropicCreditError(error: unknown): boolean {
  const value = record(error);
  if (!value) return false;
  const status = typeof value.status === "number" ? value.status : undefined;
  if (status === undefined) return false;
  return isAnthropicCreditAnswer(status, value.error, typeof value.message === "string" ? value.message : "");
}

/** The latch as stored (convex/providerCredit.ts). */
export type CreditLatchState = {
  latchedAt: number;
  probeStartedAt?: number;
};

/**
 * Where the next direct-default call goes:
 * - `direct`: no latch.
 * - `openrouter`: latched and still cooling down, or another call is
 *   already probing.
 * - `probe`: the cool-down is over and nobody is probing; the caller must
 *   claim the probe (a mutation) before trying direct.
 */
export function creditRoute(state: CreditLatchState | null, now: number): "direct" | "openrouter" | "probe" {
  if (!state) return "direct";
  if (now < state.latchedAt + CREDIT_LATCH_COOLDOWN_MS) return "openrouter";
  if (state.probeStartedAt !== undefined && now < state.probeStartedAt + CREDIT_PROBE_CLAIM_MS) return "openrouter";
  return "probe";
}
