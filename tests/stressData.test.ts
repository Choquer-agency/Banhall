import { describe, expect, it } from "vitest";
import { MAX_FILE_CHARS, namesFound, seeded, stressData, transcriptText } from "../scripts/stress/generate.mjs";

/** F5 (docs/todos/phase-f-scale.md): the stress test's fictional data. */
describe("stress test data", () => {
  it("is the same for the same seed and different for another", () => {
    const small = { files: 2, fileChars: 5_000, hours: 0.1 };
    const first = stressData({ seed: 7, ...small });
    expect(stressData({ seed: 7, ...small })).toEqual(first);
    expect(stressData({ seed: 8, ...small }).files[0].text).not.toBe(first.files[0].text);
  });

  it("has files of exactly the asked size, one at the maximum and one past it, and an interview of about the asked length", () => {
    const data = stressData({ seed: 3, files: 3, fileChars: 40_000, hours: 0.5 });
    const sizes = Object.fromEntries(data.files.map((file: { name: string; text: string }) => [file.name, file.text.length]));
    expect(sizes["notes-001.md"]).toBe(40_000);
    expect(sizes["notes-max.md"]).toBe(MAX_FILE_CHARS);
    expect(sizes["notes-over-max.md"]).toBe(MAX_FILE_CHARS + 1);
    expect(sizes["interview.txt"]).toBeGreaterThan(26_000);
    expect(sizes["interview.txt"]).toBeLessThanOrEqual(27_000);
  });

  it("writes the interview as speaker turns the transcript parser reads", () => {
    const text = transcriptText(seeded(1), 3_000, ["Interviewer", "Velzor Quinmor"], []);
    for (const line of text.split("\n")) expect(line).toMatch(/^(Interviewer|Velzor Quinmor): \S/);
  });

  it("finds a real name as a whole word, ignoring case, and not inside another word", () => {
    expect(namesFound("We met the ACME Seals team.", ["Acme Seals", "Insporos"])).toEqual(["Acme Seals"]);
    expect(namesFound("Pseudoinsporosity", ["Insporos"])).toEqual([]);
    expect(namesFound("Text", ["Al"])).toEqual([]);
  });
});
