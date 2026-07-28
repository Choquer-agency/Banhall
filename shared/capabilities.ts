import type { Role } from "./roles";

export const CAPABILITIES = [
  "project.create",
  "project.readInternal",
  "project.transferOwnership",
  "project.setStage",
  "report.editProse",
  "workItem.create",
  "workItem.completeOwn",
  "workItem.completeOthers",
  "workItem.cancelOrReassign",
  "pipeline.view",
  "branch.makeActive",
  "branch.promote",
  "outcome.recordNonDelivery",
  "outcome.recordDelivery",
  "financial.read",
  "financial.write",
  "roles.manage",
  "settings.configure",
  "ops.viewAlerts",
  "analytics.viewManager",
] as const;

export type Capability = (typeof CAPABILITIES)[number];
export type CapabilityRole = Role | "financial";
export type CapabilityLevel = "none" | "own" | "all";

export type CapabilityCell = {
  level: CapabilityLevel;
  note?: string;
  planned?: {
    level: CapabilityLevel | "read";
    note?: string;
  };
};

type CapabilityPreset = Record<Capability, CapabilityCell>;

const none = { level: "none" } as const;
const own = { level: "own" } as const;
const all = { level: "all" } as const;

/**
 * Single declarative source for the approved product-domain capability matrix.
 * Planned Financial cells remain runtime-denied until PSOS-28 widens the role
 * schema and explicitly activates them. Project visibility remains broad under
 * decision D1; PSOS-30 owns any membership-based change.
 */
export const ROLE_CAPABILITY_PRESETS: Record<CapabilityRole, CapabilityPreset> = {
  writer: {
    "project.create": all,
    "project.readInternal": all,
    "project.transferOwnership": own,
    "project.setStage": own,
    "report.editProse": own,
    "workItem.create": own,
    "workItem.completeOwn": own,
    "workItem.completeOthers": none,
    "workItem.cancelOrReassign": own,
    "pipeline.view": none,
    "branch.makeActive": own,
    "branch.promote": own,
    "outcome.recordNonDelivery": own,
    "outcome.recordDelivery": own,
    "financial.read": none,
    "financial.write": none,
    "roles.manage": none,
    "settings.configure": none,
    "ops.viewAlerts": none,
    "analytics.viewManager": none,
  },
  manager: {
    "project.create": all,
    "project.readInternal": all,
    "project.transferOwnership": all,
    "project.setStage": all,
    "report.editProse": all,
    "workItem.create": all,
    "workItem.completeOwn": own,
    "workItem.completeOthers": all,
    "workItem.cancelOrReassign": all,
    "pipeline.view": all,
    "branch.makeActive": all,
    "branch.promote": all,
    "outcome.recordNonDelivery": all,
    "outcome.recordDelivery": all,
    "financial.read": all,
    "financial.write": all,
    "roles.manage": none,
    "settings.configure": none,
    "ops.viewAlerts": none,
    "analytics.viewManager": all,
  },
  admin: Object.fromEntries(CAPABILITIES.map((capability) => [capability, all])) as CapabilityPreset,
  financial: {
    "project.create": none,
    "project.readInternal": {
      level: "none",
      planned: {
        level: "read",
        note: "Only project context required for linked financial work.",
      },
    },
    "project.transferOwnership": none,
    "project.setStage": {
      level: "none",
      planned: {
        level: "own",
        note: "Financial-stage operations only if introduced later.",
      },
    },
    "report.editProse": none,
    "workItem.create": {
      level: "none",
      planned: { level: "own", note: "Financial work items only." },
    },
    "workItem.completeOwn": {
      level: "none",
      planned: { level: "own", note: "Financial work items only." },
    },
    "workItem.completeOthers": none,
    "workItem.cancelOrReassign": {
      level: "none",
      planned: { level: "own", note: "Financial work items assigned by them." },
    },
    "pipeline.view": none,
    "branch.makeActive": none,
    "branch.promote": none,
    "outcome.recordNonDelivery": none,
    "outcome.recordDelivery": {
      level: "none",
      planned: {
        level: "own",
        note: "Used-in-filing outcomes only if explicitly granted.",
      },
    },
    "financial.read": {
      level: "none",
      planned: { level: "all" },
    },
    "financial.write": {
      level: "none",
      planned: { level: "all" },
    },
    "roles.manage": none,
    "settings.configure": none,
    "ops.viewAlerts": none,
    "analytics.viewManager": none,
  },
};

export const CAPABILITY_GROUPS = [
  {
    id: "projects",
    label: "Projects",
    capabilities: [
      "project.create",
      "project.readInternal",
      "project.transferOwnership",
      "project.setStage",
      "report.editProse",
      "pipeline.view",
    ],
  },
  {
    id: "work-items",
    label: "Work items",
    capabilities: [
      "workItem.create",
      "workItem.completeOwn",
      "workItem.completeOthers",
      "workItem.cancelOrReassign",
    ],
  },
  {
    id: "branches-outcomes",
    label: "Branches and outcomes",
    capabilities: [
      "branch.makeActive",
      "branch.promote",
      "outcome.recordNonDelivery",
      "outcome.recordDelivery",
    ],
  },
  {
    id: "financial",
    label: "Financial",
    capabilities: ["financial.read", "financial.write"],
  },
  {
    id: "administration",
    label: "Administration",
    capabilities: [
      "roles.manage",
      "settings.configure",
      "ops.viewAlerts",
      "analytics.viewManager",
    ],
  },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  capabilities: readonly Capability[];
}>;

export function getCapabilityCell(
  role: CapabilityRole | null | undefined,
  capability: Capability
): CapabilityCell {
  if (!role) return none;
  return ROLE_CAPABILITY_PRESETS[role][capability];
}

export function getEffectiveCapabilityLevel(
  role: CapabilityRole | null | undefined,
  capability: Capability
): CapabilityLevel {
  return getCapabilityCell(role, capability).level;
}

export function hasCapability(
  role: CapabilityRole | null | undefined,
  capability: Capability
) {
  return getEffectiveCapabilityLevel(role, capability) !== "none";
}

export function listCapabilityMatrix() {
  return CAPABILITY_GROUPS.map((group) => ({
    ...group,
    rows: group.capabilities.map((capability) => ({
      capability,
      writer: ROLE_CAPABILITY_PRESETS.writer[capability],
      manager: ROLE_CAPABILITY_PRESETS.manager[capability],
      admin: ROLE_CAPABILITY_PRESETS.admin[capability],
      financial: ROLE_CAPABILITY_PRESETS.financial[capability],
    })),
  }));
}
