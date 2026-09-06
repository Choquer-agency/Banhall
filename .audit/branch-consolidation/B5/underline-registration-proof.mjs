import fs from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
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
const content = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Alpha", marks: [{ type: "underline" }] }] }],
};
const rows = [];
let failed = false;
for (const editable of [true, false]) {
  const sourceExtensions = getEditorExtensions({ editable });
  const explicitCount = sourceExtensions.filter((extension) => extension.name === "underline").length;
  const variants = [{ phase: explicitCount ? "baseline" : "current", removeExplicit: false }];


  for (const { phase, removeExplicit } of variants) {
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(" "));
    let editor;
    try {
      editor = new Editor({
        element: null,
        editable,
        injectCSS: false,
        extensions: removeExplicit
          ? sourceExtensions.filter((extension) => extension.name !== "underline")
          : sourceExtensions,
        content,
      });
      const initial = editor.getJSON();
      const underlineRegistrations = editor.extensionManager.extensions.filter((extension) => extension.name === "underline").length;
      const initialUnderline = initial.content[0].content[0].marks?.some((mark) => mark.type === "underline") ?? false;
      let toggledOff = null;
      let toggledOn = null;
      if (editable) {
        editor.commands.setTextSelection({ from: 1, to: 6 });
        editor.commands.toggleUnderline();
        toggledOff = !(editor.getJSON().content[0].content[0].marks ?? []).some((mark) => mark.type === "underline");
        editor.commands.toggleUnderline();
        toggledOn = editor.getJSON().content[0].content[0].marks?.some((mark) => mark.type === "underline") ?? false;
      }
      const row = {
        phase,
        editable,
        explicitEntriesInSource: explicitCount,
        underlineRegistrations,
        duplicateWarnings: warnings.filter((warning) => warning.includes("Duplicate extension")).length,
        schemaHasUnderline: Boolean(editor.schema.marks.underline),
        initialUnderline,
        initialJSON: initial,
        exactInitialJSON: isDeepStrictEqual(initial, content),
        exactFinalJSON: isDeepStrictEqual(editor.getJSON(), content),
        text: editor.getText(),
        toggledOff,
        toggledOn,
      };
      rows.push(row);
      const expectedCount = removeExplicit ? 1 : explicitCount + 1;
      const expectedWarnings = expectedCount > 1 ? 1 : 0;
      failed ||= !row.exactInitialJSON || !row.exactFinalJSON || !row.schemaHasUnderline || !row.initialUnderline || row.text !== "Alpha"
        || (editable && (!row.toggledOff || !row.toggledOn))
        || row.underlineRegistrations !== expectedCount || row.duplicateWarnings !== expectedWarnings;
    } catch (error) {
      failed = true;
      rows.push({ phase, editable, error: error instanceof Error ? error.message : String(error) });
    } finally {
      editor?.destroy();
      console.warn = originalWarn;
    }
  }
}
console.log(JSON.stringify({ sourcePath, sourceSHA256: createHash("sha256").update(fs.readFileSync(sourcePath)).digest("hex"), rows }, null, 2));
if (failed) process.exitCode = 1;
