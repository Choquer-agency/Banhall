/**
 * CAP-1: de-identification before firm-wide knowledge.
 *
 * Client prose reaches firm-wide surfaces (Brain exemplars, learning digest
 * input) where it is no longer scoped to the project it came from. This helper
 * strips the identifiers we actually hold on the project record, plus email and
 * phone patterns, before that crossing happens.
 *
 * Pure by design (no Convex imports) so it is unit-testable without a
 * deployment. It mirrors `convex/ai/research/core.ts`'s `redactExternalText`
 * and deliberately diverges twice: it also scrubs the project titles, and it
 * does NOT strip URLs or collapse whitespace, because the text it scrubs is
 * structured prose whose paragraphing is part of the signal.
 *
 * Best effort by construction: regex + project-record driven, never
 * model-driven. False negatives are possible, which is why the digest prompts
 * carry a privacy instruction and publication requires a human confirmation.
 */

/** The subset of a `projects` document `deidentify` reads. All optional. */
export type DeidentifiableProject = {
  title?: string;
  sredTitle?: string;
  clientName?: string;
  writer?: string;
  interviewer?: string;
  interviewees?: string[];
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replace project-record identifiers with `[redacted]`, and email/phone
 * patterns with `[redacted email]`/`[redacted phone]`. Line and paragraph
 * structure is preserved exactly.
 *
 * Passing `null`/`undefined` for the project still applies the contact-pattern
 * pass — used for edit-event rows whose project document no longer exists.
 */
export function deidentify(
  text: string,
  project: DeidentifiableProject | null | undefined
): string {
  const names = Array.from(
    new Set(
      [
        project?.clientName,
        project?.title,
        project?.sredTitle,
        project?.writer,
        project?.interviewer,
        ...(project?.interviewees ?? []),
      ]
        .map((name) => name?.trim())
        .filter((name): name is string => !!name && name.length >= 3)
    )
    // Longest first so "Acme Farms" is consumed before a bare "Acme" would
    // leave a " Farms" remnant behind.
  ).sort((a, b) => b.length - a.length);

  // Contact patterns run FIRST: a client name inside an address
  // ("jo@acmefarms.ca") would otherwise be rewritten by the name pass, break
  // the email pattern, and leave the local part behind.
  let out = text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted email]")
    // Unlike the research redactor's pattern, the leading boundary is a
    // lookbehind (`\b` cannot match before "(", so "(613) 555-0134" would keep
    // its opening parenthesis), separators are required, and the bare form
    // must use the SAME separator twice ("613-555-0134", never "500-600 1000").
    // A bare ten-digit run, or a mixed-separator run, is far more often a
    // serial, sample id, or measurement range in SR&ED prose than a phone
    // number, and the sprint accepts false negatives over corrupting the
    // technical vocabulary these exemplars exist for.
    .replace(
      /(?<![\d(.])(?:\+?1[-.\s]?)?(?:\(\d{3}\)[-.\s]?\d{3}[-.\s]?\d{4}|\d{3}([-.\s])\d{3}\1\d{4})(?!\d)/g,
      "[redacted phone]"
    );

  for (const name of names) {
    // Anchored to non-alphanumeric boundaries so a short identifier cannot
    // eat the inside of an unrelated word ("Ion" within "Ionization"). Not
    // `\b`: identifiers routinely start or end with punctuation ("C++ … Ltd.").
    out = out.replace(
      new RegExp(
        `(?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`,
        "giu"
      ),
      "[redacted]"
    );
  }
  return out;
}
