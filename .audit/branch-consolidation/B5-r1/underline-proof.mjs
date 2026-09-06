import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

// Plan evidence only. Resolve the artifact and its installed dependencies from
// the caller's checkout so the same proof can run before and after the change.
const cwd = process.cwd();
const require = createRequire(path.join(cwd, "package.json"));
const ts = require("typescript");
const { Editor } = require("@tiptap/core");
const sourcePath = path.join(cwd, "src/lib/tiptapConfig.ts");
const compiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText;
const loaded = { exports: {} };
new Function("exports", "require", "module", compiled)(loaded.exports, require, loaded);
const { getEditorExtensions } = loaded.exports;

const baseline = process.argv.includes("--baseline");
const sourceSha256 = createHash("sha256").update(fs.readFileSync(sourcePath)).digest("hex");
const content = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Alpha", marks: [{ type: "underline" }] }] }],
};
const plain = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Alpha" }] }],
};
const rows = [];
let failed = false;
for (const editable of [true, false]) {
  const extensions = getEditorExtensions({ editable });
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  let editor;
  try {
    editor = new Editor({ element: null, editable, injectCSS: false, extensions, content });
    const initial = editor.getJSON();
    let toggledOff = null;
    let toggledOn = null;
    if (editable) {
      editor.commands.setTextSelection({ from: 1, to: 6 });
      editor.commands.toggleUnderline();
      toggledOff = editor.getJSON();
      editor.commands.toggleUnderline();
      toggledOn = editor.getJSON();
    }
    const final = editor.getJSON();
    const row = {
      phase: baseline ? "baseline" : "current",
      editable,
      explicitEntriesInSource: extensions.filter(e => e.name === "underline").length,
      underlineRegistrations: editor.extensionManager.extensions.filter(e => e.name === "underline").length,
      duplicateWarnings: warnings.filter(w => w.includes("Duplicate extension")).length,
      initial, toggledOff, toggledOn, final,
    };
    row.pass = row.explicitEntriesInSource === (baseline ? 1 : 0)
      && row.underlineRegistrations === (baseline ? 2 : 1)
      && row.duplicateWarnings === (baseline ? 1 : 0)
      && isDeepStrictEqual(initial, content) && isDeepStrictEqual(final, content)
      && (!editable || (isDeepStrictEqual(toggledOff, plain) && isDeepStrictEqual(toggledOn, content)));
    failed ||= !row.pass;
    rows.push(row);
  } finally {
    try { editor?.destroy(); } finally { console.warn = originalWarn; }
  }
}
console.log(JSON.stringify({ sourcePath, sourceSha256, baseline, rows }, null, 2));
if (failed) process.exitCode = 1;
