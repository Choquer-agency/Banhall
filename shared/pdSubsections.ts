export type PdSection = "s242" | "s244" | "s246";
export type PdSubsectionKind = "standard" | "optional" | "multiple";

export const SEED_TAG_DISPLAY_LABELS = {
  conservative: "Conservative",
  aggressive: "Aggressive",
  high_level: "High level",
  detailed: "Detailed",
  technical: "Technical",
  alternative_angle: "Alternative angle",
} as const;

type PdSubsectionDefinition = {
  readonly roleId: string;
  readonly section: PdSection;
  readonly order: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;
  readonly kind: PdSubsectionKind;
  readonly title: string;
  readonly objective: string;
};

/**
 * The canonical ordered vocabulary for the thirteen content roles in a PD.
 * A Subsection is a planning role only. Its title never becomes a report
 * heading, and `order` is its sole predecessor/successor relation.
 */
export const PD_SUBSECTIONS = [
  {
    roleId: "company_context",
    section: "s242",
    order: 1,
    kind: "standard",
    title: "Company / Context",
    objective:
      "Establish the company's relevant domain expertise and operating context for the project.",
  },
  {
    roleId: "goal_problem",
    section: "s242",
    order: 2,
    kind: "standard",
    title: "Goal / Problem",
    objective:
      "State the physical or practical product, process, or system the company sought to create or improve.",
  },
  {
    roleId: "passive_limitations",
    section: "s242",
    order: 3,
    kind: "standard",
    title: "Technological limitations",
    objective:
      "Explain the limitations in existing technological knowledge or standard practice that existed before a solution was chosen.",
  },
  {
    roleId: "technological_objective",
    section: "s242",
    order: 4,
    kind: "standard",
    title: "Technological objectives",
    objective:
      "State the new knowledge sought and the technological solution that knowledge was intended to enable.",
  },
  {
    roleId: "active_uncertainties",
    section: "s242",
    order: 5,
    kind: "standard",
    title: "Technological uncertainties",
    objective:
      "Frame the open questions specific to the chosen approach and explain why each outcome was uncertain.",
  },
  {
    roleId: "prior_year_status",
    section: "s244",
    order: 6,
    kind: "optional",
    title: "Previous-year status",
    objective:
      "For a continuing project, describe its status at the end of the prior year and the uncertainties that remained.",
  },
  {
    roleId: "workplan",
    section: "s244",
    order: 7,
    kind: "optional",
    title: "Work plan",
    objective:
      "Describe the planned systematic approaches and steps used to address the technological uncertainties.",
  },
  {
    roleId: "hypothesis",
    section: "s244",
    order: 8,
    kind: "standard",
    title: "Hypothesis",
    objective:
      "State a specific, testable, and measurable hypothesis in if/then form.",
  },
  {
    roleId: "experimentation",
    section: "s244",
    order: 9,
    kind: "multiple",
    title: "Experimentation / Iterations",
    objective:
      "Describe each supported experiment or iteration as a problem, attempt, finding, adaptation, and conclusion.",
  },
  {
    roleId: "overall_advancement",
    section: "s246",
    order: 10,
    kind: "standard",
    title: "Advancement to science / technology",
    objective:
      "Summarize the overall advancement and the extent to which the technological objective and hypothesis were achieved.",
  },
  {
    roleId: "specific_advancements",
    section: "s246",
    order: 11,
    kind: "multiple",
    title: "Specific technological advancements",
    objective:
      "State the technological knowledge gained for each resolved uncertainty.",
  },
  {
    roleId: "project_status",
    section: "s246",
    order: 12,
    kind: "standard",
    title: "Project status and next steps",
    objective:
      "Describe the project's current status, remaining uncertainties, and next steps.",
  },
  {
    roleId: "goal_improvements",
    section: "s246",
    order: 13,
    kind: "standard",
    title: "Overall company / project goal improvements",
    objective:
      "Connect the knowledge gained to the original project goal and the resulting product or process improvements.",
  },
] as const satisfies readonly PdSubsectionDefinition[];

