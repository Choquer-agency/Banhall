/**
 * 2026-10-04 (first): a writer's whole-Line cap reaches the drafting, repair
 * and shortening requests, and the Self-check is told code measures caps.
 * Release suite 2026-10-04 (fixture writer-settings-document, fictional
 * Velloway powder-on-MDF project): the drafter was asked for 297 words under
 * a heading that called it a Locked Rule, so every Line broke the writer's
 * 260, 520 and 260-word caps.
 */
import { describe, expect, it, vi } from "vitest";
import {
  compressSection,
  compressWithinLimit,
  compressionTargetWords,
  finalCutTargetWords,
  lengthBudgetBlock,
} from "./pipeline";
import { planLengthBudgetBlock } from "./orderedGeneration";
import { buildSelfCheckUserMessage } from "./selfCheck";
import {
  COMPRESSION_REQUEST,
  LENGTH_BUDGET_SCAFFOLD,
  ORDERED_PROMPT_SCAFFOLDS,
  SELF_CHECK_REQUEST,
} from "./promptDefinitions";
import type { GenerationClient, GenerationMessageParams } from "./openrouterCore";
import { sectionMetrics } from "../lib/lineLimits";

const CAP_260 = { words: 260 };

function userText(params: GenerationMessageParams): string {
  const content = params.messages[0]?.content;
  return typeof content === "string"
    ? content
    : (content ?? []).map((block) => ("text" in block ? block.text : "")).join("");
}

/** A client that answers each compression request with the next text, then with `echo`. */
function client(answers: string[] = [], echo = "") {
  const queue = [...answers];
  const create = vi.fn(async (_params: GenerationMessageParams) => {
    const text = queue.shift() ?? echo;
    return {
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    };
  });
  const anthropic = { messages: { create } } as unknown as GenerationClient;
  return { create, anthropicFor: () => anthropic };
}

/** `count` words in `paragraphs` paragraphs of short words. */
function text(count: number, paragraphs = 3): string {
  const words = Array.from({ length: count }, (_, index) => `w${index}`);
  const size = Math.ceil(count / paragraphs);
  const out: string[] = [];
  for (let start = 0; start < count; start += size) out.push(`${words.slice(start, start + size).join(" ")}.`);
  return out.join("\n\n");
}

describe("the length blocks under a writer's cap", () => {
  it("are sent byte for byte as before without a writer's cap", () => {
    for (const key of ["s242", "s244", "s246"] as const) {
      expect(lengthBudgetBlock(key, "standard", 297, null)).toBe(lengthBudgetBlock(key, "standard", 297));
      expect(planLengthBudgetBlock(key, "standard", null)).toBe(planLengthBudgetBlock(key, "standard"));
    }
    expect(lengthBudgetBlock("s242", "standard", 297)).toBe(
      "\n\n# LENGTH BUDGET (CRA form constraint, hard requirement)\nThe CRA form field for this section holds at most 50 lines of 78 characters, and EVERY blank line between paragraphs also costs one full line. Write AT MOST 297 words total. Prefer fewer, denser paragraphs (each blank line spent on a paragraph break is a line of content lost). Do NOT pad. If the material exceeds the budget, keep the most technically load-bearing content and cut the rest."
    );
  });

  it("state the CRA limit, then the writer's cap as the writer's settings, then the target", () => {
    expect(lengthBudgetBlock("s242", "standard", 221, CAP_260)).toBe(
      "\n\n# LENGTH BUDGET (CRA form constraint and the writer's settings, hard requirement)\nThe CRA form field for this section holds at most 50 lines of 78 characters, and EVERY blank line between paragraphs also costs one full line. The writer's settings ask for at most 260 words in this section. Write AT MOST 221 words total. Prefer fewer, denser paragraphs (each blank line spent on a paragraph break is a line of content lost). Do NOT pad. If the material exceeds the budget, keep the most technically load-bearing content and cut the rest."
    );
    // The signed-off plan's block: the Locked cap is the Locked Rule; the
    // writer's cap is never called one.
    const plan = planLengthBudgetBlock("s244", "standard", { words: 520 });
    expect(plan).toBe(
      "\n\n# LENGTH (the Locked Rule and the writer's settings outrank the plan)\nThis Line holds at most 700 words and 100 form lines (Locked Rule). The writer's settings ask for at most 520 words in this Line. Write AT MOST 442 words in all. Cover every COVER item in as few words as it needs: when the plan holds more than fits, give each item fewer words rather than go over."
    );
    expect(plan.indexOf("(Locked Rule)")).toBeLessThan(plan.indexOf("The writer's settings"));
    expect(plan.indexOf("The writer's settings")).toBeLessThan(plan.indexOf("Write AT MOST"));
    expect(plan).not.toMatch(/Locked Rule\)\. The writer's settings ask for at most \d+ words in this Line \(Locked/);
    expect(lengthBudgetBlock("s242", "standard", 221, CAP_260)).not.toContain("Locked");
    expect(planLengthBudgetBlock("s242", "standard", { words: 240, lines: 40 })).toContain(
      "The writer's settings ask for at most 240 words and 40 form lines in this Line. Write AT MOST 204 words in all."
    );
  });

  it("carry no em or en dash", () => {
    for (const scaffold of [
      LENGTH_BUDGET_SCAFFOLD.writerCap,
      ORDERED_PROMPT_SCAFFOLDS.planLengthBudgetWriterCap,
      COMPRESSION_REQUEST.writerCap,
      SELF_CHECK_REQUEST.measuredCapsInstruction,
    ]) {
      expect(JSON.stringify(scaffold)).not.toMatch(/[\u2013\u2014]/);
    }
  });
});

