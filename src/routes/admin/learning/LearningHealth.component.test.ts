import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../../convex/_generated/api";
import LearningPage from "./+page.svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __navigationCalls, __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetAuthState, __setAuthState } from "$lib/test/convex-auth-stub";
import {
  __activeQueryArgs, __isQueryActive, __resetConvexStub,
  __setQueryData, __setQueryDataForArgs, __setQueryError, __setQueryStale,
} from "$lib/test/convex-svelte-stub.svelte";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 5, 12);
const QUERY = "learningHealth:getHealth";
const READ_BYTES = 8 * 1024 * 1024;
const DOCUMENT_HEADROOM = 1024 * 1024 + 4096;
type Health = FunctionReturnType<typeof api.learningHealth.getHealth>;
const selection = (firstLoadedAt: number | null = NOW - 4 * DAY, lastLoadedAt: number | null = NOW - 1000) => ({ order: "oldest-first" as const, firstLoadedAt, lastLoadedAt, complete: true });
const bounds = (days = 30, end = NOW) => ({ start: end - days * DAY, end });

function data(days = 30, end = NOW): Health {
  return {
    window: bounds(days, end),
    ped: { selection: selection(), daily: [
      { day: Date.UTC(2026, 8, 1), mean: 0.4, samples: 2 },
      { day: Date.UTC(2026, 8, 2), mean: 0.2, samples: 1 },
      { day: Date.UTC(2026, 8, 4), mean: 0, samples: 1 },
    ], samples: 4, reports: 3, mean: 0.25, missingWriterSamples: 1, partial: false },
    sources: {
      selection: selection(),
      rows: [
        { identity: "source:distinct-a", title: "Thermal uncertainty reference", identityKind: "source", candidateIncomplete: false, reviewIncomplete: false, sourceMetadataIncomplete: false, sourceAvailable: true, generations: 2, passages: 5, candidateMean: 7.5, candidateSamples: 2, reviewMean: 82, reviewSamples: 1 },
        { identity: "source:distinct-b", title: "Thermal uncertainty reference", identityKind: "source", candidateIncomplete: false, reviewIncomplete: false, sourceMetadataIncomplete: false, sourceAvailable: false, generations: 1, passages: 1, candidateMean: null, candidateSamples: 0, reviewMean: null, reviewSamples: 0 },
      ],
      generations: 4, missingProvenanceGenerations: 1, emptyProvenanceGenerations: 0,
      missingSourceIdPassages: 0, unattributedPassages: 0, missingReportGenerations: 1,
      excludedVersionReviews: 1, legacyVersionReviews: 1, partial: false,
    },
    rerank: { selection: selection(NOW - DAY * 3), successes: 8, fallbacks: 2, attempts: 10, skips: 5, searchErrors: 1,
      rate: 0.2, observations: 16, earliestRecordedAtIncomplete: false, earliestRecordedAt: NOW - DAY * 3,
      firstInWindowAt: NOW - DAY * 3, lastInWindowAt: NOW - 1000, partial: false },
    coverage: { byteBudget: { limit: READ_BYTES, estimatedBytesRead: 2 * DOCUMENT_HEADROOM + 1000, reservedDocumentBytes: DOCUMENT_HEADROOM, exhausted: false }, partial: false, truncated: [], limits: { ped: 2000, generations: 200, outcomes: 2000, join: 20, joinBudget: 1000, passages: 2000 }, recording: "best-effort" },
  };
}
function button(text: string) {
  const match = [...document.querySelectorAll("button")].find((node) => node.textContent?.trim() === text);
  if (!match) throw new Error(`Missing button: ${text}`);
  return match;
}
async function ready() {
  await expect.poll(() => document.querySelector("[data-rerank-rate]")?.textContent).toBe("20.0%");
}
function noOverflow() {
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  expect(document.body.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
}

beforeEach(async () => {
  localStorage.clear();
  __resetPage();
  __resetNavigation();
  __resetAuthState();
  __resetConvexStub();
  __setPageUrl("/admin/learning");
  __setQueryData("users:getCurrentUser", { role: "admin", name: "Test Admin", isOwner: true, isAnonymous: false });
  __setQueryData("myWork:getViewConfig", { killSwitch: false, ready: true });
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  await page.viewport(1440, 900);
});
afterEach(() => { vi.restoreAllMocks(); __resetAuthState(); });

describe("/admin/learning actual page", () => {
  it("shows measured values, distinct identities and native judgment scales in the existing frame", async () => {
    __setQueryDataForArgs(QUERY, bounds(), data());
    render(LearningPage);
    await ready();
    expect(document.querySelectorAll("main")).toHaveLength(1);
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    expect(document.querySelector("h1")?.textContent).toBe("Learning health");
    const navigation = document.querySelector('aside a[href="/admin/learning"]');
    expect(navigation?.textContent).toContain("Learning health");
    expect(navigation?.getAttribute("aria-current")).toBe("page");
    expect(document.querySelector("[data-ped-mean]")?.textContent).toBe("25.0%");
    const sourceTable = document.querySelector('[aria-label="Brain source usage table"]');
    expect(sourceTable?.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(sourceTable?.textContent).toContain("7.5 / 10");
    expect(sourceTable?.textContent).toContain("82.0 / 100");
    expect(sourceTable?.textContent).toContain("Unavailable");
    expect(sourceTable?.textContent).toContain("Source record unavailable");
    expect(document.body.textContent).toContain("2 fallbacks / 10 measured attempts");
    expect(document.body.textContent).toContain("Recording is best-effort and can have gaps");
    expect(document.body.textContent).toContain("Pre-instrumentation history is unavailable");
    expect(button("30 days").getAttribute("aria-pressed")).toBe("true");
    expect(getComputedStyle(button("30 days")).color).toBe("rgb(255, 255, 255)");
    for (const heading of document.querySelectorAll("[data-learning-health] h2, [data-learning-health] .text-display")) {
      expect(Number(getComputedStyle(heading).fontWeight)).toBeLessThanOrEqual(500);
    }
    noOverflow();
    await page.screenshot({ path: "../../../../.audit/story-8/learning-desktop-after.png", fullPage: false });
    sourceTable?.scrollIntoView({ block: "center" });
    await page.screenshot({ path: "../../../../.audit/story-8/learning-sources-desktop-after.png", fullPage: false });
  });

  it("distinguishes historical entry identity from wholly unattributed judgment evidence", async () => {
    const measured = data();
    measured.sources.rows = [
      { ...measured.sources.rows[0], identity: "entry:historical-entry", identityKind: "entry", sourceAvailable: false },
      { ...measured.sources.rows[0], identity: "unattributed:generation:0", title: "Unattributed passage", identityKind: "unattributed", sourceAvailable: false },
    ];
    __setQueryData(QUERY, measured);
    render(LearningPage);
    await ready();
    const rows = document.querySelectorAll('[aria-label="Brain source usage table"] tbody tr');
    expect.soft(rows[0].textContent).toContain("Source ID unrecorded; historical entry identity available");
    expect.soft(rows[1].textContent).toContain("No source or entry identity recorded");
    expect.soft(rows[1].textContent).toContain("Scores are generation-associated evidence with no identified source");
    expect.soft(rows[1].textContent).toContain("7.5 / 10");
  });

  it("labels source counts as loaded and distinguishes byte allowance from actual reads", async () => {
    const measured = data();
    measured.coverage.partial = true;
    measured.coverage.truncated = ["source passages"];
    __setQueryData(QUERY, measured);
    render(LearningPage);
    await ready();
    const headings = [...document.querySelectorAll('[aria-label="Brain source usage table"] thead th')].map(node => node.textContent);
    expect.soft(headings).toContain("Loaded generations");
    expect.soft(headings).toContain("Loaded passages");
    document.querySelector("details summary")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect.soft(document.body.textContent).toContain("estimated budget consumed");
    expect.soft(document.body.textContent).toContain("including the authorization allowance");
    expect.soft(document.body.textContent).not.toContain("estimated bytes read");
  });

  it("wraps long unbroken source titles and identities within the narrow source column", async () => {
    const measured = data();
    measured.sources.rows[0].title = "LongUnbrokenSourceTitle".repeat(8);
    measured.sources.rows[0].identity = `entry:${"historicalidentifier".repeat(10)}`;
    __setQueryData(QUERY, measured);
    await page.viewport(390, 844);
    render(LearningPage);
    await ready();
    noOverflow();
    const cell = document.querySelector<HTMLElement>('[aria-label="Brain source usage table"] tbody th');
    if (!cell) throw new Error("Missing source cell");
    expect(cell.getBoundingClientRect().width).toBeLessThanOrEqual(320);
    expect(cell.scrollWidth).toBeLessThanOrEqual(cell.clientWidth);
    const title = cell.querySelector("span");
    if (!title) throw new Error("Missing source title");
    const titleRange = document.createRange();
    titleRange.selectNodeContents(title);
    expect(titleRange.getClientRects().length).toBeGreaterThan(1);
    cell.scrollIntoView({ block: "start" });
    await page.screenshot({ path: "../../../../.audit/story-8/third-learning-long-title-after.png", fullPage: false });
  });

  it("keeps missing days unconnected and exposes the actual daily means and sample counts", async () => {
    __setQueryDataForArgs(QUERY, bounds(), data());
    render(LearningPage);
    await ready();
    const chart = document.querySelector('svg[aria-labelledby="ped-chart-title ped-chart-desc"]');
    expect(chart?.querySelectorAll("circle")).toHaveLength(3);
    // Two scale references and one segment joining September 1–2. September 3 is missing.
    expect(chart?.querySelectorAll("line")).toHaveLength(3);
    expect(chart?.textContent).toContain("Days without loaded readings have no points or connecting lines");
    expect([...document.querySelectorAll("[data-ped-scale] span")].map(node => node.textContent)).toEqual(["100%", "0%"]);
    expect(getComputedStyle(chart!).color).toBe("rgb(10, 138, 132)");
    const summary = [...document.querySelectorAll("summary")].find((node) => node.textContent === "Daily means and sample counts");
    summary?.click();
    await expect.poll(() => document.querySelector("details")?.open).toBe(true);
    const readings = document.querySelector("details tbody");
    expect(readings?.querySelectorAll("tr")).toHaveLength(3);
    expect(readings?.textContent).toContain("0.0%");
  });

  it("plots boundary UTC days and the full PED scale at non-midnight bounds", async () => {
    const measured = data();
    measured.ped.daily = [
      { day: Date.UTC(2026, 7, 6), mean: 0, samples: 1 },
      { day: Date.UTC(2026, 7, 7), mean: 0.5, samples: 1 },
      { day: Date.UTC(2026, 8, 4), mean: 0.25, samples: 1 },
      { day: Date.UTC(2026, 8, 5), mean: 1, samples: 1 },
    ];
    measured.ped.mean = 1.75 / 4;
    measured.ped.selection = selection(bounds().start, NOW);
    __setQueryData(QUERY, measured);
    render(LearningPage);
    await ready();
    const chart = document.querySelector('svg[aria-labelledby="ped-chart-title ped-chart-desc"]');
    const points = [...(chart?.querySelectorAll("circle") ?? [])];
    expect(points).toHaveLength(4);
    // First partial UTC day is clamped to the left edge. The last UTC
    // midnight is half a day before this noon endpoint, so falls just inside it.
    const expectedX = [8, 8 + 584 / 60, 8 + 584 * 28.5 / 30, 8 + 584 * 29.5 / 30];
    const expectedY = [128, 70, 99, 12];
    points.forEach((point, index) => {
      expect(Number(point.getAttribute("cx"))).toBeCloseTo(expectedX[index]);
      expect(Number(point.getAttribute("cy"))).toBe(expectedY[index]);
    });
    const segments = [...(chart?.querySelectorAll('line[stroke="currentColor"]') ?? [])];
    expect(segments).toHaveLength(2);
    for (const [index, segment] of segments.entries()) {
      const first = index * 2;
      expect(Number(segment.getAttribute("x1"))).toBeCloseTo(expectedX[first]);
      expect(Number(segment.getAttribute("x2"))).toBeCloseTo(expectedX[first + 1]);
      expect(Number(segment.getAttribute("y1"))).toBe(expectedY[first]);
      expect(Number(segment.getAttribute("y2"))).toBe(expectedY[first + 1]);
    }
  });

  it("lets keyboard users scroll every daily reading in the named region", async () => {
    const measured = data();
    measured.ped.daily = Array.from({ length: 30 }, (_, index) => ({
      day: Date.UTC(2026, 7, 7) + index * DAY, mean: 0.5, samples: 1,
    }));
    measured.ped.samples = 30;
    measured.ped.mean = 0.5;
    __setQueryData(QUERY, measured);
    render(LearningPage);
    await ready();
    const summary = [...document.querySelectorAll("summary")].find(node => node.textContent === "Daily means and sample counts");
    summary?.focus();
    await userEvent.keyboard("{Enter}");
    const region = document.querySelector<HTMLElement>('[role="region"][aria-label="Daily PED readings"]');
    expect(region).not.toBeNull();
    if (!region) throw new Error("Missing daily readings region");
    expect(region.scrollHeight).toBeGreaterThan(region.clientHeight);
    await userEvent.keyboard("{Tab}");
    expect(document.activeElement).toBe(region);
    for (let press = 0; press < 8; press++) await userEvent.keyboard("{PageDown}");
    await expect.poll(() => region.scrollTop + region.clientHeight).toBeGreaterThanOrEqual(region.scrollHeight - 1);
    const last = region.querySelector("tbody tr:last-child");
    expect(last?.getBoundingClientRect().bottom).toBeLessThanOrEqual(region.getBoundingClientRect().bottom + 1);
  });

  it("switches the query window by keyboard without presenting cached 30-day values as 90-day evidence", async () => {
    __setQueryData(QUERY, data()); // Simulates the transport retaining old data temporarily.
    render(LearningPage);
    await ready();
    button("90 days").focus();
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => __activeQueryArgs(QUERY)).toEqual([bounds(90, NOW + 1)]);
    expect(button("90 days").getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector("[data-rerank-rate]")).toBeNull();
    expect(document.body.textContent).toContain("Loading learning health for 90 days");
    const next = data(90, NOW + 1);
    next.rerank.rate = 0;
    next.rerank.fallbacks = 0;
    next.rerank.successes = 10;
    next.ped.mean = 0.1;
    next.sources.rows = [];
    __setQueryDataForArgs(QUERY, bounds(90, NOW + 1), next);
    await expect.poll(() => document.querySelector("[data-rerank-rate]")?.textContent).toBe("0.0%");
    expect(document.querySelector("[data-ped-mean]")?.textContent).toBe("10.0%");
    expect(document.querySelector('[aria-label="Brain source usage table"]')).toBeNull();
    vi.mocked(Date.now).mockReturnValue(NOW + DAY);
    button("Refresh").focus();
    await userEvent.keyboard(" ");
    await expect.poll(() => __activeQueryArgs(QUERY)).toEqual([bounds(90, NOW + DAY)]);
    expect(document.querySelector("[data-rerank-rate]")).toBeNull();
    expect(document.querySelector("[data-window]")?.textContent).toContain("2026-09-06 12:00:00 UTC");
  });

  it("renders loading, safe recoverable errors, stale subscription state, and true empty evidence", async () => {
    render(LearningPage);
    await expect.poll(() => document.body.textContent).toContain("Loading learning health for 30 days");
    __setQueryError(QUERY, new Error("private provider details"));
    await expect.poll(() => document.querySelector('[role="alert"]')?.textContent).toContain("could not be loaded");
    expect(document.body.textContent).not.toContain("private provider details");
    button("Refresh").click();
    expect(__activeQueryArgs(QUERY)).toEqual([bounds(30, NOW + 1)]);
    const empty = data(30, NOW + 1);
    empty.ped = { selection: selection(null, null), daily: [], samples: 0, reports: 0, mean: null, missingWriterSamples: 0, partial: false };
    empty.sources = { ...empty.sources, selection: selection(null, null), rows: [], generations: 0, missingProvenanceGenerations: 0, missingReportGenerations: 0, excludedVersionReviews: 0, legacyVersionReviews: 0 };
    empty.rerank = { selection: selection(null, null), successes: 0, fallbacks: 0, attempts: 0, skips: 0, searchErrors: 0, rate: null, observations: 0, earliestRecordedAtIncomplete: false, earliestRecordedAt: null, firstInWindowAt: null, lastInWindowAt: null, partial: false };
    __setQueryData(QUERY, empty);
    await expect.poll(() => document.querySelector("[data-rerank-rate]")?.textContent).toBe("Unavailable");
    expect(document.querySelector("[data-ped-mean]")?.textContent).toBe("Unavailable");
    expect(document.body.textContent).toContain("No PED readings recorded");
    expect(document.body.textContent).toContain("No attributable source use recorded");
    expect(document.body.textContent).toContain("0 fallbacks / 0 measured attempts");
    __setQueryStale(QUERY, true);
    await expect.poll(() => document.querySelector("[data-rerank-rate]")).toBeNull();
    __setQueryStale(QUERY, false);
    await expect.poll(() => document.querySelector("[data-rerank-rate]")?.textContent).toBe("Unavailable");
  });

  it("discloses bounded populations and historical source/review gaps", async () => {
    const partial = data();
    partial.coverage.partial = true;
    partial.coverage.truncated = ["PED samples", "generations", "candidate scores", "rerank outcomes"];
    partial.sources.partial = true;
    partial.ped.partial = true;
    partial.rerank.partial = true;
    partial.ped.selection.complete = false;
    partial.sources.selection.complete = false;
    partial.rerank.selection.complete = false;
    partial.sources.rows[0].candidateIncomplete = true;
    partial.sources.rows[1].candidateIncomplete = true;
    partial.sources.rows[1].reviewIncomplete = true;
    partial.sources.rows[1].sourceMetadataIncomplete = true;
    __setQueryData(QUERY, partial);
    render(LearningPage);
    await ready();
    expect(document.body.textContent).toContain("Partial results");
    expect(document.body.textContent).toContain("beyond the loaded range are unknown");
    expect(document.body.textContent).toContain("regardless of when the judgments were made");
    expect(document.body.textContent).toContain("oldest-created first");
    expect(document.body.textContent).toContain("per-join and shared query limits");
    for (const attribute of ["data-ped-selection", "data-source-selection", "data-rerank-selection"]) {
      const text = document.querySelector(`[${attribute}]`)?.textContent;
      expect(text).toContain("oldest first");
      expect(text).toContain(attribute === "data-rerank-selection" ? "2026-09-02 12:00:00 UTC to 2026-09-05 11:59:59 UTC" : "2026-09-01 12:00:00 UTC to 2026-09-05 11:59:59 UTC");
      expect(text).toContain("later evidence may be omitted");
    }
    const rows = document.querySelectorAll('[aria-label="Brain source usage table"] tbody tr');
    expect(rows[0].textContent).toContain("7.5 / 10");
    expect(rows[0].textContent).toContain("Incomplete evidence");
    expect(rows[1].textContent).toContain("Not loaded");
    expect(rows[1].textContent).toContain("Source details not loaded");
    const details = document.querySelector("details");
    details?.querySelector("summary")?.click();
    await expect.poll(() => details?.open).toBe(true);
    expect(details?.textContent).toContain("candidate scores");
    expect(details?.textContent).toContain("200 generations");
    expect(document.body.textContent).toContain("1 generations lack provenance");
    expect(document.body.textContent).toContain("1 reviews were excluded for report-version mismatch");
    expect(document.body.textContent).toContain("1 linked reviews lack a version");
  });

  it("keeps unloaded populations unknown when the read budget stops before any records load", async () => {
    const partial = data();
    partial.coverage.partial = true;
    partial.coverage.byteBudget.exhausted = true;
    partial.coverage.byteBudget.estimatedBytesRead = READ_BYTES - DOCUMENT_HEADROOM + 1;
    partial.rerank.earliestRecordedAtIncomplete = true;
    partial.rerank.earliestRecordedAt = null;
    partial.coverage.truncated = ["PED samples", "generations", "rerank outcomes"];
    partial.ped = { ...partial.ped, daily: [], samples: 0, reports: 0, mean: null, partial: true, selection: { ...selection(null, null), complete: false } };
    partial.sources = { ...partial.sources, rows: [], generations: 0, partial: true, selection: { ...selection(null, null), complete: false } };
    partial.rerank = { ...partial.rerank, successes: 0, fallbacks: 0, attempts: 0, skips: 0, searchErrors: 0, observations: 0, rate: null, firstInWindowAt: null, lastInWindowAt: null, partial: true, selection: { ...selection(null, null), complete: false } };
    __setQueryData(QUERY, partial);
    render(LearningPage);
    await expect.poll(() => document.querySelector("[data-ped-mean]")?.textContent).toBe("Unavailable");
    expect(document.body.textContent).toContain("No PED readings loaded");
    expect(document.body.textContent).toContain("No outcomes loaded");
    expect(document.body.textContent).toContain("Earliest observation not loaded");
    expect(document.body.textContent).not.toContain("No prospective observations recorded yet");
    expect(document.body.textContent).toContain("No attributable source use loaded");
    expect(document.body.textContent).not.toContain("No PED readings recorded");
    expect(document.body.textContent).not.toContain("No recorded outcomes in this window");
  });

  it("contains the actual source table on narrow screens and preserves the PageBar presentation", async () => {
    __setQueryData(QUERY, data());
    await page.viewport(390, 844);
    render(LearningPage);
    await ready();
    noOverflow();
    const table = document.querySelector<HTMLElement>('[aria-label="Brain source usage table"]');
    expect(table?.scrollWidth).toBeGreaterThan(table?.clientWidth ?? 0);
    expect(table?.tabIndex).toBe(0);
    if (!table) throw new Error("Missing source table scroll region");
    table.focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect.poll(() => table.scrollLeft).toBeGreaterThan(0);
    for (let press = 0; press < 12; press++) await userEvent.keyboard("{ArrowRight}");
    await expect.poll(() => table.scrollLeft + table.clientWidth).toBeGreaterThanOrEqual(table.scrollWidth - 1);
    const reviewHeading = table.querySelector("thead th:last-child");
    expect(reviewHeading?.getBoundingClientRect().right).toBeLessThanOrEqual(table.getBoundingClientRect().right + 1);
    table.scrollLeft = 0;
    document.querySelector("main")?.scrollTo({ top: 0, behavior: "instant" });
    expect(button("30 days").getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: "../../../../.audit/story-8/learning-mobile-after.png", fullPage: false });
    table?.scrollIntoView({ block: "center" });
    await page.screenshot({ path: "../../../../.audit/story-8/learning-sources-mobile-after.png", fullPage: false });
    __setPageUrl("/admin/learning?workspace=current");
    await expect.poll(() => document.querySelector('[data-admin-presentation="current"]')).not.toBeNull();
    expect(document.querySelectorAll("main")).toHaveLength(1);
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    expect([...document.querySelectorAll('a[href="/dashboard"]')].some((link) => link.textContent?.includes("Back"))).toBe(true);
    expect(document.querySelector('[data-admin-presentation="workspace"]')).toBeNull();
    noOverflow();
    // Vitest captures its iframe body as a Playwright element, so fullPage is
    // ignored. Constrain that capture box to the viewport without clipping or
    // resizing the route itself; screenshot styles are removed immediately.
    await page.screenshot({ path: "../../../../.audit/story-8/learning-current-after.png", style: "body { height: 100vh !important; }" });
  });

  for (const user of [{ role: "writer" }, { role: "manager" }, { role: "admin", isAnonymous: true }, {}, null]) {
    it(`does not subscribe or expose metrics for ${JSON.stringify(user)}`, async () => {
      __setQueryData("users:getCurrentUser", user);
      __setQueryData(QUERY, data());
      render(LearningPage);
      await expect.poll(() => document.body.textContent).toContain("administrators only");
      expect(__isQueryActive(QUERY)).toBe(false);
      expect(document.querySelector("[data-learning-health]")).toBeNull();
    });
  }

  for (const state of ["stale user", "user error", "auth loading"] as const) {
    it(`hides cached metrics and pauses the subscription during ${state}, then recovers`, async () => {
      __setQueryData(QUERY, data());
      render(LearningPage);
      await ready();
      if (state === "stale user") __setQueryStale("users:getCurrentUser", true);
      else if (state === "user error") __setQueryError("users:getCurrentUser", new Error("private access error"));
      else __setAuthState({ isLoading: true });
      await expect.poll(() => document.querySelector("[data-learning-health]")).toBeNull();
      expect(__isQueryActive(QUERY)).toBe(false);
      expect(document.body.textContent).not.toContain("Thermal uncertainty reference");
      expect(document.body.textContent).not.toContain("private access error");
      expect(document.body.textContent).toContain(state === "user error" ? "Administrator access could not be checked" : "Checking administrator access");
      expect(__navigationCalls.some(call => call.url === "/login")).toBe(false);
      if (state === "stale user") __setQueryStale("users:getCurrentUser", false);
      else if (state === "user error") __setQueryData("users:getCurrentUser", { role: "admin", isAnonymous: false });
      else __setAuthState({ isLoading: false });
      await ready();
      expect(__isQueryActive(QUERY)).toBe(true);
    });
  }

  it("removes previously visible metrics and stops subscribing when administrator access is revoked", async () => {
    __setQueryData(QUERY, data());
    render(LearningPage);
    await ready();
    expect(__isQueryActive(QUERY)).toBe(true);
    __setQueryData("users:getCurrentUser", { role: "writer", isAnonymous: false });
    await expect.poll(() => document.querySelector("[data-learning-health]")).toBeNull();
    expect(__isQueryActive(QUERY)).toBe(false);
    expect(document.body.textContent).toContain("administrators only");
    expect(document.body.textContent).not.toContain("Thermal uncertainty reference");
  });

  it("removes cached metrics and both subscriptions when an administrator signs out", async () => {
    __setQueryData(QUERY, data());
    render(LearningPage);
    await ready();
    __setAuthState({ isAuthenticated: false });
    await expect.poll(() => document.querySelector("[data-learning-health]")).toBeNull();
    expect(__isQueryActive(QUERY)).toBe(false);
    expect(__isQueryActive("users:getCurrentUser")).toBe(false);
    expect(document.body.textContent).not.toContain("Thermal uncertainty reference");
    await expect.poll(() => __navigationCalls.some(call => call.url === "/login")).toBe(true);
  });

  it("redirects an unauthenticated visitor without subscribing to internal data", async () => {
    __setAuthState({ isAuthenticated: false });
    render(LearningPage);
    await expect.poll(() => __navigationCalls.some((call) => call.url === "/login")).toBe(true);
    expect(__isQueryActive(QUERY)).toBe(false);
    expect(__isQueryActive("users:getCurrentUser")).toBe(false);
  });
});
