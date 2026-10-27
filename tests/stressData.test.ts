import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MAX_FILE_CHARS, inventedWordsFound, main, namesFound, seeded, stressData, transcriptText } from "../scripts/stress/generate.mjs";
import { RELEASE_EVAL_PREFIX, capWithMargin, spendByCallSite, stressProjectTitle } from "../scripts/stress/run.mjs";
import { RELEASE_EVAL_PROJECT_PREFIX, isReleaseEvalProjectTitle } from "../shared/releaseEval";

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

  it("writes files whose bytes match the manifest's fingerprints, and refuses an invented name sharing a real name's word", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "stress-"));
    try {
      expect(main(["--out", dir, "--files", "2", "--file-chars", "2000", "--hours", "0.05"])).toBe(0);
      const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"));
      for (const file of manifest.files) {
        expect(createHash("sha256").update(readFileSync(path.join(dir, file.name), "utf8")).digest("hex")).toBe(file.sha256);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(inventedWordsFound(["Zorvel Works", "Quinmor Raman"], ["Priya Raman", "Acme Seals"])).toEqual(["raman"]);
    expect(inventedWordsFound(["Zorvel Works"], ["Al Bo"])).toEqual([]);
  });
});

describe("stress run's pure parts", () => {
  it("names its project as a release eval project, so the evaluation mark accepts it", () => {
    expect(RELEASE_EVAL_PREFIX).toBe(RELEASE_EVAL_PROJECT_PREFIX);
    expect(isReleaseEvalProjectTitle(stressProjectTitle("Zorvelyar Works"))).toBe(true);
  });

  it("stops 10 percent below the cap, at least a dollar", () => {
    expect(capWithMargin(40)).toBe(36);
    expect(capWithMargin(5)).toBe(4);
  });

  it("counts characters per token by feature and model, only from rows with characters and input", () => {
    const row = { costUsd: 0.1, outputTokens: 10, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, stopReason: "end_turn" };
    const groups = spendByCallSite([
      { ...row, callSite: "generation:analyzer", model: "claude-sonnet-5-5", inputTokens: 1_000, requestChars: 3_000 },
      { ...row, callSite: "generation:analyzer", model: "claude-sonnet-5-5", inputTokens: 1_000, requestChars: null },
      { ...row, callSite: "generation:analyzer", model: "claude-sonnet-5", inputTokens: 1_000, requestChars: 4_000 },
    ]);
    expect(groups.map((group) => [group.model, group.calls, group.charsPerToken])).toEqual([
      ["claude-sonnet-5-5", 2, 3],
      ["claude-sonnet-5", 1, 4],
    ]);
  });
});
