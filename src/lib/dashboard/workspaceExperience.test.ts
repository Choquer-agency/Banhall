import { describe, expect, it } from "vitest";
import { resolveWorkspaceRouteState, shouldQueryWorkspaceAccess } from "./workspaceExperience";

describe("resolveWorkspaceRouteState", () => {
  it("lets the explicit current escape win everywhere, including mid-load and on error", () => {
    expect(resolveWorkspaceRouteState({ workspaceParam: "current", access: { status: "loading" } })).toBe("current");
    expect(resolveWorkspaceRouteState({ workspaceParam: "current", access: { status: "error" } })).toBe("current");
    expect(resolveWorkspaceRouteState({ workspaceParam: "current", access: { status: "ready", available: true } })).toBe("current");
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

  it("resolves preview when the server says available", () => {
    expect(resolveWorkspaceRouteState({ workspaceParam: null, access: { status: "ready", available: true } })).toBe("preview");
  });

  it("keeps invalid param values from bypassing the server decision", () => {
    expect(resolveWorkspaceRouteState({ workspaceParam: "banana", access: { status: "ready", available: false } })).toBe("current");
    expect(resolveWorkspaceRouteState({ workspaceParam: "", access: { status: "error" } })).toBe("current");
    expect(resolveWorkspaceRouteState({ workspaceParam: "banana", access: { status: "ready", available: true } })).toBe("preview");
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
