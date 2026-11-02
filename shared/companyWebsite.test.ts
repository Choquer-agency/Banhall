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
    ["quillmere.com", "https://quillmere.com"],
    ["  Quillmere.COM/  ", "https://quillmere.com"],
    ["https://www.Quillmere.com/", "https://www.quillmere.com"],
    ["http://quillmere.com/about/", "http://quillmere.com/about"],
    ["quillmere.com/About-Us", "https://quillmere.com/About-Us"],
    ["https://quillmere.com/?lang=en", "https://quillmere.com/?lang=en"],
    ["https://quillmere.com/#team", "https://quillmere.com"],
    ["https://quillmere.com:443/", "https://quillmere.com"],
    ["société.ca", "https://xn--socit-esab.ca"],
  ])("%s is stored as %s", (typed, stored) => {
    expect(normalizeCompanyWebsite(typed)).toBe(stored);
  });

  it.each([
    [""],
    ["   "],
    ["quillmere analytics.com"],
    ["localhost"],
    ["quillmere"],
    ["ftp://quillmere.com"],
    ["javascript:alert(1)"],
    ["mailto:info@quillmere.com"],
    ["https://user:secret@quillmere.com"],
    ["https://quillmere.c0m"],
    ["https://.com"],
    ["http://127.0.0.1"],
  ])("refuses %s", (typed) => {
    expect(normalizeCompanyWebsite(typed)).toBeNull();
  });

  it("refuses an address longer than the limit", () => {
    expect(normalizeCompanyWebsite(`quillmere.com/${"a".repeat(COMPANY_WEBSITE_MAX_LENGTH)}`)).toBeNull();
  });
});

describe("companyWebsiteProblem", () => {
  it("says what is wrong, with its own words for a port", () => {
    expect(companyWebsiteProblem("")).toBeNull();
    expect(companyWebsiteProblem("quillmere.com")).toBeNull();
    expect(companyWebsiteProblem("https://quillmere.com:443")).toBeNull();
    expect(companyWebsiteProblem("quillmere analytics")).toBe("Enter a website like example.com.");
    for (const typed of ["quillmere.com:8080", "https://quillmere.com:8443/about", "http://quillmere.com:443"]) {
      expect(companyWebsiteProblem(typed)).toBe("Enter the website without a port number, like example.com.");
      expect(normalizeCompanyWebsite(typed)).toBeNull();
    }
  });
});

describe("companyWebsiteHost and the file name", () => {
  it("shows the host only, without www.", () => {
    expect(companyWebsiteHost("https://www.quillmere.com/about")).toBe("quillmere.com");
    expect(companyWebsiteHost("https://shop.quillmere.com")).toBe("shop.quillmere.com");
    expect(companyWebsiteFileName("https://quillmere.com")).toBe("Website: quillmere.com");
  });
});
