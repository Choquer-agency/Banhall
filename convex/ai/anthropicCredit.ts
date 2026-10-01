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
import { APICallError } from "ai";
import type { ActionCtx } from "../_generated/server";
import type * as providerCredit from "../providerCredit";
import {
  CREDIT_LATCH_COOLDOWN_MS,
  creditRoute,
  isAnthropicCreditAnswer,
} from "../../shared/anthropicCreditFallback";
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
const abandonProbeRef = ref<typeof providerCredit.abandonProbe>("providerCredit:abandonProbe");
const clearDirectCreditLatchRef = ref<typeof providerCredit.clearDirectCreditLatch>(
  "providerCredit:clearDirectCreditLatch"
);

type LatchCtx = Pick<ActionCtx, "runQuery" | "runMutation">;

/** Where a direct-default call starts; see creditRoute. */
export type CreditRoute = "direct" | "probe" | "openrouter";

/**
 * Where the next call goes: one query when the latch is absent or still
 * cooling down, plus the probe claim once the cool-down is over. A latch
 * that cannot be read sends the call direct.
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

/** A direct call was refused for billing: set the latch (a refused probe restarts it). */
export async function latchDirectCredit(ctx: LatchCtx, route: CreditRoute): Promise<void> {
  try {
    const latched = await ctx.runMutation(latchDirectCreditRef, { probe: route === "probe" });
    console.warn(
      latched
        ? "Anthropic refused a call for billing; sending Anthropic calls through OpenRouter until a direct try works"
        : "Anthropic still refuses calls for billing; this call goes through OpenRouter"
    );
  } catch (error) {
    console.error("Anthropic credit latch could not be set", { error: String(error) });
  }
}

/**
 * A direct call finished without a billing refusal. After a probe that
 * means: on success the latch clears; on any other failure the claim is
 * released and the cool-down restarts (the caller then sends the call
 * through OpenRouter). Outside a probe nothing is written.
 */
export async function settleDirectCall(ctx: LatchCtx, route: CreditRoute, succeeded: boolean): Promise<void> {
  if (route !== "probe") return;
  try {
    if (succeeded) {
      await ctx.runMutation(clearDirectCreditLatchRef, {});
      console.warn("Anthropic accepts calls again; Anthropic calls go direct again");
    } else {
      await ctx.runMutation(releaseProbeRef, {});
      console.warn("The direct Anthropic try failed; this call goes through OpenRouter and the next try waits 15 minutes");
    }
  } catch (error) {
    console.error("Anthropic credit latch could not be updated after a direct try", { error: String(error) });
  }
}

/**
 * The probe's call was stopped by its caller (2026-09-27, second: a Brief
 * preparation that went out of date) before direct answered. That says
 * nothing about direct, so the claim is given up at once and the next call
 * may probe; the cool-down does not restart.
 */
export async function abandonDirectProbe(ctx: LatchCtx): Promise<void> {
  try {
    await ctx.runMutation(abandonProbeRef, {});
  } catch (error) {
    console.error("Anthropic credit probe could not be given up", { error: String(error) });
  }
}

/** When this isolate last looked for a latch left behind (see clearStaleLatch). */
let staleLatchCheckedAt: number | undefined;

/** Test seam: forget when this isolate last looked for a stale latch. */
export function resetStaleLatchCheck(): void {
  staleLatchCheckedAt = undefined;
}

/**
 * A direct call succeeded on a deployment that has no fallback (no
 * OpenRouter key). A latch set while it had one would otherwise stand, with
 * its notice open, forever, since only a probe clears it and no call
 * probes without a key. So a successful direct call clears it, looking at
 * most once per cool-down per isolate: one read, and a write only when a
 * latch is there. Nothing is read on the no-key path otherwise.
 */
export async function clearStaleLatch(ctx: LatchCtx): Promise<void> {
  const now = Date.now();
  if (staleLatchCheckedAt !== undefined && now < staleLatchCheckedAt + CREDIT_LATCH_COOLDOWN_MS) return;
  staleLatchCheckedAt = now;
  try {
    if (!(await ctx.runQuery(latchStateRef, {}))) return;
    await ctx.runMutation(clearDirectCreditLatchRef, {});
    console.warn("Anthropic answers directly and no OpenRouter fallback is configured; the credit latch is cleared");
  } catch (error) {
    console.error("A stale Anthropic credit latch could not be cleared", { error: String(error) });
  }
}

const OPENROUTER_MESSAGES_PATH = "/v1/messages";

/**
 * The direct request, rewritten as the Anthropic-pinned OpenRouter transport
 * sends it (instrument.ts): only the endpoint, the key, the model id and the
 * provider pin change, and a streamed request drops each tool's
 * `eager_input_streaming`, as instrument.ts streamedBody never sends it to
 * OpenRouter. `thinking` (display "omitted" included), the top-level and
 * per-block `cache_control` and every other field pass through unchanged,
 * as on that transport.
 */
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
  if (wire.stream === true && Array.isArray(wire.tools)) {
    wire.tools = wire.tools.map((tool: unknown) => {
      if (!tool || typeof tool !== "object" || !("eager_input_streaming" in tool)) return tool;
      const { eager_input_streaming: _eager, ...rest } = tool as Record<string, unknown>;
      return rest;
    });
  }
  headers.delete("content-length");
  return [
    `${OPENROUTER_ANTHROPIC_BASE_URL}${url.pathname}${url.search}`,
    { ...init, headers, body: JSON.stringify(wire) },
  ];
}

