import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "svelte/compiler";
import { describe, expect, it } from "vitest";

type AstNode = {
  type?: string;
  name?: string;
  start?: number;
  end?: number;
  attributes?: AstNode[];
  [key: string]: unknown;
};

const srcRoot = fileURLToPath(new URL("../../../", import.meta.url));
const excludedInputTypes = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

function svelteFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return svelteFiles(path);
    return entry.name.endsWith(".svelte") ? [path] : [];
  });
}

function walk(node: unknown, visit: (node: AstNode) => void, seen = new WeakSet<object>()) {
  if (!node || typeof node !== "object" || seen.has(node)) return;
  seen.add(node);
  const astNode = node as AstNode;
  visit(astNode);
  for (const value of Object.values(astNode)) {
    if (Array.isArray(value)) value.forEach((item) => walk(item, visit, seen));
    else walk(value, visit, seen);
  }
}

function attributeSource(node: AstNode, name: string, source: string): string | undefined {
  const attribute = node.attributes?.find((candidate) => candidate.type === "Attribute" && candidate.name === name);
  return attribute?.start !== undefined && attribute.end !== undefined
    ? source.slice(attribute.start, attribute.end)
    : undefined;
}

function staticInputType(node: AstNode, source: string): string | undefined {
  return attributeSource(node, "type", source)?.match(/^type=["']([^"']+)["']$/)?.[1];
}

describe("borderless form-control source contract", () => {
  it("routes every visible native data-entry field through the shared contract", () => {
    const violations: string[] = [];

    for (const file of svelteFiles(srcRoot)) {
      const source = readFileSync(file, "utf8");
      const ast = parse(source, { modern: true }) as unknown as AstNode;

      walk(ast, (node) => {
        const nativeField = node.type === "RegularElement" && ["input", "textarea", "select"].includes(node.name ?? "");
        const comboboxField = node.type === "Component" && node.name === "Combobox.Input";
        if (!nativeField && !comboboxField) return;

        if (node.name === "input" && excludedInputTypes.has(staticInputType(node, source) ?? "")) return;

        const classSource = attributeSource(node, "class", source) ?? "";
        const location = `${relative(srcRoot, file)}:${source.slice(0, node.start).split("\n").length}`;
        if (!/\b(?:field-control|input-chromeless)\b/.test(classSource)) {
          violations.push(`${location} does not use field-control or input-chromeless`);
        }
        if (/(?:^|\s)(?:border(?!-0)(?:-\S+)?|(?:hover|focus|focus-visible):border\S*|(?:focus|focus-visible):ring\S*)/.test(classSource)) {
          violations.push(`${location} restores an exterior border/ring`);
        }
      });
    }

    expect(violations).toEqual([]);
  });

  it("keeps button-backed date fields on the same borderless contract", () => {
    for (const name of ["DatePicker.svelte", "DateRangePicker.svelte"]) {
      const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), name), "utf8");
      expect(source.match(/<Popover\.Trigger[\s\S]*?class=(?:"[^"}]*"|\{`[\s\S]*?`\})/)?.[0], name).toContain("field-control");
    }
  });

  it("defines focus and validation as inset-only treatments", () => {
    const css = readFileSync(join(srcRoot, "routes/layout.css"), "utf8");
    expect(css).toMatch(/\.field-control\s*\{[\s\S]*?border:\s*0;/);
    expect(css).toMatch(/\.field-control:focus-visible\s*\{[\s\S]*?box-shadow:\s*inset/);
    expect(css).toMatch(/\.field-control\[aria-invalid="true"\]\s*\{[\s\S]*?box-shadow:\s*inset/);
    expect(css).not.toMatch(/(?:input|textarea|select):focus-visible[\s\S]*?box-shadow:\s*(?!inset)/);
  });
});
