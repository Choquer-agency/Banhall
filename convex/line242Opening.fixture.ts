import { PD_SUBSECTIONS } from "../shared/pdSubsections";
import { COMPRESSION_KEEPS_PLAIN_OPENING } from "./ai/promptDefinitions";
import {
  ANALYZER_COMPANY_AND_GOAL_CATEGORIES,
  QA_LINE_242_OPENING_CHECK,
  SECTION_242_OPENING_RULES,
} from "./ai/prompts";

/**
 * 2026-10-19 (owner approved, client meeting of 2026-10-16): Line 242 opens
 * with one plain sentence on who the company is, then the project's business
 * goal in plain words, then the context that makes the SR&ED work credible.
 * The texts below are what every request sent before that change; pinned
 * request bodies were captured with them.
 */
export const PINNED_SECTION_242_OPENING_RULES = `**COMPANY/CONTEXT:**
This paragraph is NOT a company bio. It must establish WHY this company has the domain expertise and operational context that makes this SR&ED project credible. Every sentence must connect to the project.

BAD example (generic company description):
"GreenStem Nurseries is a BC-based nursery with 15 years of experience cultivating over 200 species of native trees for municipalities and conservation agencies."

GOOD example (context that sets up the SR&ED argument):
"GreenStem Nurseries operates a 25-acre multi-zone greenhouse facility in BC's Fraser Valley, cultivating over 200 native tree and specialty plant species from seed to maturity. The company's 15-year operational history managing biologically dynamic inventory; where individual plants continuously change in size, value, and developmental category; has produced direct knowledge of the limitations of existing inventory tracking methods for living stock."

The difference: every detail in the good version serves the SR&ED argument. Do NOT list customers, markets served, or general capabilities.

**GOAL/PROBLEM:**
Describe the company's goal. This can be high-level. This is the project goal; the creation of new, or improvement to existing, materials, devices, products, or processes. Describe the actual thing they are trying to build or improve. This is NOT the SR&ED criteria; it is the physical or practical objective.`;

export const PINNED_ANALYZER_COMPANY_AND_GOAL_CATEGORIES = `1. **company_context**: Background about the company, their industry, domain expertise. Only include context relevant to the SR&ED project.

2. **project_goal**: The high-level goal; what they are trying to build, create, or improve. This is the physical product, process, or system itself.`;

export const PINNED_COMPANY_CONTEXT_OBJECTIVE =
  "Establish the company's relevant domain expertise and operating context for the project.";
export const PINNED_GOAL_PROBLEM_OBJECTIVE =
  "State the physical or practical product, process, or system the company sought to create or improve.";

const inJson = (text: string) => JSON.stringify(text).slice(1, -1);

function objectiveOf(roleId: "company_context" | "goal_problem"): string {
  const role = PD_SUBSECTIONS.find((row) => row.roleId === roleId);
  if (!role) throw new Error(`No role ${roleId}`);
  return role.objective;
}

/**
 * A request body as JSON text with the 2026-10-19 texts put back to the
 * pinned ones: the Line 242 opening rules (drafting and repair), the
 * analyzer's company and goal categories, the Company / Context and Goal /
 * Problem objectives (Seed requests), the QA line on the plain opening and
 * the shortening rule that keeps it. These are the only bytes the change
 * moved in any request.
 */
export function withPinnedLine242Opening(body: string): string {
  const swaps: Array<[string, string]> = [
    [SECTION_242_OPENING_RULES, PINNED_SECTION_242_OPENING_RULES],
    [ANALYZER_COMPANY_AND_GOAL_CATEGORIES, PINNED_ANALYZER_COMPANY_AND_GOAL_CATEGORIES],
    [objectiveOf("company_context"), PINNED_COMPANY_CONTEXT_OBJECTIVE],
    [objectiveOf("goal_problem"), PINNED_GOAL_PROBLEM_OBJECTIVE],
    [`\n${QA_LINE_242_OPENING_CHECK}`, ""],
    [COMPRESSION_KEEPS_PLAIN_OPENING, ""],
  ];
  return swaps.reduce((text, [now, pinned]) => text.split(inJson(now)).join(inJson(pinned)), body);
}