export type PdSubsection = (typeof PD_SUBSECTIONS)[number];
export type PdSubsectionRoleId = PdSubsection["roleId"];

/**
 * Display headings for the three report Sections in the Step-by-step writing
 * view (ui-design-final.md section 6): the small sans label ("242 Technological
 * uncertainty") and the serif question. Presentation only; the report's own
 * Line headings stay as buildTiptapDocument writes them.
 */
export const PD_SECTION_HEADINGS = {
  s242: {
    number: "242",
    title: "Technological uncertainty",
    question: "What scientific or technological uncertainties did you attempt to overcome?",
  },
  s244: {
    number: "244",
    title: "Work performed",
    question: "What work did you perform to overcome these uncertainties?",
  },
  s246: {
    number: "246",
    title: "Technological advancement",
    question: "What scientific or technological advancements did you achieve?",
  },
} as const satisfies Record<
  PdSection,
  { number: string; title: string; question: string }
>;

type RoleAudience = "draft" | "qa" | "chat" | "qaScan";

const ROLE_LANGUAGE = {
  company_context: {
    draft: "company context",
    qa: "company/context",
    chat: "company context",
    qaScan: "company/context",
  },
  goal_problem: {
    draft: "goal/problem",
    qa: "goal/problem",
    chat: "goal/problem",
    qaScan: "goal/problem",
  },
  passive_limitations: {
    draft: "limitations of standard practice (passive uncertainties)",
    qa: "passive uncertainties (limitations of standard practice)",
    chat: "passive uncertainties",
    qaScan: "passive uncertainties",
  },
  technological_objective: {
    draft: "technological objective",
    qa: "technological objective",
    chat: "technological objective",
    qaScan: "technological objective",
  },
  active_uncertainties: {
    draft: "active uncertainties",
    qa: "active uncertainties",
    chat: "active uncertainties",
    qaScan: "active uncertainties",
  },
  prior_year_status: {
    draft: "prior-year status (only for a continuing project)",
    qa: "prior-year status (continuing projects only)",
    chat: "optional prior-year status",
    qaScan: "prior-year status",
  },
  workplan: {
    draft: "workplan",
    qa: "workplan",
    chat: "workplan",
    qaScan: "workplan",
  },
  hypothesis: {
    draft: "hypothesis",
    qa: "hypothesis",
    chat: "hypothesis",
    qaScan: "hypothesis",
  },
  experimentation: {
    draft: "experimentation/iterations",
    qa: "experimentation/iterations",
    chat: "experimentation/iterations",
    qaScan: "experimentation/iterations",
  },
  overall_advancement: {
    draft: "overall advancement to science/technology",
    qa: "overall advancement",
    chat: "overall advancement",
    qaScan: "overall advancement",
  },
  specific_advancements: {
    draft:
      "the specific technological advancements (one per resolved uncertainty)",
    qa: "the specific advancements (one per resolved uncertainty)",
    chat: "specific advancements",
    qaScan: "specific advancements",
  },
  project_status: {
    draft: "project status and next steps",
    qa: "project status and next steps",
    chat: "project status/next steps",
    qaScan: "project-status",
  },
  goal_improvements: {
    draft: "project goal and improvements",
    qa: "project goal and improvements",
    chat: "goal/improvements",
    qaScan: "project-goal",
  },
} satisfies Record<
  PdSubsectionRoleId,
  Readonly<Record<RoleAudience, string>>
>;

export function pdSubsectionsForSection(
  section: PdSection
): readonly PdSubsection[] {
  return PD_SUBSECTIONS.filter((subsection) => subsection.section === section);
}

export function pdSubsectionRoleLabel(
  roleId: PdSubsectionRoleId,
  audience: RoleAudience
): string {
  return ROLE_LANGUAGE[roleId][audience];
}

export function pdSubsectionRoleList(
  section: PdSection,
  audience: RoleAudience,
  separator = ", "
): string {
  return pdSubsectionsForSection(section)
    .map((subsection) => pdSubsectionRoleLabel(subsection.roleId, audience))
    .join(separator);
}
