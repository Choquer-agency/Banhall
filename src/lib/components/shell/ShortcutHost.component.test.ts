import { beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import Harness from "./ShortcutHostHarness.svelte";
import { __resetPage } from "$lib/test/app-state-stub.svelte";
import { __navigationCalls, __resetNavigation } from "$lib/test/app-navigation-stub";

const focus = (id: string) => (document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!).focus();
const gotos = () => __navigationCalls.filter((call) => call.kind === "goto").map((call) => call.url);

describe("ShortcutHost (I4, I5)", () => {
  beforeEach(() => {
    __resetPage();
    __resetNavigation();
  });

  function mount(overrides: Record<string, unknown> = {}) {
    const onToggleRail = vi.fn();
    const onOpenViewAs = vi.fn();
    return render(Harness, { onToggleRail, onOpenViewAs, ...overrides }).then(() => ({ onToggleRail, onOpenViewAs }));
  }

  it("C opens New project and ? opens the shortcuts page", async () => {
    await mount();
    focus("plain");
    await userEvent.keyboard("c");
    await expect.poll(gotos).toEqual(["/project/new"]);
    await userEvent.keyboard("?");
    await expect.poll(gotos).toEqual(["/project/new", "/settings/shortcuts"]);
  });

  it("Mod \\ toggles the rail, but not inside the editor", async () => {
    const { onToggleRail } = await mount();
    focus("plain");
    await userEvent.keyboard("{Control>}\\{/Control}");
    expect(onToggleRail).toHaveBeenCalledOnce();
    focus("editor");
    await userEvent.keyboard("{Control>}\\{/Control}");
    expect(onToggleRail).toHaveBeenCalledOnce();
  });

  it("G then A goes to Admin only for a viewer with settings.configure", async () => {
    await mount({ canOpenAdmin: false });
    focus("plain");
    await userEvent.keyboard("ga");
    expect(gotos()).toEqual([]);
  });

  it("G then A lands on the first admin page", async () => {
    await mount({ canOpenAdmin: true });
    focus("plain");
    await userEvent.keyboard("ga");
    await expect.poll(gotos).toEqual(["/admin/house-rules"]);
  });

  it("Shift V opens View as for developers only", async () => {
    const first = await mount({ canViewAs: false });
    focus("plain");
    await userEvent.keyboard("{Shift>}V{/Shift}");
    expect(first.onOpenViewAs).not.toHaveBeenCalled();
    document.body.innerHTML = "";
    const second = await mount({ canViewAs: true });
    focus("plain");
    await userEvent.keyboard("{Shift>}V{/Shift}");
    expect(second.onOpenViewAs).toHaveBeenCalledOnce();
  });

  it("nothing fires while typing in a field or the editor", async () => {
    const { onOpenViewAs } = await mount({ canViewAs: true, canOpenAdmin: true });
    for (const target of ["field", "editor"]) {
      focus(target);
      await userEvent.keyboard("c?ga{Shift>}V{/Shift}");
    }
    expect(gotos()).toEqual([]);
    expect(onOpenViewAs).not.toHaveBeenCalled();
  });
});
