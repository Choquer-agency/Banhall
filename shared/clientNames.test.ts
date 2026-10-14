import { describe, expect, it } from "vitest";
import {
  clientLooseKey,
  clientNamesLookAlike,
  isValidClientYearEnd,
} from "./clientNames";

describe("clientLooseKey", () => {
  it("normalizes case, diacritics and spacing", () => {
    expect(clientLooseKey("  Cédarline   SYSTEMS ")).toBe("cedarline systems");
  });

  it("strips trailing company suffix words, repeatedly", () => {
    expect(clientLooseKey("Acme Inc.")).toBe("acme");
    expect(clientLooseKey("Acme Incorporated")).toBe("acme");
    expect(clientLooseKey("Acme Co. Ltd.")).toBe("acme");
    expect(clientLooseKey("Acme, LLC")).toBe("acme");
    expect(clientLooseKey("Acme Corporation")).toBe("acme");
    expect(clientLooseKey("Acme Limited")).toBe("acme");
    expect(clientLooseKey("Acme Company")).toBe("acme");
    expect(clientLooseKey("Acme Ltée")).toBe("acme");
  });

  it("keeps suffix words that are not at the end", () => {
    expect(clientLooseKey("Co Op Farms")).toBe("co op farms");
    expect(clientLooseKey("Incorporated Widgets Ltd")).toBe("incorporated widgets");
  });

  it("drops in-word punctuation without a gap and splits on the rest", () => {
    expect(clientLooseKey("O'Neil Labs")).toBe("oneil labs");
    expect(clientLooseKey("A.B.C. Corp")).toBe("abc");
    expect(clientLooseKey("Smith-Jones & Partners")).toBe("smith jones partners");
  });

  it("returns an empty key for punctuation or suffixes alone", () => {
    expect(clientLooseKey("Inc.")).toBe("");
    expect(clientLooseKey("  -- ")).toBe("");
    expect(clientLooseKey("")).toBe("");
  });
});

describe("clientNamesLookAlike", () => {
  it("matches names that differ only by punctuation and suffixes", () => {
    expect(clientNamesLookAlike("Cedarline Systems Inc.", "Cedarline Systems")).toBe(true);
    expect(clientNamesLookAlike("ACME, Ltd", "acme co")).toBe(true);
  });

  it("matches names that differ only by spaces", () => {
    expect(clientNamesLookAlike("Cedar Line", "Cedarline")).toBe(true);
  });

  it("matches a whole-word prefix in either direction", () => {
    expect(clientNamesLookAlike("Acme", "Acme Manufacturing")).toBe(true);
    expect(clientNamesLookAlike("Acme Manufacturing Inc", "Acme")).toBe(true);
  });

  it("does not match a partial-word prefix or unrelated names", () => {
    expect(clientNamesLookAlike("Acme", "Acmeco")).toBe(false);
    expect(clientNamesLookAlike("Northwind", "Southwind")).toBe(false);
  });

  it("never matches an empty loose key", () => {
    expect(clientNamesLookAlike("Inc", "Inc")).toBe(false);
    expect(clientNamesLookAlike("", "Acme")).toBe(false);
  });
});

describe("isValidClientYearEnd", () => {
  it("accepts both absent", () => {
    expect(isValidClientYearEnd(undefined, undefined)).toBe(true);
  });

  it("requires both or neither", () => {
    expect(isValidClientYearEnd(3, undefined)).toBe(false);
    expect(isValidClientYearEnd(undefined, 31)).toBe(false);
  });

  it("checks the month range and the day for that month", () => {
    expect(isValidClientYearEnd(12, 31)).toBe(true);
    expect(isValidClientYearEnd(2, 29)).toBe(true);
    expect(isValidClientYearEnd(2, 30)).toBe(false);
    expect(isValidClientYearEnd(4, 31)).toBe(false);
    expect(isValidClientYearEnd(0, 1)).toBe(false);
    expect(isValidClientYearEnd(13, 1)).toBe(false);
    expect(isValidClientYearEnd(6, 0)).toBe(false);
  });

  it("rejects fractional and non-finite values", () => {
    expect(isValidClientYearEnd(3.5, 1)).toBe(false);
    expect(isValidClientYearEnd(3, 1.5)).toBe(false);
    expect(isValidClientYearEnd(Number.NaN, 1)).toBe(false);
    expect(isValidClientYearEnd(3, Number.POSITIVE_INFINITY)).toBe(false);
  });
});
