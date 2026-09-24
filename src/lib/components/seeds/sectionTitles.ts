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
