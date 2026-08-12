import { describe, expect, it } from "vitest";
import {
  resolveWorkspaceExperience,
  resolveWorkspaceRouteState,
  shouldQueryWorkspaceAccess,
} from "./workspaceExperience";

describe("resolveWorkspaceExperience", () => {
  it("forces the current dashboard immediately on an explicit current override", () => {
    expect(resolveWorkspaceExperience({ workspaceParam: "current", access: { status: "loading" } })).toBe("current");
    expect(resolveWorkspaceExperience({ workspaceParam: "current", access: { status: "error" } })).toBe("current");
    expect(resolveWorkspaceExperience({ workspaceParam: "current", access: { status: "ready", available: true } })).toBe("current");
  });

  it("never lets the preview param bypass a missing, unavailable, or errored server decision", () => {
    expect(resolveWorkspaceExperience({ workspaceParam: "preview", access: { status: "loading" } })).toBe("current");
    expect(resolveWorkspaceExperience({ workspaceParam: "preview", access: { status: "error" } })).toBe("current");
    expect(resolveWorkspaceExperience({ workspaceParam: "preview", access: { status: "ready", available: false } })).toBe("current");
  });

  it("shows the preview in local development without requiring rollout data", () => {
    expect(resolveWorkspaceExperience({ workspaceParam: null, access: { status: "loading" }, localDevelopment: true })).toBe("preview");
    expect(resolveWorkspaceExperience({ workspaceParam: "preview", access: { status: "error" }, localDevelopment: true })).toBe("preview");
    expect(resolveWorkspaceExperience({ workspaceParam: "current", access: { status: "loading" }, localDevelopment: true })).toBe("current");
  });

  it("defaults to the preview when the server says available and no current override exists", () => {
    expect(resolveWorkspaceExperience({ workspaceParam: null, access: { status: "ready", available: true } })).toBe("preview");
    expect(resolveWorkspaceExperience({ workspaceParam: "preview", access: { status: "ready", available: true } })).toBe("preview");
  });

  it("keeps invalid values from enabling the preview when it is unavailable", () => {
    expect(resolveWorkspaceExperience({ workspaceParam: "banana", access: { status: "ready", available: false } })).toBe("current");
    expect(resolveWorkspaceExperience({ workspaceParam: "", access: { status: "error" } })).toBe("current");
    expect(resolveWorkspaceExperience({ workspaceParam: null, access: { status: "ready", available: false } })).toBe("current");
  });
});

describe("resolveWorkspaceRouteState", () => {
  it("lets the explicit current escape win everywhere, including mid-load and on error", () => {
    expect(resolveWorkspaceRouteState({ workspaceParam: "current", access: { status: "loading" } })).toBe("current");
    expect(resolveWorkspaceRouteState({ workspaceParam: "current", access: { status: "error" } })).toBe("current");
    expect(resolveWorkspaceRouteState({ workspaceParam: "current", access: { status: "ready", available: true } })).toBe("current");
    expect(resolveWorkspaceRouteState({ workspaceParam: "current", access: { status: "loading" }, localDevelopment: true })).toBe("current");
  });

  it("reports loading while the decision is pending so canonical routes never redirect prematurely", () => {
    expect(resolveWorkspaceRouteState({ workspaceParam: null, access: { status: "loading" } })).toBe("loading");
    expect(resolveWorkspaceRouteState({ workspaceParam: "preview", access: { status: "loading" } })).toBe("loading");
  });

  it("fails closed to current on error or an unavailable decision", () => {
    expect(resolveWorkspaceRouteState({ workspaceParam: null, access: { status: "error" } })).toBe("current");
    expect(resolveWorkspaceRouteState({ workspaceParam: null, access: { status: "ready", available: false } })).toBe("current");
    expect(resolveWorkspaceRouteState({ workspaceParam: "preview", access: { status: "ready", available: false } })).toBe("current");
  });

  it("resolves preview when the server says available, and in local development", () => {
    expect(resolveWorkspaceRouteState({ workspaceParam: null, access: { status: "ready", available: true } })).toBe("preview");
    expect(resolveWorkspaceRouteState({ workspaceParam: null, access: { status: "loading" }, localDevelopment: true })).toBe("preview");
  });

  it("agrees with resolveWorkspaceExperience on every non-loading decision", () => {
    const accesses = [
      { status: "error" } as const,
      { status: "ready", available: false } as const,
      { status: "ready", available: true } as const,
    ];
    for (const workspaceParam of ["current", "preview", null]) {
      for (const access of accesses) {
        expect(resolveWorkspaceRouteState({ workspaceParam, access })).toBe(
          resolveWorkspaceExperience({ workspaceParam, access })
        );
      }
    }
  });
});

describe("shouldQueryWorkspaceAccess", () => {
  it("skips the access subscription only for the explicit current escape", () => {
    expect(shouldQueryWorkspaceAccess("current")).toBe(false);
    expect(shouldQueryWorkspaceAccess(null)).toBe(true);
    expect(shouldQueryWorkspaceAccess("preview")).toBe(true);
    expect(shouldQueryWorkspaceAccess("")).toBe(true);
    expect(shouldQueryWorkspaceAccess("banana")).toBe(true);
  });
});
