import { describe, expect, it } from "vitest";
import { ROLE_LABELS } from "../../../shared/roles";
import {
  ASSIGNABLE_ROLES,
  ROLE_DESCRIPTION_NOTE,
  ROLE_DESCRIPTIONS,
} from "./roleDescriptions";

describe("role descriptions", () => {
  it("describes every currently assignable role", () => {
    expect(ASSIGNABLE_ROLES).toEqual(["writer", "manager", "admin"]);

    for (const role of ASSIGNABLE_ROLES) {
      const description = ROLE_DESCRIPTIONS[role];
      expect(description.role).toBe(role);
      expect(description.label).toBe(ROLE_LABELS[role]);
      expect(description.summary.trim()).not.toBe("");
      expect(description.capabilities.length).toBeGreaterThanOrEqual(3);
      expect(description.limitations.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("never exposes the stored writer literal as a user-facing role name", () => {
    const copy = ASSIGNABLE_ROLES.flatMap((role) => {
      const description = ROLE_DESCRIPTIONS[role];
      return [
        description.label,
        description.summary,
        ...description.capabilities,
        ...description.limitations,
      ];
    }).join(" ");

    expect(copy).not.toMatch(/\bwriter\b/i);
  });

  it("makes the phased enforcement status explicit", () => {
    expect(ROLE_DESCRIPTION_NOTE).toMatch(/informational/i);
    expect(ROLE_DESCRIPTION_NOTE).toMatch(/server-side enforcement/i);
    expect(ROLE_DESCRIPTION_NOTE).toMatch(/Phase 6/i);
  });

  it("preserves the PSOS-01 capability distinctions", () => {
    expect(ROLE_DESCRIPTIONS.writer.capabilities.join(" ")).toMatch(/current handoff/i);
    expect(ROLE_DESCRIPTIONS.writer.capabilities.join(" ")).toMatch(/outcomes/i);
    expect(ROLE_DESCRIPTIONS.writer.limitations.join(" ")).toMatch(
      /manage users, invites, or roles/i,
    );
    expect(ROLE_DESCRIPTIONS.manager.capabilities.join(" ")).toMatch(/team pipeline/i);
    expect(ROLE_DESCRIPTIONS.manager.capabilities.join(" ")).toMatch(
      /reclassify QA issue severity/i,
    );
    expect(ROLE_DESCRIPTIONS.manager.limitations.join(" ")).toMatch(
      /manage users, invites, or roles/i,
    );
    expect(ROLE_DESCRIPTIONS.admin.capabilities.join(" ")).toMatch(
      /manage users, invites, and roles/i,
    );
  });
});
