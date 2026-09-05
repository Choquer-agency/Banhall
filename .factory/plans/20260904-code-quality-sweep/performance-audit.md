# Performance sweep

Date: 2026-09-04. Baseline checkout SHA observed: `11bfe3ebcb79fd8be78e2e057b45ea69db0f88be`. Read-only audit of frontend and Convex. No product edits, shared database access, deploys, factory runs, or commits performed. Findings are source-backed. The editor/parser measurements use synthetic fixtures and actual extracted functions; the upload measurement invokes the actual registered mutation inside local in-memory `convex-test`. None uses live customer workloads.

Reproducible harness: `.factory/plans/20260904-code-quality-sweep/performance-benchmark.mjs`. Run from each baseline/fixed worktree using `node /Users/johnnynguyen/Documents/Repos/Banhall/.factory/plans/20260904-code-quality-sweep/performance-benchmark.mjs`. It resolves installed packages and reads actual source relative to the current working directory, prints source SHA-256 values and stable match-position hashes, and writes no files. The helper extraction is intentionally distinguished from parser integration QA.

## Ready for narrow tickets

### PERF-1: PDF deadline timers survive successful parsing

- Evidence: `src/lib/parseDocument.ts:64` creates one timer in `withDeadline` and does not retain/clear its handle after either branch settles. The PDF path calls it once for document load and twice per page at `:187`, `:190`, `:191`. Every successful N-page parse retains 2N+1 timer callbacks until its common 60-second deadline. `loadingTask.destroy()` at `:210` does not clear these independent timers.
- Measured baseline: ran the actual helper source extracted and transpiled with the installed TypeScript compiler, using an instrumented timer boundary. 201 successful immediate operations (100-page call count) allocated 201 timers and left **201 pending after completion**.
- This is helper behavior evidence, **not a parser integration test or measured browser latency improvement**.
- Narrow change: cancel the deadline timer when work resolves or rejects, while keeping the existing absolute whole-file deadline and `ParseTimeout` identity. Do not replace it with a fresh 60-second per-page timeout.
- Verification: exercise `parseFileToText` through the actual module, controlling only the external `pdfjs-dist` boundary and timers. A successful multi-page PDF must leave zero timers, return exactly the same text, and destroy the loading task; a page timeout must retain the correct truncation marker; document-load timeout and parser rejection must preserve current behavior and cleanup. A real generated text PDF in Chromium would additionally verify the PDF.js boundary.
- Scope: `src/lib/parseDocument.ts`, existing parser tests. No domain or schema changes needed.

### PERF-2: Every proposal pair rebuilds the complete editor search index

- Evidence: `src/lib/components/editor/Editor.svelte:508` loops over every preview diff; `findAllOccurrencesCI` calls `buildSearchIndex(doc)` at `:261` on every pair. `buildSearchIndex` at `:113` walks every character and allocates two arrays plus normalized strings. `findReplaceMatches` at `:1117` repeats the same pattern. Existing decoration caching at `:848` already avoids cursor-only rebuilds; this finding concerns a single rebuild with multiple proposal pairs and subsequent document edits.
- Baseline command ran actual functions from the module script (TypeScript transpile, no algorithm rewrite), real `@tiptap/pm/model` Schema documents and real `@tiptap/pm/view` DecorationSet. Widget DOM factories were not invoked. After five warmups, 30 builds with 20 distinct proposal pairs yielded:

| Synthetic report characters | Pairs | Full `doc.descendants` traversals / 30 builds | Median ms / build | P95 ms / build |
| ---: | ---: | ---: | ---: | ---: |
| 22,790 | 20 | 600 | 60.61 | 64.90 |
| 91,490 | 20 | 600 | 262.48 | 306.32 |

- These are local Node CPU measurements, not browser INP or production data. The operation counts prove the avoidable repeated work without relying on machine-specific timing.
- Narrow change: reuse one normalized search index within each batch/build. Prefer explicit per-build reuse in the existing matching mechanics over global mutable caches. Keep case-insensitive matching, whitespace normalization, positions, duplicate occurrences, and replacement casing unchanged. Do not conflate the distinct plain-text positional search in `findTextInDoc` with this normalized index.
- Verification: same fixture/output and baseline benchmark; a 20-pair batch should need one index traversal. Verify equivalent match positions for curly quotes, dashes, repeated whitespace, cross-paragraph text, duplicate phrases, empty text, stale previews and changed document identity. Preserve selection-only no-rebuild behavior. Run relevant component checks, then browser proof of proposal preview, typing, comment highlights and apply flow. No AI mutation of report prose may be introduced.
- Scope: editor matching helper and its tests; avoid redesigning editor state or autosave. Existing cached document metrics at `:738` and selection-cache behavior must remain.

