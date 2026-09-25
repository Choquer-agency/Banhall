import { afterEach, describe, expect, it } from "vitest";
import { registerSaveHold, saveInProgress, shouldReloadForUpdate } from "./saveHold";

const releases: Array<() => void> = [];

afterEach(() => {
  while (releases.length) releases.pop()!();
});

function hold(isSaving: () => boolean) {
  releases.push(registerSaveHold(isSaving));
}

const to = { url: new URL("https://app.test/dashboard") };

describe("save hold (review D-3)", () => {
  it("reports a save only while a registered page says it is saving", () => {
    let saving = false;
    hold(() => saving);
    expect(saveInProgress()).toBe(false);
    saving = true;
    expect(saveInProgress()).toBe(true);
    saving = false;
    expect(saveInProgress()).toBe(false);
  });

  it("stops holding once the page removes its check", () => {
    const release = registerSaveHold(() => true);
    expect(saveInProgress()).toBe(true);
    release();
    expect(saveInProgress()).toBe(false);
  });

  it("reloads for a new deploy on an in-app navigation", () => {
    expect(shouldReloadForUpdate(true, { willUnload: false, to })).toBe(true);
    expect(shouldReloadForUpdate(false, { willUnload: false, to })).toBe(false);
    expect(shouldReloadForUpdate(true, { willUnload: true, to })).toBe(false);
    expect(shouldReloadForUpdate(true, { willUnload: false, to: null })).toBe(false);
  });

  it("does not reload for a new deploy while a save holds navigation (review P3-2)", () => {
    let saving = true;
    hold(() => saving);
    expect(shouldReloadForUpdate(true, { willUnload: false, to })).toBe(false);
    saving = false;
    expect(shouldReloadForUpdate(true, { willUnload: false, to })).toBe(true);
  });
});
