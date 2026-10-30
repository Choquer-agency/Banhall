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
  SECTION_EVIDENCE_POINTER,
} from "./prompts";
import { COMPRESSION_REQUEST } from "./promptDefinitions";
import { factsMatchSourcesInstruction } from "./selfCheck";
import { buildStylePreviewPrompt } from "./stylePreview";
import { compressionLoss, endedMidSentence, inferredSentenceLoss } from "./pipeline";
import {
  INFERENCE_MARKER_ADDITIONS,
  INFERENCE_MARKER_COUNTS,
  inferenceMarkerCounts,
  withoutInferenceMarker,
  withoutInferenceMarkerText,
} from "../inferenceMarker.fixture";

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
    expect(RULES_EVIDENCE_KINDS).toContain("[INFERRED: the stated facts it rests on, in plain words]");
    // Review round 2 (P2-1): an inference is a consequence, cause or
    // comparison of stated facts; an event is never inferred, marked or not.
    expect(RULES_EVIDENCE_KINDS).toContain(
      "2. Inferred: a consequence, a cause or a comparison that the stated facts clearly imply, and that a careful reader of the evidence would agree with."
    );
    expect(RULES_EVIDENCE_KINDS).toContain(
      "- Events are never inferred. Write a trial, a test, a result, a finding, a first approach or a change of approach only where the evidence describes it. An event the evidence does not describe is missing: leave a [GAP: ...]. A marker does not make it allowed."
    );
    expect(RULES_EVIDENCE_KINDS).toContain(
      "- [INFERRED: ...] is only for a consequence, a cause or a comparison drawn from stated facts, and for general practice as below. Write an inferred cause as likely, never as confirmed."
    );
    // The gap comes first wherever the instructions ask for what the evidence lacks.
    expect(RULES_EVIDENCE_KINDS).toContain(
      "leave a [GAP: ...]; mark an inference only where the stated evidence clearly implies it (general practice in Line 242's limitations aside). Never make it up to fill the shape."
    );
    expect(RULES_EVIDENCE_KINDS).not.toContain("mark it as inferred, or leave a gap");
    expect(RULES_EVIDENCE_KINDS).not.toContain("mark a reasonable inference, or leave a gap");
    expect(RULES_EVIDENCE_KINDS).toContain("3. Missing: nothing in the evidence supports it. Do not write it.");
    expect(RULES_EVIDENCE_KINDS).toContain("[GAP: what is needed]");
    // The meeting's own example of an invented event is the bad example.
    expect(RULES_EVIDENCE_KINDS).toContain('Bad: "Trials then indicated that single readings were unreliable."');
    // Review round 1 (P2-3): the Good example follows from stated facts, a
    // missing story step becomes a gap, and a requirement read as a first
    // approach is the Bad example.
    expect(RULES_EVIDENCE_KINDS).toContain(
      `Good: "Standard setpoint tables did not describe the warehouse's normal operating state. [INFERRED: the source says the tables assume a closed room and that the dock doors stay open for most of a shift]" (a consequence of two stated facts)`
    );
    expect(RULES_EVIDENCE_KINDS).toContain('"The first approach was [GAP: what was tried first and why it fell short].');
    // Round 2: the marked invented event, the easy wrong answer, is the first Bad example.
    expect(RULES_EVIDENCE_KINDS).toContain(
      'Bad: "Initial trials showed single readings were unreliable. [INFERRED: the source stresses stability]" (a trial and its result are events the evidence does not describe; the marker does not make them allowed: leave a gap)'
    );
    // Round 3: a marked first approach, the meeting's own case, is Bad too.
    expect(RULES_EVIDENCE_KINDS).toContain(
      'Bad: "Readiness was first judged from single readings. [INFERRED: the source asks for stability over time]" (a first approach is an event'
    );
    // No Good example marks an event.
    // 2026-10-29 (third): a third Good example names general practice, marked.
    // 2026-10-30: a fourth names it where the evidence gives no reason it
    // falls short, so a gap asks for the reason.
    const goods = RULES_EVIDENCE_KINDS.split("\n").filter((line) => line.startsWith("Good"));
    expect(goods).toHaveLength(4);
    for (const good of goods) expect(good).not.toMatch(/\b(?:trials?|tests?|tested|found|showed|indicated)\b/i);
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

  // Review round 1 (P1-1): the rule is in the system prompt, before the Line
  // instructions in the user message, so a pointer follows them.
  it("points back to the rule right after each Line's instructions, before the Brief and any repair guidance", () => {
    for (const instructions of [buildSection242Instructions(), buildSection244Instructions(), buildSection246Instructions()]) {
      const request = buildSectionDraftRequest({
        instructions,
        analysisJson: "{}",
        brainExemplars: "",
        lengthBudget: "\n\n# LENGTH BUDGET",
        styleGuidance: "\n\n## Self-check repair (high priority)",
        contentPlanBlock: "",
        briefBlock: "\n\n# BRIEF",
      });
      const task = request.messages[0].content[1].text;
      expect(task.split(SECTION_EVIDENCE_POINTER)).toHaveLength(2);
      expect(task.indexOf(SECTION_EVIDENCE_POINTER)).toBe(task.indexOf(instructions) + instructions.length);
      expect(task.indexOf(SECTION_EVIDENCE_POINTER)).toBeLessThan(task.indexOf("# LENGTH BUDGET"));
      expect(task.indexOf("## Self-check repair")).toBeGreaterThan(task.indexOf(SECTION_EVIDENCE_POINTER));
      expect(task.endsWith("# BRIEF")).toBe(true);
    }
    // 2026-10-29 (third), review round 1 (P3-1): general practice in Line
    // 242's limitations aside, and no longer about a required story.
    expect(SECTION_EVIDENCE_POINTER).toContain(
      "the STATED, INFERRED OR MISSING rule decides: leave a [GAP: ...]; mark an inference only where the stated evidence clearly implies it (general practice in Line 242's limitations aside), and never for an event (a trial, test, result, finding, first approach or change of approach) the evidence does not describe."
    );
    expect(SECTION_EVIDENCE_POINTER).not.toContain("even where these instructions say a missing element will be flagged");
    expect(findDashConnectors(SECTION_EVIDENCE_POINTER)).toEqual([]);
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
    // 2026-10-29 (third): Line 242's limitations name the general practice
    // marker, and nothing else in the Line instructions holds one.
    for (const instructions of [buildSection244Instructions(), buildSection246Instructions()]) {
      expect(instructions).not.toContain("[INFERRED");
    }
    expect(buildSection242Instructions().match(/\[INFERRED[^\]]*\]/g)).toEqual([
      "[INFERRED: general practice, not in the source: what the writer should confirm with the client]",
    ]);
    // 2026-10-29 (third): the required story is now the order to follow as
    // far as the evidence goes (convex/ai/honestDrafting.test.ts).
    expect(buildSection244Instructions()).toContain("5. What was learned, or what stayed unresolved.");
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
      expect(prompt).toContain("A sentence followed by an [INFERRED: ...] marker is a marked inference the writer will check. Only its lack of a source is allowed");
      // Round 2: a marked event is still not allowed.
      expect(prompt).toContain("A marked event (a trial, test, result, finding, first approach or change of approach) the evidence does not describe is not allowed.");
      // Review round 1 (P3-7): its hedging is still judged.
      expect(prompt).toContain("Judge its hedging against the Confidence Map, and everything else about it, as usual.");
      expect(prompt).toContain("A [GAP: ...] or [INFERRED: ...] marker is a note to the writer, not report text, so it may name a source.");
    }
    expect(SUMMARY_PLAN_SELF_CHECK_SYSTEM_PROMPT).toContain(
      "fail it like a flat claim. A [GAP: ...] or [INFERRED: ...] marker is not a sentence of the section: it may name a source."
    );
  });

  it("the facts check never flags a marked inference for having no source, but still checks its figures", () => {
    for (const complete of [true, false]) {
      const instruction = factsMatchSourcesInstruction(complete);
      expect(instruction).toContain(
        "never flag it for having no source, but check a figure or a specific detail it states like any other, and flag an event it states (a trial, test, result, finding, first approach or change of approach) that the sources do not describe."
      );
      // Review round 1 (P3-8): and the marker's own words.
      expect(instruction).toContain("Check the marker's own words the same way: a figure in them, or what they say the sources say, must match the sources.");
    }
  });

  it("QA does not count a marked inference as fabricated, and still flags an unmarked one", () => {
    for (const prompt of [buildQaSystemPrompt(), buildQaSystemPrompt({ ...NO_STYLE_OVERRIDES, reportSkeleton: true })]) {
      expect(prompt).toContain("- Are [GAP] placeholders used where information is missing?");
      expect(prompt).toContain(
        "do not count it as untraceable or fabricated, unless it states an event (a trial, test, result, finding, first approach or change of approach) the evidence does not describe, which a marker does not allow. Flag an inference written as a stated fact, with no marker, as before."
      );
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

  // Review round 1 (P3-11): a kept marker must keep the sentence it marks.
  it("does not keep a pass that cuts the inferred sentence and leaves its marker on another", () => {
    const text = `The room was held at 2 C in every trial. Readiness was first judged from single readings of the probe. ${MARK} [GAP: the hold time]`;
    const shortened = `The room was held at 2 C in every trial. Readiness was judged from single probe readings. ${MARK} [GAP: the hold time]`;
    expect(inferredSentenceLoss(text, shortened)).toBeNull();
    expect(compressionLoss(text, shortened, "s244", 5)).toBeNull();
    const moved = `The room was held at 2 C in every trial. ${MARK} [GAP: the hold time]`;
    expect(inferredSentenceLoss(text, moved)).toBe(`dropped the sentence the marker ${MARK} belongs to`);
    expect(compressionLoss(text, moved, "s244", 5)).toBe(`dropped the sentence the marker ${MARK} belongs to`);
    // Each of two identical markers is judged at its own place.
    const two = `Alpha probes drifted at night in the cold room. ${MARK}\n\nBeta valves stuck after each long door opening. ${MARK}`;
    expect(inferredSentenceLoss(two, two)).toBeNull();
    expect(inferredSentenceLoss(two, `Alpha probes drifted at night. ${MARK}\n\nThe probes were replaced. ${MARK}`)).toBe(
      `dropped the sentence the marker ${MARK} belongs to`
    );
  });

  // Review round 2 (P3-3): a good squeeze passes, and a sentence is never split at "e.g.".
  it("keeps a heavy but faithful squeeze, and still refuses a marker moved to a similar neighbour", () => {
    const long = `The room was held at 2 C in every trial. Standard setpoint tables did not describe the warehouse's normal daily operating state for long dock door openings. ${MARK}`;
    const squeezed = `The room was held at 2 C in every trial. Setpoint tables did not describe normal operation. ${MARK}`;
    expect(inferredSentenceLoss(long, squeezed)).toBeNull();
    // A neighbour that shares words with the marked sentence is still told apart.
    const close = `The probe was read every ten seconds in the cold room. Readiness was first judged from single readings of the probe. ${MARK}`;
    expect(inferredSentenceLoss(close, `The probe was read every ten seconds in the cold room. ${MARK}`)).toBe(
      `dropped the sentence the marker ${MARK} belongs to`
    );
    expect(inferredSentenceLoss(close, `The probe was read every ten seconds. Readiness was judged from single probe readings. ${MARK}`)).toBeNull();
    // "e.g." and "approx." end no sentence: the marked sentence is the whole one.
    const abbreviated = `The room was held at 2 C. Loads varied, e.g. pallets of fish and approx. 3 t of ice, so the tables did not fit them. ${MARK}`;
    expect(inferredSentenceLoss(abbreviated, `The room was held at 2 C. Loads varied, so the tables did not fit. ${MARK}`)).toBeNull();
    expect(inferredSentenceLoss(abbreviated, `The room was held at 2 C. ${MARK}`)).toBe(`dropped the sentence the marker ${MARK} belongs to`);
    // Review round 3 (P3-3): a squeeze that keeps only the words before
    // "e.g." is still that sentence; split there, it would hold none of them.
    expect(inferredSentenceLoss(abbreviated, `The room was held at 2 C. Loads of fish varied across pallets. ${MARK}`)).toBeNull();
    // A short marked sentence needs 2 of its words, not 1.
    const short = `The room was cold at night. Doors stayed open. ${MARK}`;
    expect(inferredSentenceLoss(short, `The room was cold at night. Doors closed quickly. ${MARK}`)).toBe(
      `dropped the sentence the marker ${MARK} belongs to`
    );
    expect(inferredSentenceLoss(short, `The room was cold at night. Doors stayed open. ${MARK}`)).toBeNull();
  });

  it("reads a paragraph that ends on a marker as ending on a whole sentence", () => {
    expect(endedMidSentence(`One. ${MARK}`, `One. ${MARK}`)).toBeNull();
  });
});

describe("the pinned-request fixture", () => {
  it("lists each addition once, and taking them out gives the shared rules as before", () => {
    const additions = Object.values(INFERENCE_MARKER_ADDITIONS);
    expect(new Set(additions).size).toBe(additions.length);
    // No addition holds another, so stripping order cannot matter.
    for (const one of additions) for (const other of additions) if (one !== other) expect(one.includes(other)).toBe(false);
    // A draft request holds the rules block and the pointer once each.
    const request = buildSectionDraftRequest({
      instructions: buildSection244Instructions(),
      analysisJson: "{}",
      brainExemplars: "",
      lengthBudget: "",
      styleGuidance: "",
      contentPlanBlock: "",
      briefBlock: "",
    });
    const body = JSON.stringify(request);
    expect(inferenceMarkerCounts(body)).toEqual(INFERENCE_MARKER_COUNTS.draft);
    expect(withoutInferenceMarker(body, "draft")).not.toContain("INFERRED");
    // A count other than the stage's is refused, so a moved or doubled addition is caught.
    expect(() => withoutInferenceMarker(body, "none")).toThrow(/holds the inference marker's additions/);
    expect(() => withoutInferenceMarker(body.replace(JSON.stringify(SECTION_EVIDENCE_POINTER).slice(1, -1), ""), "draft")).toThrow();
    expect(withoutInferenceMarkerText(buildChatSystemPromptV2(), "chat")).not.toContain("INFERRED");
    expect(withoutInferenceMarkerText(SUMMARY_PLAN_SELF_CHECK_SYSTEM_PROMPT, "summarySelfCheck")).not.toContain("INFERRED");
    expect(withoutInferenceMarkerText(COMPRESSION_REQUEST.system, "compression")).not.toContain("INFERRED");
  });
});
