import { readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, test } from "vitest";

// Story 1 (CAP-1/2/4) Never-rule: "Let Brief rows reach `brainSources`
// nomination or the Brain retriever" is explicitly forbidden. Brief content
// is project-scoped, writer-guidance-only, and must never become firm-wide
// Brain knowledge or be retrieved across projects (AD-19). This is a static
// source contract, not a runtime behaviour one: it must hold even before any
// generation ever runs.

const CONVEX_ROOT = join(__dirname, "..", "convex");
const BRAIN_FILES = [
  "brain.ts",
  join("ai", "brain", "ingest.ts"),
  join("ai", "brain", "rag.ts"),
  join("ai", "brain", "retrieve.ts"),
  join("ai", "brain", "query.ts"),
  join("ai", "brain", "embeddings.ts"),
  join("ai", "brain", "erase.ts"),
  join("ai", "brain", "scienceRouting.ts"),
];

const BRIEF_TABLE_NAMES = ["generationBriefs", "generationBriefEntries"];

function listConvexSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listConvexSourceFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

describe("Generation Brief / Brain isolation (story 1 Never-rule)", () => {
  test("no Brain nomination or retrieval file references generationBriefs/generationBriefEntries", () => {
    for (const relativePath of BRAIN_FILES) {
      const path = join(CONVEX_ROOT, relativePath);
      const source = readFileSync(path, "utf8");
      for (const table of BRIEF_TABLE_NAMES) {
        expect(source, `${relativePath} must never reference "${table}"`).not.toContain(table);
      }
    }
  });

  test("no file anywhere in convex/ inserts a brainSources row sourced from a Brief table", () => {
    // Broader net than the named-files check above: catch a future brain
    // helper file this test doesn't yet know about. A legitimate insert
    // site never needs to look up a Brief row to build its arguments.
    const files = listConvexSourceFiles(CONVEX_ROOT).filter(
      (path) => !path.includes(`${sep}_generated${sep}`)
    );
    for (const path of files) {
      const source = readFileSync(path, "utf8");
      if (!source.includes('insert("brainSources"') && !source.includes("insert('brainSources'")) continue;
      for (const table of BRIEF_TABLE_NAMES) {
        expect(
          source,
          `${path} inserts into "brainSources" and must never also reference "${table}"`
        ).not.toContain(table);
      }
    }
  });
});