/** Whether a direct HTTP answer is a billing refusal. Reads a clone. */
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

/** Frees a direct answer the caller will never read. */
async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Already read or closed.
  }
}

/** How much of a stream is searched for the serving provider. */
const PROVIDER_SNIFF_LIMIT = 64 * 1024;

/** The provider OpenRouter names in one event or message, if any. */
function providerOf(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const message = record.message && typeof record.message === "object" ? (record.message as Record<string, unknown>) : {};
  const provider = message.provider ?? record.provider;
  return typeof provider === "string" && provider.trim() ? provider.trim() : undefined;
}

/**
 * The OpenRouter answer as the AI SDK reads it, reporting the provider
 * OpenRouter says served it (the Messages endpoint's `provider` field, on
 * the message or its `message_start` event) without changing a byte.
 */
function withServedProvider(response: Response, onProvider: (provider: string) => void): Response {
  if (!response.body) return response;
  const decoder = new TextDecoder();
  let seen = "";
  let done = false;
  const scan = (text: string) => {
    seen += text;
    for (const line of seen.split("\n")) {
      const data = line.startsWith("data:") ? line.slice(5).trim() : line.trim().startsWith("{") ? line.trim() : "";
      if (!data) continue;
      try {
        const provider = providerOf(JSON.parse(data));
        if (provider) {
          onProvider(provider);
          done = true;
          return;
        }
      } catch {
        // A line split across chunks; the next chunk completes it.
      }
    }
    if (seen.length > PROVIDER_SNIFF_LIMIT) done = true;
  };
  const body = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (!done) scan(decoder.decode(chunk, { stream: true }));
        controller.enqueue(chunk);
      },
    })
  );
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

/**
 * An OpenRouter answer that is not a success, as the error the AI SDK would
 * raise, but naming OpenRouter's endpoint rather than api.anthropic.com
 * (the AI SDK builds its error URL from the provider's base URL, which is
 * the direct one). No request body is attached, so no prompt is logged.
 */
async function openRouterFailure(response: Response): Promise<APICallError> {
  const responseBody = await response.text().catch(() => "");
  let message = `OpenRouter answered ${response.status}`;
  try {
    const parsed = JSON.parse(responseBody) as { error?: { message?: unknown } };
    if (typeof parsed.error?.message === "string") message = `OpenRouter: ${parsed.error.message}`;
  } catch {
    // Not JSON; keep the status line.
  }
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    responseHeaders[name] = value;
  });
  return new APICallError({
    message,
    url: `${OPENROUTER_ANTHROPIC_BASE_URL}${OPENROUTER_MESSAGES_PATH}`,
    requestBodyValues: {},
    statusCode: response.status,
    responseHeaders,
    responseBody,
  });
}

/** Where the chat assistant's latest request went, for its usage row and logs. */
export type ChatServedState = { transport: "direct" | "openrouter"; servedProvider?: string };

/**
 * An HTTP transport for the AI SDK's Anthropic provider (the report chat
 * assistant) with the billing fallback, following the same rules as
 * instrumentedAnthropic:
 * - latched: the request goes to OpenRouter's Messages endpoint pinned to
 *   Anthropic;
 * - otherwise it goes direct; a billing refusal sets the latch and sends
 *   the same request through OpenRouter, so the stream the caller reads is
 *   the OpenRouter one;
 * - a probe that fails in any way is sent through OpenRouter too, and
 *   restarts the cool-down.
 * `served` records where each request went and the provider OpenRouter
 * reports. A billing refusal is an HTTP error answer, never a stream that
 * already started; an error inside a direct stream that started is not a
 * billing refusal and never falls back.
 */
export function creditFallbackFetch(ctx: LatchCtx, authToken: string, served: ChatServedState): typeof fetch {
  const viaOpenRouter = async (input: RequestInfo | URL, init: RequestInit | undefined) => {
    const [url, request] = openRouterRequest(input, init, authToken);
    served.transport = "openrouter";
    served.servedProvider = undefined;
    const response = await fetch(url, request);
    if (!response.ok) throw await openRouterFailure(response);
    return withServedProvider(response, (provider) => {
      served.servedProvider = provider;
    });
  };
  return async (input, init) => {
    const route = await directCreditRoute(ctx);
    if (route === "openrouter") return await viaOpenRouter(input, init);
    let response: Response;
    try {
      response = await fetch(input, init);
    } catch (error) {
      if (route !== "probe") throw error;
      await settleDirectCall(ctx, route, false);
      return await viaOpenRouter(input, init);
    }
    if (await isCreditResponse(response)) {
      await discard(response);
      await latchDirectCredit(ctx, route);
      return await viaOpenRouter(input, init);
    }
    if (route === "probe" && !response.ok) {
      await discard(response);
      await settleDirectCall(ctx, route, false);
      return await viaOpenRouter(input, init);
    }
    await settleDirectCall(ctx, route, response.ok);
    served.transport = "direct";
    served.servedProvider = undefined;
    return response;
  };
}
