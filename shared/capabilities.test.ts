import { describe, expect, it } from "vitest";
import { projectCapabilityAllows } from "./capabilities";

describe("projectCapabilityAllows", () => {
  const project = { ownerId: "owner-1" };

  it("holds an own capability only on the user's own project", () => {
    expect(projectCapabilityAllows("writer", "project.setStage", project, "owner-1")).toBe(true);
    expect(projectCapabilityAllows("writer", "project.setStage", project, "creator-1")).toBe(false);
    expect(projectCapabilityAllows("writer", "project.setStage", {}, "owner-1")).toBe(false);
  });

  it("holds an all capability everywhere and nothing without a role", () => {
    expect(projectCapabilityAllows("manager", "project.setStage", project, "someone")).toBe(true);
    expect(projectCapabilityAllows("admin", "project.setStage", {}, "someone")).toBe(true);
    expect(projectCapabilityAllows(undefined, "project.setStage", project, "owner-1")).toBe(false);
    expect(projectCapabilityAllows("writer", "ops.viewAlerts", project, "owner-1")).toBe(false);
  });
});
