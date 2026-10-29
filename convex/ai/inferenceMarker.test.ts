import { describe, expect, it } from "vitest";
import { NO_STYLE_OVERRIDES, STYLE_OVERRIDE_KEYS } from "../../shared/styleOverrides";
import { RULES_EVIDENCE_KINDS, findDashConnectors, findSourceTalk } from "../../shared/humanProse";
import { LOCKED_RULES } from "../../shared/houseRules";
import {
  SELF_CHECK_SYSTEM_PROMPT,
  SUMMARY_PLAN_SELF_CHECK_SYSTEM_PROMPT,
  buildChatSystemPromptV2,
  buildQaSystemPrompt,
  buildSection242Instructions,
  buildSection244Instructions,
  buildSection246Instructions,
  buildSectionDraftRequest,
  buildSharedWritingRules,
} from "./prompts";
import { COMPRESSION_REQUEST } from "./promptDefinitions";
import { factsMatchSourcesInstruction } from "./selfCheck";
import { buildStylePreviewPrompt } from "./stylePreview";
import { compressionLoss, endedMidSentence } from "./pipeline";
import { INFERENCE_MARKER_ADDITIONS, withoutInferenceMarkerText } from "../inferenceMarker.fixture";

/**
 * 2026-10-29 (owner, chat: "We can include the ... inference marker."):
 * every claim in a drafted report is stated, inferred and marked
 * [INFERRED: what it rests on], or missing and left as a [GAP: ...]. The
 * rule rides the shared writing rules every drafting path sends; the checks
 * allow a marked inference; compression keeps the markers.
 */
const MARK = "[INFERRED: the source asks for stability over time, not single-point checks]";

describe("the three kinds rule", () => {
  it("names the three kinds, the marker, the gap and the examples, in plain words with no dashes", () => {
    expect(RULES_EVIDENCE_KINDS).toContain("STATED, INFERRED OR MISSING (MANDATORY in the report text):");
    expect(RULES_EVIDENCE_KINDS).toContain("1. Stated: the evidence says it. Write it plainly.");
    expect(RULES_EVIDENCE_KINDS).toContain("[INFERRED: what it rests on, in plain words]");
    expect(RULES_EVIDENCE_KINDS).toContain("3. Missing: nothing in the evidence supports it. Do not write it.");
    expect(RULES_EVIDENCE_KINDS).toContain("[GAP: what is needed]");
    // The meeting's own example of an invented event is the bad example.
    expect(RULES_EVIDENCE_KINDS).toContain('Bad: "Trials then indicated that single readings were unreliable."');
    expect(RULES_EVIDENCE_KINDS).toContain(`Good: "Readiness was first judged from single readings. ${MARK}"`);
    // The marker may name the source; the sentence may not.
    expect(RULES_EVIDENCE_KINDS).toContain("A marker is a note to the writer, like a gap: it may say which part of the evidence the inference rests on");
    expect(RULES_EVIDENCE_KINDS).toContain("The sentence itself never names a source.");
    // A required story never wins over the evidence.
    expect(RULES_EVIDENCE_KINDS).toContain("Never make it up to fill the shape.");
    // Revisions keep the markers.
    expect(RULES_EVIDENCE_KINDS).toContain("keep each one with the sentence it belongs to");
    expect(findDashConnectors(RULES_EVIDENCE_KINDS)).toEqual([]);
  });

  it("is Locked: every shared writing rules build sends it right after GENERAL RULES, waived or not", () => {
    const builds = [
      NO_STYLE_OVERRIDES,
      ...STYLE_OVERRIDE_KEYS.map((key) => ({ ...NO_STYLE_OVERRIDES, [key]: true })),
      Object.fromEntries(STYLE_OVERRIDE_KEYS.map((key) => [key, true])) as typeof NO_STYLE_OVERRIDES,
    ];
    for (const overrides of builds) {
      const rules = buildSharedWritingRules(overrides);
      expect(rules.split(RULES_EVIDENCE_KINDS)).toHaveLength(2);
      const general = rules.indexOf("GENERAL RULES:");
      const kinds = rules.indexOf(RULES_EVIDENCE_KINDS);
      expect(general).toBeGreaterThan(0);
      expect(kinds).toBeGreaterThan(general);
      // The [GAP] rule it builds on is unchanged.
      expect(rules).toContain(
        "- NEVER hallucinate or fabricate technical details. If information is missing from the analysis, insert a clearly marked placeholder: [GAP: description of what information is needed]."
      );
    }
  });

  it("reaches every drafting request (Single draft, Compare, Step by step and redrafts all draft through it) and the Assistant", () => {
    for (const instructions of [buildSection242Instructions(), buildSection244Instructions(), buildSection246Instructions()]) {
      const request = buildSectionDraftRequest({
        instructions,
        analysisJson: "{}",
        brainExemplars: "",
        lengthBudget: "",
        styleGuidance: "",
        contentPlanBlock: "",
        briefBlock: "",
      });
      expect(request.system).toContain(RULES_EVIDENCE_KINDS);
    }
    expect(buildChatSystemPromptV2()).toContain(RULES_EVIDENCE_KINDS);
    expect(buildStylePreviewPrompt({ instructions: null, styleOverrides: NO_STYLE_OVERRIDES }).system).toContain(RULES_EVIDENCE_KINDS);
  });

  it("leaves the templates, the required story and the other drafting rules as they were", () => {
    // Only the shared rules and the check lines move: the Line instructions
    // hold none of the marker's text.
    for (const instructions of [buildSection242Instructions(), buildSection244Instructions(), buildSection246Instructions()]) {
      expect(instructions).not.toContain("[INFERRED");
    }
    expect(buildSection244Instructions()).toContain("3. WHAT WENT WRONG OR WAS LEARNED (1-2 sentences)");
  });

  it("says on the House Rules page that an inference is written with a note to check", () => {
    const rule = LOCKED_RULES.find((entry) => entry.title === "No fabrication");
    expect(rule?.summary).toContain("[INFERRED: what it rests on]");
    expect(rule?.summary).toContain("[GAP: ...] placeholder");
  });
});

