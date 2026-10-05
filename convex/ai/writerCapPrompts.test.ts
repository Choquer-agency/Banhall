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
  coverItemLoss,
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
  STYLE_GUIDANCE_SCAFFOLDS,
  WRITER_PREFERENCES_HEADING,
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

/** `count` words of letters only (no digit reads as a figure), as one paragraph. */
function plain(count: number): string {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  return `${Array.from({ length: count }, (_, index) => `w${letters[index % 26]}${letters[Math.floor(index / 26) % 26]}`).join(" ")}.`;
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
    // writer's cap is never called one. Owner decision (2026-10-04): every
    // COVER item is drafted even over the writer's cap, never over the
    // Locked cap.
    const plan = planLengthBudgetBlock("s244", "standard", { words: 520 });
    expect(plan).toBe(
      "\n\n# LENGTH (the Locked Rule outranks the plan; the writer's settings ask for less)\nThis Line holds at most 700 words and 100 form lines (Locked Rule). The writer's settings ask for at most 520 words in this Line. Write AT MOST 442 words in all. Cover every COVER item in as few words as it needs, and cover every COVER item even if that goes over the writer's cap, never over the Locked cap: when the plan holds more than the Locked cap fits, give each item fewer words rather than go over."
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
      SELF_CHECK_REQUEST.measuredCaps,
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
    // Two squeezes and the targeted pass: within the Locked cap it runs at
    // any overage of the writer's cap (Round 4); none is cut to fit.
    expect(run.create).toHaveBeenCalledTimes(3);
    expect(fit).toEqual({ text: draft, passes: 3, overLimit: false });
    expect(sectionMetrics(fit.text, "s246").words).toBe(300);
  });

  // 2026-10-04 (first), Round 4: release suite run 3 of 2026-10-05 left Line
  // 246 at 288 of 260 words after two squeezes, just past the targeted
  // pass's 10 percent reach (286), so that pass never ran.
  it("send the targeted pass at the writer's cap at an overage past its 10 percent reach, and keep a pass that meets it (Round 4)", async () => {
    // A signed-off item and 275 words of other wording: 288 of 260 words.
    const item = "The cure window held between 118 C and 124 C on routed panels.";
    const over = `${item}\n\n${plain(275)}`;
    expect(sectionMetrics(over, "s246")).toMatchObject({ words: 288, overLimit: false });
    // The pass cuts only other wording, and keeps the item.
    const under = `${item}\n\n${plain(227)}`;
    const run = client([over, over, under]);
    const fit = await compressWithinLimit(run.anthropicFor, "claude-sonnet-5", "s246", over, "standard", undefined, [], [], {
      finalCut: true,
      writerCap: CAP_260,
      coverItems: [item],
    });
    expect(run.create).toHaveBeenCalledTimes(3);
    const targeted = userText(run.create.mock.calls[2]![0]);
    expect(targeted.startsWith(COMPRESSION_REQUEST.writerCap.finalCutScaffold.prefix)).toBe(true);
    expect(targeted).toContain("Cut at least 41 words, so that it ends at 247 words or fewer");
    expect(fit).toEqual({ text: under, passes: 3, overLimit: false });
    expect(sectionMetrics(fit.text, "s246").words).toBeLessThanOrEqual(260);
  });

  it("hold a targeted pass for the writer's cap that drops a signed-off item, at any overage (Round 4)", async () => {
    const item = "The cure window held between 118 C and 124 C on routed panels.";
    const over = `${item} ${text(280, 1)}`;
    const dropped = text(240);
    const run = client([over, over, dropped]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fit = await compressWithinLimit(run.anthropicFor, "claude-sonnet-5", "s246", over, "standard", undefined, [], [], {
      finalCut: true,
      writerCap: CAP_260,
      coverItems: [item],
    });
    warn.mockRestore();
    expect(run.create).toHaveBeenCalledTimes(3);
    // The pass met the cap but took the item: held, the text kept whole.
    expect(fit).toEqual({ text: over, passes: 3, overLimit: false, heldForPlan: 1 });
  });

  // Round 4 review P2-1 (lead decision, owner informed): past the old reach,
  // figures and hedges outrank the writer's cap, as signed-off items do.
  it("hold a targeted pass past the old reach that drops a figure or a negation the text holds (Round 4, review P2-1)", async () => {
    const facts = "On the deep cove profile 13 percent of 180 panels fell short. The cause is not yet confirmed.";
    const factsWords = sectionMetrics(facts, "s246").words;
    const over = `${facts}\n\n${plain(340 - factsWords)}`;
    expect(sectionMetrics(over, "s246")).toMatchObject({ words: 340, overLimit: false });
    for (const cut of [
      `On the deep cove profile some panels fell short. The cause is not yet confirmed.\n\n${plain(225)}`,
      `On the deep cove profile 13 percent of 180 panels fell short. The cause is confirmed.\n\n${plain(225)}`,
    ]) {
      expect(sectionMetrics(cut, "s246").words).toBeLessThanOrEqual(260);
      const run = client([over, over, cut]);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const fit = await compressWithinLimit(run.anthropicFor, "claude-sonnet-5", "s246", over, "standard", undefined, [], [], {
        finalCut: true,
        writerCap: CAP_260,
      });
      const warned = warn.mock.calls.map((call) => String(call[0]));
      warn.mockRestore();
      expect(run.create).toHaveBeenCalledTimes(3);
      // Met the cap, but took a figure or the hedge: held, the text kept whole.
      expect(fit).toEqual({ text: over, passes: 3, overLimit: false, heldForFigures: 1 });
      expect(warned.some((line) => /pass 3 not kept: it dropped the (number|negation)/.test(line))).toBe(true);
    }
    // Within the old reach the pass is judged as before (Must keep lines only).
    const near = `${facts}\n\n${plain(280 - factsWords)}`;
    expect(sectionMetrics(near, "s246").words).toBe(280);
    const nearCut = `On the deep cove profile some panels fell short.\n\n${plain(225)}`;
    const nearRun = client([near, near, nearCut]);
    const nearFit = await compressWithinLimit(nearRun.anthropicFor, "claude-sonnet-5", "s246", near, "standard", undefined, [], [], {
      finalCut: true,
      writerCap: CAP_260,
    });
    expect(nearFit.text).toBe(nearCut);
  });

  it("leave the Locked targeted pass as it was: a text over a Locked limit past its reach gets none (Round 4)", async () => {
    const far = text(400);
    const run = client([], far);
    await compressWithinLimit(run.anthropicFor, "claude-sonnet-5", "s246", far, "standard", undefined, [], [], {
      finalCut: true,
      writerCap: CAP_260,
    });
    // 400 of 350 is over the Locked cap past its reach: two squeezes only.
    expect(run.create).toHaveBeenCalledTimes(2);
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

describe("the Self-check is told which caps code measures", () => {
  const base = {
    section: "244" as const,
    text: "One paragraph.",
    storylineText: "",
    confidenceMap: [],
    glossaryCandidates: [],
    writerInstructions: "# PD Writing Customized Settings\n\n- Line 244: no more than 520 words.\n\nKeep sentences under 25 words.",
    rules: [],
    model: "claude-sonnet-5",
  };

  it("quotes the measured rules and scopes the sentence to the writer-instruction verdicts (review P2-1)", () => {
    const told = buildSelfCheckUserMessage({
      ...base,
      measuredCaps: ["- Line 244: no more than 520 words.", "- Line 244: no more than 520 words."],
    });
    const sentence =
      "\n\nCode measures these caps of the writer's and reports them on their own: \"- Line 244: no more than 520 words.\". In the verdicts for the WRITER INSTRUCTIONS block, do not judge these caps, and do not mention this section's word or line count. Judge every other rule, including any other length rule.";
    expect(told).toContain(`--- END [WRITER INSTRUCTIONS] ---${sentence}`);
    expect(told.endsWith(sentence)).toBe(true);
    // No longer a blanket ban on caps and limits in every verdict.
    expect(told).not.toContain("never mention word counts, line counts, caps or limits");
    expect(buildSelfCheckUserMessage(base)).toBe(told.slice(0, -sentence.length));
    expect(buildSelfCheckUserMessage({ ...base, measuredCaps: [] })).toBe(buildSelfCheckUserMessage(base));
    // No writer instructions in the request: nothing to tell.
    expect(
      buildSelfCheckUserMessage({ ...base, writerInstructions: undefined, measuredCaps: ["- Line 244: no more than 520 words."] })
    ).not.toContain("Code measures these caps");
  });
});

describe("signed-off items outrank the writer's cap (owner decision, 2026-10-04)", () => {
  const COVER = "The edge sealer separated conductivity from heat on routed board panels.";
  const FILLER = "The team logged each trial in the shop book and compared it with the run before.";
  const withCover = (fillers: number) =>
    [COVER, ...Array.from({ length: fillers }, () => FILLER)].join(" ");

  it("finds the words of a signed-off item a pass dropped, and nothing when it keeps them", () => {
    expect(coverItemLoss(withCover(4), withCover(1), [COVER])).toBeNull();
    // The words are named as the matcher normalizes them.
    expect(coverItemLoss(withCover(4), FILLER, [COVER])).toBe(
      'dropped words of a signed-off item ("edg", "sealer", "separat")'
    );
    // Only the words the given text held count.
    expect(coverItemLoss(FILLER, FILLER, [COVER])).toBeNull();
  });

  it("does not keep a pass run only for the writer's cap that drops words of a signed-off item", async () => {
    const draft = withCover(12);
    const words = sectionMetrics(draft, "s246").words;
    expect(words).toBeGreaterThan(200);
    expect(sectionMetrics(draft, "s246").overLimit).toBe(false);
    const thinned = Array.from({ length: 8 }, () => FILLER).join(" ");
    const run = client([thinned, thinned], draft);
    const fit = await compressWithinLimit(run.anthropicFor, "claude-sonnet-5", "s246", draft, "standard", undefined, [COVER], [], {
      finalCut: true,
      writerCap: { words: 200 },
      coverItems: [COVER],
    });
    // Two squeezes, both held for the item, then the targeted pass (203
    // words is within its reach of 200), which comes back unchanged.
    expect(fit).toEqual({ text: draft, passes: 3, overLimit: false, heldForPlan: 2 });
    // Review re-check P2-a: a held pass whose own text is still over the
    // cap is counted apart, since the item is not why the Line stays over.
    const stillOver = Array.from({ length: 13 }, () => FILLER).join(" ");
    expect(sectionMetrics(stillOver, "s246").words).toBeGreaterThan(200);
    const longer = withCover(20);
    expect(sectionMetrics(longer, "s246").overLimit).toBe(false);
    const over = client([stillOver, stillOver], longer);
    const heldOver = await compressWithinLimit(over.anthropicFor, "claude-sonnet-5", "s246", longer, "standard", undefined, [COVER], [], {
      finalCut: true,
      writerCap: { words: 200 },
      coverItems: [COVER],
    });
    expect(heldOver).toMatchObject({ text: longer, overLimit: false, heldBack: 2 });
    expect(heldOver.heldForPlan).toBeUndefined();
    // A pass that keeps the item's words is kept.
    const shorter = withCover(8);
    const keeps = client([shorter], draft);
    const kept = await compressWithinLimit(keeps.anthropicFor, "claude-sonnet-5", "s246", draft, "standard", undefined, [COVER], [], {
      finalCut: true,
      writerCap: { words: 200 },
      coverItems: [COVER],
    });
    expect(kept).toEqual({ text: shorter, passes: 1, overLimit: false });
  });

  it("judges a pass for a Locked limit as before", async () => {
    const draft = withCover(24);
    expect(sectionMetrics(draft, "s246").overLimit).toBe(true);
    const thinned = Array.from({ length: 14 }, () => FILLER).join(" ");
    const run = client([thinned], draft);
    const fit = await compressWithinLimit(run.anthropicFor, "claude-sonnet-5", "s246", draft, "standard", undefined, [COVER], [], {
      finalCut: true,
      writerCap: { words: 260 },
      coverItems: [COVER],
    });
    expect(fit.text).toBe(thinned);
    expect(fit.heldForPlan).toBeUndefined();
  });

  it("every writer-preference block opens with the heading the Seed request looks for (review P3-4)", () => {
    for (const scaffold of [
      STYLE_GUIDANCE_SCAFFOLDS.writerDefault,
      STYLE_GUIDANCE_SCAFFOLDS.writerWithWaivers,
      STYLE_GUIDANCE_SCAFFOLDS.writerSkeletonWaived,
    ]) {
      expect(scaffold.prefix).toContain(`\n\n${WRITER_PREFERENCES_HEADING}`);
    }
    expect(STYLE_GUIDANCE_SCAFFOLDS.learned.prefix).not.toContain(WRITER_PREFERENCES_HEADING);
  });
});
