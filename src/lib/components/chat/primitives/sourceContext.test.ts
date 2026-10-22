import { describe, expect, it } from "vitest";
import { faviconUrlFor } from "./sourceContext";

describe("faviconUrlFor (Phase A, task 3)", () => {
  it("sends the hostname only, never the path, query or fragment", () => {
    const url = faviconUrlFor("https://www.canada.ca/en/revenue-agency/sred.html?token=secret-123#claim");
    expect(url).toBe("https://www.google.com/s2/favicons?sz=64&domain=www.canada.ca");
    expect(url).not.toContain("revenue-agency");
    expect(url).not.toContain("secret-123");
    expect(url).not.toContain("domain_url");
  });

  it("drops credentials and ports with the rest of the link", () => {
    const url = faviconUrlFor("https://user:pass@example.test:8443/private/report");
    expect(url).toBe("https://www.google.com/s2/favicons?sz=64&domain=example.test");
  });

  it("asks for nothing when the link is not a web address", () => {
    expect(faviconUrlFor("not a url")).toBe("");
    expect(faviconUrlFor("")).toBe("");
    expect(faviconUrlFor("mailto:someone@example.test")).toBe("");
    expect(faviconUrlFor("javascript:alert(1)")).toBe("");
  });
});
