import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import WorkspaceRolloutCard from "./WorkspaceRolloutCard.svelte";
import {
  __resetConvexStub,
  __setQueryData,
} from "$lib/test/convex-svelte-stub.svelte";

/**
 * Slice-4 admin rollout card. Presentational contract under test:
 * - OCC version echo: mutations receive the exact `version` read from
 *   `getAdminState` / `listEnabledAccess` as `expectedVersion`.
 * - STALE_REVISION failures show the reload-and-retry recovery copy.
 * - Duplicate rows are surfaced (master alert + per-row badge), never hidden.
 * Mutations are injected through the test seams; queries resolve from the
 * convex-svelte stub registry.
 */

const MEMBERS = [
  {
    _id: "user-admin",
    displayName: "Ada Admin",
    email: "ada@example.test",
    role: "admin",
    hasAuthAccount: true,
  },
  {
    _id: "user-writer",
    displayName: "Wes Writer",
    email: "wes@example.test",
    role: "writer",
    hasAuthAccount: true,
  },
  {
    _id: "user-unlinked",
    displayName: "Una Unlinked",
    role: "writer",
    hasAuthAccount: false,
  },
] as never[];

function seedQueries({
  master = { enabled: false, version: 3, duplicates: false },
  userAccess = undefined as
    | { enabled: boolean; version: number; duplicates: boolean }
    | undefined,
  entries = [] as unknown[],
  truncated = false,
  events = [] as unknown[],
} = {}) {
  __setQueryData("workspaceRollout:getAdminState", { master, ...(userAccess ? { userAccess } : {}) });
  __setQueryData("workspaceRollout:listEnabledAccess", { entries, truncated });
  __setQueryData("workspaceRollout:listRolloutEvents", events);
}

function masterSwitchButton(): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(
    'button[aria-label="Master switch for the workspace preview"]'
  );
  if (!button) throw new Error("master switch button not rendered");
  return button;
}

async function selectMember(id: string) {
  const select = document.querySelector<HTMLSelectElement>("#workspace-rollout-member");
  if (!select) throw new Error("member select not rendered");
  select.value = id;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  await Promise.resolve();
}

function buttonByText(text: string): HTMLButtonElement {
  const button = [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === text
  );
  if (!button) throw new Error(`button "${text}" not rendered`);
  return button as HTMLButtonElement;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  __resetConvexStub();
});

describe("WorkspaceRolloutCard", () => {
  it("echoes the master version from getAdminState into setMasterSwitch", async () => {
    seedQueries({ master: { enabled: false, version: 3, duplicates: false } });
    const runSetMasterSwitch = vi.fn().mockResolvedValue(null);
    await render(WorkspaceRolloutCard, { members: MEMBERS, runSetMasterSwitch });

    masterSwitchButton().click();
    await flush();
    expect(runSetMasterSwitch).toHaveBeenCalledWith({ enabled: true, expectedVersion: 3 });
  });

  it("shows the stale-revision recovery copy on STALE_REVISION", async () => {
    seedQueries({ master: { enabled: true, version: 5, duplicates: false } });
    const runSetMasterSwitch = vi
      .fn()
      .mockRejectedValue({ data: { code: "STALE_REVISION", message: "stale" } });
    await render(WorkspaceRolloutCard, { members: MEMBERS, runSetMasterSwitch });

    masterSwitchButton().click();
    await flush();
    const alert = document.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(
      "The rollout configuration changed since it was read."
    );
  });

  it("enables a selected member with the version from getAdminState.userAccess", async () => {
    seedQueries({
      master: { enabled: true, version: 1, duplicates: false },
      userAccess: { enabled: false, version: 2, duplicates: false },
    });
    const runSetUserAccess = vi.fn().mockResolvedValue(null);
    await render(WorkspaceRolloutCard, { members: MEMBERS, runSetUserAccess });

    await selectMember("user-writer");
    buttonByText("Enable preview").click();
    await flush();
    expect(runSetUserAccess).toHaveBeenCalledWith({
      userId: "user-writer",
      enabled: true,
      expectedVersion: 2,
    });
  });

  it("defaults expectedVersion to 0 for a member with no access row yet", async () => {
    seedQueries({ master: { enabled: true, version: 1, duplicates: false } });
    const runSetUserAccess = vi.fn().mockResolvedValue(null);
    await render(WorkspaceRolloutCard, { members: MEMBERS, runSetUserAccess });

    await selectMember("user-writer");
    buttonByText("Enable preview").click();
    await flush();
    expect(runSetUserAccess).toHaveBeenCalledWith({
      userId: "user-writer",
      enabled: true,
      expectedVersion: 0,
    });
  });

  it("blocks enabling a member without a linked sign-in", async () => {
    seedQueries({ master: { enabled: true, version: 1, duplicates: false } });
    const runSetUserAccess = vi.fn();
    await render(WorkspaceRolloutCard, { members: MEMBERS, runSetUserAccess });

    await selectMember("user-unlinked");
    expect(buttonByText("Enable preview").disabled).toBe(true);
    expect(document.body.textContent).toContain(
      "Only an active internal member with a role and a linked sign-in"
    );
  });

  it("disables an enabled member using the version from listEnabledAccess", async () => {
    seedQueries({
      master: { enabled: true, version: 1, duplicates: false },
      entries: [
        {
          userId: "user-writer",
          displayName: "Wes Writer",
          email: "wes@example.test",
          version: 7,
          updatedAt: 1754450000000,
          duplicates: false,
        },
      ],
    });
    const runSetUserAccess = vi.fn().mockResolvedValue(null);
    await render(WorkspaceRolloutCard, { members: MEMBERS, runSetUserAccess });

    const disable = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Disable the workspace preview for Wes Writer"]'
    );
    expect(disable).not.toBeNull();
    disable!.click();
    await flush();
    expect(runSetUserAccess).toHaveBeenCalledWith({
      userId: "user-writer",
      enabled: false,
      expectedVersion: 7,
    });
  });

  it("surfaces duplicate rows on the master switch and per enabled member", async () => {
    seedQueries({
      master: { enabled: false, version: 2, duplicates: true },
      entries: [
        {
          userId: "user-writer",
          displayName: "Wes Writer",
          version: 4,
          updatedAt: 1754450000000,
          duplicates: true,
        },
      ],
    });
    await render(WorkspaceRolloutCard, { members: MEMBERS });

    expect(document.body.textContent).toContain(
      "The master setting has duplicate rows and is failing closed."
    );
    expect(masterSwitchButton().disabled).toBe(true);
    expect(document.body.textContent).toContain("Duplicate rows");
    const disable = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Disable the workspace preview for Wes Writer"]'
    );
    expect(disable?.disabled).toBe(true);
  });

  it("lists recent audit events with actor, target, and channel", async () => {
    seedQueries({
      master: { enabled: true, version: 1, duplicates: false },
      events: [
        {
          id: "evt-2",
          scope: "user_access",
          enabled: true,
          via: "public",
          occurredAt: 1754450000000,
          actorId: "user-admin",
          actorName: "Ada Admin",
          targetUserId: "user-writer",
          targetName: "Wes Writer",
        },
        {
          id: "evt-1",
          scope: "master",
          enabled: true,
          via: "internal",
          occurredAt: 1754440000000,
          actorId: "user-admin",
          actorName: "Ada Admin",
        },
      ],
    });
    await render(WorkspaceRolloutCard, { members: MEMBERS });

    expect(document.body.textContent).toContain("Access for Wes Writer enabled by Ada Admin");
    expect(document.body.textContent).toContain("Master switch enabled by Ada Admin");
    expect(document.body.textContent).toContain("internal");
  });
});
