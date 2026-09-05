// Run from the repository/worktree being measured. Reads source only.
// This is a synthetic CPU/helper benchmark, not browser or parser integration QA.
//
// Maintained successor to
// `.factory/plans/20260904-code-quality-sweep/performance-benchmark.mjs`, which
// stays frozen as the baseline artifact. Same fixtures, warm-ups, iteration
// count, traversal counting and hashes; the one addition is that when
// `src/lib/components/editor/docSearch.ts` exists its exports are injected into
// the extracted module block, whose imports the extractor strips.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";

const requireFromWorktree = createRequire(path.join(process.cwd(), "package.json"));
const ts = requireFromWorktree("typescript");
const { Schema } = requireFromWorktree("@tiptap/pm/model");
const { Decoration, DecorationSet } = requireFromWorktree("@tiptap/pm/view");

const docSearchPath = "src/lib/components/editor/docSearch.ts";
let docSearchSource = null;
let docSearchExports = {};
if (fs.existsSync(docSearchPath)) {
  docSearchSource = fs.readFileSync(docSearchPath, "utf8");
  const docSearchJs = ts.transpileModule(docSearchSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  docSearchExports = {};
  new Function("exports", "require", docSearchJs)(docSearchExports, requireFromWorktree);
}
const docSearchNames = Object.keys(docSearchExports);

const editorPath = "src/lib/components/editor/Editor.svelte";
const editorSource = fs.readFileSync(editorPath, "utf8");
const moduleMatch = editorSource.match(/<script module lang="ts">([\s\S]*?)<\/script>/);
if (!moduleMatch) throw new Error("Editor module script not found; update the harness for the new source structure.");
const ast = ts.createSourceFile("editor.ts", moduleMatch[1], ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const printer = ts.createPrinter();
const moduleCode = ast.statements
  .filter((statement) => !ts.isImportDeclaration(statement))
  .map((statement) => printer.printNode(ts.EmitHint.Unspecified, statement, ast))
  .join("\n");
const compiled = ts.transpileModule(moduleCode, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const { buildDecorationSet } = new Function(
  "Decoration", "DecorationSet", ...docSearchNames, compiled + ";return {buildDecorationSet};",
)(Decoration, DecorationSet, ...docSearchNames.map((name) => docSearchExports[name]));
console.log(JSON.stringify({
  kind: "measurement_context",
  cwd: process.cwd(),
  node: process.version,
  source: editorPath,
  sha256: createHash("sha256").update(editorSource).digest("hex"),
  ...(docSearchSource === null
    ? {}
    : {
        docSearchSource: docSearchPath,
        docSearchSha256: createHash("sha256").update(docSearchSource).digest("hex"),
        docSearchExports: docSearchNames,
      }),
}));

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*", group: "block" },
    text: { group: "inline" },
  },
});
for (const paragraphs of [100, 400]) {
  const doc = schema.node("doc", null, Array.from({ length: paragraphs }, (_, i) =>
    schema.node("paragraph", null, schema.text(
      `Experiment ${i}: ` + "The system evaluated thermal stability against the measured reference. ".repeat(3),
    )),
  ));
  let traversals = 0;
  const originalDescendants = doc.descendants.bind(doc);
  doc.descendants = (...args) => { traversals++; return originalDescendants(...args); };
  const diffs = Array.from({ length: 20 }, (_, i) => ({ find: `Experiment ${i}:`, replaceWith: "Replacement" }));
  for (let i = 0; i < 5; i++) buildDecorationSet(doc, [], [], undefined, diffs);
  traversals = 0;
  const durations = [];
  let matchPositions;
  for (let i = 0; i < 30; i++) {
    const start = performance.now();
    const result = buildDecorationSet(doc, [], [], undefined, diffs);
    durations.push(performance.now() - start);
    matchPositions = result.find().map(({ from, to }) => [from, to]);
  }
  durations.sort((a, b) => a - b);
  console.log(JSON.stringify({
    kind: "synthetic_editor_cpu",
    chars: doc.textContent.length,
    proposalPairs: diffs.length,
    iterations: durations.length,
    descendantTraversals: traversals,
    medianMs: Number(durations[15].toFixed(2)),
    p95Ms: Number(durations[28].toFixed(2)),
    matchPositionsSha256: createHash("sha256").update(JSON.stringify(matchPositions)).digest("hex"),
  }));
}

const parserPath = "src/lib/parseDocument.ts";
const parserSource = fs.readFileSync(parserPath, "utf8");
const deadlineSource = parserSource.slice(parserSource.indexOf("class ParseTimeout"), parserSource.indexOf("export function capContent"));
if (!deadlineSource.includes("function withDeadline")) throw new Error("Deadline helper moved; update harness for the new source structure.");
const deadlineJs = ts.transpileModule(deadlineSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
let allocated = 0;
const pending = new Set();
const withDeadline = new Function("setTimeout", "clearTimeout", deadlineJs + ";return withDeadline;")(
  () => { const id = ++allocated; pending.add(id); return id; },
  (id) => pending.delete(id),
);
for (let i = 0; i < 201; i++) await withDeadline(Promise.resolve("ok"), Date.now() + 60_000);
console.log(JSON.stringify({
  kind: "deadline_helper_only_not_pdf_integration",
  source: parserPath,
  sha256: createHash("sha256").update(parserSource).digest("hex"),
  successfulOperations: 201,
  allocatedTimers: allocated,
  pendingAfterCompletion: pending.size,
}));
