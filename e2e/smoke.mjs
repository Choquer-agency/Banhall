#!/usr/bin/env node
/**
 * End-to-end browser smoke scaffold for Banhall's core routes.
 *
 * Uses the repo's installed `playwright` package directly (zero extra deps).
 * Intercepts outbound LLM/provider endpoints so smoke runs never spend tokens.
 *
 * Usage:
 *   BASE_URL=http://127.0.0.1:4173 node e2e/smoke.mjs
 *
 * Optional authenticated checks:
 *   SMOKE_STORAGE_STATE=e2e/.auth/state.json BASE_URL=http://127.0.0.1:4173 node e2e/smoke.mjs
 */
import { chromium } from "playwright";
import { existsSync } from "node:fs";

const BASE_URL = (process.env.BASE_URL ?? "http://127.0.0.1:4173").replace(/\/$/, "");
const STORAGE_STATE = process.env.SMOKE_STORAGE_STATE;

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Smoke check failed: ${message}`);
  }
}

async function stubExternalLlmRequests(context) {
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (
      url.includes("api.anthropic.com") ||
      url.includes("openrouter.ai") ||
      url.includes("api.openai.com") ||
      url.includes("api.perplexity.ai")
    ) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: "smoke-stub", choices: [], content: [] }),
      });
    }
    return route.continue();
  });
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const contextOptions =
    STORAGE_STATE && existsSync(STORAGE_STATE) ? { storageState: STORAGE_STATE } : {};
  const context = await browser.newContext(contextOptions);
  await stubExternalLlmRequests(context);
  const page = await context.newPage();

  const consoleErrors = [];
  page.on("pageerror", (err) => consoleErrors.push(err.message));

  const authenticated = Boolean(STORAGE_STATE && existsSync(STORAGE_STATE));

  try {
    // 1. Root renders or redirects cleanly to sign-in with visible content.
    const homeRes = await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded", timeout: 20_000 });
    assert(homeRes && homeRes.status() === 200, `GET / returned ${homeRes?.status()}`);
    if (authenticated) {
      await page.locator("h1, main").first().waitFor({ state: "visible", timeout: 15_000 });
    } else {
      await page.waitForURL((url) => url.pathname === "/login", { timeout: 15_000 });
      await page.locator("form").first().waitFor({ state: "visible", timeout: 15_000 });
    }

    // 2. Public invalid client review token must settle out of loading and show its refusal message.
    const reviewRes = await page.goto(`${BASE_URL}/review/invalid-smoke-token`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });
    assert(reviewRes && reviewRes.status() === 200, `GET /review/invalid-smoke-token returned ${reviewRes?.status()}`);
    await page.getByRole("heading", { name: "Report Not Found" }).waitFor({ state: "visible", timeout: 15_000 });

    // 3-5. Core workspace routes return HTTP 200 and either render (authenticated) or redirect to /login.
    for (const path of ["/my-work", "/projects", "/project/new"]) {
      const res = await page.goto(`${BASE_URL}${path}`, { waitUntil: "domcontentloaded", timeout: 20_000 });
      assert(res && res.status() === 200, `GET ${path} returned ${res?.status()}`);
      if (authenticated) {
        await page.locator("h1").first().waitFor({ state: "visible", timeout: 15_000 });
        assert(new URL(page.url()).pathname === path, `Expected ${path}, landed on ${page.url()}`);
      } else {
        await page.waitForURL((url) => url.pathname === "/login", { timeout: 15_000 });
        await page.locator("form").first().waitFor({ state: "visible", timeout: 15_000 });
      }
    }

    assert(consoleErrors.length === 0, `Uncaught page errors: ${consoleErrors.join("; ")}`);
    console.log(`e2e smoke passed against ${BASE_URL} (5 routes checked, 0 uncaught errors)`);
  } finally {
    await context.close();
    await browser.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
