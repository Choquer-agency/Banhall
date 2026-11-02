import { describe, expect, it } from "vitest";
import {
  CAPABILITIES,
  CAPABILITY_GROUPS,
  ROLE_CAPABILITY_PRESETS,
  getEffectiveCapabilityLevel,
  hasCapability,
  listCapabilityMatrix,
  type Capability,
  type CapabilityLevel,
  type CapabilityRole,
} from "../../../shared/capabilities";

const roles: CapabilityRole[] = ["writer", "manager", "admin", "financial"];

const expected: Record<Capability, Record<CapabilityRole, CapabilityLevel>> = {
  "project.create": { writer: "all", manager: "all", admin: "all", financial: "none" },
  "project.readInternal": { writer: "all", manager: "all", admin: "all", financial: "none" },
  "project.transferOwnership": { writer: "own", manager: "all", admin: "all", financial: "none" },
  "project.setStage": { writer: "own", manager: "all", admin: "all", financial: "none" },
  "report.editProse": { writer: "own", manager: "all", admin: "all", financial: "none" },
  // 2026-11-02 (client meeting): rule overrides on chat cards.
  "report.overrideRules": { writer: "none", manager: "all", admin: "all", financial: "none" },
  "workItem.create": { writer: "own", manager: "all", admin: "all", financial: "none" },
  "workItem.completeOwn": { writer: "own", manager: "own", admin: "all", financial: "none" },
  "workItem.completeOthers": { writer: "none", manager: "all", admin: "all", financial: "none" },
  "workItem.cancelOrReassign": { writer: "own", manager: "all", admin: "all", financial: "none" },
  "pipeline.view": { writer: "none", manager: "all", admin: "all", financial: "none" },
  "branch.makeActive": { writer: "own", manager: "all", admin: "all", financial: "none" },
  "branch.promote": { writer: "own", manager: "all", admin: "all", financial: "none" },
  "outcome.recordNonDelivery": { writer: "own", manager: "all", admin: "all", financial: "none" },
  "outcome.recordDelivery": { writer: "own", manager: "all", admin: "all", financial: "none" },
  "financial.read": { writer: "none", manager: "all", admin: "all", financial: "none" },
  "financial.write": { writer: "none", manager: "all", admin: "all", financial: "none" },
  "team.view": { writer: "none", manager: "all", admin: "all", financial: "none" },
  "invites.manage": { writer: "none", manager: "all", admin: "all", financial: "none" },
  "roles.manage": { writer: "none", manager: "none", admin: "all", financial: "none" },
  "settings.configure": { writer: "none", manager: "none", admin: "all", financial: "none" },
  "ops.viewAlerts": { writer: "none", manager: "none", admin: "all", financial: "none" },
  "analytics.viewManager": { writer: "none", manager: "all", admin: "all", financial: "none" },
  // Decision "2026-10-26", part 1: company files.
  "companyFiles.read": { writer: "all", manager: "all", admin: "all", financial: "none" },
  "companyFiles.add": { writer: "all", manager: "all", admin: "all", financial: "none" },
  "companyFiles.manage": { writer: "none", manager: "all", admin: "all", financial: "none" },
};

describe("role capability matrix", () => {
  it("matches every approved effective role-by-capability expectation", () => {
    for (const capability of CAPABILITIES) {
      for (const role of roles) {
        expect(getEffectiveCapabilityLevel(role, capability)).toBe(
          expected[capability][role]
        );
      }
    }
  });

  it("defines every role and capability exactly once", () => {
    expect(Object.keys(expected).sort()).toEqual([...CAPABILITIES].sort());
    for (const role of roles) {
      expect(Object.keys(ROLE_CAPABILITY_PRESETS[role]).sort()).toEqual(
        [...CAPABILITIES].sort()
      );
    }
    const grouped = CAPABILITY_GROUPS.flatMap((group) => group.capabilities);
    expect(grouped.sort()).toEqual([...CAPABILITIES].sort());
    expect(listCapabilityMatrix().flatMap((group) => group.rows)).toHaveLength(
      CAPABILITIES.length
    );
  });

  it("keeps planned Financial permissions visible but runtime-denied", () => {
    expect(ROLE_CAPABILITY_PRESETS.financial["financial.read"].planned).toEqual({
      level: "all",
    });
    expect(ROLE_CAPABILITY_PRESETS.financial["project.readInternal"].planned?.level).toBe(
      "read"
    );
    expect(hasCapability("financial", "financial.read")).toBe(false);
    expect(hasCapability(undefined, "project.readInternal")).toBe(false);
  });

  it("preserves broad internal project visibility for current stored roles", () => {
    expect(hasCapability("writer", "project.readInternal")).toBe(true);
    expect(hasCapability("manager", "project.readInternal")).toBe(true);
    expect(hasCapability("admin", "project.readInternal")).toBe(true);
  });
});

describe("company file quotes in drafts (Phase C review 2, 2026-10-26)", () => {
  it("every role that may read a project's drafts may also read company files", () => {
    // Seed and Summary provenance and Brief entry text show company file
    // quotes to anyone who may read the draft; only file names and Brief
    // quotes are hidden without companyFiles.read. A role that may read
    // drafts but not company files needs those hidden first.
    for (const role of roles) {
      if (getEffectiveCapabilityLevel(role, "project.readInternal") !== "none") {
        expect(hasCapability(role, "companyFiles.read"), role).toBe(true);
      }
    }
  });
});
