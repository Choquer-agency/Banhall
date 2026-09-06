import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = process.cwd();
const dir = `${root}/.audit/branch-consolidation/parser-expired-audit`;
const source = await readFile(`${root}/src/lib/parseDocument.ts`, 'utf8');
await writeFile(`${dir}/source-manifest.json`, JSON.stringify({source: 'src/lib/parseDocument.ts', sha256: createHash('sha256').update(source).digest('hex')}, null, 2));
await writeFile(`${dir}/parseDocument.source.snapshot`, source);
for (const variant of ['current', 'observer-fix']) {
  await build({
    entryPoints: [`${root}/src/lib/parseDocument.ts`], bundle: true, platform: 'node', format: 'esm', packages: 'external',
    outfile: `${dir}/parser-${variant}.mjs`,
    plugins: [{name: 'pdf-boundary', setup(b) {
      b.onResolve({filter: /^pdfjs-dist$/}, () => ({path: 'pdf-fixture', namespace: 'fixture'}));
      b.onLoad({filter: /.*/, namespace: 'fixture'}, () => ({contents: 'export const GlobalWorkerOptions = {}; export const getDocument = (...args) => globalThis.pdfProbe.getDocument(...args);', loader: 'js'}));
      if (variant === 'observer-fix') b.onLoad({filter: /\/src\/lib\/parseDocument\.ts$/}, () => ({
        contents: source.replace('if (ms <= 0) return Promise.reject(new ParseTimeout());', 'if (ms <= 0) { void promise.catch(() => {}); return Promise.reject(new ParseTimeout()); }'), loader: 'ts', resolveDir: `${root}/src/lib`,
      }));
    }}],
  });
}
