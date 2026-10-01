import type { PdSection } from "../../../../shared/pdSubsections";

/** Reader-facing titles of the three PD Sections (ui-design-final.md
 * sections 4 and 6): the serif title under the mono "Section 242" eyebrow. */
export const PD_SECTION_TITLES: Record<PdSection, string> = {
  s242: "Technological uncertainty",
  s244: "Work performed",
  s246: "Technological advancement",
};

/** "242" for "s242". */
export function pdSectionNumber(section: PdSection): string {
  return section.slice(1);
}

/** A step's serif heading in the plan (boards 3.1 and 3.2): the Outline's
 * "Company / Context" reads "Company and context" as a title. */
export function stepHeadingTitle(title: string): string {
  return title.replace(/ \/ (\S)/g, (_, first: string) => ` and ${first.toLowerCase()}`);
}
