/** Run: node scripts/performance/spreadsheet-probe.mjs
 * Builds a standalone production parser harness, generates synthetic workbooks,
 * and checks responsiveness/output parity locally without uploading anything.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';
import { chromium } from 'playwright';
import * as XLSX from 'xlsx';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../../', import.meta.url));
const evidence = path.join(root, '.audit/performance-improvements/spreadsheet');
const harness = path.join(evidence, 'harness');
await fs.mkdir(path.join(harness, 'public'), { recursive: true });
for (const rows of [5000, 20000]) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(
    Array.from({ length: rows }, (_, row) => Array.from({ length: 20 }, (_, col) => `row${row}-col${col}-text`))
  ), 'Data');
  await fs.writeFile(path.join(harness, 'public', `synthetic-${rows}.xlsx`), XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', compression: true }));
}
await fs.writeFile(path.join(harness, 'index.html'), '<!doctype html><html><body><input id="input" aria-label="Concurrent input"><script type="module" src="/main.js"></script></body></html>');
await fs.writeFile(path.join(harness, 'main.js'), `
import {parseFileToText} from ${JSON.stringify(path.join(root, 'src/lib/parseDocument.ts'))};
import {baselineSpreadsheetText} from ${JSON.stringify(path.join(root, 'src/lib/test/spreadsheetFixtures.ts'))};
window.prepare = async rows => {
  const buffer = await (await fetch('/synthetic-'+rows+'.xlsx')).arrayBuffer();
  window.file = new File([buffer], 'synthetic.xlsx');
  const tasks = [];
  const observer = new PerformanceObserver(list => tasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration}))));
  observer.observe({type:'longtask'});
  const start = performance.now();
  window.expected = baselineSpreadsheetText(buffer);
  const elapsedMs = performance.now()-start;
  await new Promise(resolve=>setTimeout(resolve,100));
  observer.disconnect();
  window.baseline = {elapsedMs, maxLongTask:Math.max(0,...tasks.map(task=>task.duration))};
};
window.start = () => {
  window.finished = false;
  const tasks = [];
  const observer = new PerformanceObserver(list => tasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration}))));
  observer.observe({type:'longtask'});
  let frames=0, maxFrameGap=0, previous=performance.now(), raf;
  const frame = now => { frames++; maxFrameGap=Math.max(maxFrameGap,now-previous); previous=now; raf=requestAnimationFrame(frame); };
  raf=requestAnimationFrame(frame);
  const start=performance.now();
  window.pending = parseFileToText(window.file).then(result=>{
    const elapsedMs=performance.now()-start;
    cancelAnimationFrame(raf);
    window.finished=true;
    return new Promise(resolve=>setTimeout(()=>{
      observer.disconnect();
      resolve({baseline:window.baseline,elapsedMs,frames,maxFrameGap,outputChars:result.content.length,parity:result.content===window.expected,tasks});
    },100));
  });
};
window.ready=true;
`);
const config = {
  configFile: false, root: harness, cacheDir: path.join(evidence, 'vite-cache'),
  build: { outDir: path.join(evidence, 'dist'), emptyOutDir: true },
  preview: { host: '127.0.0.1', port: 3028, strictPort: true },
};
await build(config);
const server = await preview(config);
let browser;
const results = [];
try {
  browser = await chromium.launch({ headless: true });
  for (const cpu of [1, 4]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
    await page.goto('http://127.0.0.1:3028');
    await page.waitForFunction(() => window.ready);
    // Warm the production parser and worker assets before calibrated samples.
    await page.evaluate(async () => { await window.prepare(5000); window.start(); await window.pending; });
    for (const rows of [5000, 20000]) for (let sample = 1; sample <= 2; sample++) {
      await page.evaluate(rows => window.prepare(rows), rows);
      await page.waitForTimeout(150);
      await page.locator('#input').fill('');
      await page.evaluate(() => window.start());
      await page.locator('#input').pressSequentially('responsive', { delay: 5 });
      const inputDuringParse = await page.evaluate(() => !window.finished && document.querySelector('#input').value === 'responsive');
      const result = await page.evaluate(() => window.pending);
      const maxLongTask = Math.max(0, ...result.tasks.map(task => task.duration));
      const entry = { cpu, rows, sample, ...result, inputDuringParse, maxLongTask };
      results.push(entry);
      console.log(JSON.stringify(entry));
      assert.equal(result.parity, true, 'Worker output differs from baseline');
      assert.ok(result.frames > 1, 'Animation stalled during parsing');
      if (rows === 20000) assert.equal(inputDuringParse, true, 'Input was blocked until parsing finished');
      assert.ok(maxLongTask < 100, 'Parser produced a main-thread task >=100ms');
    }
    await context.close();
  }
} finally {
  await fs.writeFile(path.join(evidence, 'results.json'), JSON.stringify({ recordedAt: new Date().toISOString(), browser: browser?.version(), results }, null, 2));
  await browser?.close();
  await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
}
