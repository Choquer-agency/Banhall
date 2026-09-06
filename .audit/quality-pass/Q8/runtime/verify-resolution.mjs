import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = path => JSON.parse(readFileSync(path,'utf8'));
const before=read('.audit/quality-pass/Q8/inputs/package.before.json');
const manifest=read('package.json');
const lock=read('package-lock.json');
const targets={'@anthropic-ai/sdk':'0.91.1','@sveltejs/kit':'2.70.3','@xmldom/xmldom':'0.8.15','brace-expansion':'5.0.9','dompurify':'3.4.13','mermaid':'11.16.1','nanoid':'3.3.18','postcss':'8.5.23','tar':'7.5.21','react':'19.2.8','cookie':'0.7.2'};
for(const [name,version] of Object.entries(targets)) assert.equal(lock.packages[`node_modules/${name}`].version,version,name);
const tiptap=Object.entries(lock.packages).filter(([path])=>path.includes('node_modules/@tiptap/'));
assert.ok(tiptap.length>0);
for(const [path,entry] of tiptap) assert.equal(entry.version,'3.30.4',path);
for(const group of ['dependencies','devDependencies']) for(const [name,range] of Object.entries(before[group])) {
 if(name.startsWith('@tiptap/')) assert.equal(manifest[group][name],'3.30.4');
 else if(!['@anthropic-ai/sdk','@sveltejs/kit'].includes(name)) assert.equal(manifest[group][name],range,name);
}
assert.equal(manifest.dependencies.react,'19.2.8');
assert.equal(manifest.dependencies['@tiptap/core'],'3.30.4');
assert.deepEqual(manifest.overrides,{'@sveltejs/kit':{cookie:'0.7.2'}});
assert.ok(readFileSync('.npmrc','utf8').includes('legacy-peer-deps=true'));
assert.equal(lock.packages['node_modules/react'].dev,undefined);
assert.equal(Object.keys(lock.packages['node_modules/react'].dependencies??{}).length,0);
assert.equal(Object.keys(lock.packages).some(path=>path.endsWith('node_modules/react-dom')),false);
assert.deepEqual(read('.audit/quality-pass/Q8/audit-after.json').vulnerabilities,{});
console.log(JSON.stringify({result:'passed',exactTargets:targets,alignedTiptapEntries:tiptap.length,unrelatedManifestRanges:'preserved',temporaryOverrides:'absent',react:'production dependency without dependencies or react-dom'}));
