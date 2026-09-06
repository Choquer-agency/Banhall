import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import UsagePage from "./+page.svelte";
import { __activeQueryArgs, __resetConvexStub, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";
import { __resetAuthState } from "$lib/test/convex-auth-stub";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 6, 12));
  __resetAuthState(); __resetConvexStub();
  __setQueryData("aiUsage:usageReportAccess", true);
  __setQueryData("aiUsage:usageReport", { totals: { calls: 0, costUsd: 0, inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }, byDay: [], byModel: [], byCallSite: [], byProject: [], byWriter: [] });
});
afterEach(() => { vi.useRealTimers(); });
const args = () => __activeQueryArgs("aiUsage:usageReport");
it("initially requests 30 local calendar days and keeps exact All time explicit", async () => {
  await render(UsagePage);
  await expect.element(page.getByRole("radio", { name: "30d", exact: true })).toHaveAttribute("aria-checked", "true");
  expect(args()).toEqual([{ start: new Date(2026, 7, 8).getTime(), end: new Date(2026, 8, 6, 23, 59, 59, 999).getTime(), tzOffsetMinutes: new Date().getTimezoneOffset() }]);
  await page.getByRole("radio", { name: "All time", exact: true }).click();
  expect(args()).toEqual([{ tzOffsetMinutes: new Date().getTimezoneOffset() }]);
  await expect.element(page.getByRole("radio", { name: "All time", exact: true })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("radio", { name: "7d", exact: true }).click();
  expect(args()).toEqual([{ start: new Date(2026, 7, 31).getTime(), end: new Date(2026, 8, 6, 23, 59, 59, 999).getTime(), tzOffsetMinutes: new Date().getTimezoneOffset() }]);
});
it("commits custom calendar endpoints and removes preset selection", async () => {
  await render(UsagePage);
  await page.getByRole("button", { name: /Aug 8/ }).click();
  await page.getByRole("button", { name: "Monday, August 10, 2026", exact: true }).click();
  await page.getByRole("button", { name: "Saturday, August 15, 2026", exact: true }).click();
  await expect.poll(args).toEqual([{ start: new Date(2026, 7, 10).getTime(), end: new Date(2026, 7, 15, 23, 59, 59, 999).getTime(), tzOffsetMinutes: new Date().getTimezoneOffset() }]);
  for (const label of ["All time", "7d", "30d", "90d"]) await expect.element(page.getByRole("radio", { name: label, exact: true })).toHaveAttribute("aria-checked", "false");
});
