import { describe, expect, it } from "vitest";
import { avatarTone, initialsFor } from "./avatarTone";

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

describe("initialsFor", () => {
  it("takes the first and last name initials", () => {
    expect(initialsFor("Johnny Nguyen")).toBe("JN");
    expect(initialsFor("Ana Maria Ruiz")).toBe("AR");
    expect(initialsFor("ana")).toBe("A");
    expect(initialsFor("  ")).toBe("?");
    expect(initialsFor(undefined)).toBe("?");
  });
});
