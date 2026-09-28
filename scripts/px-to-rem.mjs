#!/usr/bin/env node
// px-to-rem: rewrites pixel sizes under src/ to rem at 16px per rem, so sizes
// follow the root font size (which grows above 1600px wide, see layout.css).
//
//   node scripts/px-to-rem.mjs            rewrite src/ in place
//   node scripts/px-to-rem.mjs --check    list files that would change, exit 1
//   node scripts/px-to-rem.mjs <paths>    limit to files or directories
//
// Idempotent: a second run changes nothing. Safe to re-run after merges.
//
// What it converts:
//   - Tailwind arbitrary values on size utilities in any source file
//     (text-[13px], leading-[18px], w-[136px], gap-[10px], rounded-[10px],
//     grid-cols-[104px_minmax(0,1fr)], max-h-[min(760px,...)], ...).
//   - Literal size={N} on icons imported from phosphor-svelte (size="Nrem").
//   - Size declarations (font-size, line-height, width, padding, margin,
//     gap, inset, border-radius, ...) in .css files, Svelte <style> blocks,
//     static style="..." attributes and static style:prop="..." directives.
//
// What it keeps in px:
//   - 1px and 0.5px hairlines anywhere, 0px, and 9999px pill radii.
//   - Border, outline, ring, shadow, decoration, divide and blur utilities
//     and declarations, and CSS transforms, masks and gradients.
//   - Media and container query conditions (arbitrary variants such as
//     min-[880px]: and [@media(min-height:640px)]:, and @media preludes).
//   - Anything computed at runtime: style={...} expressions and template
//     strings with ${...}px, canvas and SVG attributes are never touched.
//   - Any CSS line carrying the marker comment "px-to-rem: keep" (the root
//     font size in layout.css, whose 1600px is a window width).

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PX_PER_REM = 16;

const EXTENSIONS = new Set([".svelte", ".ts", ".js", ".css"]);

/** Tailwind utilities whose arbitrary px values are sizes. */
const SIZE_UTILITY =
  /^-?(?:text|leading|tracking|indent|w|h|size|min-w|min-h|max-w|max-h|basis|inset|inset-x|inset-y|top|right|bottom|left|start|end|p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|ms|me|gap|gap-x|gap-y|space-x|space-y|rounded(?:-(?:t|r|b|l|s|e|tl|tr|br|bl|ss|se|es|ee))?|translate-x|translate-y|scroll-m[trblxyse]?|scroll-p[trblxyse]?|grid-cols|grid-rows|auto-cols|auto-rows|columns)$/;

/** CSS properties whose px lengths are sizes. */
const SIZE_PROPERTY =
  /^(?:font-size|line-height|letter-spacing|text-indent|(?:min-|max-)?(?:width|height|inline-size|block-size)|padding(?:-[a-z-]+)?|margin(?:-[a-z-]+)?|gap|row-gap|column-gap|top|right|bottom|left|inset(?:-[a-z-]+)?|border(?:-[a-z]+)*-radius|flex-basis|grid-template-(?:columns|rows)|grid-auto-(?:columns|rows)|scroll-(?:margin|padding)(?:-[a-z-]+)?)$/;

/** Custom properties that name a line, shadow or effect keep px. */
const KEEP_CUSTOM_PROPERTY = /shadow|ring|outline|border|blur|stroke|hairline|line-width|offset/;

const PX_LENGTH = /(-?)(\d*\.?\d+)px(?![a-zA-Z])/g;

/**
 * 13 -> "0.8125rem"; the kept values return null.
 * @param {number} value
 * @returns {string | null}
 */
export function pxToRem(value) {
  const abs = Math.abs(value);
  if (abs === 0 || abs === 0.5 || abs === 1 || abs >= 9999) return null;
  const rem = Number((value / PX_PER_REM).toFixed(6));
  return `${rem}rem`;
}

/**
 * Converts every px length in a value, skipping url(...) contents.
 * @param {string} value
 * @returns {string}
 */
export function convertLengths(value) {
  const parts = value.split(/(url\([^)]*\))/);
  return parts
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part.replace(PX_LENGTH, (match, sign, digits) => pxToRem(Number(sign + digits)) ?? match)
    )
    .join("");
}

