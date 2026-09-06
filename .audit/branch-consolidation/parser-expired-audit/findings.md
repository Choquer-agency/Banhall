# Expired-entry parser promise observation

Finding: real pre-existing hole, reachable through public parseFileToText. It is not introduced by the B1 timer-finally repair.

## Evidence

`probe.mjs` calls the actual exported parser bundled from the frozen source. Only pdfjs-dist's boundary is replaced, and Date.now is controlled to represent expiry while the next operation is synchronously being created. It first extracts one successful page. In separate child Node invocations, second-page getPage or getTextContent starts a deferred promise and moves the clock to start + 60,001ms before withDeadline reads it. The public parser returns preserved first-page text plus the normal page-2 truncation marker and destroys the loading task once. The simulated worker operation rejects on the next event-loop turn after destruction. Node emits an actual unhandledRejection event, recorded by a listener; this is not a synthetically asserted event.

Commands, all from the consolidation worktree:

- node .audit/branch-consolidation/parser-expired-audit/build.mjs
- node .audit/branch-consolidation/parser-expired-audit/probe.mjs current page
- node .audit/branch-consolidation/parser-expired-audit/probe.mjs current text
- node .audit/branch-consolidation/parser-expired-audit/probe.mjs observer-fix page
- node .audit/branch-consolidation/parser-expired-audit/probe.mjs observer-fix text

All four probes exited zero after checking the expected observed event count. Current variants recorded one unhandled rejection each; observer-fix variants recorded zero with identical partial result, page count and destruction count. Exact JSON output is retained in their corresponding .log files. Probe event observation uses event-loop turns, not a fixed sleep or full test suite.

## Why reachable

At src/lib/parseDocument.ts:194-195, JavaScript evaluates pdf.getPage(i) / page.getTextContent() before invoking withDeadline. Its :66 ms<=0 early return creates a separate rejected ParseTimeout promise without observing the already-started input promise. The outer parser catches that timeout and treats it as partial success, then destroys the worker. Deadline expiry can occur during synchronous work, between completion and the next operation, or due to a wall-clock advance; this branch is intentionally present for those cases. Existing earlier races cannot observe the newly created promise. loadingTask.destroy().catch only observes destroy's own promise.

Installed pdf.js getPage at build/pdf.mjs:12836 returns a .then-derived promise with no rejection observer attached to that returned promise; it can reject with Transport destroyed. getTextContent at :11964 returns a new promise rejected on readable-stream failure. Relevant installed source and SHA-256 are captured in installed-pdfjs-evidence.txt. Thus the mocked boundary models a supported late-rejection behavior rather than requiring a thenable that violates pdf.js's interface.

## Existing coverage and scope

Current parseDocument.test.ts PDF group covers successful cleanup, a cumulative timer deadline with a never-settling second page, never-loading document and three rejection stages while budget remains. No setSystemTime/expired-on-entry or late-after-timeout rejection case is present. Those existing tests cannot detect this branch's missing observer. baseline-helper.snapshot proves the same early return already exists at cc6b706; B1's change only adds timer storage/finally cleanup on the positive-ms path.

This probe establishes reachability of the actual public parser using a controlled dependency/clock. It does not claim a real PDF fixture or browser reproduced the issue, nor measure how often a browser reaches the boundary. No browser, full gate or remote operation ran.

## Smallest contract-preserving fix

On the expired branch, synchronously observe the already-started promise before returning the same immediate timeout:

    if (ms <= 0) {
      void promise.catch(() => {});
      return Promise.reject(new ParseTimeout());
    }

Do not await it: an expired, never-settling operation must still return promptly. Keep the existing ParseTimeout, cumulative budget, partial text/marker, worker cleanup and timer-finally path. This deliberately ignores only late underlying errors after the timeout has already won; positive-budget errors still propagate normally. `build.mjs` applies this hypothetical one-branch change only to the generated observer-fix bundle in this audit directory. No implementation source was changed.

## Preservation

parseDocument.source.snapshot and source-manifest.json freeze the reviewed source; a final SHA-256 check confirmed it remained unchanged during this audit. All scripts and generated modules are inside ignored parser-expired-audit and use .mjs or .snapshot extensions, not canonical .test.ts paths. No src/spec/index/native ledger/parent B1 artifact was modified. This is evidence for root's triage decision, not authorization to expand B1.
