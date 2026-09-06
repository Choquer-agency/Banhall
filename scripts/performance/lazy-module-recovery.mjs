/** Run serially: node scripts/performance/lazy-module-recovery.mjs
 * Build the actual LazyModule in a production Svelte harness. Serve its optional
 * chunk with a real HTTP 503, restore the bytes, and verify explicit page reload
 * recovers the browser's cached import failure. No auth or backend required.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../../', import.meta.url));
const evidence = path.join(root, '.audit/astra-high-review');
const harness = path.join(evidence, 'lazy-harness');
const dist = path.join(evidence, 'lazy-dist');
await fs.mkdir(harness, { recursive: true });
// Execute the real layout fallback, with its reload throttle already active.
// This represents a failure persisting after the app's first automatic reload.
const layout = await fs.readFile(path.join(root, 'src/routes/+layout.svelte'), 'utf8');
const preloadHandler = layout.match(/  if \(typeof window !== "undefined"\) \{[\s\S]*?\n  \}\n(?=<\/script>)/)?.[0];
assert.ok(preloadHandler, 'The layout preload-error handler changed; update the harness boundary');
await fs.writeFile(path.join(harness, 'index.html'), '<!doctype html><html><body><div id="app"></div><script type="module" src="/main.js"></script></body></html>');
await fs.writeFile(path.join(harness, 'main.js'), `
import { mount } from 'svelte';
import App from './App.svelte';
sessionStorage.setItem('chunk-reload-at', String(Date.now()));
window.preloadErrors = 0;
window.addEventListener('vite:preloadError', () => window.preloadErrors++);
${preloadHandler}
mount(App, { target: document.querySelector('#app') });
`);
await fs.writeFile(path.join(harness, 'App.svelte'), `
<script>
  import LazyModule from ${JSON.stringify(path.join(root, 'src/lib/components/ui/LazyModule.svelte'))};
  let active = $state(false);
  let reportDraft = $state('');
  const load = () => import('./Optional.svelte');
  window.retrySameImport = load;
</script>
<label>Report draft <input bind:value={reportDraft}></label>
<button onclick={() => active = !active}>Toggle optional tool</button>
<div hidden={!active}>
  <LazyModule {load} {active} label="optional tool">
    {#snippet children(Tool)}<Tool />{/snippet}
  </LazyModule>
</div>
`);
await fs.writeFile(path.join(harness, 'Optional.svelte'), `
<script>let draft = $state('');</script>
<label>Tool draft <input bind:value={draft}></label>
`);
await build({
  configFile: false, root: harness, cacheDir: path.join(evidence, 'lazy-vite-cache'),
  plugins: [svelte()],
  build: { outDir: dist, emptyOutDir: true, manifest: true },
});
const manifest = JSON.parse(await fs.readFile(path.join(dist, '.vite/manifest.json'), 'utf8'));
const optional = Object.values(manifest).find(entry => entry.src === 'Optional.svelte');
assert.ok(optional?.isDynamicEntry, 'Expected independently loaded optional component');
const optionalPath = `/${optional.file}`;
let failChunk = true;
const requests = [];
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const filename = path.resolve(dist, url.pathname === '/' ? 'index.html' : `.${url.pathname}`);
    if (!filename.startsWith(`${dist}${path.sep}`)) {
      response.writeHead(403).end();
      return;
    }
    if (url.pathname === optionalPath) {
      requests.push({ path: url.pathname, status: failChunk ? 503 : 200 });
      if (failChunk) {
        response.writeHead(503, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' }).end('Unavailable');
        return;
      }
    }
    const bytes = await fs.readFile(filename);
    response.writeHead(200, { 'Content-Type': filename.endsWith('.html') ? 'text/html' : 'text/javascript', 'Cache-Control': 'no-store' }).end(bytes);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address !== 'string');
const result = { method: 'Actual production LazyModule and extracted existing layout preload handler; HTTP 503 optional chunk with automatic-reload throttle active, then HTTP 200 and user-triggered reload. No Convex/auth or timing claim.', requests };
let browser;
try {
  browser = await chromium.launch({ headless: true });
  result.browser = browser.version();
  const page = await browser.newPage();
  let documentNavigations = 0;
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) documentNavigations++; });
  await page.goto(`http://127.0.0.1:${address.port}`);
  await page.getByLabel('Report draft').fill('Unsaved report text');
  assert.equal(requests.length, 0, 'Inactive optional module was fetched');
  await page.getByRole('button', { name: 'Toggle optional tool' }).click();
  await page.getByRole('button', { name: 'Reload page', exact: true }).waitFor();
  assert.match(await page.getByRole('alert').innerText(), /Unsaved changes may be lost/);
  assert.equal(await page.getByLabel('Report draft').inputValue(), 'Unsaved report text');
  assert.equal(documentNavigations, 1, 'Failure automatically navigated despite active layout throttle');
  assert.equal(await page.evaluate(() => window.preloadErrors), 1, 'Did not observe the production preload-error event');
  assert.deepEqual(requests.map(request => request.status), [503]);
  await page.screenshot({ path: path.join(evidence, 'lazy-failed.png') });
  failChunk = false;
  const retry = await page.evaluate(async () => {
    try { await window.retrySameImport(); return 'resolved'; }
    catch { return 'rejected'; }
  });
  assert.equal(retry, 'rejected', 'Browser no longer caches this failed import; revisit recovery behavior');
  assert.equal(requests.length, 1, 'Same-document retry unexpectedly fetched the restored module');
  result.cachedFailure = { sameDocumentRetry: retry, networkRequests: requests.length };
  await Promise.all([
    page.waitForEvent('load'),
    page.getByRole('button', { name: 'Reload page', exact: true }).click(),
  ]);
  assert.equal(documentNavigations, 2);
  await page.getByRole('button', { name: 'Toggle optional tool' }).click();
  const tool = page.getByLabel('Tool draft');
  await tool.fill('Keep the mounted tool draft');
  const originalNode = await tool.elementHandle();
  await page.getByRole('button', { name: 'Toggle optional tool' }).click();
  await page.getByRole('button', { name: 'Toggle optional tool' }).click();
  assert.equal(await tool.inputValue(), 'Keep the mounted tool draft');
  assert.equal(await tool.evaluate((element, original) => element === original, originalNode), true);
  assert.deepEqual(requests.map(request => request.status), [503, 200]);
  await page.screenshot({ path: path.join(evidence, 'lazy-recovered.png') });
  result.recovery = { documentNavigations, moduleStatuses: requests.map(request => request.status), retainedInstanceAndDraft: true };
  result.passed = true;
} finally {
  await fs.writeFile(path.join(evidence, 'lazy-recovery.json'), JSON.stringify(result, null, 2));
  await browser?.close();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
console.log(JSON.stringify(result, null, 2));
