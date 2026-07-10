import { describe, expect, test } from "bun:test";
import {
  CRA_SCIENCE_CODES,
  CRA_SCIENCE_CODE_ITEMS,
  isCraScienceCode,
  normalizeCraScienceCode,
} from "../shared/craScienceCodes";

describe("authoritative CRA science-code catalog", () => {
  test("contains the complete unique Appendix 1 code set", () => {
    expect(CRA_SCIENCE_CODES).toHaveLength(147);
    expect(new Set(CRA_SCIENCE_CODES.map(({ code }) => code)).size).toBe(147);
    expect(CRA_SCIENCE_CODE_ITEMS.slice(1).map(({ value }) => value)).toEqual(
      CRA_SCIENCE_CODES.map(({ code }) => code)
    );
  });

  test("preserves the complete official industrial-biotechnology labels", () => {
    expect(CRA_SCIENCE_CODES.find(({ code }) => code === "2.09.04")?.label).toBe(
      "Bioproducts (products that are manufactured using biological material as feedstock)"
    );
    expect(CRA_SCIENCE_CODES.find(({ code }) => code === "2.09.05")?.label).toBe(
      "Biomaterials (bioplastics, biofuels, bioderived bulk and fine chemicals, bio-derived materials)"
    );
  });

  test("normalizes valid codes and rejects arbitrary science strings", () => {
    expect(isCraScienceCode("2.02.09")).toBe(true);
    expect(normalizeCraScienceCode(" 2.02.09 ")).toBe("2.02.09");
    expect(isCraScienceCode("software engineering")).toBe(false);
    expect(normalizeCraScienceCode("2.02.99")).toBeUndefined();
    expect(normalizeCraScienceCode("   ")).toBeUndefined();
  });
});
