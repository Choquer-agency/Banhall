import { describe, expect, test } from "vitest";
import { isNormalizedEmail, normalizeEmail } from "./email";

describe("email normalization", () => {
  test.each([
    [" User@Banhall.com ", "user@banhall.com"],
    ["USER+Tag@Example.COM", "user+tag@example.com"],
    ["user@banhall.com", "user@banhall.com"],
    ["", null],
    ["   ", null],
    ["not-an-email", null],
    [null, null],
    [undefined, null],
  ])("normalizes %j", (input, expected) => {
    expect(normalizeEmail(input)).toBe(expected);
  });

  test("is idempotent and identifies canonical values", () => {
    const normalized = normalizeEmail(" User@Banhall.com ");
    expect(normalizeEmail(normalized)).toBe(normalized);
    expect(isNormalizedEmail("user@banhall.com")).toBe(true);
    expect(isNormalizedEmail(" User@Banhall.com ")).toBe(false);
  });
});
