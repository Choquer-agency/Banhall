import { describe, expect, it } from "vitest";
import { ROLE_CHIP_LABELS, roleChipKind } from "./roleChip";

describe("roleChipKind", () => {
  it("maps each stored role to its chip, showing writer as Consultant", () => {
    expect(roleChipKind({ role: "writer" })).toBe("consultant");
    expect(roleChipKind({ role: "manager" })).toBe("manager");
    expect(roleChipKind({ role: "admin" })).toBe("admin");
    expect(ROLE_CHIP_LABELS[roleChipKind({ role: "writer" })!]).toBe("Consultant");
  });

  it("lets the display flags win over the role, Developer before Owner", () => {
    expect(roleChipKind({ role: "admin", isOwner: true })).toBe("owner");
    expect(roleChipKind({ role: "admin", isDeveloper: true })).toBe("developer");
    expect(roleChipKind({ role: "writer", isOwner: true, isDeveloper: true })).toBe("developer");
  });

  it("returns null when there is nothing to show", () => {
    expect(roleChipKind({})).toBeNull();
    expect(roleChipKind({ role: null, isOwner: false, isDeveloper: false })).toBeNull();
  });
});
