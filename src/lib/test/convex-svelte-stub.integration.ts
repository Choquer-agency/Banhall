/**
 * Integration-only alias target for `convex-svelte`, used solely by
 * `vite.integration.config.ts` (the real-SvelteKit-router witness driven by
 * `scripts/seed-summary-history-witness.mjs`).
 *
 * It re-exports the component-test stub unchanged and, in the browser, exposes
 * the stub's seeding helpers on `window.__banhallConvexStub` so a real-browser
 * driver can feed query data to pages served through the production SvelteKit
 * router. The app never imports this module and neither vitest config resolves
 * to it: the canonical component config keeps running without `sveltekit()`.
 */
import * as stub from "./convex-svelte-stub.svelte";
import { PD_SUBSECTIONS } from "../../../shared/pdSubsections";

export * from "./convex-svelte-stub.svelte";

type IntegrationStub = typeof stub & { PD_SUBSECTIONS: typeof PD_SUBSECTIONS };

declare global {
  interface Window {
    __banhallConvexStub?: IntegrationStub;
  }
}

if (typeof window !== "undefined") {
  window.__banhallConvexStub = { ...stub, PD_SUBSECTIONS };
}