### PERF-3: Empty-content uploads scan every full project document unnecessarily

- Evidence: `convex/documents.ts:83` collects all project documents before checking `args.content.trim().length > 0` at `:88`. Images, unreadable files and extraction failures store empty text, and comments at `:76` explicitly say these cannot be deduplicated. That scan therefore contributes nothing to the result for those uploads, yet loads every prior body and broadens transaction dependencies.
- Narrow change: compute whether dedupe is eligible first and skip the query for empty/whitespace-only text. Preserve creation of separate rows, original-byte storage, processing statuses and upload-attempt resolution.
- Verification: existing `documents`/upload-attempt tests plus the public transaction-metrics proof below. Test two empty uploads with the same filename still get separate ids and successful receipts. Nonempty duplicate uploads still reuse the original row and handle orphan storage.
- No schema migration or production handler wrapper is necessary for this narrow branch optimization.

#### Actual registered mutation baseline and public verification seam

The installed Convex `1.42.3` exposes `ctx.meta.getTransactionMetrics()` as a public method (`node_modules/convex/src/server/meta.ts:134`, `registration.ts:158`). Installed `convex-test` `0.0.54` supports an inline `t.mutation` callback (`node_modules/convex-test/dist/index.d.ts:24`), tracks query/read metrics, and folds child-mutation metrics into the parent on commit (`dist/transactionMetrics.js:62`; the metadata syscall is handled at `dist/index.js:1005`). Therefore an inline test callback can call the **actual registered** upload mutation with its normal validators/auth and then retrieve its cost:

```ts
const result = await writer.mutation(async (ctx) => {
  const documentId = await ctx.runMutation(api.documents.uploadDocument, {
    projectId,
    fileName: "image.png",
    fileType: "image",
    content: "",
  });
  return { documentId, metrics: await ctx.meta.getTransactionMetrics() };
});
```

No production extraction, `_handler` access, query stub or syscall interception is required. The fixture intentionally omits optional report/attempt/storage arguments so the baseline is the authentication lookup, the project lookup, and the avoidable dedupe scan. Existing normal mutation tests separately cover receipts, storage and dedupe semantics.

Executed this proof against the real project schema and auth helpers at `11bfe3e`, with only disposable in-memory seeded data:

| Existing supporting documents | Queries | Documents read | Bytes read | Stored upload status |
| --- | ---: | ---: | ---: | --- |
| 0 | 3 | 2 | 375 | reference_only |
| 3 documents, 100,000 characters each | 3 | 5 | 301,074 | reference_only |

The future fixed fixture should remain at **2 queries and 2 documents read** regardless of the seeded supporting-file count, because only user/project authorization reads remain. The fixed source has not been executed by this audit. Avoid asserting exact byte totals as a universal runtime promise; these are local fixture measurements.

Exact executable runner: `.factory/plans/20260904-code-quality-sweep/upload-read-baseline.mjs`. Captured successful output: `.factory/plans/20260904-code-quality-sweep/upload-read-baseline.log`. Run it from the checkout being measured using an absolute script path:

```sh
node /Users/johnnynguyen/Documents/Repos/Banhall/.factory/plans/20260904-code-quality-sweep/upload-read-baseline.mjs
```

It resolves packages/source from the current working directory, transpiles TypeScript only in memory, prints commit/source hashes and measurements, disables `fetch`, and writes no files. The baseline log was captured by shell redirection outside the runner. No shared backend was contacted and no product tests/code were written. Source SHA-256 for this run was `3ab18a85774fc3bcdd44d68d680831ade83cbc15b1b08ea06c3c214167c8eab9` for `convex/documents.ts`; `git status` over source/config paths remained empty.

## Larger follow-ups, defer unless separately scoped

### PERF-4: Supporting-file list and dedupe repeatedly read every full body

`convex/documents.ts:172` uses unbounded `.collect()` for a metadata list and `:197` resolves a URL for every stored file. Stripping `content` from returned objects reduces browser transfer but does not avoid database body reads. `:83` also collects all bodies for every nonempty upload before matching filename/content. `projectDocuments.content` can be roughly 400,000 characters per file (`src/lib/parseDocument.ts:51`). A populated project can consume large read bandwidth and cause upload transactions/list subscriptions to depend on unrelated bodies.

