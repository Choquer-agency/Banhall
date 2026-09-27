import { HOUR, RateLimiter, type RateLimitConfig } from "@convex-dev/rate-limiter";
import type { ComponentApi } from "@convex-dev/rate-limiter/_generated/component.js";
import { components } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx, MutationCtx } from "../_generated/server";
import { firmDateParts, firmDateStartAfterDays, firmDateStartUtc, firmDayNumber } from "../../shared/firmTime";
import { domainError } from "./contracts";

// ─── Per-user limits on paid AI actions (audit wave 2) ──────────────────────
// docs/product-domain.md, 2026-09-27 amendment. Token buckets per signed-in
// user (and per project for generation starts) in the rate limiter
// component. Only the public entry points a person clicks spend tokens:
// the scheduler, crons and the server's first Seed batch never call this.
// Admins are counted like everyone else.

/**
 * `components.rateLimiter` joins convex/_generated/api.d.ts on the next
 * codegen (it runs on deploy); until then the component's own API type
 * stands in. At runtime `components` resolves any registered name.
 */
const rateLimiterComponent = (
  components as typeof components & { rateLimiter: ComponentApi<"rateLimiter"> }
).rateLimiter;

/** Hourly buckets: `rate` tokens an hour, never more than `rate` saved up. */
export const AI_RATE_LIMITS = {
  generationPerUser: { kind: "token bucket", rate: 12, period: HOUR },
  generationPerProject: { kind: "token bucket", rate: 6, period: HOUR },
  seedPerUser: { kind: "token bucket", rate: 90, period: HOUR },
  qaPerUser: { kind: "token bucket", rate: 20, period: HOUR },
  pdReviewPerUser: { kind: "token bucket", rate: 20, period: HOUR },
  researchPerUser: { kind: "token bucket", rate: 20, period: HOUR },
  scienceCodePerUser: { kind: "token bucket", rate: 30, period: HOUR },
  styleAnalysisPerUser: { kind: "token bucket", rate: 20, period: HOUR },
} as const satisfies Record<string, RateLimitConfig>;

/** Generation starts one user may make in one firm day (America/Vancouver). */
export const GENERATION_PER_USER_FIRM_DAY = 40;

const GENERATION_DAY_BUCKET = "generationPerUserFirmDay";

/** The hourly buckets; exported so tests can spend or read them directly. */
export const aiRateLimiter = new RateLimiter(rateLimiterComponent, AI_RATE_LIMITS);

type LimitCtx = Pick<MutationCtx, "runQuery" | "runMutation"> | Pick<ActionCtx, "runQuery" | "runMutation">;
type HourlyLimit = keyof typeof AI_RATE_LIMITS;
/** Whose count refused: the caller's hour, the caller's firm day, or the project's hour. */
export type RateLimitScope = "user" | "firmDay" | "project";
type Bucket =
  | { kind: "hour"; name: HourlyLimit; key: string; scope: "user" | "project" }
  | { kind: "firmDay"; key: string; now: number; scope: "firmDay" };

/**
 * One firm day, keyed by its day number so the count starts again at firm
 * midnight. The window is 25 hours from that midnight so it never rolls over
 * inside the day, even on the day the clocks go back.
 */
function firmDayConfig(now: number): RateLimitConfig {
  return {
    kind: "fixed window",
    rate: GENERATION_PER_USER_FIRM_DAY,
    period: 25 * HOUR,
    start: firmDateStartUtc(firmDateParts(now)),
  };
}

async function checkBucket(ctx: LimitCtx, bucket: Bucket) {
  if (bucket.kind === "hour") return await aiRateLimiter.check(ctx, bucket.name, { key: bucket.key });
  const status = await aiRateLimiter.check(ctx, GENERATION_DAY_BUCKET, {
    key: `${bucket.key}:${firmDayNumber(bucket.now)}`,
    config: firmDayConfig(bucket.now),
  });
  // A spent day comes back at the next firm midnight, whatever the window says.
  return status.ok ? status : { ok: false as const, retryAfter: firmDateStartAfterDays(bucket.now, 1) - bucket.now };
}

async function spendBucket(ctx: LimitCtx, bucket: Bucket) {
  if (bucket.kind === "hour") return await aiRateLimiter.limit(ctx, bucket.name, { key: bucket.key });
  return await aiRateLimiter.limit(ctx, GENERATION_DAY_BUCKET, {
    key: `${bucket.key}:${firmDayNumber(bucket.now)}`,
    config: firmDayConfig(bucket.now),
  });
}

/** The plain refusal, naming whose count is spent: "Try again in 5 minutes." / "tomorrow". */
export function rateLimitedMessage(retryAfterSeconds: number, scope: RateLimitScope): string {
  if (scope === "firmDay") return "You have started a lot of runs today. Try again tomorrow.";
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  const wait = `Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
  return scope === "project"
    ? `This project has started a lot of runs in the last hour. ${wait}`
    : `You have started a lot of runs in the last hour. ${wait}`;
}

/**
 * Spends one token from every bucket, or none: all are checked first, and a
 * refusal names the bucket with the longest wait. Throws RATE_LIMITED with
 * `retryAfter` in whole seconds and `scope` (whose count is spent). In a
 * mutation a later refusal also rolls back earlier spends.
 */
async function enforce(ctx: LimitCtx, buckets: Bucket[]): Promise<void> {
  let refusal: { retryAfterMs: number; scope: RateLimitScope } | null = null;
  for (const bucket of buckets) {
    const status = await checkBucket(ctx, bucket);
    if (status.ok) continue;
    const retryAfterMs = status.retryAfter ?? HOUR;
    if (!refusal || retryAfterMs > refusal.retryAfterMs) {
      refusal = { retryAfterMs, scope: bucket.scope };
    }
  }
  if (!refusal) {
    for (const bucket of buckets) {
      const status = await spendBucket(ctx, bucket);
      if (!status.ok) {
        refusal = { retryAfterMs: status.retryAfter, scope: bucket.scope };
        break;
      }
    }
  }
  if (!refusal) return;
  const retryAfter = Math.max(1, Math.ceil(refusal.retryAfterMs / 1000));
  domainError("RATE_LIMITED", rateLimitedMessage(retryAfter, refusal.scope), {
    retryAfter,
    scope: refusal.scope,
  });
}

/**
 * Starting a generation, a retry, a redraft or a section regenerate:
 * 12 an hour and 40 a firm day per user, 6 an hour per project.
 */
export async function limitGenerationStart(
  ctx: LimitCtx,
  userId: Id<"users">,
  projectId: Id<"projects">
): Promise<void> {
  await enforce(ctx, [
    { kind: "hour", name: "generationPerUser", key: userId, scope: "user" },
    { kind: "firmDay", key: userId, now: Date.now(), scope: "firmDay" },
    { kind: "hour", name: "generationPerProject", key: projectId, scope: "project" },
  ]);
}

/** One per-user hourly bucket (Seeds, QA, PD reviews, research, science codes, style analysis). */
export async function limitUserAction(
  ctx: LimitCtx,
  name: Exclude<HourlyLimit, "generationPerUser" | "generationPerProject">,
  userId: Id<"users">
): Promise<void> {
  await enforce(ctx, [{ kind: "hour", name, key: userId, scope: "user" }]);
}
