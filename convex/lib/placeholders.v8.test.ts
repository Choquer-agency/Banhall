import { describe, expect, it } from "vitest";
import {
  avoidTokenCollisions,
  buildPlaceholderMap,
  dropPlaceholderTokens,
  pseudonymize,
  restorePlaceholders,
} from "./deidentify";
import { transcriptSpeakerNames } from "../../shared/transcriptParse";

/**
 * Parser v8 and the firm-name setting (2026-09-26, audit wave 2; a2 P2-5,
 * a4 #9; review fixes P1-2, P2-2, P2-4 and P3 of the same day): every
 * speaker label is hidden whatever its case, length or script, a label that
 * opened no turn only where it stands as a label, email labels with their
 * mailbox name, and the firm's own names. Every name here is fictional.
 */

function tokens(map: ReturnType<typeof buildPlaceholderMap>) {
  return Object.fromEntries(map.map((entry) => [entry.token, entry.value]));
}

/** The map a transcript's own names give, as the project map builds it. */
function mapFor(content: string, people: string[] = []) {
  const names = transcriptSpeakerNames(content);
  return buildPlaceholderMap({
    companies: names.organizations,
    people: [...people, ...names.labels, ...names.otherNames],
    phrases: names.looseLabels ?? [],
  });
}

describe("lowercase labels", () => {
  it("hides a lowercase name, its capitalized form and its parts", () => {
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

  it("gives no capitalized form or parts to a lowercase label that fails the name test", () => {
    expect(buildPlaceholderMap({ people: ["will grant"] }).map((entry) => entry.value)).toEqual(["will grant"]);
    expect(buildPlaceholderMap({ people: ["flow rate"] }).map((entry) => entry.value)).toEqual(["flow rate"]);
  });
});

describe("loose labels are hidden only where they stand as labels (review P1-2)", () => {
  it("leaves the words in running text", () => {
    const cases: Array<[string, string, string]> = [
      ["Notes.\n\nlatency: 30 ms at the feeder.", "latency", "The latency was high all week."],
      ["Notes.\n\nflow rate: 30 litres a minute.", "flow rate", "The flow rate held; the rate fell later."],
      ["Notes.\n\nthermal drift: within band.", "thermal drift", "Thermal drift and thermal drift again; the drift stayed."],
      ["团队三月开始。\n\n温度: 30度。", "温度", "温度很高，温度计坏了。"],
      ["팀은 3월에 시작했다.\n\n그래서: 다시 만들었다.", "그래서", "그래서 우리는 그래서라고 말했다."],
    ];
    for (const [transcript, label, running] of cases) {
      const map = mapFor(transcript);
      expect(map.map((entry) => [entry.value, entry.at]), label).toEqual([[label, "label"]]);
      expect(pseudonymize(running, map), label).toBe(running);
      const hidden = pseudonymize(transcript, map);
      expect(hidden, label).not.toContain(`${label}:`);
      expect(restorePlaceholders(hidden, map)).toBe(transcript);
    }
  });

  it("hides a loose label after a time, in a render prefix, a voice or a header", () => {
    const map = buildPlaceholderMap({ people: [], phrases: ["dana", "dana (acme)"] });
    expect(pseudonymize("[00:00:05] dana: hi", map)).toBe("[00:00:05] [PERSON_1]: hi");
    expect(pseudonymize("[T0001] (unknown) dana: hi", map)).toBe("[T0001] (unknown) [PERSON_1]: hi");
    expect(pseudonymize("dana (acme): hi", map)).toBe("[PERSON_2]: hi");
    expect(pseudonymize("dana   0:03\nhi", map)).toBe("[PERSON_1]   0:03\nhi");
    expect(pseudonymize("<v dana>hi", map)).toBe("<v [PERSON_1]>hi");
    expect(pseudonymize("I told dana: fine. Ask dana.", map)).toBe("I told dana: fine. Ask dana.");
  });

  it("hides a loose label that is a known person in another case as that person, everywhere (review P2-2)", () => {
    const map = buildPlaceholderMap({ people: ["Dana Whitfield"], phrases: ["thermal drift", "dana whitfield"] });
    expect(tokens(map)).toMatchObject({ "[PERSON_1_LOWER]": "dana whitfield", "[PERSON_2]": "thermal drift" });
    expect(map.find((entry) => entry.value === "dana whitfield")?.at).toBeUndefined();
    expect(pseudonymize("we asked dana whitfield twice", map)).toBe("we asked [PERSON_1_LOWER] twice");
    expect(map.some((entry) => entry.value === "Thermal Drift" || entry.value === "drift")).toBe(false);
  });
});

describe("short and caseless names", () => {
  it("hides labels under three characters", () => {
    const map = buildPlaceholderMap({ people: ["Al", "Bo"] });
    expect(pseudonymize("Al asked Bo. Also, Bob stays.", map)).toBe("[PERSON_1] asked [PERSON_2]. Also, Bob stays.");
  });

  it("hides a Chinese name as a whole name, never inside a longer one (review P1-2)", () => {
    const map = buildPlaceholderMap({ people: ["李伟"] });
    expect(pseudonymize("李伟说测试台重建了。", map)).toBe("[PERSON_1]说测试台重建了。");
    expect(pseudonymize("和李伟一起", map)).toBe("和[PERSON_1]一起");
    expect(pseudonymize("李伟东来了。", map)).toBe("李伟东来了。");
    expect(pseudonymize("王李伟来了。", map)).toBe("王李伟来了。");
    expect(pseudonymize("李伟 (Acme): 好。李伟さん", map)).toBe("[PERSON_1] (Acme): 好。[PERSON_1]さん");
    const both = buildPlaceholderMap({ people: ["李伟东", "李伟"] });
    expect(pseudonymize("李伟东和李伟", both)).toBe("[PERSON_1]和[PERSON_2]");
  });

  it("hides a Korean name with its particles, never inside a longer word", () => {
    const map = buildPlaceholderMap({ people: ["김민수"] });
    const text = "김민수는 동의했다. 김민수님은 왔다. 김민수진 씨는 아니다.";
    expect(pseudonymize(text, map)).toBe("[PERSON_1]는 동의했다. [PERSON_1]님은 왔다. 김민수진 씨는 아니다.");
    expect(restorePlaceholders(pseudonymize(text, map), map)).toBe(text);
  });

  it("hides an Arabic name and its parts as whole words", () => {
    const map = buildPlaceholderMap({ people: ["محمد علي"] });
    expect(pseudonymize("قال محمد علي إن عليه", map)).toBe("قال [PERSON_1] إن عليه");
  });

  it("skips generic labels and labels with no letter", () => {
    expect(buildPlaceholderMap({ people: ["speaker 2", "Interviewer", "2", "#1"] })).toEqual([]);
  });
});

describe("email labels (review P2-4)", () => {
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
      "[PERSON_1_FIRSTLOWER]": "priya",
      "[PERSON_1_LASTLOWER]": "shah",
    });
    const text = "priya.shah@acme.example: Priya Shah here; write to priya.shah or anyone at acme.example.";
    const hidden = pseudonymize(text, map);
    for (const piece of ["priya", "Priya", "Shah", "acme"]) expect(hidden).not.toContain(piece);
    expect(restorePlaceholders(hidden, map)).toBe(text);
  });

  it("hides a one-word mailbox and its capitalized form", () => {
    expect(tokens(buildPlaceholderMap({ people: ["priya@gmail.com"] }))).toEqual({
      "[PERSON_1]": "priya@gmail.com",
      "[PERSON_1_LOCAL]": "priya",
      "[PERSON_1_TITLE]": "Priya",
    });
  });

  it("never hides a common word, a role mailbox or a public mail domain", () => {
    for (const address of ["will@acme.example", "it@acme.example", "info@gmail.com", "hello@gmail.com"]) {
      const map = buildPlaceholderMap({ people: [address] });
      const text = "We will ask it and say hello for info.";
      expect(pseudonymize(text, map), address).toBe(text);
    }
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
    expect(restorePlaceholders("FIRM_2 prepared it.", map)).toBe("NWA prepared it.");
  });

  it("hides the firm's own email domain as the firm, never as a client (review P3)", () => {
    const map = buildPlaceholderMap({
      clientName: "Verdant Grid Inc.",
      firms: ["Northwind Advisory"],
      people: ["dana@northwind.example", "pshah@acme.example"],
    });
    expect(tokens(map)).toMatchObject({ "[FIRM_1_DOMAIN]": "northwind.example", "[CLIENT_2]": "acme.example" });
    expect(map.some((entry) => entry.token.startsWith("[CLIENT") && entry.value === "northwind.example")).toBe(false);
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

describe("dropping placeholders from a search query", () => {
  it("removes bracketed tokens and folds the spaces they leave", () => {
    expect(dropPlaceholderTokens("Did [PERSON_1] test [FIRM_1_SHORT] rigs for [CLIENT_1]?")).toBe(
      "Did test rigs for ?"
    );
  });
});
