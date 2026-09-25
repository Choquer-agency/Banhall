import { beforeEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { ConvexError } from "convex/values";
import type { Id } from "../../../../convex/_generated/dataModel";
import { __mutationCalls, __resetConvexStub, __setMutationResult } from "$lib/test/convex-svelte-stub.svelte";
import SeedInitializationRecovery from "./SeedInitializationRecovery.svelte";

const first = "generation-first" as Id<"generations">;
const replacement = "generation-replacement" as Id<"generations">;
const props = (generationId: Id<"generations">) => ({
  generationId,
  message: "Seed preparation did not complete. Retry initialization.",
  canEdit: true,
});
/** A lazily rejecting result: it fails only when the component awaits it. */
const rejecting = (error: unknown) => ({
  then(_resolve: (value: unknown) => void, reject: (reason: unknown) => void) {
    reject(error);
  },
});
const retryButton = () => page.getByRole("button", { name: "Retry initialization", exact: true });

beforeEach(() => {
  document.body.innerHTML = "";
  __resetConvexStub();
});

describe("Seed initialization recovery", () => {
  it("resets a pending retry when its generation is replaced in place, and drops the obsolete refusal (A5, R6-07)", async () => {
    let refuse: ((reason: unknown) => void) | undefined;
    __setMutationResult("generations:retryInitializeSeedStage", new Promise((_resolve, reject) => { refuse = reject; }));
    const view = await render(SeedInitializationRecovery, props(first));
    await retryButton().click();
    await expect.element(page.getByRole("button", { name: "Retrying…", exact: true })).toBeDisabled();

    await view.rerender(props(replacement));
    await expect.element(retryButton()).toBeEnabled();
    refuse?.(new ConvexError({ code: "INVALID_STATE", message: "Refusal for the first generation" }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(document.body.textContent).not.toContain("Refusal for the first generation");
    await expect.element(retryButton()).toBeEnabled();

    // The replacement's own refusal is still announced.
    __setMutationResult("generations:retryInitializeSeedStage", rejecting(new ConvexError({
      code: "INVALID_STATE",
      message: "Refusal for the replacement",
    })));
    await retryButton().click();
    await expect.element(page.getByRole("alert")).toHaveTextContent("Refusal for the replacement");
    expect(__mutationCalls("generations:retryInitializeSeedStage")).toEqual([
      { generationId: first },
      { generationId: replacement },
    ]);
  });
});
