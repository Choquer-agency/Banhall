import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routes = ["learning", "usage", "reviews", "brain", "models", "tags", "users", "backfill"] as const;
const readRoute = (route: (typeof routes)[number]) =>
  readFileSync(new URL(`./${route}/+page.svelte`, import.meta.url), "utf8");

describe("authenticated admin workspace routes", () => {
  it.each(routes)("keeps /admin/%s content route-owned under the shared presentation shell", (route) => {
    const source = readRoute(route);
    expect(source).toContain('AdminWorkspacePage from "$lib/components/admin/AdminWorkspacePage.svelte"');
    expect(source).toContain("<AdminWorkspacePage");
    expect(source).not.toMatch(/<main(?:\s|>)/);
    expect(source).not.toMatch(/<h1(?:\s|>)/);
    expect(source).not.toContain("<WorkspaceChrome");
  });

  it("keeps the shell presentation-only and records the current-presentation rollback branch", () => {
    const shell = readFileSync(
      new URL("../../lib/components/admin/AdminWorkspacePage.svelte", import.meta.url),
      "utf8"
    );
    expect(shell).not.toContain("convex-svelte");
    expect(shell).not.toContain("useQuery(");
    expect(shell).not.toContain("useMutation(");
    expect(shell).toContain('searchParams.get("workspace") === "current"');
    expect(shell).toContain('data-admin-presentation="current"');
    expect(shell).toContain('data-admin-presentation="workspace"');
  });
});
