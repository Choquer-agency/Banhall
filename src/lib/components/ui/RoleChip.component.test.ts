import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import RoleChip from "./RoleChip.svelte";

const chip = () => document.body.querySelector<HTMLElement>("[data-role-chip]");

// Round 2 HANDOFF "Role chips": fill / text per chip.
const COLOURS = {
  owner: ["rgb(201, 237, 231)", "rgb(6, 95, 91)", "Owner"],
  admin: ["rgb(219, 234, 254)", "rgb(29, 78, 216)", "Admin"],
  manager: ["rgb(207, 250, 254)", "rgb(14, 116, 144)", "Manager"],
  consultant: ["rgb(221, 230, 228)", "rgb(51, 66, 63)", "Consultant"],
  developer: ["rgb(237, 227, 255)", "rgb(109, 40, 217)", "Developer"],
} as const;

describe("RoleChip", () => {
  it("renders every chip with its label and colour pair", async () => {
    for (const [kind, [background, color, text]] of Object.entries(COLOURS)) {
      const view = await render(RoleChip, { kind: kind as keyof typeof COLOURS });
      const element = chip()!;
      expect(element.dataset.roleChip).toBe(kind);
      expect(element.textContent?.trim()).toBe(text);
      expect(getComputedStyle(element).backgroundColor).toBe(background);
      expect(getComputedStyle(element).color).toBe(color);
      view.unmount();
    }
  });

  it("shows the stored writer role as Consultant", async () => {
    await render(RoleChip, { role: "writer" });
    expect(chip()?.dataset.roleChip).toBe("consultant");
    expect(chip()?.textContent?.trim()).toBe("Consultant");
  });

  it("lets the Developer and Owner display flags win over the role", async () => {
    const owner = await render(RoleChip, { role: "admin", isOwner: true });
    expect(chip()?.textContent?.trim()).toBe("Owner");
    owner.unmount();

    await render(RoleChip, { role: "admin", isOwner: true, isDeveloper: true });
    expect(chip()?.textContent?.trim()).toBe("Developer");
  });

  it("is 20px tall with a 5px radius and 12px/500 text by default", async () => {
    await render(RoleChip, { role: "manager" });
    const style = getComputedStyle(chip()!);
    expect(chip()!.getBoundingClientRect().height).toBe(20);
    expect(style.borderRadius).toBe("5px");
    expect(style.fontSize).toBe("12px");
    expect(style.fontWeight).toBe("500");
  });

  it("has a 16px rail identity size", async () => {
    await render(RoleChip, { role: "writer", size: "sm" });
    const style = getComputedStyle(chip()!);
    expect(chip()!.getBoundingClientRect().height).toBe(16);
    expect(style.borderRadius).toBe("4px");
    expect(style.fontSize).toBe("10px");
    expect(style.fontWeight).toBe("500");
  });

  it("renders nothing without a role or flag", async () => {
    await render(RoleChip, {});
    expect(chip()).toBeNull();
  });
});
