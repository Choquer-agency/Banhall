/**
 * Keeps a test file from reaching a model provider over the real network.
 *
 * convex-test runs scheduled functions on the real `setTimeout`, so a test
 * that plans an evaluation or reserves a generation, and fakes only `Date`,
 * lets that job start by itself and call OpenRouter or Anthropic with
 * whatever keys the environment holds. Tests fake every timer instead; this
 * guard makes a slip fail loudly rather than send a request.
 *
 * Call `guardProviderNetwork()` once at the top level of a test file. For
 * that file it:
 * - replaces the base `fetch` with one that refuses provider hosts and
 *   passes every other host through unchanged. A test that stubs `fetch`
 *   (`vi.stubGlobal`) replaces it for that test only, so deliberate stubs
 *   keep working;
 * - fails the test during which a provider request was refused (a request
 *   from a job that outlives its test fails a later test, or the file);
 * - sets placeholder provider keys between tests, so a job that outlives
 *   its test reaches the refused `fetch` instead of stopping on a missing
 *   key, and real keys in the shell are never used. Tests that stub keys
 *   (`vi.stubEnv`) are unaffected.
 */
import { afterAll, afterEach, beforeAll } from "vitest";

export const MODEL_PROVIDER_HOSTS = ["openrouter.ai", "api.anthropic.com"] as const;

const PLACEHOLDER_KEYS = {
  ANTHROPIC_API_KEY: "network-guard-placeholder",
  OPENROUTER_API_KEY: "network-guard-placeholder",
} as const;

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** True when `href` is on a model provider host (or one of its subdomains). */
export function isModelProviderUrl(href: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(href).hostname;
  } catch {
    return false;
  }
  return MODEL_PROVIDER_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

/** A fetch that refuses model provider hosts and passes the rest to `base`. */
export function providerRefusingFetch(
  base: typeof fetch,
  onRefused: (href: string) => void
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = requestUrl(input);
    if (isModelProviderUrl(href)) {
      onRefused(href);
      throw new Error(`Test network guard: refused an unstubbed model provider request to ${href}`);
    }
    return await base(input, init);
  }) as typeof fetch;
}

export function guardProviderNetwork(): void {
  const refused: string[] = [];
  let baseFetch: typeof fetch | undefined;
  const savedKeys: Partial<Record<keyof typeof PLACEHOLDER_KEYS, string | undefined>> = {};
  const report = (when: string) => {
    const urls = refused.splice(0);
    if (urls.length > 0) {
      throw new Error(
        `Test network guard: ${urls.length} model provider request(s) without a fetch stub ${when}: ${urls.join(", ")}. ` +
          "Fake every timer (vi.useFakeTimers()) so scheduled jobs never start by themselves, or stub fetch."
      );
    }
  };
  beforeAll(() => {
    baseFetch = globalThis.fetch;
    globalThis.fetch = providerRefusingFetch(baseFetch, (href) => refused.push(href));
    for (const key of Object.keys(PLACEHOLDER_KEYS) as Array<keyof typeof PLACEHOLDER_KEYS>) {
      savedKeys[key] = process.env[key];
      process.env[key] = PLACEHOLDER_KEYS[key];
    }
  });
  afterEach(() => report("during this test"));
  afterAll(() => {
    try {
      report("after the last test");
    } finally {
      if (baseFetch) globalThis.fetch = baseFetch;
      for (const key of Object.keys(PLACEHOLDER_KEYS) as Array<keyof typeof PLACEHOLDER_KEYS>) {
        if (savedKeys[key] === undefined) delete process.env[key];
        else process.env[key] = savedKeys[key];
      }
    }
  });
}
