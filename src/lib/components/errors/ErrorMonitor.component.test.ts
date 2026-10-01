import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { flushSync } from "svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetConvexStub } from "$lib/test/convex-svelte-stub.svelte";
import ErrorMonitor from "./ErrorMonitor.svelte";

const sonner = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), dismiss: vi.fn() }));
vi.mock("svelte-sonner", () => ({ toast: sonner }));

const flag = () => document.querySelector("[data-flag-issue-floating]");

describe("ErrorMonitor floating Flag issue", () => {
  beforeEach(() => {
    __resetPage();
    __resetConvexStub();
  });

  it("hides on the sign-in and invite pages and shows elsewhere (J1 to J9)", async () => {
    __setPageUrl("/login");
    render(ErrorMonitor);
    await expect.poll(() => document.body.childElementCount).toBeGreaterThan(0);
    expect(flag()).toBeNull();

    __setPageUrl("/signup/tok-ana");
    flushSync();
    expect(flag()).toBeNull();

    __setPageUrl("/loginx");
    flushSync();
    expect(flag()).not.toBeNull();

    __setPageUrl("/my-work");
    flushSync();
    expect(flag()).not.toBeNull();
  });
});

/**
 * Recheck #2: the Convex client logs every failed call with console.error
 * before the caller's catch runs. A refusal the page already handles (F6's
 * GENERATION_ACTIVE callout) must not also raise "We noticed an error";
 * an unexpected failure still does.
 */
describe("ErrorMonitor crash toast", () => {
  const crashToasts = () => sonner.error.mock.calls.filter(([text]) => text === "We noticed an error.");
  function convexLog(data: Record<string, unknown> | null) {
    const body = data
      ? `Uncaught ConvexError: ${JSON.stringify(data)}\n    at handler (../convex/lib/generations/reservation.ts:93:3)`
      : "Uncaught TypeError: Cannot read properties of undefined (reading 'status')";
    return `[CONVEX M(generations:requestGeneration)] [Request ID: 7c1e] Server Error\n${body}`;
  }
  let quiet: ReturnType<typeof vi.spyOn>;
  let unmount: () => void;

  beforeEach(async () => {
    __resetPage();
    __resetConvexStub();
    __setPageUrl("/project/new");
    sonner.error.mockClear();
    // Keep the deliberate log lines out of the test output; ErrorMonitor wraps this.
    quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    ({ unmount } = await render(ErrorMonitor));
    await expect.poll(() => flag()).not.toBeNull();
  });

  afterEach(() => {
    // Unmount first so ErrorMonitor hands console.error back before the spy goes.
    unmount();
    quiet.mockRestore();
  });

  it("stays quiet for a GENERATION_ACTIVE refusal the start flow handles (F6)", () => {
    console.error(
      convexLog({
        code: "GENERATION_ACTIVE",
        message: "A generation is already active for this project",
        generationId: "g-9",
        requestedByName: "Sam Chen",
        candidateMode: "single",
        startedAt: "1000",
      })
    );
    console.error(convexLog({ code: "STALE_REVISION", message: "Seed decisions changed" }));
    expect(crashToasts()).toHaveLength(0);
    expect(quiet).toHaveBeenCalledTimes(2);
  });

  it("still raises the toast for an unexpected failure", () => {
    console.error(convexLog(null));
    expect(crashToasts()).toHaveLength(1);
  });

  it("still raises the toast for a refusal no page handles quietly", () => {
    console.error(convexLog({ code: "INVALID_STATE", message: "Frozen recovery inputs are incomplete" }));
    expect(crashToasts()).toHaveLength(1);
  });
});
