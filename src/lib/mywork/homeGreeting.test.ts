import { describe, expect, it } from "vitest";
import { greetingForHour, greetingName } from "./homeGreeting";

describe("greetingForHour", () => {
  it("maps day parts at their boundaries", () => {
    expect(greetingForHour(0)).toBe("Good evening");
    expect(greetingForHour(4)).toBe("Good evening");
    expect(greetingForHour(5)).toBe("Good morning");
    expect(greetingForHour(11)).toBe("Good morning");
    expect(greetingForHour(12)).toBe("Good afternoon");
    expect(greetingForHour(16)).toBe("Good afternoon");
    expect(greetingForHour(17)).toBe("Good evening");
    expect(greetingForHour(23)).toBe("Good evening");
  });
});

describe("greetingName", () => {
  it("prefers firstName, falls back to the first word of name, else empty", () => {
    expect(greetingName({ firstName: "Olivia", name: "Ignored Person" })).toBe("Olivia");
    expect(greetingName({ firstName: "  ", name: "Morgan Manager" })).toBe("Morgan");
    expect(greetingName({ name: "  Solo " })).toBe("Solo");
    expect(greetingName({})).toBe("");
    expect(greetingName(null)).toBe("");
    // Never an email or a placeholder — the greeting simply omits the name.
    expect(greetingName({ firstName: null, name: null })).toBe("");
  });
});
