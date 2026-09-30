/**
 * Figures with a unit, read from plan wording and drafted text. Pure: no
 * database, no model.
 *
 * 2026-09-30 (first): the release suite's hint named the paragraphs that hold
 * a dropped uncertainty's distinctive figures (scripts/seed-plan-eval).
 * 2026-09-30 (second): moved here so the product uses the same reading. A
 * LEAVE OUT verdict that flags a signed-off item by its figures is recorded
 * applied (convex/ai/orderedGeneration.ts), and a repair that keeps fewer
 * paragraphs holding a signed-off figure is set aside. Review fixes: a hyphen
 * between number and unit, spelled units, thousands separators, a minus
 * sign, and a capital label such as "Trial 4 C" read right; product and
 * suite compute a dropped uncertainty's own figures by one rule
 * (droppedUncertaintyFigures).
 */

/** Each unit's spellings, longest first, and the one form it is read as. */
const UNITS: ReadonlyArray<[string, string]> = [
  [String.raw`degrees?\s*celsius`, "C"],
  [String.raw`degrees?\s*c`, "C"],
  [String.raw`[°º]\s*c`, "C"],
  [String.raw`degrees?`, "C"],
  [String.raw`per\s*cent`, "percent"],
  [String.raw`percent`, "percent"],
  [String.raw`%`, "percent"],
  [String.raw`days?`, "days"],
  [String.raw`weeks?`, "weeks"],
  [String.raw`months?`, "months"],
  [String.raw`years?`, "years"],
  [String.raw`hours?`, "hours"],
  [String.raw`hrs?`, "hours"],
  [String.raw`minutes?`, "minutes"],
  [String.raw`mins?`, "minutes"],
  [String.raw`milliseconds?`, "ms"],
  [String.raw`seconds?`, "seconds"],
  [String.raw`secs?`, "seconds"],
  [String.raw`milligrams?\s+per\s+lit(?:re|er)s?`, "mg/L"],
  [String.raw`mg\s+per\s+lit(?:re|er)s?`, "mg/L"],
  [String.raw`mg\/l`, "mg/L"],
  [String.raw`ppm`, "ppm"],
  [String.raw`ppi`, "ppi"],
  [String.raw`millimet(?:re|er)s?\s+per\s+second`, "mm/s"],
  [String.raw`mm\/s`, "mm/s"],
  [String.raw`kilograms?\s+per\s+second`, "kg/s"],
  [String.raw`kg\/s`, "kg/s"],
  [String.raw`millimet(?:re|er)s?`, "mm"],
  [String.raw`centimet(?:re|er)s?`, "cm"],
  [String.raw`nanomet(?:re|er)s?`, "nm"],
  [String.raw`kilograms?`, "kg"],
  [String.raw`kilonewtons?`, "kN"],
  [String.raw`newtons?`, "N"],
  [String.raw`kilopascals?`, "kPa"],
  [String.raw`megapascals?`, "MPa"],
  [String.raw`ms`, "ms"],
  [String.raw`mm`, "mm"],
  [String.raw`cm`, "cm"],
  [String.raw`nm`, "nm"],
  [String.raw`kg`, "kg"],
  [String.raw`kn`, "kN"],
  [String.raw`kpa`, "kPa"],
  [String.raw`mpa`, "MPa"],
  [String.raw`psi`, "psi"],
  [String.raw`rpm`, "rpm"],
  // A single letter is a unit only after a space: "7 C", "20 N", "30 s",
  // "6 h" (never "1990s" or "4C"). Its case is checked below.
  [String.raw`(?<=\s)[cnsh]`, "letter"],
];

/**
 * A number: thousands separators allowed ("1,350"), a decimal part, and a
 * minus sign where no word or digit comes just before it ("-5", not the
 * hyphen of "6-12").
 */
const NUMBER = String.raw`(?:(?<![\w.])[-\u2212])?(?:\d{1,3}(?:,\d{3})+(?!\d)|\d+)(?:\.\d+)?`;
/**
 * What joins the numbers of a list or a range: "44 and 29", "36 to 40", "19
 * vs 6", "6-12". A comma before three digits is a thousands separator, never
 * a join ("1,350").
 */
