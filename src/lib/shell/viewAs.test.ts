import { describe, expect, it } from "vitest";
import {
  effectiveViewer,
  enterViewAs,
  exitViewAs,
  parseViewAsRole,
  undoViewAs,
} from "./viewAsModel";

const developer = { role: "admin" as const, isOwner: false, isDeveloper: true };

describe("effectiveViewer", () => {
  it("returns the real viewer when not viewing", () => {
    expect(effectiveViewer(developer, null)).toEqual({
      role: "admin",
      isOwner: false,
      isDeveloper: true,
      viewing: null,
    });
  });

  it.each([
    ["owner", { role: "admin", isOwner: true }],
    ["admin", { role: "admin", isOwner: false }],
    ["manager", { role: "manager", isOwner: false }],
    ["consultant", { role: "writer", isOwner: false }],
  ] as const)("maps %s and turns the developer flag off", (viewing, expected) => {
    expect(effectiveViewer(developer, viewing)).toEqual({
      ...expected,
      isDeveloper: false,
      viewing,
    });
  });

  it("ignores a stored view for anyone who is not a developer", () => {
    const admin = { role: "admin" as const, isOwner: true, isDeveloper: false };
    expect(effectiveViewer(admin, "consultant")).toEqual({
      role: "admin",
      isOwner: true,
      isDeveloper: false,
      viewing: null,
    });
    expect(effectiveViewer(null, "consultant").viewing).toBeNull();
  });
});

describe("view as transitions", () => {
  it("enter, switch and exit keep the previous role for undo", () => {
    const entered = enterViewAs({ role: null }, "consultant");
    expect(entered).toEqual({ role: "consultant", previous: null });
    const switched = enterViewAs(entered, "manager");
    expect(switched).toEqual({ role: "manager", previous: "consultant" });
    expect(undoViewAs(switched)).toEqual({ role: "consultant", previous: undefined });
    const exited = exitViewAs(switched);
    expect(exited).toEqual({ role: null, previous: "manager" });
    expect(undoViewAs(exited).role).toBe("manager");
  });

  it("undo is a no-op when there is nothing to undo", () => {
    const state = { role: "admin" as const };
    expect(undoViewAs(state)).toBe(state);
  });
});

describe("parseViewAsRole", () => {
  it("accepts the four roles and rejects anything else", () => {
    expect(parseViewAsRole("owner")).toBe("owner");
    expect(parseViewAsRole("consultant")).toBe("consultant");
    expect(parseViewAsRole("writer")).toBeNull();
    expect(parseViewAsRole("developer")).toBeNull();
    expect(parseViewAsRole(null)).toBeNull();
    expect(parseViewAsRole("")).toBeNull();
  });
});
