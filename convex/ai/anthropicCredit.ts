/**
 * The direct Anthropic credit fallback at call time (owner decision 64,
 * 2026-09-26). The policy, the error shapes and their doc sources are in
 * shared/anthropicCreditFallback.ts; the latch is convex/providerCredit.ts.
 *
 * Two call paths use it:
 * - instrumentedAnthropic (convex/ai/instrument.ts): every generation,
 *   helper, evaluation and streamed Brief call, through the Anthropic SDK.
 * - the report chat assistant (convex/ai/chatAgentV2.ts), through the AI
 *   SDK, with `creditFallbackFetch` below as its HTTP transport.
 *
 * Every latch read or write here is best effort: a failure is logged and
 * the call goes on as it would without the latch (direct first), so the
 * latch can never fail a provider call.
 */
import {
  makeFunctionReference,
  type FunctionReference,
  type RegisteredMutation,
  type RegisteredQuery,
} from "convex/server";
import type { ActionCtx } from "../_generated/server";
import type * as providerCredit from "../providerCredit";
import { isAnthropicCreditAnswer, creditRoute } from "../../shared/anthropicCreditFallback";
import {
  OPENROUTER_ANTHROPIC_BASE_URL,
  OPENROUTER_APP_HEADERS,
  openRouterAnthropicBody,
} from "../../shared/anthropicTransport";
import { TRANSPORT_CONFIGURATION } from "../lib/providerConfig";
import { domainError } from "../lib/contracts";

// `convex/_generated/api.d.ts` lists convex/providerCredit.ts only after the
// next `npx convex codegen`; until then these references, typed from the
// registered exports as convex/lib/modelCatalogRefs.ts does, stand in for
// `internal.providerCredit.*`.
type RefOf<Export> =
  Export extends RegisteredQuery<infer Visibility, infer Args, infer Return>
    ? FunctionReference<"query", Visibility, Args, Awaited<Return>>
    : Export extends RegisteredMutation<infer Visibility, infer Args, infer Return>
      ? FunctionReference<"mutation", Visibility, Args, Awaited<Return>>
      : never;

function ref<Export>(name: string): RefOf<Export> {
  return makeFunctionReference(name) as unknown as RefOf<Export>;
}

const latchStateRef = ref<typeof providerCredit.latchState>("providerCredit:latchState");
const claimProbeRef = ref<typeof providerCredit.claimProbe>("providerCredit:claimProbe");
const latchDirectCreditRef = ref<typeof providerCredit.latchDirectCredit>("providerCredit:latchDirectCredit");
const releaseProbeRef = ref<typeof providerCredit.releaseProbe>("providerCredit:releaseProbe");
const clearDirectCreditLatchRef = ref<typeof providerCredit.clearDirectCreditLatch>(
  "providerCredit:clearDirectCreditLatch"
);

type LatchCtx = Pick<ActionCtx, "runQuery" | "runMutation">;

/** Where a direct-default call starts; see creditRoute. */
export type CreditRoute = "direct" | "probe" | "openrouter";

/**
 * Where the next call goes: one query when the latch is absent or still
 * cooling down, plus the probe claim once the cool-down is over.
 */
export async function directCreditRoute(ctx: LatchCtx): Promise<CreditRoute> {
  try {
    const route = creditRoute(await ctx.runQuery(latchStateRef, {}), Date.now());
    return route === "probe" ? await ctx.runMutation(claimProbeRef, {}) : route;
  } catch (error) {
    console.error("Anthropic credit latch could not be read; trying direct", { error: String(error) });
    return "direct";
  }
}

/** A direct call ran out of credit: set the latch (a failed probe restarts it). */
export async function latchDirectCredit(ctx: LatchCtx, route: CreditRoute): Promise<void> {
  try {
    const latched = await ctx.runMutation(latchDirectCreditRef, { probe: route === "probe" });
    console.warn(
      latched
        ? "Anthropic credit ran out; sending Anthropic calls through OpenRouter until a direct try works"
        : "Anthropic credit is still out; this call goes through OpenRouter"
    );
  } catch (error) {
    console.error("Anthropic credit latch could not be set", { error: String(error) });
  }
}

