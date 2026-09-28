import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  GENERATION_MODES,
  GENERATION_MODE_IDS,
  generationMode,
  isGenerationModeId,
} from "./generationModes";

const root = fileURLToPath(new URL("..", import.meta.url));

/** Every non-test Svelte and TS source file under src/, repo-relative. */
function sourceFiles(dir = join(root, "src")): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.(svelte|ts)$/.test(entry.name) || /\.test\.ts$/.test(entry.name)) return [];
    return [relative(root, path)];
  });
}

const read = (path: string) => readFileSync(join(root, path), "utf8");

const importsSharedList = (source: string) =>
  /import\s*\{[^}]*\bGENERATION_MODES\b[^}]*\}\s*from\s*["'](?:\.\.\/)+shared\/generationModes["']/.test(source);

// The selectors known on 2026-09-27. The scan below also finds any new one.
const SELECTORS = [
  "src/lib/components/project-new/WriteModeCards.svelte",
  "src/lib/components/project/CurrentProjectPage.svelte",
  "src/lib/components/project/PreviewProjectPage.svelte",
];

describe("the shared generation mode list", () => {
  it("lists Step by step first and recommended, then Single draft, then Compare two drafts", () => {
    expect(GENERATION_MODES.map((mode) => mode.id)).toEqual([...GENERATION_MODE_IDS]);
    expect(GENERATION_MODES.map((mode) => [mode.id, mode.label, mode.recommended])).toEqual([
      ["iterative", "Step by step", true],
      ["single", "Single draft", false],
      ["compare", "Compare two drafts", false],
    ]);
  });

  it("uses the round 2 board E1 hints", () => {
    expect(GENERATION_MODES.map((mode) => mode.hint)).toEqual([
      "Pick the ideas first. We write after.",
      "One full draft, straight to the editor.",
      "Two drafts. You keep the better one.",
    ]);
  });

  it("keeps the stored ids and reads them back", () => {
    expect(generationMode("iterative").label).toBe("Step by step");
    expect(isGenerationModeId("compare")).toBe(true);
    expect(isGenerationModeId("gated")).toBe(false);
    expect(isGenerationModeId("Single")).toBe(false);
    expect(isGenerationModeId(undefined)).toBe(false);
  });

  it("uses plain hyphens only", () => {
    const copy = GENERATION_MODES.flatMap((mode) => [mode.label, mode.hint, mode.shortHint, mode.runLabel]);
    for (const text of copy) expect(text).not.toMatch(/[\u2013\u2014\u00b7]/);
  });
});

describe("every mode selector imports the shared list (spine AD-41)", () => {
  const files = sourceFiles();

  it.each(SELECTORS)("%s imports GENERATION_MODES", (path) => {
    expect(importsSharedList(read(path))).toBe(true);
  });

  it("finds every mode radio group and each imports the shared list", () => {
    const groups = files.filter((path) => read(path).includes('aria-label="Draft generation mode"'));
    expect(groups.sort()).toEqual([...SELECTORS].sort());
    for (const path of groups) expect(importsSharedList(read(path)), path).toBe(true);
  });

  it("the start dialog names a running mode from the shared list", () => {
    const dialog = read("src/lib/components/generation/StartRunDialog.svelte");
    expect(dialog).toMatch(/from\s*["'](?:\.\.\/)+shared\/generationModes["']/);
    expect(dialog).toContain("generationMode(run.candidateMode).runLabel");
  });

  it("no source file defines its own mode list or mode copy", () => {
    const copy = GENERATION_MODES.flatMap((mode) => [mode.label, mode.hint, mode.shortHint, mode.runLabel]);
    const quoted = new RegExp(
      `["'\`](?:${[...new Set(copy)].map((text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})["'\`]`
    );
    // A list is two or more `{ id: <mode>, label: ... }` entries; one entry
    // is some other control that happens to use a mode id (a "compare" menu item).
    const ownEntry = new RegExp(`\\bid:\\s*["'](${GENERATION_MODE_IDS.join("|")})["']\\s*,\\s*label:`, "g");
    const offenders = files.filter((path) => {
      const source = read(path);
      const entryIds = new Set([...source.matchAll(ownEntry)].map((match) => match[1]));
      return quoted.test(source) || entryIds.size > 1;
    });
    expect(offenders).toEqual([]);
  });
});
