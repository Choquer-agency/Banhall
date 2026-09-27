import { describe, expect, it } from "vitest";
import {
  avoidTokenCollisions,
  buildPlaceholderMap,
  dropPlaceholderTokens,
  pseudonymize,
  restorePlaceholders,
} from "./deidentify";

/**
 * Parser v8 and the firm-name setting (2026-09-26, audit wave 2; a2 P2-5,
 * a4 #9): every parsed speaker label is hidden whatever its case, length or
 * script, email labels with their mailbox name, and the firm's own names.
 * Every name here is fictional.
 */

function tokens(map: ReturnType<typeof buildPlaceholderMap>) {
  return Object.fromEntries(map.map((entry) => [entry.token, entry.value]));
}

describe("lowercase labels", () => {
  it("hides the label as written, its capitalized form and its parts", () => {
    const map = buildPlaceholderMap({ people: ["priya shah"] });
    expect(tokens(map)).toEqual({
      "[PERSON_1]": "priya shah",
      "[PERSON_1_TITLE]": "Priya Shah",
      "[PERSON_1_FIRST]": "Priya",
      "[PERSON_1_LAST]": "Shah",
      "[PERSON_1_FIRSTLOWER]": "priya",
      "[PERSON_1_LASTLOWER]": "shah",
    });
    const text = "priya shah: we rebuilt it. Priya said so; ask shah.";
    const hidden = pseudonymize(text, map);
    for (const name of ["priya", "Priya", "shah", "Shah"]) expect(hidden).not.toContain(name);
    expect(restorePlaceholders(hidden, map)).toBe(text);
  });

  it("hides a label that differs from a person on the record only in case", () => {
    const map = buildPlaceholderMap({ people: ["Priya Shah", "priya shah", "PRIYA SHAH"] });
    expect(tokens(map)).toMatchObject({
      "[PERSON_1]": "Priya Shah",
      "[PERSON_1_LOWER]": "priya shah",
      "[PERSON_1_UPPER]": "PRIYA SHAH",
      "[PERSON_1_FIRSTLOWER]": "priya",
    });
    expect(map.filter((entry) => entry.token.startsWith("[PERSON_2"))).toEqual([]);
  });

  it("never hides a common word as a lowercase part", () => {
    const map = buildPlaceholderMap({ people: ["will grant"] });
    expect(map.map((entry) => entry.value)).toEqual(["will grant", "Will Grant"]);
    expect(pseudonymize("we will grant access", map)).toBe("we [PERSON_1] access");
  });
});

describe("short and caseless labels", () => {
  it("hides labels under three characters", () => {
    const map = buildPlaceholderMap({ people: ["Al", "Bo"] });
    expect(map.map((entry) => entry.value)).toEqual(["Al", "Bo"]);
    expect(pseudonymize("Al asked Bo. Also, Bob stays.", map)).toBe("[PERSON_1] asked [PERSON_2]. Also, Bob stays.");
  });

  it("hides a Chinese or Korean name inside running text, where no word edge exists", () => {
    const map = buildPlaceholderMap({ people: ["李伟", "김민수"] });
    const text = "李伟说测试台重建了。김민수는 동의했습니다.";
    const hidden = pseudonymize(text, map);
    expect(hidden).toBe("[PERSON_1]说测试台重建了。[PERSON_2]는 동의했습니다.");
    expect(restorePlaceholders(hidden, map)).toBe(text);
  });

  it("hides an Arabic name and its parts as whole words", () => {
    const map = buildPlaceholderMap({ people: ["محمد علي"] });
    expect(tokens(map)).toEqual({
      "[PERSON_1]": "محمد علي",
      "[PERSON_1_FIRST]": "محمد",
      "[PERSON_1_LAST]": "علي",
    });
    // A word that holds the name's letters stays: Arabic keeps word edges.
    expect(pseudonymize("قال محمد علي إن عليه", map)).toBe("قال [PERSON_1] إن عليه");
  });

  it("skips generic labels and labels with no letter", () => {
    expect(buildPlaceholderMap({ people: ["speaker 2", "Interviewer", "2", "#1"] })).toEqual([]);
  });
});