describe("the checks allow a marked inference", () => {
  it("the Self-check, in both modes, never fails a marked inference and lets a marker name a source", () => {
    for (const prompt of [SELF_CHECK_SYSTEM_PROMPT, SUMMARY_PLAN_SELF_CHECK_SYSTEM_PROMPT]) {
      expect(prompt).toContain("A sentence followed by an [INFERRED: ...] marker is a marked inference the writer will check. It is allowed");
      expect(prompt).toContain("A [GAP: ...] or [INFERRED: ...] marker is a note to the writer, not report text, so it may name a source.");
    }
    expect(SUMMARY_PLAN_SELF_CHECK_SYSTEM_PROMPT).toContain(
      "fail it like a flat claim. A [GAP: ...] or [INFERRED: ...] marker is not a sentence of the section: it may name a source."
    );
  });

  it("the facts check never flags a marked inference for having no source, but still checks its figures", () => {
    for (const complete of [true, false]) {
      const instruction = factsMatchSourcesInstruction(complete);
      expect(instruction).toContain("never flag it for having no source, but check a figure or a specific detail it states like any other.");
    }
  });

  it("QA does not count a marked inference as fabricated, and still flags an unmarked one", () => {
    for (const prompt of [buildQaSystemPrompt(), buildQaSystemPrompt({ ...NO_STYLE_OVERRIDES, reportSkeleton: true })]) {
      expect(prompt).toContain("- Are [GAP] placeholders used where information is missing?");
      expect(prompt).toContain("do not count it as untraceable or fabricated. Flag an inference written as a stated fact, with no marker, as before.");
    }
  });

  it("the source-talk scan skips text inside a marker, and still finds it in the sentence", () => {
    const subject = { subjectText: [] };
    expect(findSourceTalk("Readiness was first judged from single readings. [INFERRED: the transcript says readings must hold steady]", subject)).toEqual([]);
    expect(findSourceTalk("The load was not given. [GAP: according to the interview notes, a second test ran]", subject)).toEqual([]);
    const hits = findSourceTalk("The transcript says readings must hold steady. [INFERRED: the transcript says so]", subject);
    expect(hits.map((hit) => [hit.phrase, hit.index])).toEqual([["The transcript says", 0]]);
    // Context comes from the text as written.
    expect(hits[0].context).toContain("The transcript says readings");
  });

  it("the Assistant says inference notes never count and calls them inference notes", () => {
    const prompt = buildChatSystemPromptV2();
    expect(prompt).toContain('The meter never counts [INFERRED] notes either, and they are not in "with gaps": deleting one changes no number.');
    expect(prompt).toContain('call a [GAP: ...] placeholder a "gap note" and never type the bracketed token itself (it belongs in report text only). Call an [INFERRED: ...] marker an "inference note"');
  });
});

describe("compression keeps every marker", () => {
  const input = `Readiness was first judged from single readings. ${MARK} The team then held each sample for an hour before it read the probe again, and it logged the drift. [GAP: the hold time]`;

  it("asks for every [INFERRED] marker verbatim, after its sentence, and none added", () => {
    expect(COMPRESSION_REQUEST.system).toContain("Keep every [GAP: …] marker verbatim (never remove or reword one)");
    expect(COMPRESSION_REQUEST.system).toContain(
      "Keep every [INFERRED: …] marker verbatim too, right after the sentence it marks: you may shorten that sentence, never drop it or its marker, and never add a marker."
    );
  });

  it("does not keep a pass that drops, rewords or adds an [INFERRED] marker", () => {
    const kept = `Readiness was first judged from single readings. ${MARK} Each sample was held an hour and read again. [GAP: the hold time]`;
    expect(compressionLoss(input, kept, "s244", 10)).toBeNull();
    expect(compressionLoss(input, kept.replace(` ${MARK}`, ""), "s244", 10)).toBe(`dropped the marker ${MARK}`);
    const reworded = kept.replace(MARK, "[INFERRED: the source asks for steady readings]");
    expect(compressionLoss(input, reworded, "s244", 10)).toBe(`dropped the marker ${MARK}`);
    const added = `${kept} [INFERRED: the plan names no other check]`;
    expect(compressionLoss(input, added, "s244", 10)).toBe("added the marker [INFERRED: the plan names no other check]");
  });

  it("reads a paragraph that ends on a marker as ending on a whole sentence", () => {
    expect(endedMidSentence(`One. ${MARK}`, `One. ${MARK}`)).toBeNull();
  });
});

describe("the pinned-request fixture", () => {
  it("lists each addition once, and taking them out gives the shared rules as before", () => {
    expect(new Set(INFERENCE_MARKER_ADDITIONS).size).toBe(INFERENCE_MARKER_ADDITIONS.length);
    const before = withoutInferenceMarkerText(buildSharedWritingRules());
    expect(before).not.toContain("[INFERRED");
    expect(before).toContain("GENERAL RULES:");
    expect(withoutInferenceMarkerText(buildChatSystemPromptV2())).not.toContain("INFERRED");
    expect(withoutInferenceMarkerText(SUMMARY_PLAN_SELF_CHECK_SYSTEM_PROMPT)).not.toContain("INFERRED");
    expect(withoutInferenceMarkerText(COMPRESSION_REQUEST.system)).not.toContain("INFERRED");
  });
});
