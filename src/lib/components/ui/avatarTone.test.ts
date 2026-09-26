import { describe, expect, it } from "vitest";
import { avatarTone, initialsFor, roleAvatarTone } from "./avatarTone";

describe("avatarTone", () => {
  it("is stable for a seed and fir when there is none", () => {
    expect(avatarTone("user-1")).toBe(avatarTone("user-1"));
    expect(avatarTone("")).toBe("fir");
    expect(avatarTone(null)).toBe("fir");
  });

  it("spreads seeds over the three tones", () => {
    const tones = new Set(Array.from({ length: 30 }, (_, index) => avatarTone(`user-${index}`)));
    expect(tones).toEqual(new Set(["fir", "teal", "purple"]));
  });
});

describe("roleAvatarTone", () => {
  it("colours by role as the boards do (A1 to D5, C1)", () => {
    expect(roleAvatarTone("consultant")).toBe("fir");
    expect(roleAvatarTone("manager")).toBe("fir");
    expect(roleAvatarTone("owner")).toBe("teal");
    expect(roleAvatarTone("developer")).toBe("purple");
    expect(roleAvatarTone("admin")).toBe("admin");
    expect(roleAvatarTone(null)).toBe("fir");
  });
});

describe("initialsFor", () => {
  it("takes the first and last name initials", () => {
    expect(initialsFor("Johnny Nguyen")).toBe("JN");
    expect(initialsFor("Ana Maria Ruiz")).toBe("AR");
    expect(initialsFor("ana")).toBe("A");
    expect(initialsFor("  ")).toBe("?");
    expect(initialsFor(undefined)).toBe("?");
  });
});
