import { beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import { flushSync } from "svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetConvexStub } from "$lib/test/convex-svelte-stub.svelte";
import ErrorMonitor from "./ErrorMonitor.svelte";

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
