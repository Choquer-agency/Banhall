/**
 * 2026-10-04 (first), Round 5 (owner approved 2026-10-05, "Build code
 * checks"): the writer's terms, banned words and required openings,
 * measured in code on the text. Release suite run 5 of 2026-10-05 (fixture
 * writer-settings-document) found Line 242 with no sentence opening "The
 * aim of this work was to" and Line 244 P3 saying "pinhole formation",
 * while the settings rows gave other reasons. Fictional project.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { extractWriterWordingRules } from "./settingsExtraction";
import {
  assembleSectionNotes,
  repairIssues,
  runDeterministicSelfCheck,
  type ModelVerdict,
} from "./selfCheckRules";
import { bannedRuleHits, openingAt, termRuleHits, wordingLoss, type WriterWordingRules } from "./writerWording";
import type { CategoryOutcome, OrderedProfileContext, SectionNumber } from "./orderedChain";

const SETTINGS_TEXT = readFileSync(
  path.join(process.cwd(), "scripts/seed-plan-eval/fixtures/writer-settings-document/settings.md"),
  "utf8"
);
const RULES = extractWriterWordingRules(SETTINGS_TEXT);

const openers = (effective: boolean, mode: CategoryOutcome["mode"] = "writer_choice"): CategoryOutcome => ({
  category: "openingClauses",
  mode,
  effective,
  tier: mode === "writer_choice" ? "none" : "org_enforced",
});
const profile = (outcomes: CategoryOutcome[] = [openers(true, "off")]): OrderedProfileContext => ({
  profileState: "applied",
  categoryOutcomes: outcomes,
  buildOrder: ["242", "244", "246"],
  selfCheckRules: [],
});

const check = (section: SectionNumber, text: string, rules: WriterWordingRules | null = RULES, context = profile()) =>
  runDeterministicSelfCheck({ section, text, brief: null, profile: context, isFirstInOrder: false, ...(rules ? { writerWording: rules } : {}) });
const row = (result: ReturnType<typeof check>, instruction: string) =>
  result.entries.find((entry) => entry.row.instruction === instruction);

const LINE_244 = [
  "Velloway Panel Finishing ran two oven trials on routed MDF doors.",
  "Trial 1 measured film build on the edges at 58 microns.",
  "In Trial 2, pinhole formation was tied to panel surface temperature itself.",
].join("\n\n");
const LINE_242 = [
  "Velloway Panel Finishing coats routed MDF doors with a low-temperature powder.",
  "This work aimed to develop a powder finish for routed MDF doors.",
  "It was not known at the outset whether full cure could be reached below the outgassing onset.",
].join("\n\n");

describe("the matcher (Round 5)", () => {
  it("reads whole words in any case, a space or hyphen between words, and an s or es ending", () => {
    const pinholes = RULES.terms.find((rule) => rule.term === "outgassing defects")!;
    expect(termRuleHits("Pinhole formation rose.", pinholes).map((hit) => hit.words)).toEqual(["Pinhole"]);
    expect(termRuleHits("Blistering and pinholing were seen.", pinholes).map((hit) => hit.words)).toEqual(["pinholing", "Blistering"]);
    // On their own: beside the term in the same sentence they are allowed.
    expect(termRuleHits("Outgassing defects (pinholes and blisters) fell.", pinholes)).toEqual([]);
    expect(termRuleHits("Pinheads fell.", pinholes)).toEqual([]);
    const optimize = RULES.banned.find((rule) => rule.phrase === "optimize")!;
    expect(bannedRuleHits("The team optimized the cure and optimizes it still.", optimize).map((hit) => hit.words)).toEqual(["optimizes", "optimized"]);
    const trial = RULES.banned.find((rule) => rule.phrase === "trial and error")!;
    expect(bannedRuleHits("It was trial-and-error.", trial).map((hit) => hit.words)).toEqual(["trial-and-error"]);
  });

  it("finds an opening at the start of any sentence, never inside one", () => {
    expect(openingAt("Context first. The aim of this work was to cure it.", "The aim of this work was to")).toEqual({ paragraphIndex: 0, opensParagraph: false });
    expect(openingAt("Its aim was that the aim of this work was to cure it.", "The aim of this work was to")).toBeNull();
    expect(openingAt("[GAP: company size] The aim of this work was to cure it.", "The aim of this work was to")).toEqual({ paragraphIndex: 0, opensParagraph: false });
  });
});

describe("measured rows, repair issues and the Writer Profile row (Round 5)", () => {
  it("run 5, Line 244: the banned synonym gets its own row naming the paragraph and the words, and an exact repair issue", () => {
    const result = check("244", LINE_244);
    const term = row(result, "Writer's term: outgassing defects")!;
    expect(term.row).toMatchObject({
      source: "deterministic",
      outcome: "not_applied",
      paragraphIndex: 2,
      reason: 'P3 says "pinhole"; the writer\'s settings say "outgassing defects", which this Line never uses',
    });
    expect(term.repairable).toBe(true);
    expect(repairIssues(result, [])).toContain(
      'Paragraph 3: replace "pinhole" with wording that uses "outgassing defects" (the writer\'s settings never allow "pinholes" on its own).'
    );
    // The other rules hold, each on its own row.
    expect(row(result, "Writer's term: film build")!.row).toMatchObject({ outcome: "applied", reason: '"film build" used; no banned synonym' });
    expect(row(result, "Writer's banned word: optimize")!.row).toMatchObject({ outcome: "applied", reason: '"optimize" not used' });
    // Openings bear on Line 242 only.
    expect(result.entries.some((entry) => entry.row.instruction.startsWith("Writer's opening"))).toBe(false);
    // The Writer Profile row's caveat covers the measured break.
    expect(row(result, "Writer Profile")!.row.reason).toBe(
      'Writer Profile applied. It was used to draft this Line, but not every rule it sets was met: P3 says "pinhole" (the writer\'s term is "outgassing defects") (see that row).'
    );
  });

  it("run 5, Line 242: a required opening that starts no sentence is a break with an exact repair issue; the uncertainty opening holds", () => {
    const result = check("242", LINE_242);
    const objective = row(result, 'Writer\'s opening for the objective statement: "The aim of this work was to"')!;
    expect(objective.row).toMatchObject({
      outcome: "not_applied",
      reason: 'No sentence of Line 242 opens with "The aim of this work was to", which the writer\'s settings require for the objective statement',
    });
    expect(repairIssues(result, [])).toContain('Open the statement of the objective with "The aim of this work was to".');
    expect(row(result, 'Writer\'s opening for the uncertainty statement: "It was not known at the outset whether"')!.row).toMatchObject({
      outcome: "applied",
      paragraphIndex: 2,
      reason: 'P3 opens with "It was not known at the outset whether" (whether that sentence is the uncertainty statement is the Self-check\'s to judge)',
    });
  });

  it("does not measure an opening while the House Rule openers apply, and asks no repair for it", () => {
    const result = check("242", LINE_242, RULES, profile([openers(false)]));
    const objective = row(result, 'Writer\'s opening for the objective statement: "The aim of this work was to"')!;
    expect(objective.repairable).toBe(false);
    expect(objective.row.reason).toBe("Not measured: the House Rule openers apply in this Line (House Rule applied (no Writer Profile waiver))");
  });

  it("adds no row and no issue for a writer with no such rule, or a profile that did not apply", () => {
    const none = check("244", LINE_244, null);
    expect(none.entries.some((entry) => entry.row.instruction.startsWith("Writer's"))).toBe(false);
    const missing = check("244", LINE_244, RULES, { ...profile(), profileState: "missing" });
    expect(missing.entries.some((entry) => entry.row.instruction.startsWith("Writer's"))).toBe(false);
  });

  it("re-measures the final text: a break the repair fixed reads repaired, one it left reads repair failed", () => {
    const before = check("244", LINE_244);
    const fixed = LINE_244.replace("pinhole formation", "outgassing defect formation");
    const notes = (finalText: string) =>
      assembleSectionNotes({
        section: "244",
        before,
        after: check("244", finalText),
        verdicts: [],
        modelCheck: { ok: true },
        storylineQuestion: null,
        repair: { attempted: true, succeeded: true },
        finalText,
        finalVerdicts: { ok: true, verdicts: [] },
      }).rows.find((note) => note.instruction === "Writer's term: outgassing defects");
    expect(notes(fixed)).toMatchObject({ outcome: "applied", repaired: true, reason: '"outgassing defects" used; no banned synonym; repaired' });
    expect(notes(LINE_244.replace("ran two", "ran just two"))).toMatchObject({
      outcome: "not_applied",
      reason: 'P3 says "pinhole"; the writer\'s settings say "outgassing defects", which this Line never uses; repair failed',
    });
  });

  it("the model's row for the settings never contradicts a measured break", () => {
    const before = check("244", LINE_244);
    const verdict: ModelVerdict = {
      check: "instruction",
      instruction: "# PD Writing Customized Settings ...",
      outcome: "applied",
      reason: "Terms, banned words and third person all respected.",
    };
    const settingsRow = assembleSectionNotes({
      section: "244",
      before,
      after: null,
      verdicts: [verdict],
      modelCheck: { ok: true },
      storylineQuestion: null,
      repair: { attempted: false, succeeded: false },
      finalText: LINE_244,
      writerInstructions: SETTINGS_TEXT,
    }).rows.find((note) => note.source === "model");
    expect(settingsRow).toMatchObject({
      outcome: "not_applied",
      reason:
        'Not followed in full: P3 says "pinhole" (the writer\'s term is "outgassing defects") (measured by code; see that row). Otherwise followed: Terms, banned words and third person all respected.',
    });
  });
});

describe("shortening never breaks a measured wording rule (Round 5, rule 4)", () => {
  it("names a pass that removes a required opening, writes a banned word or removes the last use of a term", () => {
    expect(wordingLoss(LINE_242.replace("This work aimed", "The aim of this work was"), LINE_242, RULES, "242")).toBe(
      'removed the opening "The aim of this work was to" the writer\'s settings require'
    );
    expect(wordingLoss(LINE_244.replace("pinhole formation", "outgassing defects"), LINE_244, RULES, "244")).toBe(
      'wrote "pinhole", which the writer\'s settings ban in favour of "outgassing defects"'
    );
    expect(wordingLoss(LINE_244, LINE_244.replace("film build", "thickness"), RULES, "244")).toBe(
      'removed the last use of "film build", the writer\'s term'
    );
    expect(wordingLoss("The team tuned the cure.", "The team optimized the cure.", RULES, "244")).toBe(
      'wrote "optimized", which the writer\'s settings ban'
    );
    // A break the input already held is not the pass's doing; an opening in
    // another Line is not checked here.
    expect(wordingLoss(LINE_244, LINE_244.replace("Velloway Panel Finishing ran", "Velloway ran"), RULES, "244")).toBeNull();
    expect(wordingLoss(LINE_242.replace("This work aimed", "The aim of this work was"), LINE_242, RULES, "244")).toBeNull();
  });
});

describe("a repair that takes a Line over the writer's cap it met (Round 5, rule 5)", () => {
  it("is kept for what it fixed, and the cap row says the repair pushed the Line over the cap the checked draft met", () => {
    const cap = { section: "246" as const, instruction: "- Line 246: no more than 40 words.", maxWords: 40 };
    const withCap = { ...profile(), selfCheckRules: [cap] };
    const words = (count: number) => Array.from({ length: count }, () => "word").join(" ");
    const checkedText = `The pinholes fell. ${words(30)}.`;
    const repairedText = `The outgassing defects fell. ${words(40)}.`;
    const before = check("246", checkedText, RULES, withCap);
    const after = check("246", repairedText, RULES, withCap);
    expect(before.entries.find((entry) => entry.key === "rule:0")!.row.outcome).toBe("applied");
    const rows = assembleSectionNotes({
      section: "246",
      before,
      after,
      verdicts: [],
      modelCheck: { ok: true },
      storylineQuestion: null,
      repair: { attempted: true, succeeded: true },
      finalText: repairedText,
      compression: { passes: 3 },
      finalVerdicts: { ok: true, verdicts: [] },
    }).rows;
    expect(rows.find((note) => note.instruction === cap.instruction)?.reason).toBe(
      "exceeds: 44/40 words; the repair, kept for what it fixed, took Line 246 over the writer's cap that the checked draft met (33/40 words); still over after 3 shortening passes. The text was not cut to fit: shorten Line 246 to 40 words to meet the writer's settings"
    );
    expect(rows.find((note) => note.instruction === "Writer's term: outgassing defects")).toMatchObject({ outcome: "applied", repaired: true });
  });
});

// Review of 13051055..a8e254bd: the matcher and the guard.
describe("review fixes to the matcher and the settings row guard (Round 5)", () => {
  const rule = (term: string, banned: string[], allowedWithTerm = false) => ({ term, banned, allowedWithTerm, source: `${term}: never write ${banned.join(" or ")}.` });

  it("never counts a banned item inside a use of the term itself (P1-1 b)", () => {
    const surface = rule("panel surface temperature", ["surface temperature"]);
    expect(termRuleHits("The panel surface temperature reached 120 C.", surface)).toEqual([]);
    expect(termRuleHits("The surface temperature reached 120 C.", surface).map((hit) => hit.words)).toEqual(["surface temperature"]);
    // Nor a banned word inside another required term.
    const temperature = { phrase: "temperature", forms: [], source: "- temperature" };
    expect(bannedRuleHits("The panel surface temperature rose.", temperature, ["panel surface temperature"])).toEqual([]);
  });

  it("reads e.g. and i.e. as no sentence end (P3-1)", () => {
    const pinholes = RULES.terms.find((entry) => entry.term === "outgassing defects")!;
    expect(termRuleHits("Outgassing defects (e.g. pinholes and blisters) rose.", pinholes)).toEqual([]);
    expect(termRuleHits("Outgassing defects rose, i.e. pinholes appeared.", pinholes)).toEqual([]);
  });

  it("matches an opening with a curly or straight apostrophe either way (P3-2)", () => {
    expect(openingAt("The team’s aim was to cure it.", "The team's aim was to")).toEqual({ paragraphIndex: 0, opensParagraph: true });
    expect(openingAt("The team's aim was to cure it.", "The team’s aim was to")).toEqual({ paragraphIndex: 0, opensParagraph: true });
  });

  it("compares a pass by rule, not by form: \"pinhole\" made \"pinholes\" adds none (P3-7)", () => {
    expect(wordingLoss("A pinhole formed.", "Pinholes formed.", RULES, "244")).toBeNull();
    expect(wordingLoss("A pinhole formed.", "A pinhole and a blister formed.", RULES, "244")).toBe(
      'wrote "blister", which the writer\'s settings ban in favour of "outgassing defects"'
    );
  });

  it("an instruction row that quotes one measured rule carries its break, as a cap row does (P3-4)", () => {
    const before = check("244", LINE_244);
    const pinholesRule = RULES.terms.find((entry) => entry.term === "outgassing defects")!;
    const verdict: ModelVerdict = { check: "instruction", instruction: pinholesRule.source, outcome: "applied", reason: "Followed." };
    const other: ModelVerdict = { check: "instruction", instruction: "Write in the third person throughout.", outcome: "applied", reason: "Third person used." };
    const rows = assembleSectionNotes({
      section: "244",
      before,
      after: null,
      verdicts: [verdict, other],
      modelCheck: { ok: true },
      storylineQuestion: null,
      repair: { attempted: false, succeeded: false },
      finalText: LINE_244,
      writerInstructions: SETTINGS_TEXT,
    }).rows.filter((note) => note.source === "model");
    expect(rows[0]).toMatchObject({
      outcome: "not_applied",
      reason: 'Not followed in full: P3 says "pinhole" (the writer\'s term is "outgassing defects") (measured by code; see that row). Otherwise followed: Followed.',
    });
    // A row for another rule keeps its own verdict.
    expect(rows[1]).toMatchObject({ outcome: "applied", reason: "Third person used." });
  });
});
