import { describe, expect, it } from "vitest";
import {
  canCreateProjects,
  duplicateProjectSearch,
  parseDraftModeParam,
} from "./projectDuplicate";

describe("parseDraftModeParam", () => {
  it.each(["compare", "single", "iterative"] as const)("accepts %s", (mode) => {
    expect(parseDraftModeParam(mode)).toBe(mode);
  });

  it.each([null, undefined, "", "Iterative", "ITERATIVE", " iterative", "step-by-step", "review"])(
    "ignores %j",
    (value) => {
      expect(parseDraftModeParam(value)).toBeNull();
    }
  );
});

describe("duplicateProjectSearch", () => {
  it("asks the wizard for Step by step by default", () => {
    expect(duplicateProjectSearch("p1")).toBe("?from=p1&drafts=iterative");
  });

  it("encodes the project id and takes another Drafts mode", () => {
    expect(duplicateProjectSearch("a b&c", "single")).toBe("?from=a+b%26c&drafts=single");
  });
});

describe("canCreateProjects", () => {
  it.each(["writer", "manager", "admin"] as const)("allows the %s role", (role) => {
    expect(canCreateProjects({ role })).toBe(true);
  });

  it("refuses the financial role, no role, an anonymous user and an unknown user", () => {
    expect(canCreateProjects({ role: "financial" })).toBe(false);
    expect(canCreateProjects({ role: null })).toBe(false);
    expect(canCreateProjects({})).toBe(false);
    expect(canCreateProjects({ role: "writer", isAnonymous: true })).toBe(false);
    expect(canCreateProjects(null)).toBe(false);
    expect(canCreateProjects(undefined)).toBe(false);
  });
});