// A Tailwind arbitrary value: an optional boundary, the utility, the bracketed
// value, an optional /[line-height] modifier. A trailing ':' means the bracket
// was an arbitrary variant (a media or container condition), never a size.
const CLASS_TOKEN =
  /(^|[\s"'`{(,:!|>])(-?[a-z][a-z0-9-]*?)-\[([^\]\s"'`]+)\](?:\/\[([^\]\s"'`]+)\])?(?![:\w-])/g;

/**
 * Rewrites arbitrary px values on size utilities anywhere in the text.
 * @param {string} text
 * @returns {string}
 */
export function convertClassTokens(text) {
  return text.replace(CLASS_TOKEN, (match, lead, utility, value, modifier) => {
    if (!SIZE_UTILITY.test(utility)) return match;
    if (!value.includes("px") && !(modifier ?? "").includes("px")) return match;
    // Queries inside a value (for example [@media...]) are conditions.
    if (value.includes("@")) return match;
    const next = convertLengths(value);
    const nextModifier = modifier === undefined ? "" : `/[${convertLengths(modifier)}]`;
    return `${lead}${utility}-[${next}]${nextModifier}`;
  });
}

/**
 * @param {string} property
 * @param {string} value
 * @returns {string}
 */
function convertDeclaration(property, value) {
  const name = property.toLowerCase();
  if (name.startsWith("--")) {
    if (KEEP_CUSTOM_PROPERTY.test(name)) return value;
    if (/gradient\(|#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(value)) return value;
    return convertLengths(value);
  }
  if (!SIZE_PROPERTY.test(name)) return value;
  return convertLengths(value);
}

// property: value, ending at ';', '}' or the end of the text. A selector such
// as a:hover { or an @media (min-width: 600px) { prelude never ends in ';' or
// '}', so it is never read as a declaration.
const DECLARATION = /(^|[{;\s])(--[\w-]+|[a-zA-Z-]+)(\s*:\s*)([^;{}]*?)(?=\s*(?:;|}|$))/g;

/**
 * Rewrites size declarations in a stylesheet (comments are left alone).
 * @param {string} css
 * @param {{ toEnd?: boolean }} [options] toEnd: the last declaration may end the text (a style attribute)
 * @returns {string}
 */
export function convertCss(css, { toEnd = false } = {}) {
  /** @type {string[]} */
  const comments = [];
  /** @param {string} kept */
  const hold = (kept) => {
    comments.push(kept);
    return `\u0000${comments.length - 1}\u0000`;
  };
  const masked = css
    .replace(/^.*px-to-rem: keep.*$/gm, hold)
    .replace(/\/\*[\s\S]*?\*\//g, hold);
  const pattern = toEnd ? DECLARATION : new RegExp(DECLARATION.source.replace("|$", ""), "g");
  const converted = masked.replace(pattern, (match, lead, property, colon, value) => {
    if (!value.includes("px")) return match;
    return `${lead}${property}${colon}${convertDeclaration(property, value)}`;
  });
  return converted.replace(/\u0000(\d+)\u0000/g, (_, index) => comments[Number(index)]);
}

/**
 * @param {string} source
 * @returns {string}
 */
function convertSvelte(source) {
  let out = source.replace(
    /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/g,
    (_, open, css, close) => `${open}${convertCss(css)}${close}`
  );
  // Static style attributes only: anything with {...} is computed at runtime.
  out = out.replace(/(\sstyle=")([^"{}]*)(")/g, (_, open, css, close) => `${open}${convertCss(css, { toEnd: true })}${close}`);
  out = out.replace(
    /(\sstyle:([a-z-]+)(?:\|important)?=")([^"{}]*)(")/g,
    (_, open, property, value, close) => `${open}${convertDeclaration(property, value)}${close}`
  );
  return convertPhosphorSizes(out);
}

/**
 * Phosphor icons (phosphor-svelte) render their numeric size as px svg
 * attributes. On a component imported from phosphor-svelte, a literal
 * size={14} becomes size="0.875rem" so the icon scales with the root.
 * @param {string} source
 * @returns {string}
 */
export function convertPhosphorSizes(source) {
  /** @type {string[]} */
  const names = [];
  for (const [, list] of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*"phosphor-svelte(?:\/[^"]*)?"/g)) {
    for (const part of list.split(",")) {
      const local = part.split(/\s+as\s+/).pop()?.trim();
      if (local && /^[A-Z]\w*$/.test(local)) names.push(local);
    }
  }
  for (const [, local] of source.matchAll(/import\s+([A-Z]\w*)\s+from\s*"phosphor-svelte\/[^"]*"/g)) names.push(local);
  if (!names.length) return source;
  const tag = new RegExp(`<(?:${names.join("|")})\\b[^<>]*?>`, "g");
  return source.replace(tag, (element) =>
    element.replace(/(\ssize=)\{(\d*\.?\d+)\}/, (match, attr, digits) => {
      const rem = pxToRem(Number(digits));
      return rem === null ? match : `${attr}"${rem}"`;
    })
  );
}

/**
 * The whole transform for one file; returns the new text.
 * @param {string} text
 * @param {string} filename
 * @returns {string}
 */
export function transformSource(text, filename) {
  const ext = extname(filename);
  let out = convertClassTokens(text);
  if (ext === ".css") out = convertCss(out);
  if (ext === ".svelte") out = convertSvelte(out);
  return out;
}

/**
 * Source files under a file or directory, sorted.
 * @param {string} target
 * @returns {string[]}
 */
export function listSourceFiles(target) {
  const stat = statSync(target);
  if (stat.isFile()) return EXTENSIONS.has(extname(target)) ? [target] : [];
  /** @type {string[]} */
  const files = [];
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    files.push(...listSourceFiles(join(target, entry.name)));
  }
  return files.sort();
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const targets = args.filter((arg) => !arg.startsWith("--"));
  const files = (targets.length ? targets : [join(root, "src")]).flatMap((target) => listSourceFiles(resolve(target)));
  /** @type {string[]} */
  const changed = [];
  for (const file of files) {
    const before = readFileSync(file, "utf8");
    const after = transformSource(before, file);
    if (after === before) continue;
    changed.push(relative(root, file));
    if (!check) writeFileSync(file, after);
  }
  for (const file of changed) console.log(`${check ? "would change" : "changed"}: ${file}`);
  console.log(`${changed.length} of ${files.length} files ${check ? "would change" : "changed"}.`);
  if (check && changed.length) process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