describe("the shortening passes under a writer's cap", () => {
  it("aim under the writer's cap with the Locked headroom, and as before without one", () => {
    expect(compressionTargetWords("s246", "standard")).toBe(297);
    expect(compressionTargetWords("s246", "standard", 1, undefined, null)).toBe(297);
    expect(compressionTargetWords("s246", "standard", 1, undefined, CAP_260)).toBe(221);
    expect(compressionTargetWords("s246", "standard", 0.85, undefined, CAP_260)).toBe(188);
    expect(compressionTargetWords("s244", "standard", 1, undefined, { words: 520 })).toBe(442);
    // A writer's line cap holds a Line over it to the words that fit it.
    expect(compressionTargetWords("s242", "standard", 1, { words: 300, lines: 45 }, { lines: 40 })).toBe(226);
    expect(finalCutTargetWords("s246", { words: 270, lines: 30 })).toBe(332);
    expect(finalCutTargetWords("s246", { words: 270, lines: 30 }, CAP_260)).toBe(247);
  });

  it("names the CRA limits and the writer's cap in the request, and the request is as before without one", async () => {
    const draft = text(300);
    const withCap = client(["short"]);
    await compressSection(withCap.anthropicFor(), "claude-sonnet-5", "s246", draft, "standard", 1, [], [], CAP_260);
    const m = sectionMetrics(draft, "s246");
    expect(userText(withCap.create.mock.calls[0]![0])).toBe(
      `This section is ${m.lines} lines and 300 words. The CRA field allows at most 50 lines of 78 characters (blank lines between paragraphs each cost one line) and at most 350 words, and the writer's settings ask for at most 260 words in this section. Rewrite it to AT MOST 221 words: cut at least 79 words, about 26 percent of it, while preserving the technical substance. Merge paragraphs where natural; fewer paragraph breaks save lines.\n\n${draft}`
    );
    const without = client(["short"]);
    const nullCap = client(["short"]);
    await compressSection(without.anthropicFor(), "claude-sonnet-5", "s246", draft, "standard");
    await compressSection(nullCap.anthropicFor(), "claude-sonnet-5", "s246", draft, "standard", 1, [], [], null);
    expect(nullCap.create.mock.calls[0]![0]).toEqual(without.create.mock.calls[0]![0]);
    expect(userText(without.create.mock.calls[0]![0])).toContain("but the CRA field allows at most 50 lines");
  });

  it("run while a Line is within the Locked cap but over the writer's, and keep a pass that meets it", async () => {
    const draft = text(300);
    const shorter = text(240);
    const run = client([shorter]);
    const fit = await compressWithinLimit(run.anthropicFor, "claude-sonnet-5", "s246", draft, "standard", undefined, [], [], {
      finalCut: true,
      writerCap: CAP_260,
    });
    expect(run.create).toHaveBeenCalledTimes(1);
    expect(fit).toEqual({ text: shorter, passes: 1, overLimit: false });
    // Without the writer's cap the same Line is within its limits: no pass.
    const none = client([shorter]);
    const locked = await compressWithinLimit(none.anthropicFor, "claude-sonnet-5", "s246", draft, "standard", undefined, [], [], { finalCut: true });
    expect(none.create).not.toHaveBeenCalled();
    expect(locked).toEqual({ text: draft, passes: 0, overLimit: false });
  });

  it("never cut the text to fit: passes that do not shorten leave it whole and over the writer's cap", async () => {
    const draft = text(300);
    const run = client([], draft);
    const fit = await compressWithinLimit(run.anthropicFor, "claude-sonnet-5", "s246", draft, "standard", undefined, [], [], {
      finalCut: true,
      writerCap: CAP_260,
    });
    // Two squeezes; 300 words is beyond the targeted pass's reach of the
    // writer's cap and within the Locked cap, so no targeted pass.
    expect(run.create).toHaveBeenCalledTimes(2);
    expect(fit).toEqual({ text: draft, passes: 2, overLimit: false });
    expect(sectionMetrics(fit.text, "s246").words).toBe(300);
  });

  it("keep the Locked limits first: a pass under the writer's cap but over a Locked limit is not kept", async () => {
    const draft = text(300);
    // 250 words in 28 one-line paragraphs: 55 form lines, over the 50-line Locked limit.
    const overLines = text(250, 28);
    expect(sectionMetrics(overLines, "s246")).toMatchObject({ words: 250, lines: 55, overLimit: true });
    const run = client([overLines, overLines]);
    const fit = await compressWithinLimit(run.anthropicFor, "claude-sonnet-5", "s246", draft, "standard", undefined, [], [], {
      finalCut: true,
      writerCap: CAP_260,
    });
    expect(fit.text).toBe(draft);
    expect(fit.overLimit).toBe(false);
  });

  it("send the targeted pass at the writer's cap when within its reach, and at the Locked cap otherwise", async () => {
    const near = text(270);
    const run = client([], near);
    await compressWithinLimit(run.anthropicFor, "claude-sonnet-5", "s246", near, "standard", undefined, [], [], {
      finalCut: true,
      writerCap: CAP_260,
    });
    expect(run.create).toHaveBeenCalledTimes(3);
    const targeted = userText(run.create.mock.calls[2]![0]);
    expect(targeted.startsWith(COMPRESSION_REQUEST.writerCap.finalCutScaffold.prefix)).toBe(true);
    expect(targeted).toContain("and the writer's settings ask for at most 260 words in this section. Cut at least 23 words, so that it ends at 247 words or fewer");

    // 370 words: beyond the writer's reach, within the Locked one, so the
    // Locked targeted pass still runs as before.
    const over = text(370);
    const locked = client([], over);
    await compressWithinLimit(locked.anthropicFor, "claude-sonnet-5", "s246", over, "standard", undefined, [], [], {
      finalCut: true,
      writerCap: CAP_260,
    });
    expect(locked.create).toHaveBeenCalledTimes(3);
    const lockedTargeted = userText(locked.create.mock.calls[2]![0]);
    expect(lockedTargeted.startsWith(COMPRESSION_REQUEST.finalCut.userScaffold.prefix)).toBe(true);
    expect(lockedTargeted).toContain("Cut at least 38 words, so that it ends at 332 words or fewer");
  });
});

describe("the Self-check is told code measures caps", () => {
  const base = {
    section: "244" as const,
    text: "One paragraph.",
    storylineText: "",
    confidenceMap: [],
    glossaryCandidates: [],
    writerInstructions: "# PD Writing Customized Settings\n\n- Line 244: no more than 520 words.",
    rules: [],
    model: "claude-sonnet-5",
  };

  it("after the writer instructions, only when a writer's cap is measured on the Line", () => {
    const told = buildSelfCheckUserMessage({ ...base, measuredCaps: true });
    expect(told).toContain(`--- END [WRITER INSTRUCTIONS] ---${SELF_CHECK_REQUEST.measuredCapsInstruction}`);
    expect(told.endsWith(SELF_CHECK_REQUEST.measuredCapsInstruction)).toBe(true);
    expect(buildSelfCheckUserMessage(base)).toBe(told.slice(0, -SELF_CHECK_REQUEST.measuredCapsInstruction.length));
    // No writer instructions in the request: nothing to tell.
    expect(
      buildSelfCheckUserMessage({ ...base, writerInstructions: undefined, measuredCaps: true })
    ).not.toContain(SELF_CHECK_REQUEST.measuredCapsInstruction);
  });
});
