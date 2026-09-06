import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const path = '.audit/quality-pass/Q8/client-modules.json';
const evidence = JSON.parse(readFileSync(path,'utf8'));
assert.equal(evidence.environment, 'client');
assert.ok(evidence.rows.some(row => row.renderedLength > 0 && row.id.includes('/src/')));
const forbidden = /node_modules\/(?:react(?:-dom)?\/|@convex-dev\/better-auth\/dist\/(?:react|react-start|nextjs)\/|convex\/dist\/[^/]+\/react\/)/;
assert.equal(evidence.rows.filter(row => forbidden.test(row.id.replaceAll('\\','/'))).length, 0);
for (const chunk of evidence.chunks) {
  assert.equal(createHash('sha256').update(readFileSync(resolve(evidence.outputDirectory,chunk.file))).digest('hex'),chunk.sha256,chunk.file);
}
const result={result:'passed', environment:evidence.environment, chunks:evidence.chunks.length, modules:evidence.rows.length, renderedModules:evidence.rows.filter(row => row.renderedLength>0).length, forbiddenModules:0, allEmittedHashesMatch:true, manifestSha256:createHash('sha256').update(readFileSync(path)).digest('hex')};
writeFileSync('.audit/quality-pass/Q8/client-verification.json',JSON.stringify(result,null,2)+'\n');
console.log(result);
