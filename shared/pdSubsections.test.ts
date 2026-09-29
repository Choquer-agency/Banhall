import { describe, expect, it } from "vitest";
import {
  QA_PROMPT_BRANCHES,
  buildSection242SystemPrompt,
  buildSection244SystemPrompt,
  buildSection246SystemPrompt,
} from "../convex/ai/prompts";
import { SEED_TAGS } from "../convex/lib/seedContract";
import {
  PD_SUBSECTIONS,
  SEED_TAG_DISPLAY_LABELS,
  pdSubsectionOutlineLabel,
  pdSubsectionStepSubtitle,
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
  it("gives every step a short name for the Outline and notices, and keeps every title (2026-09-29)", () => {
    expect(PD_SUBSECTIONS.map((subsection) => pdSubsectionOutlineLabel(subsection.roleId))).toEqual([
      "Company / Context",
      "Goal / Problem",
      "Limitations",
      "Objectives",
      "Uncertainties",
      "Previous year",
      "Work plan",
      "Hypothesis",
      "Experiments",
      "Overall advancement",
      "Specific advancements",
      "Status and next steps",
      "Goal improvements",
    ]);
    // No two steps share a name.
    const labels = PD_SUBSECTIONS.map((subsection) => pdSubsectionOutlineLabel(subsection.roleId));
    expect(new Set(labels).size).toBe(labels.length);
    // The canonical titles are unchanged for every other use.
    expect(PD_SUBSECTIONS.find((subsection) => subsection.roleId === "prior_year_status")?.title).toBe("Previous-year status");
    expect(PD_SUBSECTIONS.find((subsection) => subsection.roleId === "experimentation")?.title).toBe("Experimentation / Iterations");
  });

  it("uses a short subtitle for every step and keeps every objective (2026-09-29)", () => {
    expect(pdSubsectionStepSubtitle("company_context")).toBe("Who the claimant is and where the work happened.");
    expect(pdSubsectionStepSubtitle("goal_problem")).toBe("What the project set out to do, and what stood in the way.");
    expect(pdSubsectionStepSubtitle("passive_limitations")).toBe("Where existing knowledge and standard practice fell short.");
    for (const subsection of PD_SUBSECTIONS) {
      const subtitle = pdSubsectionStepSubtitle(subsection.roleId);
      expect(subtitle.length).toBeGreaterThan(0);
      // Shorter than the objective it stands in for, in plain hyphens only.
      expect(subtitle.length).toBeLessThan(subsection.objective.length);
      expect(subtitle).not.toMatch(/[\u2013\u2014]/);
    }
    // The objectives that feed prompts, QA and the Summary are unchanged.
    expect(PD_SUBSECTIONS[0].objective).toBe(
      "Establish the company's relevant domain expertise and operating context for the project."
    );
    expect(PD_SUBSECTIONS[1].objective).toBe(
      "State the physical or practical product, process, or system the company sought to create or improve."
    );
  });

  it("provides display labels for the closed seed tag vocabulary", () => {
    expect(SEED_TAG_DISPLAY_LABELS).toEqual({
      conservative: "Conservative",
      aggressive: "Aggressive",
      high_level: "High level",
      detailed: "Detailed",
      technical: "Technical",
      alternative_angle: "Alternative angle",
    });
    expect(Object.keys(SEED_TAG_DISPLAY_LABELS)).toEqual([...SEED_TAGS]);
  });

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
