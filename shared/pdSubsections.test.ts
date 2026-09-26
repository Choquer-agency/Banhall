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
  it("shortens three Outline labels and keeps every other title (F3)", () => {
    expect(PD_SUBSECTIONS.map((subsection) => pdSubsectionOutlineLabel(subsection.roleId))).toEqual([
      "Company / Context",
      "Goal / Problem",
      "Technological limitations",
      "Technological objectives",
      "Technological uncertainties",
      "Previous-year work",
      "Work plan",
      "Hypothesis",
      "Experimentation / Iterations",
      "Advancement to science / technology",
      "Specific advancements",
      "Project status and next steps",
      "Goal improvements",
    ]);
    // The canonical titles are unchanged for every other use.
    expect(PD_SUBSECTIONS.find((subsection) => subsection.roleId === "prior_year_status")?.title).toBe("Previous-year status");
  });

  it("uses the boards' step subtitles for display and keeps every objective (F3 to F5)", () => {
    expect(pdSubsectionStepSubtitle("company_context", "writing")).toBe("Who the claimant is and where the work happened.");
    expect(pdSubsectionStepSubtitle("company_context", "ready")).toBe(
      "Who the claimant is and the operating context the uncertainty sits in. Pick the seeds that position the project the way you want it written."
    );
    expect(pdSubsectionStepSubtitle("goal_problem", "writing")).toBe(
      "What the project set out to do and the problem that stood in the way."
    );
    expect(pdSubsectionStepSubtitle("goal_problem", "ready")).toBe(
      "What the project set out to do and the problem that stood in the way."
    );
    // Steps the boards do not draw fall back to the objective.
    for (const subsection of PD_SUBSECTIONS.filter((row) => row.roleId !== "company_context" && row.roleId !== "goal_problem")) {
      expect(pdSubsectionStepSubtitle(subsection.roleId, "ready")).toBe(subsection.objective);
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
