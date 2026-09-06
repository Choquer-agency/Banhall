/** Run serially, with no tests/builds running: node scripts/performance/streaming-probe.mjs */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
const root = fileURLToPath(new URL('../../', import.meta.url));
const evidence = path.join(root, '.audit/performance-improvements/streaming');
await fs.mkdir(evidence, { recursive: true });
const server = await createServer({ root, configFile: false, cacheDir: path.join(evidence, 'vite-cache'), server: { middlewareMode: true } });
const { createPersistentProjection } = await server.ssrLoadModule('/src/lib/chat/persistentProjection.ts');
const { deriveUIMessagesFromDeltas } = await server.ssrLoadModule('/src/lib/chat/agentInternal.ts');
const realNow = Date.now;
// Generated creation timestamps are frozen only for exact snapshot equality;
// all durations use monotonic performance.now(). No wall-clock wait is used.
Date.now = () => 123;
const row = { streamId: 'benchmark', format: 'UIMessageChunk', status: 'streaming', order: 0, stepOrder: 0 };
const results = [];
async function measure(count, sample) {
  const parts = [{ type: 'start' }, { type: 'start-step' }, { type: 'text-start', id: 't' },
    ...Array.from({ length: count }, () => ({ type: 'text-delta', id: 't', delta: 'The evidence explains this result. ' })),
    { type: 'text-end', id: 't' }, { type: 'finish-step' }, { type: 'finish', finishReason: 'stop' }];
  const batchSize = 50;
  const expected = [];
  let baselineTotalMs = 0, baselineLargestBatchMs = 0;
  for (let index = 0; index < parts.length; index += batchSize) {
    const start = performance.now();
    const [message] = await deriveUIMessagesFromDeltas('benchmark', [row], [{ streamId: row.streamId, start: 0, end: Math.min(parts.length, index + batchSize), parts: parts.slice(0, index + batchSize) }]);
    const elapsed = performance.now() - start;
    baselineTotalMs += elapsed; baselineLargestBatchMs = Math.max(baselineLargestBatchMs, elapsed);
    expected.push(message);
  }
  const projection = createPersistentProjection('benchmark', row);
  let persistentTotalMs = 0, persistentLargestBatchMs = 0;
  try {
    for (let index = 0; index < parts.length; index += batchSize) {
      const start = performance.now();
      await projection.append(parts.slice(index, index + batchSize));
      const message = projection.snapshot();
      const elapsed = performance.now() - start;
      persistentTotalMs += elapsed; persistentLargestBatchMs = Math.max(persistentLargestBatchMs, elapsed);
      assert.deepEqual(message, expected[index / batchSize], `Snapshot differs at batch ${index / batchSize}`);
    }
    return { count, sample, batchSize, batches: expected.length, baselineTotalMs, baselineLargestBatchMs, persistentTotalMs, persistentLargestBatchMs, everyBatchEqual: true, characters: projection.snapshot().text.length };
  } finally { await projection.dispose(); }
}
try {
  await measure(1000, 'warmup');
  for (const count of [100, 1000, 5000]) for (let sample = 1; sample <= 3; sample++) {
    const result = await measure(count, sample); results.push(result); console.log(JSON.stringify(result));
  }
} finally {
  Date.now = realNow;
  await fs.writeFile(path.join(evidence, 'results.json'), JSON.stringify({ recordedAt: new Date().toISOString(), runtime: process.version, method: 'Actual app persistent SDK projection versus installed authoritative replay; standard start/step/text/end framing, 50-chunk batches, one 1000-chunk warmup, three measured samples per size. Node desktop; no network, browser rendering or field INP claims. Run without concurrent tests/builds.', results }, null, 2));
  await server.close();
}