const JOIN = String.raw`\s*(?:,(?!\d{3}(?!\d))|and|or|to|[-\u2013]|vs\.?|versus)\s*`;
const FIGURE = new RegExp(
  String.raw`(?<![\w.])((?:${NUMBER}${JOIN})*)(${NUMBER})(?:\s*-\s*|\s*)(${UNITS.map(([pattern]) => `(?:${pattern})`).join("|")})(?![A-Za-z])`,
  "gi"
);
const NUMBERS = new RegExp(NUMBER, "g");

/** Words that name a trial, loop or other item, so a capital letter after its number is a label ("Trial 4 C"). */
const LABEL_WORDS = /^(?:trial|test|run|loop|phase|stage|step|round|batch|zone|unit|line|item|figure|fig|table|section|experiment|iteration|sample|series|tank|cell|bay|site|version|option|case|group|model|type|part|lot|coupon|pour|rig|pilot|appendix|paragraph|week|day|month)$/i;

/** One unit spelling read as its single form, or null when it is no unit here. */
function unitOf(raw: string, before: string): string | null {
  const spelled = raw.replace(/\s+/g, " ").trim();
  for (const [pattern, unit] of UNITS) {
    if (!new RegExp(`^(?:${pattern})$`, "i").test(spelled) && !(unit === "letter" && /^[cnsh]$/i.test(spelled))) continue;
    if (unit !== "letter") return unit;
    // "C" and "N" only in capitals, "s" and "h" only in lower case.
    if (spelled === "C" || spelled === "N") {
      // A capital after a label's number is a label, not a unit: "Trial 4 C".
      // So is one after a capitalised word inside a sentence ("Bay 4 C").
      const word = /([A-Za-z]+)\.?\s+$/.exec(before);
      if (word) {
        const sentenceStart = /(?:^|[.!?]\s+)$/.test(before.slice(0, before.length - word[0].length));
        if (LABEL_WORDS.test(word[1]!)) return null;
        if (/^[A-Z]/.test(word[1]!) && !sentenceStart) return null;
      }
      return spelled;
    }
    if (spelled === "s") return "seconds";
    if (spelled === "h") return "hours";
    return null;
  }
  return null;
}

/** A number as a figure reads it: no thousands separators, a plain minus. */
function numberOf(raw: string): string {
  return raw.replace(/\u2212/g, "-").replace(/,/g, "");
}

/**
 * The figures with a unit in a text, normalised ("6 degrees C", "6 C" and
 * "6°C" read alike; "44 and 29 days" and "19 vs 6 days" give both; "a 5-week
 * target" is "5 weeks"; "1,350 C" is "1350 C"; "-5 C" keeps its minus).
 */
export function figuresOf(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(FIGURE)) {
    const before = text.slice(0, match.index);
    const unit = unitOf(match[3]!, before);
    if (!unit) continue;
    // A list that opens after a label word counts its first numbers as the
    // label's ("by day 10 and 0.4 mg/L" is "0.4 mg/L" only).
    const label = /([A-Za-z]+)\.?\s+$/.exec(before);
    const listed = [
      ...(label && LABEL_WORDS.test(label[1]!) ? [] : match[1]!.match(NUMBERS) ?? []),
      match[2]!,
    ];
    for (const number of listed) found.add(`${numberOf(number)} ${unit}`);
  }
  return [...found];
}

/**
 * The figures of `own` texts that no `plan` text uses: what only they say,
 * such as a dropped uncertainty's own trial results.
 */
export function distinctiveFigures(own: readonly string[], plan: readonly string[]): string[] {
  const common = new Set(plan.flatMap(figuresOf));
  return [...new Set(own.flatMap(figuresOf))].filter((figure) => !common.has(figure));
}

/**
 * 2026-09-30 (second, review P3-2): one rule for a dropped uncertainty's own
 * figures, shared by the product and the release suite: the figures of its
 * wording and of the experiments and advancements that recorded it (as
 * frozen at sign-off), that no signed-off item of the plan uses (every Line,
 * skipped steps aside).
 */
export function droppedUncertaintyFigures(args: {
  wording: readonly string[];
  /** The recorded experiments' and advancements' wording. */
  references: ReadonlyArray<{ wording: readonly string[] }>;
  /** The wording of every signed-off item, skipped steps aside. */
  planWording: ReadonlyArray<readonly string[]>;
}): string[] {
  return distinctiveFigures(
    [args.wording.join(" "), ...args.references.map((reference) => reference.wording.join(" "))],
    args.planWording.map((wording) => wording.join(" "))
  );
}
