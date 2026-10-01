import type { TestConvex } from "convex-test";
import type { MutationCtx } from "./_generated/server";
import type schema from "./schema";
import { AI_RATE_LIMITS, aiRateLimiter } from "./lib/aiRateLimits";

// Test helpers for the audit wave 2 limits: spend a whole hourly bucket, as
// that many earlier clicks would, or read what is left of one.

type HourlyLimit = keyof typeof AI_RATE_LIMITS;
type T = TestConvex<typeof schema>;

export async function spendAll(t: T, name: HourlyLimit, key: string) {
  await t.run(async (ctx) => {
    const limitCtx = ctx as unknown as MutationCtx;
    await aiRateLimiter.reset(limitCtx, name, { key });
    const spent = await aiRateLimiter.limit(limitCtx, name, { key, count: AI_RATE_LIMITS[name].rate });
    if (!spent.ok) throw new Error(`Could not spend ${name} for ${key}`);
  });
}

export async function refill(t: T, name: HourlyLimit, key: string) {
  await t.run(async (ctx) => {
    await aiRateLimiter.reset(ctx as unknown as MutationCtx, name, { key });
  });
}

export async function remaining(t: T, name: HourlyLimit, key: string) {
  return await t.run(async (ctx) =>
    (await aiRateLimiter.getValue(ctx as unknown as MutationCtx, name, { key })).value);
}
