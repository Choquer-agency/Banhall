/**
 * The Brief derivation's own rules that the request bytes do not show
 * (Opus review P3-3, 2026-09-26): how many places a quote may try, the
 * glossary matcher, the placeholder algorithm and the structured repair
 * policy. The whole bundle is hashed into the Brief preparation key
 * (convex/lib/briefPreparationKey.ts), so a prepared Brief derived under
 * other rules is never adopted. convex/briefPreparationKey.test.ts pins
 * the bundle's hash: change a constant, bump BRIEF_DERIVATION_VERSION and
 * pin the new hash together.
 */
import { STRUCTURED_OUTPUT_PROGRAM } from "../ai/structured";
import { GLOSSARY_MATCHER_VERSION } from "./glossaryMatcher";
import { PLACEHOLDER_ALGORITHM_VERSION } from "./deidentify";

/** Bumped with any change to the bundle below. */
export const BRIEF_DERIVATION_VERSION = 3;

/** Places of one quote tried under owner decision 25 before it is dropped. */
export const MAX_QUOTE_PLACES = 8;

export const BRIEF_DERIVATION_CONSTANTS = {
  version: BRIEF_DERIVATION_VERSION,
  maxQuotePlaces: MAX_QUOTE_PLACES,
  glossaryMatcherVersion: GLOSSARY_MATCHER_VERSION,
  placeholderAlgorithmVersion: PLACEHOLDER_ALGORITHM_VERSION,
  structuredOutput: STRUCTURED_OUTPUT_PROGRAM,
} as const;
