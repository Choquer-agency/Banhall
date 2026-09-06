import { beforeEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { tick } from "svelte";
import type { FunctionReturnType } from "convex/server";
import type { Id } from "../../../../convex/_generated/dataModel";
import { api } from "../../../../convex/_generated/api";
import BrainPage from "./+page.svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __navigationCalls, __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetAuthState, __setAuthState } from "$lib/test/convex-auth-stub";
import {
  __activeQueryArgs, __activeQueryCount, __resetConvexStub, __setQueryData,
} from "$lib/test/convex-svelte-stub.svelte";

const AUDIT = "brain:listBrainAudit";
const SOURCES = "brain:listBrainSources";
const STATS = "brain:brainStats";
type Audit = NonNullable<FunctionReturnType<typeof api.brain.listBrainAudit>>;
const NOW = Date.UTC(2026, 8, 5, 12);
// Opaque fixture IDs are never dereferenced by this route or query stub.
const sourceId = "brain-source-recovery" as Id<"brainSources">;
const actions: Audit[number]["action"][] = [
  "ingest", "approve", "reject", "reweight", "revert",
  "revoke", "unlearn_failed", "unlearn_confirmed",
];
const audit: Audit = actions.map((action, index) => ({
  _id: `brain-audit-${index}` as Id<"brainAuditLog">,
  _creationTime: NOW + index * 1000,
  action,
  actorId: action === "ingest" ? "cli:importer" : action.startsWith("unlearn_") ? "system" : "human-admin",
  at: NOW + index * 1000,
  sourceId,
  ...(action === "revert" ? {} : {
    reason: action === "unlearn_failed"
      ? "Erasure failed for entry rag-recovery (attempt 1/3): temporary failure"
      : `Recorded ${action}`,
  }),
})).reverse();
const labels: Record<Audit[number]["action"], string> = {
  ingest: "Imported", approve: "Approved", reject: "Rejected",
  reweight: "Reweighted", revert: "Reverted",
  revoke: "Revoked (unlearn requested)",
  unlearn_failed: "Erasure attempt failed", unlearn_confirmed: "Erasure confirmed",
};
const rows = () => [...document.querySelectorAll("tbody tr")];
const cells = (row: Element) => [...row.querySelectorAll("td")].map(cell => cell.textContent?.trim());
async function openAudit() {
  render(BrainPage);
  await page.getByRole("tab", { name: "Audit log", exact: true }).click();
  await expect.poll(() => rows().length).toBe(audit.length);
}
function subscription(name: string, args: unknown[]) {
  expect(__activeQueryCount(name)).toBe(args.length);
  expect(__activeQueryArgs(name)).toEqual(args);
}

beforeEach(async () => {
  localStorage.clear();
  __resetPage();
  __resetNavigation();
  __resetAuthState();
  __resetConvexStub();
  __setPageUrl("/admin/brain");
  __setQueryData("users:getCurrentUser", { role: "admin", name: "Test Admin", isOwner: true, isAnonymous: false });
  __setQueryData("myWork:getViewConfig", { killSwitch: false, ready: true });
  __setQueryData(STATS, { approved: 0, pending: 0, byIndustry: {} });
  __setQueryData(SOURCES, []);
  __setQueryData(AUDIT, audit);
  await page.viewport(1440, 900);
});

describe("/admin/brain actual audit route", () => {
  it("renders all eight event labels and same-source recovery newest first with exact row details", async () => {
    await openAudit();
    // Soft assertions retain all three baseline label failures in one run.
    rows().forEach((row, index) => {
      const event = audit[index];
      expect.soft(cells(row)).toEqual([
        labels[event.action], event.reason ?? "\u2014",
        event.actorId.startsWith("cli:") ? event.actorId : "admin",
        new Date(event.at).toLocaleString(),
      ]);
    });
    expect(audit.slice(0, 3).map(event => event.action)).toEqual([
      "unlearn_confirmed", "unlearn_failed", "revoke",
    ]);
  });

  it("preserves raw action fallback at a forward-compatibility query boundary (not a schema-valid event)", async () => {
    const boundaryRows = audit.map((event, index) => index === 0
      ? { ...event, action: "future_erasure_event" } : event);
    __setQueryData(AUDIT, boundaryRows);
    await openAudit();
    expect(cells(rows()[0])[0]).toBe("future_erasure_event");
  });

  it("subscribes only on Audit log and stops on return to Queue", async () => {
    render(BrainPage);
    await expect.element(page.getByRole("tab", { name: "Audit log", exact: true })).toBeVisible();
    subscription(AUDIT, []);
    subscription(STATS, [{}]);
    subscription(SOURCES, [{ status: "pending" }]);
    await page.getByRole("tab", { name: "Audit log", exact: true }).click();
    await expect.poll(() => rows().length).toBe(audit.length);
    subscription(AUDIT, [{}]);
    subscription(SOURCES, []);
    subscription("brain:listFeedbackQueue", []);
    await page.getByRole("tab", { name: /^Queue/ }).click();
    await expect.poll(() => __activeQueryCount(AUDIT)).toBe(0);
    subscription(AUDIT, []);
    subscription(SOURCES, [{ status: "pending" }]);
    expect(rows()).toHaveLength(0);
  });

  it("skips audit and navigates to login for a signed-out visitor", async () => {
    __setAuthState({ isAuthenticated: false, isLoading: false });
    render(BrainPage);
    await expect.poll(() => __navigationCalls.some(call => call.kind === "goto" && call.url === "/login")).toBe(true);
    subscription(AUDIT, []);
    subscription(STATS, []);
    subscription(SOURCES, []);
    expect(document.querySelector('[role="tab"]')).toBeNull();
  });

  it("stops an existing audit subscription on sign-out", async () => {
    await openAudit();
    subscription(AUDIT, [{}]);
    __setAuthState({ isAuthenticated: false, isLoading: false });
    await expect.poll(() => __navigationCalls.some(call => call.url === "/login")).toBe(true);
    subscription(AUDIT, []);
    subscription(STATS, []);
    expect(rows()).toHaveLength(0);
  });

  it("preserves the access-denied render gate when authenticated stats are null", async () => {
    __setQueryData(STATS, null);
    render(BrainPage);
    await expect.poll(() => document.body.textContent).toContain("Admin access only.");
    expect(document.querySelector('[role="tab"]')).toBeNull();
    subscription(AUDIT, []);
    subscription(STATS, [{}]);
    subscription(SOURCES, [{ status: "pending" }]);
  });

  it("keeps authenticated audit subscription arguments while auth is loading", async () => {
    await openAudit();
    __setAuthState({ isLoading: true });
    await tick();
    await expect.poll(() => document.querySelector('[role="tab"]')).toBeNull();
    subscription(AUDIT, [{}]);
    subscription(STATS, [{}]);
    expect(rows()).toHaveLength(0);
    expect(__navigationCalls.some(call => call.url === "/login")).toBe(false);
    __setAuthState({ isLoading: false });
    await expect.poll(() => rows().length).toBe(audit.length);
    subscription(AUDIT, [{}]);
  });
});
