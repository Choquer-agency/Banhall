import { describe, expect, it } from "vitest";
import { canDeleteProject } from "./projectDelete";

// Mirrors projects.deleteProject's rule (creator or admin) so Delete is only
// offered to people who can use it.
describe("canDeleteProject", () => {
  const creator = { _id: "u-1", role: "writer" };
  it("lets the creator and any admin delete", () => {
    expect(canDeleteProject(creator, "u-1")).toBe(true);
    expect(canDeleteProject({ _id: "u-9", role: "admin" }, "u-1")).toBe(true);
  });
  it("refuses everyone else, including managers and the owner by role alone", () => {
    expect(canDeleteProject({ _id: "u-2", role: "writer" }, "u-1")).toBe(false);
    expect(canDeleteProject({ _id: "u-3", role: "manager" }, "u-1")).toBe(false);
  });
  it("reads unknowns as no", () => {
    expect(canDeleteProject(null, "u-1")).toBe(false);
    expect(canDeleteProject(undefined, "u-1")).toBe(false);
    expect(canDeleteProject(creator, undefined)).toBe(false);
    expect(canDeleteProject({ _id: "u-9", role: "admin" }, undefined)).toBe(false);
    expect(canDeleteProject({ _id: "u-1", role: null }, "u-1")).toBe(false);
    expect(canDeleteProject({ _id: "u-1", role: "writer", isAnonymous: true }, "u-1")).toBe(false);
  });
  it("offers nothing for a project already being deleted", () => {
    expect(canDeleteProject(creator, "u-1", true)).toBe(false);
  });
});
