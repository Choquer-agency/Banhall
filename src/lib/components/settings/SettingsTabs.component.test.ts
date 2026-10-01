import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import SettingsTabs from "./SettingsTabs.svelte";

const tabs = [
  { key: "account", label: "Account", href: "/settings/account" },
  { key: "writing", label: "Writing preferences", href: "/settings/writing" },
  { key: "notifications", label: "Notifications", href: "/settings/notifications" },
  { key: "shortcuts", label: "Keyboard shortcuts", href: "/settings/shortcuts" },
];

describe("SettingsTabs (I1 to I5)", () => {
  it("renders link tabs with the active one filled and aria-current", async () => {
    await render(SettingsTabs, { tabs, activeKey: "notifications" });
    const bar = document.querySelector<HTMLElement>("[data-settings-tabs]")!;
    expect(getComputedStyle(bar).backgroundColor).toBe("rgb(234, 242, 241)");
    expect(getComputedStyle(bar).borderRadius).toBe("10px");
    const links = Array.from(bar.querySelectorAll<HTMLAnchorElement>("a"));
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual(
      tabs.map((tab) => [tab.label, tab.href])
    );
    const active = links[2];
    expect(active.getAttribute("aria-current")).toBe("page");
    expect(getComputedStyle(active).backgroundColor).toBe("rgb(8, 122, 117)");
    expect(getComputedStyle(active).color).toBe("rgb(255, 255, 255)");
    expect(getComputedStyle(active).fontWeight).toBe("500");
    expect(active.getBoundingClientRect().height).toBe(30);
    expect(links[0].getAttribute("aria-current")).toBeNull();
    expect(links[0].className).toContain("hover:bg-primary-wash");
  });
});
