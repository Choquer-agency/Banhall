import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';

const client = '.svelte-kit/output/client';
const destination = process.argv[2] ?? '.audit/performance-improvements/report-bundles-after.json';
const manifest = JSON.parse(fs.readFileSync(path.join(client, '.vite/manifest.json'), 'utf8'));
const app = fs.readFileSync('.svelte-kit/generated/client/app.js', 'utf8');
const routeMatch = [...app.matchAll(/"([^"\n]+)": (\[[^\n]+\])/g)].find(match => match[1] === '/project/[id]');
if (!routeMatch) throw new Error('Project route not found in generated app');
const route = JSON.parse(routeMatch[2]);
const node = n => `.svelte-kit/generated/client-optimized/nodes/${n}.js`;
const roots = ['.svelte-kit/generated/client-optimized/app.js', 'node_modules/@sveltejs/kit/src/runtime/client/entry.js', node(0), ...(route[1] ?? []).filter(n => n != null).map(node), node(route[0])];
function closure(keys) {
  const seen = new Set();
  function visit(key) {
    if (seen.has(key)) return;
    if (!manifest[key]) throw new Error(`Missing manifest entry ${key}`);
    seen.add(key);
    for (const dep of manifest[key].imports ?? []) visit(dep);
  }
  keys.forEach(visit);
  return [...seen];
}
function measure(keys) {
  const files = closure(keys).map(key => {
    const file = manifest[key].file;
    const bytes = fs.readFileSync(path.join(client, file));
    return { key, file, bytes: bytes.length, gzip: zlib.gzipSync(bytes).length };
  });
  return { modules: files.length, bytes: files.reduce((n, f) => n + f.bytes, 0), gzip: files.reduce((n, f) => n + f.gzip, 0), files };
}
const shell = measure(roots);
const moduleKey = name => {
  const key = Object.keys(manifest).find(k => k.endsWith(`/${name}.svelte`));
  if (!key) throw new Error(`No independent dynamic entry for ${name}`);
  if (shell.files.some(file => file.key === key)) throw new Error(`${name} leaked into static shell`);
  return key;
};
const names = ['AgentChatPanel', 'QARailPanel', 'VersionHistory', 'CandidateSelection', 'IterativeStepper'];
const optionalModules = Object.fromEntries(names.map(name => [name, moduleKey(name)]));
const cohorts = Object.fromEntries(['CurrentProjectPage', 'PreviewProjectPage'].map(name => {
  const selected = moduleKey(name);
  const closedAssistant = measure([...roots, selected]);
  const opposite = name === 'CurrentProjectPage' ? 'PreviewProjectPage' : 'CurrentProjectPage';
  if (closedAssistant.files.some(file => file.key.endsWith(`/${opposite}.svelte`) || Object.values(optionalModules).includes(file.key))) throw new Error(`${name} eagerly imports another cohort or optional module`);
  return [name, { closedAssistant, defaultDesktopAssistant: measure([...roots, selected, optionalModules.AgentChatPanel]), optionalTools: Object.fromEntries(Object.entries(optionalModules).map(([tool, key]) => [tool, measure([...roots, selected, key])])) }];
}));
const baseline = JSON.parse(fs.readFileSync('docs/performance-audit-2026-09-06/evidence.json', 'utf8')).route_bundles.routes.find(route => route.route === '/project/[id]');
if (!baseline) throw new Error('Committed audit evidence has no /project/[id] route baseline');
const result = { method: 'Production manifest static transitive closures. Cold shell includes shared app/layout. Each selected cohort includes shell; default desktop additionally includes assistant. Optional tools shown as cold union with selected cohort. Gzip is offline per-file estimate, not network transfer or a measured route speedup.', baseline: { cold: baseline.cold, incremental_over_root: baseline.incremental_over_root }, shell, cohorts };
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ baseline: result.baseline, shell: { bytes: shell.bytes, gzip: shell.gzip }, cohorts: Object.fromEntries(Object.entries(cohorts).map(([name, data]) => [name, { closed: { bytes: data.closedAssistant.bytes, gzip: data.closedAssistant.gzip }, desktop: { bytes: data.defaultDesktopAssistant.bytes, gzip: data.defaultDesktopAssistant.gzip } }])) }, null, 2));
