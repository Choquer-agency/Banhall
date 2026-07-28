import { ROLE_LABELS, type Role } from "../../../shared/roles";

export interface RoleDescription {
  role: Role;
  label: string;
  summary: string;
  capabilities: readonly string[];
  limitations: readonly string[];
}

export const ASSIGNABLE_ROLES = ["writer", "manager", "admin"] as const satisfies readonly Role[];

export const ROLE_DESCRIPTIONS: Record<Role, RoleDescription> = {
  writer: {
    role: "writer",
    label: ROLE_LABELS.writer,
    summary:
      "Consultants create projects and produce reports for the projects they own or are assigned to.",
    capabilities: [
      "Create projects and read internal projects across the workspace under the current visibility policy.",
      "Edit report prose on their own projects and in assigned collaboration contexts.",
      "Move their own projects through permitted workflow stages, including when they hold the current handoff, and transfer ownership to an eligible Consultant or Manager.",
      "Create work items for their own projects, complete work assigned to them, and cancel or reassign items they assigned or that belong to their projects.",
      "Make or promote report branches for their own projects, subject to readiness rules.",
      "Record delivery and non-delivery outcomes for their own projects, with an exact revision required for delivery or filing.",
      "Vote and comment on QA observations.",
    ],
    limitations: [
      "Cannot view the team pipeline or complete another user's work item.",
      "Cannot reclassify QA issue severity.",
      "Cannot access financial data by default.",
      "Cannot manage users, invites, or roles.",
      "Cannot configure models, tags, Brain, or global settings.",
    ],
  },
  manager: {
    role: "manager",
    label: ROLE_LABELS.manager,
    summary:
      "Managers can work across all projects and oversee the team's production workflow.",
    capabilities: [
      "Use Consultant project, report, workflow, branch, and outcome capabilities across all projects.",
      "Transfer project ownership and change workflow stages across the workspace.",
      "Create, reassign, cancel, or administratively complete work items, with audit notes where required.",
      "View the team pipeline and reclassify QA issue severity.",
      "Read and write financial data.",
    ],
    limitations: [
      "Cannot manage users, invites, or roles.",
      "Cannot configure models, tags, Brain, or global settings.",
      "Cannot view operational alerts or usage administration except where manager analytics are explicitly granted.",
    ],
  },
  admin: {
    role: "admin",
    label: ROLE_LABELS.admin,
    summary:
      "Admins have full internal workspace control, including user and system administration.",
    capabilities: [
      "Use all Manager capabilities across the workspace.",
      "Manage users, invites, and roles.",
      "Configure models, tags, Brain, and global settings.",
      "View operational alerts and usage administration.",
    ],
    limitations: ["No additional restrictions within the authenticated internal workspace."],
  },
};

export const ROLE_DESCRIPTION_NOTE =
  "Workflow, assignment, branch, and delivery capabilities become available as those features roll out. These descriptions are informational; full server-side enforcement of this matrix arrives with capability hardening in Phase 6.";
