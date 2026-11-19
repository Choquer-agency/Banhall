import { describe, expect, it } from "vitest";
import { scienceCodeFromText } from "./scienceCodeFromText";

describe("scienceCodeFromText", () => {
  it("finds the code on the field of science line", () => {
    expect(
      scienceCodeFromText(
        "Project title: Cold chain sensor drift\nField of science or technology: 2.02.09 Industrial biotechnology\nStart date: 2024-04-01"
      )
    ).toBe("2.02.09");
    expect(scienceCodeFromText("Line 206 field of science or technology code (see Appendix 1): 1.02.01")).toBe("1.02.01");
    expect(scienceCodeFromText("Science and technology field: 4.04.01")).toBe("4.04.01");
  });

  it("finds a code that starts the short line after the field line", () => {
    expect(scienceCodeFromText("Line 206 - Field of science or technology\n\n   2.02.01   \n\nWork done")).toBe("2.02.01");
    expect(scienceCodeFromText("Field of science or technology\n2.02.09 Industrial biotechnology")).toBe("2.02.09");
    // After optional punctuation.
    expect(scienceCodeFromText("Field of science or technology:\n- 2.02.09 Industrial biotechnology")).toBe("2.02.09");
    expect(scienceCodeFromText("Field of science or technology\n(2.02.09)")).toBe("2.02.09");
    // The same code twice is still one code.
    expect(scienceCodeFromText("Field of science or technology: 2.02.09\n2.02.09")).toBe("2.02.09");
  });

  it("gives nothing for a code that is not by words naming the field", () => {
    expect(scienceCodeFromText("")).toBeUndefined();
    expect(scienceCodeFromText("Halden Foods fermentation trials, code 4.04.01, run in 2024.")).toBeUndefined();
    expect(scienceCodeFromText("Field of science or technology: see the appendix")).toBeUndefined();
    // Not the line before the field line, and not two lines after it.
    expect(scienceCodeFromText("2.02.09\nField of science or technology")).toBeUndefined();
    expect(scienceCodeFromText("Field of science or technology\nSee below.\n2.02.09")).toBeUndefined();
    // Not a code in the middle of the next line.
    expect(scienceCodeFromText("Field of science or technology\nWe used 2.02.09")).toBeUndefined();
  });

  it("gives nothing for two different codes", () => {
    expect(scienceCodeFromText("Field of science or technology: 2.02.09 or 2.02.01")).toBeUndefined();
    expect(scienceCodeFromText("Field of science or technology: 2.02.09\n1.02.01")).toBeUndefined();
    expect(
      scienceCodeFromText("Field of science or technology: 2.02.09\nLater on.\nField of science or technology: 1.02.01")
    ).toBeUndefined();
  });

  it("ignores a code-shaped number that is not a real code", () => {
    expect(scienceCodeFromText("Field of science or technology: 2.02.99")).toBeUndefined();
    expect(scienceCodeFromText("Field of science or technology: 9.99.99, really 2.02.09")).toBe("2.02.09");
  });

  it("never reads a version, a section number or a longer dotted number as a code", () => {
    expect(scienceCodeFromText("Version 1.02 of the field of science or technology form")).toBeUndefined();
    for (const before of [
      "v",
      "v.",
      "Version",
      "version:",
      "Ver.",
      "Rev.",
      "revision",
      "release",
      "Build",
      "firmware",
      "Firmware",
      "FW",
      "Section",
      "sec.",
      "Step",
      "Figure",
      "Fig.",
      "Table",
      "Clause",
      "§",
    ]) {
      expect(scienceCodeFromText(`Field of science or technology: see ${before} 2.02.01`), before).toBeUndefined();
    }
    expect(scienceCodeFromText("Field of science or technology: see v1.02.01")).toBeUndefined();
    expect(scienceCodeFromText("Field of science or technology: firmware 2.02.01")).toBeUndefined();
    expect(
      scienceCodeFromText("Field of science or technology: server 10.2.02.09, build 2.02.09.1 and 12.02.09")
    ).toBeUndefined();
    expect(scienceCodeFromText("Field of science or technology: ratio 2.02.091")).toBeUndefined();
    // A word that only starts or ends like one of them is not one of them.
    expect(scienceCodeFromText("Field of science or technology: timetable 2.02.09")).toBe("2.02.09");
    expect(scienceCodeFromText("Field of science or technology: reviewed 2.02.09")).toBe("2.02.09");
    // A field line that ends in "version" does not hand its number to the next line.
    expect(scienceCodeFromText("Field of science or technology form, version\n2.02.09")).toBeUndefined();
  });

  it("does not take a numbered heading for the code", () => {
    // A heading that starts with a code-shaped section number names the field after it.
    expect(scienceCodeFromText("1.02.01 Field of science or technology\nThe work is described below.")).toBeUndefined();
    // A numbered heading just before the field line.
    expect(scienceCodeFromText("4.04.01 Background\nField of science or technology\nSee the claim.")).toBeUndefined();
    // The heading's number before the words, the code after them: only the code counts.
    expect(scienceCodeFromText("1.02.01 Field of science or technology: 2.02.09")).toBe("2.02.09");
  });

  it("does not read a long paragraph after the field line", () => {
    const paragraph =
      "2.02.01 builds of the controller firmware ran all year, and the team logged every fault the sensors raised.";
    expect(paragraph.length).toBeGreaterThan(60);
    expect(scienceCodeFromText(`Field of science or technology\n${paragraph}`)).toBeUndefined();
    expect(
      scienceCodeFromText(
        "Field of science or technology\nThe line ran firmware version 1.02.01 for most of the year while Northgate Labs tested it."
      )
    ).toBeUndefined();
  });

  it("does not reach far along a long line for the code", () => {
    const far = `Field of science or technology: see the appendix. ${"Background work. ".repeat(20)}2.02.09`;
    expect(scienceCodeFromText(far)).toBeUndefined();
    const near = `${"Background work. ".repeat(2000)}Field of science or technology: 2.02.09 ${"More work. ".repeat(2000)}`;
    expect(scienceCodeFromText(near)).toBe("2.02.09");
  });

  it("reads a 700 KB single-line text with 20,000 numbers quickly", () => {
    const codes = ["1.02.01", "2.02.09", "4.04.01", "1.03.10"];
    const versions = Array.from(
      { length: 20_000 },
      (_, i) => `version ${codes[i % codes.length]} and some filler text `
    ).join("");
    const cases: Array<[string, string, string | undefined]> = [
      // One mention of the field, then 20,000 version numbers.
      ["one field line", `Field of science or technology: ${versions}`, undefined],
      // The field named 20,000 times, each followed by a version number.
      [
        "many field mentions",
        Array.from({ length: 20_000 }, (_, i) => `field of science version ${codes[i % codes.length]} x `).join(""),
        undefined,
      ],
      // 20,000 code-shaped numbers with no field words at all.
      [
        "no field words",
        Array.from({ length: 20_000 }, (_, i) => `${codes[i % codes.length]} and some filler, `).join(""),
        undefined,
      ],
      // The real code after the field words at the very end.
      ["code at the end", `${versions}Field of science or technology: 2.02.09`, "2.02.09"],
    ];
    for (const [label, text, expected] of cases) {
      expect(text.length, label).toBeGreaterThan(400_000);
      const started = performance.now();
      const result = scienceCodeFromText(text);
      const elapsed = performance.now() - started;
      expect(result, label).toBe(expected);
      // Well under one second on a quiet machine; generous so load does not fail it.
      expect(elapsed, label).toBeLessThan(3000);
    }
    expect(`Field of science or technology: ${versions}`.length).toBeGreaterThan(700_000);
  });
});
