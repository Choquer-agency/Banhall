import { describe, expect, it } from "vitest";
import { resolveDashboardView } from "./viewMode";

describe("resolveDashboardView", () => {
  it("lets the kill switch and readiness force All projects", () => {
    expect(resolveDashboardView({ killSwitch: true, ready: true, urlView: "my_work", sessionView: "my_work", configuredDefault: "my_work" })).toBe("all_projects");
    expect(resolveDashboardView({ killSwitch: false, ready: false, urlView: "my_work", sessionView: "my_work", configuredDefault: "my_work" })).toBe("all_projects");
  });

  it("uses URL, then session, then configured default", () => {
    expect(resolveDashboardView({ killSwitch: false, ready: true, urlView: "all_projects", sessionView: "my_work", configuredDefault: "my_work" })).toBe("all_projects");
    expect(resolveDashboardView({ killSwitch: false, ready: true, sessionView: "all_projects", configuredDefault: "my_work" })).toBe("all_projects");
    expect(resolveDashboardView({ killSwitch: false, ready: true, configuredDefault: "my_work" })).toBe("my_work");
  });
});
