import { describe, expect, it } from "vitest";
import { personInitials } from "./personInitials";

describe("personInitials", () => {
  it("prefers first and last name, then a single name, then the email", () => {
    expect(personInitials({ firstName: "priya", lastName: "Shah" })).toBe("PS");
    expect(personInitials({ firstName: "Priya" })).toBe("P");
    expect(personInitials({ name: "Jordan Lee Park" })).toBe("JL");
    expect(personInitials({ name: "Cher" })).toBe("C");
    expect(personInitials({ email: "sam@banhall.com" })).toBe("S");
    expect(personInitials({})).toBe("?");
  });
});
