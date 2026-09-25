import { describe, expect, it } from "vitest";
import { afterLoginPath, loginHref, safeNextPath } from "./next";

const APP = "http://localhost:3001";

/** The path a sign-in returns to after a signed-out visit to `href`. */
function roundTrip(href: string) {
  const login = new URL(loginHref(new URL(href, APP)), APP);
  expect(login.pathname).toBe("/login");
  return afterLoginPath(login.searchParams);
}

describe("next round trip", () => {
  it("returns to the page, query and hash that sent the visitor to /login", () => {
    expect(roundTrip("/project/k97617jap")).toBe("/project/k97617jap");
    expect(roundTrip("/projects?layout=board&view=all")).toBe("/projects?layout=board&view=all");
    expect(roundTrip("/project/p1?tab=report#seed-3")).toBe("/project/p1?tab=report#seed-3");
    expect(roundTrip("/settings/writing")).toBe("/settings/writing");
  });

  it("encodes next as one query value", () => {
    expect(loginHref(new URL("/projects?layout=board&view=all", APP))).toBe(
      "/login?next=%2Fprojects%3Flayout%3Dboard%26view%3Dall",
    );
  });

  it("sends plain /login for the site root, login itself or no page", () => {
    expect(loginHref(new URL("/", APP))).toBe("/login");
    expect(loginHref(new URL("/login?next=%2Fprojects", APP))).toBe("/login");
    expect(loginHref(null)).toBe("/login");
  });

  it("goes to the dashboard without a usable next", () => {
    expect(afterLoginPath(new URLSearchParams())).toBe("/dashboard");
    expect(afterLoginPath(new URLSearchParams("next="))).toBe("/dashboard");
  });
});

describe("next validation", () => {
  it.each([
    "https://evil.example/phish",
    "http://localhost:3001/projects",
    "//evil.example/phish",
    "///evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
    "/..//evil.example",
    "javascript:alert(1)",
    "data:text/html,hi",
    "evil.example",
    "projects",
    " /projects",
    "/login",
    "/login?next=%2Fprojects",
    "/LOGIN",
    "/signup/abc",
    "/api/auth/sign-out",
    `/${"a".repeat(2048)}`,
  ])("rejects %j", (raw) => {
    expect(safeNextPath(raw)).toBeNull();
    expect(afterLoginPath(new URLSearchParams({ next: raw }))).toBe("/dashboard");
  });

  it("keeps same-origin paths, normalising dot segments", () => {
    expect(safeNextPath("/my-work")).toBe("/my-work");
    expect(safeNextPath("/admin/../projects")).toBe("/projects");
    expect(safeNextPath("/logins")).toBe("/logins");
    expect(safeNextPath("/%2F%2Fevil.example")).toBe("/%2F%2Fevil.example");
  });

  it("rejects a foreign next that arrives encoded in the query", () => {
    expect(afterLoginPath(new URLSearchParams("next=https%3A%2F%2Fevil.example"))).toBe("/dashboard");
    expect(afterLoginPath(new URLSearchParams("next=%2F%2Fevil.example"))).toBe("/dashboard");
  });
});
