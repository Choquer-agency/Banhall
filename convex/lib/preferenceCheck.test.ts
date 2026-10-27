import { describe, expect, it } from "vitest";
import { checkPreferenceText, preferenceTextKey, type PreferenceRefusal } from "./preferenceCheck";

const NAMES = ["Acme Pumps", "Borealis Mining", "Dana Whitlock", "Choquer"];

/** Style preferences a writer could hold: none may be refused. */
const STYLE_PREFERENCES = [
  "Prefers 'we' to 'the company'.",
  "Keeps sentences under 25 words.",
  "Starts each section with the result, then the method.",
  "Uses Canadian spelling.",
  "Uses the Oxford comma.",
  "Keeps Line 244 short and to the point.",
  "Avoids the passive voice.",
  "Writes in the first person plural.",
  "Names the uncertainty before the work that answered it.",
  "Uses plain words instead of jargon.",
  "Keeps paragraphs to 4 sentences.",
  "Never opens a sentence with 'this'.",
  "Prefers short bullets over long paragraphs.",
  "Puts figures after the claim they support.",
  "Writes in the past tense for work already done.",
  "Avoids repeating the same word in one sentence.",
  "Uses headings only for the three Lines.",
  "Keeps the Brief's wording when a Seed already says it well.",
  "Leads with what was uncertain, then the experiments.",
  "Spells out what changed between iterations.",
  // Review probe: refused before, style all the same.
  "Uses T661 wording for each Line.",
  "Uses 'we' rather than 'I'.",
  "Avoids starting bullets with 'The'.",
  "Keeps the summary to 2-3 sentences.",
  "Writes in Canadian English, not US English.",
  "Uses AI only as a noun.",
  "Avoids ALL CAPS.",
  "Uses two spaces after a full stop.",
  // Re-check of 29d88d40: refused by the first fix, style all the same.
  "At most 25 words per sentence.",
  "Three sentences per paragraph at most.",
  "Keeps paragraphs to three or four sentences.",
  "Uses two or three bullets at most.",
  "Spells out numbers under ten.",
  "Writes percent as a symbol.",
  "Prefers three short paragraphs.",
  "Keeps sentences to 20 to 25 words.",
  "Writes \"CRA\" without spelling it out.",
  "Uses SI units.",
  "Writes headings in Title Case.",
  "Writes in the third person.",
  "Keeps each Line to half a page.",
  "Never uses the same word twice in a sentence.",
  // Third re-check: refused by the second fix, style all the same.
  "Uses digits for 10 and above.",
  "Uses digits for numbers 10 and above.",
  "Uses numerals for 10 and over.",
  "Writes numbers of 10 or more as digits.",
  "Spells out numbers one through nine.",
  "Spells out numbers under ten and uses digits for 10 or more.",
  "Writes two or three short plain sentences.",
];

/** Preferences that carry a company or project fact: each must be refused. */
const FACT_PREFERENCES: Array<[string, PreferenceRefusal]> = [
  ["Calls the [CLIENT_1] pump 'the prototype'.", "placeholder"],
  ["Mentions PERSON_2 as the lead engineer.", "placeholder"],
  ["Sends drafts to dana@acme.example first.", "contact"],
  ["Calls the XR-200 rig 'the test bench'.", "code"],
  ["Says the seal held at 4.2 bar.", "number"],
  ["Says trials ran in 2023.", "number"],
  ["Calls the HydroFlex unit 'the prototype'.", "capitalized"],
  ["Writes 'the custom seal held at high pressure' every time.", "quote"],
  ["Writes 'Seal' with a capital.", "quote"],
  ["Mentions acme pumps by name in every Line.", "name"],
  ["Credits dana whitlock for the method.", "name"],
  // Review probe: passed before.
  ["Says the seal held at four bar.", "number"],
  ["Says trials ran in twenty twenty-three.", "number"],
  ["Says the pump runs 500 lines per minute.", "number"],
  ["Keeps 2023 words.", "number"],
  ["Keeps sentences under 1,000,000 words.", "number"],
  ["Mentions 株式会社 in every Line.", "script"],
  // Re-check of 29d88d40: passed before.
  ["Notes the third prototype failed under load.", "number"],
  ["Says the team tested a fifth seal design.", "number"],
  ["Says yields rose by half after the redesign.", "number"],
  ["Says costs were a quarter of budget.", "number"],
  ["Says output was 40 percent higher.", "number"],
  ["Says the line made forty units per hour.", "number"],
  ["Says the press ran 300 cycles per shift.", "number"],
  // Second re-check: passed the first fix.
  ["Says output rose by half in a short sentence.", "number"],
  ["Reports the yield as 40 in a short paragraph.", "number"],
  ["Reports numbers rose by 40 percent.", "number"],
  ["Reports the yield as 40 in a paragraph.", "number"],
  // Third re-check: passed the second fix.
  ["Says the numbers rose to 40 percent.", "number"],
  ["Notes that numbers fell below 300 units.", "number"],
  ["Says defect numbers dropped to twelve.", "number"],
  ["Reports numbers of 40 percent.", "number"],
];

describe("checkPreferenceText (Phase E, E1a)", () => {
  it("lets every style preference stand", () => {
    const refused = STYLE_PREFERENCES.map((text) => [text, checkPreferenceText(text, { names: NAMES })] as const).filter(
      ([, result]) => !result.ok
    );
    expect(refused).toEqual([]);
  });

  it("refuses each preference that carries a fact, for its reason", () => {
    for (const [text, reason] of FACT_PREFERENCES) {
      expect([text, checkPreferenceText(text, { names: NAMES })]).toEqual([text, { ok: false, reason }]);
    }
  });

  it("refuses empty and over-long text", () => {
    expect(checkPreferenceText("   ", { names: [] })).toEqual({ ok: false, reason: "empty" });
    expect(checkPreferenceText("Keeps it short. ".repeat(12), { names: [] })).toEqual({ ok: false, reason: "too_long" });
  });

  it("for a suggestion, refuses a word its request capitalizes as a name, and a term from fewer than three companies", () => {
    const request = [
      { text: "The flotation trials at the mill ran long, and Dana measured recovery.", company: "a" },
      { text: "We tested recovery again; the flotation trials improved it.", company: "a" },
      { text: "Recovery fell in the second phase.", company: "b" },
    ];
    // "dana" is only ever capitalized mid-sentence in the request.
    expect(checkPreferenceText("Credits dana for each result.", { names: [], request })).toEqual({ ok: false, reason: "request_capitalized" });
    // "flotation" is a term of one company's work, not of writing.
    expect(checkPreferenceText("Calls the flotation work 'the trials'.", { names: [], request })).toEqual({ ok: false, reason: "request_word" });
    // A style word the request capitalizes stays allowed (review).
    expect(checkPreferenceText("Uses Canadian spelling.", { names: [], request: [{ text: "Use Canadian spelling, said Dana.", company: "a" }] })).toEqual({ ok: true });
    // Words of writing pass, even when the request uses them.
    expect(checkPreferenceText("Keeps the result before the method.", { names: [], request })).toEqual({ ok: true });
  });

  it("keys the same preference written twice alike", () => {
    expect(preferenceTextKey("Prefers 'we' to 'the company'.")).toBe(preferenceTextKey("prefers WE to the company"));
  });
});
