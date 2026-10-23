/**
 * 2026-10-22 (fourth): every read of a project file's text goes through
 * convex/lib/documentText.ts, which falls back to `content` only for a row
 * whose text has not moved. The guard asks the TypeScript checker for every
 * `.content` read (and `{ content }` destructuring) on a value typed as a
 * `projectDocuments` row, anywhere in convex/ outside tests and that module.
 *
 * PENDING lists the reads later steps of the move convert, by file and count.
 * It may only shrink: a new read fails, and so does a count that is no
 * longer reached (update the list in the commit that converts it).
 */
import path from "node:path";
import ts from "typescript";
import { describe, expect, test } from "vitest";

const root = path.resolve(__dirname, "..");
const convexDir = path.join(root, "convex");
const HELPER = path.join(convexDir, "lib", "documentText.ts");

/** Reads still to convert, per file (relative to the repo root). */
const PENDING: Readonly<Record<string, number>> = {
  // Step 2c: search.
  "convex/chatDocuments.ts": 3,
  "convex/research.ts": 2,
  // Step 3: the project copy, with the writers.
  "convex/projects.ts": 1,
};

/** A `projectDocuments` row: only that table has `textMovedAt` and `content`. */
function isDocumentRow(type: ts.Type): boolean {
  const parts = type.isUnion() ? type.types : [type];
  return parts.some((part) => part.getProperty("textMovedAt") !== undefined && part.getProperty("content") !== undefined);
}

function contentReads(): Record<string, number> {
  const configPath = path.join(convexDir, "tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, convexDir);
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
  const checker = program.getTypeChecker();
  const found: Record<string, number> = {};
  for (const file of program.getSourceFiles()) {
    const name = path.resolve(file.fileName);
    if (!name.startsWith(convexDir + path.sep) || name.includes(`${path.sep}_generated${path.sep}`)) continue;
    if (name === HELPER || /\.test\.ts$/.test(name) || file.isDeclarationFile) continue;
    const relative = path.relative(root, name);
    const record = () => {
      found[relative] = (found[relative] ?? 0) + 1;
    };
    const visit = (node: ts.Node) => {
      if (ts.isPropertyAccessExpression(node) && node.name.text === "content") {
        if (isDocumentRow(checker.getTypeAtLocation(node.expression))) record();
      } else if (
        ts.isElementAccessExpression(node) &&
        ts.isStringLiteral(node.argumentExpression) &&
        node.argumentExpression.text === "content"
      ) {
        if (isDocumentRow(checker.getTypeAtLocation(node.expression))) record();
      } else if (ts.isObjectBindingPattern(node)) {
        const takesContent = node.elements.some((element) => {
          const key = element.propertyName ?? element.name;
          return ts.isIdentifier(key) && key.text === "content";
        });
        if (takesContent && isDocumentRow(checker.getTypeAtLocation(node))) record();
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return found;
}

describe("project file text is read only through convex/lib/documentText.ts (2026-10-22, fourth)", () => {
  test("no other code reads a projectDocuments row's content", { timeout: 180_000 }, () => {
    expect(contentReads()).toEqual(PENDING);
  });
});
