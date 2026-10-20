/**
 * Research presets (chat parity Phase C, W3, 2026-10-20). "Vet against
 * public sources" is the client's 2026-10-16 idea: check a passage's general
 * statements against public sources. The server builds its instruction from
 * the fixed text below; the client sends only the preset and any words of
 * the writer's own, which go through the same redaction as any research
 * instruction.
 */

export type ResearchPreset = "vet";

export const VET_LABEL = "Vet against public sources";

export const VET_INSTRUCTION =
  "Check each general statement in the selected passage against public sources: CRA SR&ED guidance, standards bodies and common technical knowledge. " +
  "For each one, say whether it is supported, qualified, contradicted or not found, and cite the source. " +
  "Flag every statement that is unsupported or contradicted. " +
  "Statements about what this company did, built, tested or found cannot be checked in public sources: mark them as such and do not search for them. " +
  "Never search for the company, its people, its products or this project. " +
  "Propose new wording only to correct a general statement that is contradicted or overstated.";

/** Joins the fixed instruction and the writer's own words, when any. */
export const VET_NOTE_SEPARATOR = "\n\nThe writer also asks: ";

/**
 * A research instruction's limit (`MAX_INSTRUCTION` in
 * convex/ai/research/core.ts; a test keeps them equal).
 */
export const RESEARCH_INSTRUCTION_MAX_CHARS = 2_000;

/**
 * The writer's note on a vet: what the fixed instruction leaves of the
 * research instruction's limit (review R2 P3-7). The composer counts
 * against it and the server names it.
 */
export const VET_NOTE_MAX_CHARS =
  RESEARCH_INSTRUCTION_MAX_CHARS - VET_INSTRUCTION.length - VET_NOTE_SEPARATOR.length;

/** The server's refusal of a note over VET_NOTE_MAX_CHARS. */
export function vetNoteTooLongMessage(): string {
  return `Your note can be up to ${VET_NOTE_MAX_CHARS.toLocaleString("en-US")} characters.`;
}

/** The instruction a vet session runs with. */
export function vetInstruction(writerNote: string): string {
  const note = writerNote.trim();
  return note ? `${VET_INSTRUCTION}${VET_NOTE_SEPARATOR}${note}` : VET_INSTRUCTION;
}

/** The writer's own words in a stored vet instruction ("" when none). */
export function vetWriterNote(instruction: string): string {
  if (!instruction.startsWith(VET_INSTRUCTION)) return "";
  const rest = instruction.slice(VET_INSTRUCTION.length);
  return rest.startsWith(VET_NOTE_SEPARATOR) ? rest.slice(VET_NOTE_SEPARATOR.length).trim() : "";
}