Suggested scoped follow-up: indexed filename and content-hash dedupe (verify actual content on candidate hash match), metadata/body separation or bounded metadata pagination, and lazy file URL lookup where UI permits. Preserve archived-row dedupe behavior, legacy processing status derivation, receipt completeness and download behavior. Measure actual transaction read documents/bytes using disposable local Convex fixtures with many large files; do not invent a smaller `.take()` cap that silently changes dedupe or omits user files.

### PERF-5: Industry picker scans all projects; dashboard facets scan up to 1,001

`convex/projects.ts:176` reads all project documents to return distinct industry strings. `src/lib/components/ui/IndustrySelect.svelte:42` subscribes whenever authenticated, including project creation/editing. Every unrelated project update can invalidate the scan. `convex/dashboard.ts:410` separately reads up to `DASHBOARD_FACET_LIMIT + 1` and aggregates stage/owner/industry/science-code values. **There is no persisted industry/facet projection to substitute directly.** Using `getFacets` for the picker would hide custom industry values beyond its bounded window and change behavior.

Follow-up: maintain compact counts/projection for industries and dashboard facets, with correct update/delete/backfill handling, or evaluate an indexed distinct-industry traversal. Measure query documents/bytes and invalidation counts at 100, 1,000 and 10,000 seeded projects. Preserve legacy custom-industry availability and current truncated-facet semantics unless explicitly changed.

### PERF-6: Admin statistics scan cumulative source tables

`convex/generations.ts:2862` scans all model selections, `:2894` scans all scores, and `:2927` scans all scores again to return at most 50 comments for one model. `convex/brain.ts:788` and `:792` collect complete approved/pending source rows, including source prose, to calculate counts. The filtered source list at `:731` is also unbounded.

Use indexed model-comment reads plus compact aggregate counters and paginated queues. Counts need write-path/migration proofs rather than a `.take()` cap. These are less frequent admin paths and should rank below parser/editor/upload work. Verify with local large fixtures and before/after transaction bytes. No production scale claim has been made.

## Audited areas already doing the useful thing

- Parsing dependencies are lazy: PDF.js, Mammoth, XLSX and message/email parsers load inside file-type branches (`src/lib/parseDocument.ts:168`, `:175`, `:222`, `:257`, `:130`). Export DOCX/file-saver imports are already browser-handler lazy (`CurrentProjectPage.svelte:767`, `PreviewProjectPage.svelte:922`). Do not claim these libraries are all in initial route payload.
- Editor metrics cache by immutable doc identity and decorations avoid selection-only recomputation (`Editor.svelte:738`, `:818`, `:848`). No blanket "recompute all metrics on every cursor move" finding.
- Transcript browser queries return metadata and fetch only the selected body (`convex/transcripts.ts:15`, `:37`; `CurrentProjectPage.svelte:117`). Server metadata still reads bodies/word-counts, but project limits are explicit (20 transcripts, 2,000,000 combined characters in `convex/lib/transcripts.ts:8`, `:17`); this is not unbounded browser transfer.
- Modern dashboard project lists paginate and deduplicate user lookups (`convex/dashboard.ts:98`, `:143`, `:176`). The old `projects.listProjects` scan is not automatically evidence against the current dashboard path.
- Chat message history uses pagination; turn metadata is capped at the latest 200 (`convex/chatV2.ts:66`, `:128`, `:216`). ErrorMonitor fetches feature requests only when the relevant flow is open (`ErrorMonitor.svelte:54`).

## Fresh production build and current route bundle

Ran a fresh production build at unchanged source commit `11bfe3ebcb79fd8be78e2e057b45ea69db0f88be` on 2026-09-04 local time (started `2026-09-05T05:31:03.336Z`). Command:

```sh
PUBLIC_CONVEX_URL=https://placeholder.convex.cloud PUBLIC_CONVEX_SITE_URL=https://placeholder.convex.site npm run build
```

The build passed, including the Vercel adapter, in **44.393 seconds** with a 600-second enforced timeout. No server was started, and no source/config files were changed. `git status --short -- src convex shared package.json package-lock.json vite.config.ts vitest.config.ts vitest.component.config.ts` returned no changes afterward. Full output and timing are in `.factory/plans/20260904-code-quality-sweep/build-baseline.log`. Vite reported a chunk exceeding 500 kB and a build-plugin timing advisory; neither failed the build.

