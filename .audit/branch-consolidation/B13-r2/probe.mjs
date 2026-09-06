import fs from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const require = createRequire(`${process.cwd()}/package.json`);
const ts = require('typescript');
const { getSchema } = require('@tiptap/core');
function compile(source) {
  const exports = {};
  const js = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
  } }).outputText;
  new Function('exports', 'require', js)(exports, require);
  return exports;
}
const { getEditorExtensions } = compile(fs.readFileSync('src/lib/tiptapConfig.ts', 'utf8'));
const file = 'src/lib/components/editor/docSearch.ts';
const sources = {
  baseline: execFileSync('git', ['show', `1d6053388326fe4fde43a86177955157f11ce588:${file}`], { encoding: 'utf8' }),
  preserved: fs.readFileSync(`.audit/branch-consolidation/B13-r1/preserved-source/${file}.snapshot`, 'utf8'),
  final: fs.readFileSync(file, 'utf8'),
};
const results = {};
for (const [phase, source] of Object.entries(sources)) {
  const { findOccurrencesBatch } = compile(source);
  results[phase] = { sha256: createHash('sha256').update(source).digest('hex'), schemas: [] };
  for (const editable of [true, false]) {
    const schema = getSchema(getEditorExtensions({ editable }));
    const p = (...content) => schema.node('paragraph', null, content);
    const t = (text) => schema.text(text);
    const fixtures = [
      { name: 'expanded-prefix-tail', blocks: [p(t('İ target tail'))], needles: ['target'] },
      { name: 'expanded-prefix-end', blocks: [p(t('İ target'))], needles: ['target'] },
      { name: 'rejected-overlap', blocks: [p(t('İİİİİİ'))], needles: ['\u0307i\u0307i'] },
      { name: 'hard-break', blocks: [p(t('alpha'), schema.node('hardBreak'), t('beta'))], needles: ['alphabeta', 'alpha beta'] },
      { name: 'supplementary', blocks: [p(t('😀😀'))], needles: ['\ud83d', '\ude00'] },
    ];
    results[phase].schemas.push({ editable, fixtures: fixtures.map(({ name, blocks, needles }) => {
      const doc = schema.node('doc', null, blocks);
      doc.check();
      return { name, document: doc.toJSON(), needles, ranges: findOccurrencesBatch(doc, needles) };
    }) });
  }
}
fs.writeFileSync('.audit/branch-consolidation/B13-r2/results.json', JSON.stringify(results, null, 2) + '\n');
console.log('Recorded actual-schema ranges for baseline, preserved candidate and final source.');
