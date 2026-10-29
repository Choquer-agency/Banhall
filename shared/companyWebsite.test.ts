import { describe, expect, it } from "vitest";
import {
  COMPANY_WEBSITE_MAX_LENGTH,
  companyWebsiteFileName,
  companyWebsiteHost,
  companyWebsiteProblem,
  normalizeCompanyWebsite,
} from "./companyWebsite";

describe("normalizeCompanyWebsite", () => {
  it.each([
    ["hatchbetter.com", "https://hatchbetter.com"],
    ["  HatchBetter.COM/  ", "https://hatchbetter.com"],
    ["https://www.HatchBetter.com/", "https://www.hatchbetter.com"],
    ["http://hatchbetter.com/about/", "http://hatchbetter.com/about"],
    ["hatchbetter.com/About-Us", "https://hatchbetter.com/About-Us"],
    ["https://hatchbetter.com/?lang=en", "https://hatchbetter.com/?lang=en"],
    ["https://hatchbetter.com/#team", "https://hatchbetter.com"],
    ["https://hatchbetter.com:443/", "https://hatchbetter.com"],
    ["société.ca", "https://xn--socit-esab.ca"],
  ])("%s is stored as %s", (typed, stored) => {
    expect(normalizeCompanyWebsite(typed)).toBe(stored);
  });

  it.each([
    [""],
    ["   "],
    ["hatch better.com"],
    ["localhost"],
    ["hatchbetter"],
    ["ftp://hatchbetter.com"],
    ["javascript:alert(1)"],
    ["mailto:info@hatchbetter.com"],
    ["https://user:secret@hatchbetter.com"],
    ["https://hatchbetter.c0m"],
    ["https://.com"],
    ["http://127.0.0.1"],
  ])("refuses %s", (typed) => {
    expect(normalizeCompanyWebsite(typed)).toBeNull();
  });

  it("refuses an address longer than the limit", () => {
    expect(normalizeCompanyWebsite(`hatchbetter.com/${"a".repeat(COMPANY_WEBSITE_MAX_LENGTH)}`)).toBeNull();
  });
});

describe("companyWebsiteProblem", () => {
  it("says what is wrong, with its own words for a port", () => {
    expect(companyWebsiteProblem("")).toBeNull();
    expect(companyWebsiteProblem("hatchbetter.com")).toBeNull();
    expect(companyWebsiteProblem("https://hatchbetter.com:443")).toBeNull();
    expect(companyWebsiteProblem("hatch better")).toBe("Enter a website like hatchbetter.com.");
    for (const typed of ["hatchbetter.com:8080", "https://hatchbetter.com:8443/about", "http://hatchbetter.com:443"]) {
      expect(companyWebsiteProblem(typed)).toBe("Enter the website without a port number, like hatchbetter.com.");
      expect(normalizeCompanyWebsite(typed)).toBeNull();
    }
  });
});

describe("companyWebsiteHost and the file name", () => {
  it("shows the host only, without www.", () => {
    expect(companyWebsiteHost("https://www.hatchbetter.com/about")).toBe("hatchbetter.com");
    expect(companyWebsiteHost("https://shop.hatchbetter.com")).toBe("shop.hatchbetter.com");
    expect(companyWebsiteFileName("https://hatchbetter.com")).toBe("Website: hatchbetter.com");
  });
});
