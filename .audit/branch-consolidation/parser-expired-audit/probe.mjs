import assert from 'node:assert/strict';
const variant = process.argv[2];
const phase = process.argv[3];
const {parseFileToText} = await import(`./parser-${variant}.mjs`);
const actualNow = Date.now;
const start = actualNow();
let now = start;
Date.now = () => now;
const unhandled = [];
process.on('unhandledRejection', reason => unhandled.push(reason.message));
let rejectPending;
let destroyed = 0;
let pageCalls = 0;
const pending = new Promise((_, reject) => { rejectPending = reject; });
const expire = () => { now = start + 60_001; return pending; };
const pdf = {
  numPages: 2,
  getPage(i) {
    pageCalls++;
    if (i === 1) return Promise.resolve({getTextContent: () => Promise.resolve({items:[{str:'First page preserved'}]})});
    if (phase === 'page') return expire();
    return Promise.resolve({getTextContent: expire});
  },
};
globalThis.pdfProbe = {
  getDocument() {
    return {
      promise: Promise.resolve(pdf),
      destroy() {
        destroyed++;
        // pdf.js teardown/worker failure can reject already-started work later.
        setImmediate(() => rejectPending(new Error('late pdf work rejected after destroy')));
        return Promise.resolve();
      },
    };
  },
};
const result = await parseFileToText(new File([new Uint8Array([37,80,68,70])], 'expired.pdf'));
await new Promise(resolve => setImmediate(() => setImmediate(resolve)));
Date.now = actualNow;
assert.equal(destroyed, 1);
assert.equal(pageCalls, 2);
assert.match(result.content, /First page preserved/);
assert.match(result.content, /Stopped reading at page 2/);
assert.equal(unhandled.length, variant === 'current' ? 1 : 0);
console.log(JSON.stringify({variant,phase,clock:'Date.now controlled: budget expires synchronously before withDeadline attaches',publicEntry:'parseFileToText',result,destroyed,pageCalls,unhandled}));