describe("email labels", () => {
  it("hides the address, its mailbox name, the name it spells and its domain", () => {
    const map = buildPlaceholderMap({ clientName: "Verdant Grid Inc.", people: ["priya.shah@acme.example"] });
    expect(tokens(map)).toEqual({
      "[CLIENT_1]": "Verdant Grid Inc.",
      "[CLIENT_1_SHORT]": "Verdant Grid",
      "[CLIENT_1_CAPS]": "VERDANT GRID",
      "[CLIENT_2]": "acme.example",
      "[CLIENT_2_CAPS]": "ACME.EXAMPLE",
      "[PERSON_1]": "priya.shah@acme.example",
      "[PERSON_1_LOCAL]": "priya.shah",
      "[PERSON_1_TITLE]": "Priya Shah",
      "[PERSON_1_FIRST]": "Priya",
      "[PERSON_1_LAST]": "Shah",
    });
    const text = "priya.shah@acme.example: Priya Shah here; write to priya.shah or anyone at acme.example.";
    const hidden = pseudonymize(text, map);
    for (const piece of ["priya", "Priya", "Shah", "acme"]) expect(hidden).not.toContain(piece);
    expect(restorePlaceholders(hidden, map)).toBe(text);
  });

  it("keeps a role mailbox and a public mail domain visible", () => {
    const map = buildPlaceholderMap({ people: ["info@gmail.com", "pshah@gmail.com"] });
    expect(map.map((entry) => entry.value)).toEqual(["info@gmail.com", "pshah@gmail.com", "pshah"]);
  });
});

describe("the firm's own names", () => {
  it("hides each name with its short forms under FIRM tokens, after the client", () => {
    const map = buildPlaceholderMap({
      clientName: "Verdant Grid Technologies Inc.",
      firms: ["Northwind Advisory Group Ltd.", "NWA"],
      companies: ["Acme"],
      people: ["Dana Whitfield"],
    });
    expect(map.map((entry) => entry.token)).toEqual([
      "[CLIENT_1]",
      "[CLIENT_1_SHORT]",
      "[CLIENT_1_BRAND]",
      "[CLIENT_1_CAPS]",
      "[FIRM_1]",
      "[FIRM_1_SHORT]",
      "[FIRM_1_BRAND]",
      "[FIRM_1_CAPS]",
      "[FIRM_2]",
      "[CLIENT_2]",
      "[CLIENT_2_CAPS]",
      "[PERSON_1]",
      "[PERSON_1_FIRST]",
      "[PERSON_1_LAST]",
    ]);
    const text = "Northwind Advisory Group Ltd. (NWA) filed for Verdant Grid. Northwind Advisory wrote it.";
    const hidden = pseudonymize(text, map);
    expect(hidden).toBe("[FIRM_1] ([FIRM_2]) filed for [CLIENT_1_BRAND]. [FIRM_1_BRAND] wrote it.");
    expect(restorePlaceholders(hidden, map)).toBe(text);
    // A bare id the map issued restores too.
    expect(restorePlaceholders("FIRM_2 prepared it.", map)).toBe("NWA prepared it.");
  });

  it("leaves the map as it was when no firm name is set", () => {
    const input = { clientName: "Verdant Grid Technologies Inc.", people: ["Dana Whitfield"] };
    expect(buildPlaceholderMap({ ...input, firms: [] })).toEqual(buildPlaceholderMap(input));
  });

  it("renumbers FIRM tokens past a literal one in the texts", () => {
    const map = buildPlaceholderMap({ firms: ["Northwind Advisory"], people: [] });
    const safe = avoidTokenCollisions(map, ["An old note by [FIRM_1]."]);
    expect(safe[0].token).toBe("[FIRM_2]");
    expect(restorePlaceholders(pseudonymize("Northwind Advisory and [FIRM_1].", safe), safe)).toBe(
      "Northwind Advisory and [FIRM_1]."
    );
  });
});

describe("phrases", () => {
  it("hides a loose label as written, with no single-word or case forms", () => {
    const map = buildPlaceholderMap({ people: ["Dana Whitfield"], phrases: ["thermal drift", "dana whitfield"] });
    expect(tokens(map)).toMatchObject({ "[PERSON_2]": "thermal drift" });
    expect(map.some((entry) => entry.value === "Thermal Drift" || entry.value === "drift")).toBe(false);
    // A phrase that is a person's name in another case stays with the person.
    expect(map.some((entry) => entry.value === "dana whitfield")).toBe(false);
  });
});

describe("dropping placeholders from a search query", () => {
  it("removes bracketed tokens and folds the spaces they leave", () => {
    expect(dropPlaceholderTokens("Did [PERSON_1] test [FIRM_1_SHORT] rigs for [CLIENT_1]?")).toBe(
      "Did test rigs for ?"
    );
  });
});
