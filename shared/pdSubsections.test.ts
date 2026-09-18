import { describe, expect, it } from "vitest";
import {
  QA_PROMPT_BRANCHES,
  buildSection242SystemPrompt,
  buildSection244SystemPrompt,
  buildSection246SystemPrompt,
} from "../convex/ai/prompts";
import {
  PD_SUBSECTIONS,
  pdSubsectionRoleList,
  pdSubsectionsForSection,
} from "./pdSubsections";

const EXPECTED_SUBSECTIONS = [
  [1, "s242", "company_context", "Company / Context", "standard"],
  [2, "s242", "goal_problem", "Goal / Problem", "standard"],
  [
    3,
    "s242",
    "passive_limitations",
    "Technological limitations",
    "standard",
  ],
  [
    4,
    "s242",
    "technological_objective",
    "Technological objectives",
    "standard",
  ],
  [
    5,
    "s242",
    "active_uncertainties",
    "Technological uncertainties",
    "standard",
  ],
  [6, "s244", "prior_year_status", "Previous-year status", "optional"],
  [7, "s244", "workplan", "Work plan", "optional"],
  [8, "s244", "hypothesis", "Hypothesis", "standard"],
  [
    9,
    "s244",
    "experimentation",
    "Experimentation / Iterations",
    "multiple",
  ],
  [
    10,
    "s246",
    "overall_advancement",
    "Advancement to science / technology",
    "standard",
  ],
  [
    11,
    "s246",
    "specific_advancements",
    "Specific technological advancements",
    "multiple",
  ],
  [
    12,
    "s246",
    "project_status",
    "Project status and next steps",
    "standard",
  ],
  [
    13,
    "s246",
    "goal_improvements",
    "Overall company / project goal improvements",
    "standard",
  ],
] as const;

describe("PD_SUBSECTIONS", () => {
  it("matches the canonical role, display-title, section, order, and kind bijection", () => {
    expect(
      PD_SUBSECTIONS.map(({ order, section, roleId, title, kind }) => [
        order,
        section,
        roleId,
        title,
        kind,
      ])
    ).toEqual(EXPECTED_SUBSECTIONS);
    expect(new Set(PD_SUBSECTIONS.map(({ roleId }) => roleId)).size).toBe(13);
    expect(PD_SUBSECTIONS.every(({ objective }) => objective.length > 0)).toBe(
      true
    );
  });

  it("projects the same ordered roles into every section prompt and QA", () => {
    const sectionPrompts = {
      s242: buildSection242SystemPrompt(),
      s244: buildSection244SystemPrompt(),
      s246: buildSection246SystemPrompt(),
    } as const;

    for (const section of ["s242", "s244", "s246"] as const) {
      expect(sectionPrompts[section]).toContain(
        pdSubsectionRoleList(section, "draft")
      );
      expect(QA_PROMPT_BRANCHES.structureCompliance.default).toContain(
        pdSubsectionRoleList(section, "qa")
      );
      expect(pdSubsectionsForSection(section).map(({ order }) => order)).toEqual(
        PD_SUBSECTIONS.filter((subsection) => subsection.section === section).map(
          ({ order }) => order
        )
      );
    }
  });
});
