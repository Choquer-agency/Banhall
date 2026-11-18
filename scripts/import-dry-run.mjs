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
// year>/...). Run it from the Banhall folder after `npm ci`.
//
// Read-only and local: it sends nothing anywhere, needs no Convex deployment
// and no API key, and writes nothing in the folder. Online-only OneDrive
// files are not opened (that would download them) and are counted as
// "online only"; on Windows PowerShell says which files are on this
// computer, and if it cannot, no text is read. The only files it writes are
// the --out JSON, which must be new and outside the folder, and Vite's
// module cache under node_modules. Vite opens no port and no watcher.
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
  // No listener: no HMR WebSocket, no file watcher, no dependency scan.
  server: { middlewareMode: true, watch: null, ws: false, hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  resolve: { alias: { $lib: path.join(root, "src/lib") } },
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
  const refusal = options.out ? dryRun.outRefusal(folder, options.out) : null;
  if (refusal) {
    console.error(`import-dry-run: ${refusal}`);
    process.exitCode = 2;
    throw null;
  }

  // Progress goes to stderr, so the report on stdout stays clean.
  let lastShown = 0;
  const show = (line, force = false) => {
    if (!process.stderr.isTTY || (!force && Date.now() - lastShown < 1000)) return;
    lastShown = Date.now();
    process.stderr.write(`\r${line}\x1b[K`);
  };
  let localStarted = 0;
  let localTimer;
  const report = await dryRun.runDryRun(folder, {
    readText: options.readText,
    onProgress: (stage, done, total) => {
      if (stage === "local" && done === 0) {
        localStarted = Date.now();
        show("Asking PowerShell which files are on this computer...", true);
        localTimer = setInterval(() => show(`Asking PowerShell which files are on this computer... ${Math.round((Date.now() - localStarted) / 1000)}s`, true), 1000);
      } else if (stage === "local") {
        clearInterval(localTimer);
        show("Asking PowerShell which files are on this computer... done\n", true);
      } else if (stage === "walk") show(`Looking through folders: ${done} files so far`);
      else show(`Reading files: ${done} of ${total}`, done === total);
    },
  });
  clearInterval(localTimer);
  if (process.stderr.isTTY) process.stderr.write("\n");
  process.stdout.write(dryRun.formatReport(report));
  if (options.out) {
    // "wx": never overwrite a file, even one made since the check above.
    writeFileSync(path.resolve(options.out), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
    console.log(`\nJSON written to ${options.out}`);
  }
} catch (error) {
  if (error !== null && (error?.code === "EACCES" || error?.code === "EPERM")) {
    console.error(
      "import-dry-run: the folder could not be opened (no permission). On a Mac, give Terminal access to ~/Library/CloudStorage (System Settings, Privacy and Security, Files and Folders, or Full Disk Access) and run it again."
    );
    process.exitCode = 1;
  } else if (error !== null) {
    // The error's message could name a file; print only its kind.
    console.error(`import-dry-run: stopped (${error?.code ?? error?.name ?? "error"})`);
    process.exitCode = 1;
  }
} finally {
  await server.close();
}
