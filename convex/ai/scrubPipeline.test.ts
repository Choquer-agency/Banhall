/**
 * Scrubber-in-pipeline: shared/bannedWords.ts unit tests cover the tables;
 * this proves the pipeline seam — a draft riddled with every banned-word
 * category goes through scrubBannedWords, and the QA scanners
 * (checkBannedWords + sectionDeterministicFindings) then flag ONLY the
 * scan-only terms the scrubber deliberately leaves for a human/LLM.
 */
import { describe, expect, it } from "vitest";
import {
  checkBannedWords,
  sectionDeterministicFindings,
} from "./qaChecks";
import { scrubBannedWords } from "../../shared/bannedWords";

// Every category in one draft: deletion ("Furthermore,"), adjective
// ("substantial"), sentence-initial replacement ("Novel"), inflected verb
// ("leveraged"), phrase ("delving into"), and a scan-only technical term
// ("transform") that must survive untouched.
const RAW_DRAFT =
  "Furthermore, the substantial gains were confirmed by testing. " +
  "Novel methods were leveraged while delving into the Fourier transform behaviour.";

const EXPECTED_SCRUBBED =
  "The considerable gains were confirmed by testing. " +
  "New methods were used while examining the Fourier transform behaviour.";

describe("scrubber → QA scanner pipeline", () => {
  it("the raw draft trips the scanner in every category", () => {
    const found = checkBannedWords(RAW_DRAFT, "", "").found.map((f) => f.word);
    expect(found).toEqual(
      expect.arrayContaining([
        "furthermore",
        "substantial",
        "novel",
        "leveraged",
        "delving",
        "transform",
      ])
    );
  });

  it("scrubs with correct case and punctuation", () => {
    expect(scrubBannedWords(RAW_DRAFT)).toBe(EXPECTED_SCRUBBED);
  });

  it("post-scrub, the scanner flags ONLY scan-only terms", () => {
    const scrubbed = scrubBannedWords(RAW_DRAFT);
    const found = checkBannedWords("", scrubbed, "").found;
    expect([...new Set(found.map((f) => f.word))]).toEqual(["transform"]);
    expect(found.every((f) => f.section === "244")).toBe(true);
  });

  it("sectionDeterministicFindings on the scrubbed draft reports only the scan-only residue", () => {
    const scrubbed = scrubBannedWords(RAW_DRAFT);
    const findings = sectionDeterministicFindings("s244", scrubbed);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      check: "banned_word",
      message: expect.stringContaining('Banned word "transform"'),
    });
  });

  it("scrubbing is idempotent", () => {
    const once = scrubBannedWords(RAW_DRAFT);
    expect(scrubBannedWords(once)).toBe(once);
  });
});
