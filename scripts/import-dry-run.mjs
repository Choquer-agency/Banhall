#!/usr/bin/env node
// @ts-nocheck: plain Node script; the app's type check reaches its logic
// through tests/importDryRun.test.ts, which imports scripts/import-dry-run/dryRun.ts.
//
// Import dry run: walks a local copy of the firm's OneDrive folder and prints
// what the Import page would make of it (categories, companies, fiscal years,
// PD file names, initials, writer names in the text, text sizes, duplicates),
// using the server's own functions so the counts match the app.
//
//   node scripts/import-dry-run.mjs "<folder>" [--no-text] [--out report.json]
//   node scripts/import-dry-run.mjs --help
//
// <folder> is the folder that holds the client folders (<Client>/<Fiscal
// year>/...). Run it from a checkout with `npm ci` done.
//
// Read-only and local: it sends nothing anywhere, needs no Convex deployment
// and no API key, and writes nothing in the folder. Online-only OneDrive
// files are not opened (that would download them) and are counted as "not
// downloaded". The only files it writes are the --out JSON, which must be
// outside the folder, and Vite's module cache under node_modules.
//
// Privacy: the report holds counts, initials and file name patterns with
// every word replaced. No file text, client names or person names.
import { existsSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

const server = await createServer({
  root,
  configFile: false,
  cacheDir: path.join(root, "node_modules/.vite-import-dry-run"),
  server: { middlewareMode: true, watch: null },
  logLevel: "error",
  // As vitest.config.ts: explicit, so a checkout with no .svelte-kit folder yet still loads.
  oxc: { tsconfig: { compilerOptions: { target: "ESNext", strict: true } } },
});

try {
  const dryRun = await server.ssrLoadModule("/scripts/import-dry-run/dryRun.ts");
  let options;
  try {
    options = dryRun.parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`import-dry-run: ${error.message}\n\n${dryRun.HELP}`);
    process.exitCode = 2;
    throw null;
  }
  if (options.help) {
    console.log(dryRun.HELP);
    throw null;
  }
  if (!options.folder) {
    console.error(`import-dry-run: give the folder to read\n\n${dryRun.HELP}`);
    process.exitCode = 2;
    throw null;
  }
  const folder = path.resolve(options.folder);
  if (!existsSync(folder) || !statSync(folder).isDirectory()) {
    console.error("import-dry-run: that folder does not exist or is not a folder");
    process.exitCode = 2;
    throw null;
  }
  if (options.out && dryRun.isInside(folder, options.out)) {
    console.error("import-dry-run: --out must be outside the folder being read, so the folder is not changed");
    process.exitCode = 2;
    throw null;
  }

  let lastShown = 0;
  const report = await dryRun.runDryRun(folder, {
    readText: options.readText,
    onProgress: process.stderr.isTTY
      ? (done, total) => {
          if (done === total || Date.now() - lastShown > 1000) {
            lastShown = Date.now();
            process.stderr.write(`\rReading files: ${done} of ${total}${done === total ? "\n" : ""}`);
          }
        }
      : undefined,
  });
  process.stdout.write(dryRun.formatReport(report));
  if (options.out) {
    writeFileSync(path.resolve(options.out), `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\nJSON written to ${options.out}`);
  }
} catch (error) {
  if (error !== null) {
    // The error's message could name a file; print only its kind.
    console.error(`import-dry-run: stopped (${error?.code ?? error?.name ?? "error"})`);
    process.exitCode = 1;
  }
} finally {
  await server.close();
}