/**
 * A direct call finished without a credit refusal. After a probe that
 * means: on success the latch clears, on any other failure the probe is
 * released for the next call. Outside a probe nothing is written.
 */
export async function settleDirectCall(ctx: LatchCtx, route: CreditRoute, succeeded: boolean): Promise<void> {
  if (route !== "probe") return;
  try {
    if (succeeded) {
      await ctx.runMutation(clearDirectCreditLatchRef, {});
      console.warn("Anthropic credit is back; Anthropic calls go direct again");
    } else {
      await ctx.runMutation(releaseProbeRef, {});
    }
  } catch (error) {
    console.error("Anthropic credit latch could not be updated after a direct try", { error: String(error) });
  }
}

/** The direct request, rewritten for the Anthropic-pinned OpenRouter transport. */
function openRouterRequest(input: RequestInfo | URL, init: RequestInit | undefined, authToken: string): [string, RequestInit] {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
  // The direct key never goes to OpenRouter.
  headers.delete("x-api-key");
  headers.set("authorization", `Bearer ${authToken}`);
  for (const [name, value] of Object.entries(OPENROUTER_APP_HEADERS)) headers.set(name, value);
  const text = typeof init?.body === "string" ? init.body : "";
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  const wire = parsed && typeof parsed === "object" ? openRouterAnthropicBody(parsed as Record<string, unknown>) : null;
  if (!wire) {
    domainError(
      "PROVIDER_NOT_CONFIGURED",
      "This Anthropic request cannot go through OpenRouter (its model has no OpenRouter id in shared/anthropicTransport.ts)",
      TRANSPORT_CONFIGURATION
    );
  }
  headers.delete("content-length");
  return [
    `${OPENROUTER_ANTHROPIC_BASE_URL}${url.pathname}${url.search}`,
    { ...init, headers, body: JSON.stringify(wire) },
  ];
}

/** Whether a direct HTTP answer is a credit refusal. Reads a clone. */
async function isCreditResponse(response: Response): Promise<boolean> {
  if (response.status !== 400 && response.status !== 402) return false;
  let body: unknown = null;
  try {
    body = await response.clone().json();
  } catch {
    body = null;
  }
  return isAnthropicCreditAnswer(response.status, body);
}

/**
 * An HTTP transport for the AI SDK's Anthropic provider (the report chat
 * assistant) with the credit fallback: while the latch stands, each request
 * goes to OpenRouter's Messages endpoint pinned to Anthropic; otherwise it
 * goes direct, and a credit refusal sets the latch and sends the same
 * request through OpenRouter, so the stream the caller reads is the
 * OpenRouter one. `onServed` reports where each request went, for the usage
 * row. Streaming works the same on both: a credit refusal is an HTTP error
 * answer, never a stream that already started.
 */
export function creditFallbackFetch(
  ctx: LatchCtx,
  authToken: string,
  onServed: (transport: "direct" | "openrouter") => void
): typeof fetch {
  const viaOpenRouter = async (input: RequestInfo | URL, init: RequestInit | undefined) => {
    const [url, request] = openRouterRequest(input, init, authToken);
    onServed("openrouter");
    return await fetch(url, request);
  };
  return async (input, init) => {
    const route = await directCreditRoute(ctx);
    if (route === "openrouter") return await viaOpenRouter(input, init);
    let response: Response;
    try {
      response = await fetch(input, init);
    } catch (error) {
      await settleDirectCall(ctx, route, false);
      throw error;
    }
    if (await isCreditResponse(response)) {
      await latchDirectCredit(ctx, route);
      return await viaOpenRouter(input, init);
    }
    await settleDirectCall(ctx, route, response.ok);
    onServed("direct");
    return response;
  };
}