The new client manifest was written at `2026-09-05T05:31:40.880Z`. `.svelte-kit/generated/client-optimized/app.js` maps `/project/[id]` to node 18, emitted as `_app/immutable/nodes/18.Bxfz1Il-.js`. Following only manifest `imports` edges, deduplicating emitted files, and summing raw bytes and each file's default-level `zlib.gzipSync` size produced:

| Static JavaScript set | Files | Raw bytes | Gzip bytes |
| --- | ---: | ---: | ---: |
| Project route node alone | 1 | 555,131 | 147,692 |
| Project route plus all static imports | 53 | 1,976,926 | 573,265 |
| Project route plus root layout and their static imports | 55 | 2,013,199 | 586,889 |
| Project route, root layout, app/start entries and all static imports | 57 | 2,024,072 | 590,319 |
| Additional route files beyond the app/start/root-layout closure | 37 | 1,616,760 | 454,415 |

These are **build-artifact JavaScript totals**, not measured browser transfer, request timings, LCP or INP. They exclude dynamic imports, CSS, fonts, other assets and HTTP overhead. Per-file sizes, SHA-256 values and the complete static closures are saved in `.factory/plans/20260904-code-quality-sweep/bundle-baseline.json`.

Both workspaces are included. The source statically imports CurrentProjectPage and PreviewProjectPage (`src/routes/project/[id]/+page.svelte:7`, `:8`). The emitted route node contains both component function definitions and the final gate call `current:e=>{wx(e,{})},preview:e=>{US(e,{})}`. `currentWhileLoading:false` prevents either component from mounting before the decision, but does not split their JavaScript out of the static route bundle.

PDF.js, Mammoth, XLSX, PostalMime, MSGReader, DOCX export and FileSaver remain dynamic entry points and are **not** counted as static route payload. A lazy cohort branch remains a supported follow-up candidate, but no code-split change or browser comparison has been made. The two workspaces share substantial editor/UI dependencies, so their duplication does not imply that half the total can be removed. A follow-up needs a before/after manifest comparison, a cold-browser measurement and preserved loading/rollback/preview behavior before claiming useful savings.

## Reproduction details for the measured editor baseline

The Node command loaded the module `<script module lang="ts">` from `Editor.svelte`, removed only import declarations with TypeScript's AST/printer, transpiled it with the installed compiler, and evaluated it with real `Decoration` and `DecorationSet` imports. A real ProseMirror Schema had `doc -> paragraph+`, `paragraph -> text*`. Documents had 100 or 400 paragraphs, each `Experiment ${i}: ` followed by `The system evaluated thermal stability against the measured reference. ` repeated three times. Twenty pairs searched `Experiment 0:` through `Experiment 19:` and replaced each with `Replacement`. It counted calls to the real document's `descendants`, ran five warmups and 30 measured `buildDecorationSet(doc, [], [], undefined, diffs)` operations. Use the same fixture in the implementation worktree for a defensible before/after.

Saved harness verified successfully with Node `v24.19.0`. Exact final-run records (the table uses this run; an earlier ad hoc run had the same operation counts with somewhat higher timing):

```jsonl
{"kind":"measurement_context","cwd":"/Users/johnnynguyen/Documents/Repos/Banhall","node":"v24.19.0","source":"src/lib/components/editor/Editor.svelte","sha256":"8aa853d5eda4e82dfea6d9dd2eb1dcc6fff3ffae5822ef9f7284bca06e85e6f5"}
{"kind":"synthetic_editor_cpu","chars":22790,"proposalPairs":20,"iterations":30,"descendantTraversals":600,"medianMs":60.61,"p95Ms":64.9,"matchPositionsSha256":"97e33b1b41e05229838b63cdc1f9bde97b8d265c7e4138f0dfee37303cf85397"}
{"kind":"synthetic_editor_cpu","chars":91490,"proposalPairs":20,"iterations":30,"descendantTraversals":600,"medianMs":262.48,"p95Ms":306.32,"matchPositionsSha256":"97e33b1b41e05229838b63cdc1f9bde97b8d265c7e4138f0dfee37303cf85397"}
{"kind":"deadline_helper_only_not_pdf_integration","source":"src/lib/parseDocument.ts","sha256":"1a47de2b39cd3ffc3041debff222691fb6cb4d6c866f405911a2ad4c6d19be8c","successfulOperations":201,"allocatedTimers":201,"pendingAfterCompletion":201}
```
