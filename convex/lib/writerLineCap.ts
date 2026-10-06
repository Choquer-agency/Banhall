/**
 * 2026-10-04 (first): a writer's whole-Line word and line caps.
 *
 * The Writer Profile (a saved profile, or a settings document applied as the
 * profile) can cap a Line below its Locked CRA cap ("Line 242: no more than
 * 260 words."). The Self-check has always measured such a cap, clipped to
 * the Locked caps. Release suite 2026-10-04 (fixture writer-settings-document)
 * found that the drafter, the repair and the shortening passes only ever saw
 * the Locked cap, so every Line broke the writer's cap. This module is the
 * one place that reads a rule's cap, clips it to the Locked caps and picks a
 * Line's tightest whole-Line cap, so drafting, repair, shortening and the
 * Self-check cannot disagree. Framework-free.
 */
import {
  DRAFT_WORD_CAP_SHARE,
  LINE_LIMITS,
  WORD_BUDGET_USABLE_LINE_FACTOR,
  WORD_BUDGET_WORDS_PER_LINE,
  WORD_CAPS,
  draftWordTarget,
  type LengthTarget,
  type SectionKey,
} from "./lineLimits";
import { sectionKeyOf, type SectionNumber, type SelfCheckRule } from "./orderedChain";

/** A rule bears on a Line when it names no section or names that Line. */
export function ruleBearsOnLine(
  rule: Pick<SelfCheckRule, "section">,
  section: SectionNumber
): boolean {
  return rule.section === undefined || rule.section === section;
}

/** The cap a writer's rule asks for, never above the Locked limit. */
export function capWithinLocked(asked: number, lockedLimit: number): number {
  return Math.min(asked, lockedLimit);
}

/**
 * A Line's tightest whole-Line writer cap, each part present only when it
 * is below the Locked cap. Null when the writer sets no such cap.
 */
export type WriterLineCap = {
  words?: number;
  lines?: number;
};

/**
 * The writer's cap for one Line: the tightest cap of the profile's rules
 * that bear on the Line (no section, or this one) and bind the whole Line
 * (no paragraph), each clipped to the Locked cap as the Self-check clips
 * it. A cap at or above the Locked cap changes nothing and is left out.
 */
export function writerLineCap(
  section: SectionNumber,
  rules: readonly SelfCheckRule[]
): WriterLineCap | null {
  const key = sectionKeyOf(section);
  let words: number | undefined;
  let lines: number | undefined;
  for (const rule of rules) {
    if (!ruleBearsOnLine(rule, section) || rule.paragraphIndex !== undefined) continue;
    if (rule.maxWords !== undefined) {
      const cap = capWithinLocked(rule.maxWords, WORD_CAPS[key]);
      if (cap < WORD_CAPS[key]) words = Math.min(words ?? cap, cap);
    }
    if (rule.maxLines !== undefined) {
      const cap = capWithinLocked(rule.maxLines, LINE_LIMITS[key]);
      if (cap < LINE_LIMITS[key]) lines = Math.min(lines ?? cap, cap);
    }
  }
  if (words === undefined && lines === undefined) return null;
  return {
    ...(words !== undefined ? { words } : {}),
    ...(lines !== undefined ? { lines } : {}),
  };
}

/** The word cap and line limit a Line's text must meet: the writer's, else the Locked ones. */
export function effectiveLineLimits(
  key: SectionKey,
  cap: WriterLineCap | null
): { wordCap: number; lineLimit: number } {
  return {
    wordCap: cap?.words ?? WORD_CAPS[key],
    lineLimit: cap?.lines ?? LINE_LIMITS[key],
  };
}

/** The words that fit `lines` form lines, by the length budget's own rule. */
export function wordsForLines(lines: number): number {
  return Math.round(lines * WORD_BUDGET_USABLE_LINE_FACTOR * WORD_BUDGET_WORDS_PER_LINE);
}

/**
 * The words an ordered-chain draft and its repair ask for. With no writer
 * cap it is the Locked draft target (draftWordTarget, unchanged). With one,
 * it is never above DRAFT_WORD_CAP_SHARE of the writer's word cap, or of the
 * words that fit the writer's line cap: the same headroom the Locked design
 * leaves, since a draft overshoots its ask whichever cap the ask comes from.
 */
export function lineDraftWordTarget(
  key: SectionKey,
  target: LengthTarget,
  cap: WriterLineCap | null
): number {
  const locked = draftWordTarget(key, target);
  const ceilings = [
    ...(cap?.words !== undefined ? [cap.words] : []),
    ...(cap?.lines !== undefined ? [wordsForLines(cap.lines)] : []),
  ];
  if (ceilings.length === 0) return locked;
  return Math.min(locked, Math.floor(Math.min(...ceilings) * DRAFT_WORD_CAP_SHARE));
}

/** "260 words", "40 form lines" or "260 words and 40 form lines". */
export function writerCapText(cap: WriterLineCap): string {
  return [
    ...(cap.words !== undefined ? [`${cap.words} words`] : []),
    ...(cap.lines !== undefined ? [`${cap.lines} form lines`] : []),
  ].join(" and ");
}
