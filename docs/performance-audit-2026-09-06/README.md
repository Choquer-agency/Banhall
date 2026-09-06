# Banhall performance audit

Audit date: 2026-09-06. **Measurement audit only: no application changes or deployment. This publication records findings; no speed fixes have been implemented.**

The clearest measured problems are spreadsheet parsing that blocks the browser and the amount of code needed for the first report open. Typical report editing and the public sign-in page performed well in the sampled lab runs. There is no evidence supporting a wholesale database rewrite.

## Scope and confidence

Source: audited commit `c48f61ac035c1f93bc636a45d3f87c5e28ebe259`, with the same tree as merged main `9b7c397f17051ebcc776e4779e8083e231b18644`. Route sizes come from the accepted production build. Application source remained unchanged during measurement.

This is a portable documentation snapshot. [evidence.json](evidence.json) contains compact per-sample results and source-artifact hashes. Original raw traces, local harnesses, private review transcripts and environment receipts remain outside Git. Artifact filenames mentioned below identify those original local records. [Review and publication notes](verification.md) record the independent review and packaging checks.

Three evidence classes are kept separate:

- **Live:** canonical production sign-in at `https://banhall.vercel.app/login`; aggregate-only read-only samples from development Convex `energized-salamander-237`.
- **Laboratory:** actual application Editor and file parser compiled for production, synthetic inputs; unchanged production route modules loaded through local preview; installed chat stream reconstruction helper measured in Node.
- **Code-confirmed risks:** navigation gates, hidden panel lifecycles, database read sets and bounds, motion choices, and missing performance telemetry. These do not establish their current latency or real-world frequency.

**Unverified:** signed-in Home → Projects → report navigation, authenticated report/chat/QA interaction timing, client-share report timing, real upload/network timing, real AI time to first token, production query latency, and 72-hour OCC/resource health. The accessible app browser is signed out. The user was asked about access while independent work continued. Convex insights explicitly rejected deploy-key access; this is neither a clean health report nor evidence of contention.

## Measurement results

See [measurements.md](measurements.md) for the machine-derived measurement table and conditions.

The browser profiles configure 4× CPU slowdown and, where stated, 80 ms added network latency with 6 Mbit/s download. These are controlled lab profiles, not a specific phone, a field percentile, or a Lighthouse score. Sample maxima and medians below are not real-user INP.

### 1. Move spreadsheet parsing off the UI thread — high priority, reproduced

**Evidence:** `src/lib/parseDocument.ts:231` synchronously executes `XLSX.read`, then `sheet_to_csv` for a whole sheet. The 400,000-character cap is applied after parsing/conversion. Lazy-loading the library already exists; it does not make its execution asynchronous.

Actual `parseFileToText` in Chromium, two runs per input/profile:

| Synthetic workbook | Compressed file | Desktop longest blocking task | 4× CPU longest blocking task |
|---|---:|---:|---:|
| 5,000 rows × 20 text columns | 744,979 bytes | 296–303 ms | 1,221–1,253 ms |
| 20,000 rows × 20 text columns | 2,982,397 bytes | 1,181–1,193 ms | 4,923–4,930 ms |

Both produce 400,053 output characters, including the existing truncation marker. The larger workbook is not an actual customer file; this proves the failure mode, not its prevalence. Parsing happened locally, with no upload or database write.

**Fix unit:** move XLSX read/conversion to a dedicated worker; preserve parser output, markers, file support, and truthful extraction errors. Add cancellation and progress that can paint while parsing runs. Audit DOCX/MSG/email parsing next using representative fixtures; the PDF path already uses its dedicated PDF worker. Do not parallelize every large file at once and exhaust memory.

**Acceptance:** same extracted output and truncation behavior; a deliberately oversized valid fixture keeps a concurrent input/animation responsive; no parser-induced main-thread task above 100 ms in the calibrated lab profile. Check cancellation and fallback without uploading fixtures to live services.

Artifacts: `parser-profile.json`, `parser-profile.mjs`, `harness/main.js`, generated synthetic workbooks under `harness/public/`.

### 2. Reduce code required for the first report open — high priority, measured

`src/routes/project/[id]/+page.svelte:7` eagerly imports both CurrentProjectPage and PreviewProjectPage. Both statically import the editor, assistant, QA, comparison, and supporting UI (`PreviewProjectPage.svelte:11–77`, with the sibling Current implementation). Selecting one subtree prevents duplicate mounting, but does not prevent importing the route's static dependency graph.

| Route | Static JavaScript closure, raw | Offline gzip estimate |
|---|---:|---:|
| Projects | 835,376 bytes | 248,835 bytes |
| Report | 2,047,531 bytes | 597,544 bytes |

These totals include common application code, count each module once, and exclude dynamic imports not requested. They are not all removable bytes. File parsers and DOCX export are already dynamic; loading both report variants is only part of the report closure.

An isolated import of Projects followed by report loads **23 additional script resources**, 1,339,617 decoded bytes / 387,865 encoded bytes. Report import takes 67–94 ms locally and 905–913 ms in the constrained lab; repeating the same report import costs below 6 ms. This is code fetch/evaluation only, **not click-to-report-ready time**. No application is mounted in that test.

**Fix unit:** use real lazy component boundaries for the selected report experience and expensive optional panels. Prioritize editor/report text; delay comparison, history, and unused assistant/QA work until intent. Preserve route rollback, error handling, editing, and already-open panel state. Make imports early enough that opening chat does not merely move a multi-second pause to the button.

**Acceptance:** compare exact emitted dependency graphs and cold/warm navigation before/after; prove the alternative subtree/unused panels are absent from the initial network path. Verify all panel open and recovery paths. Set the final byte target after a measured split rather than promising all 597 KB can disappear.

Artifacts: `bundles.json`, `measure-bundles.mjs`, `module-profile.json`, `module-profile.mjs`.

### 3. Preserve the workspace through navigation and shorten data waterfalls — high-value candidate, signed-in timing required

`WorkspaceGate.svelte:51–64` waits for authentication and the workspace access query. The report route uses `currentWhileLoading={false}`; its actual project/report subscriptions begin only once the gate mounts the selected experience. Projects/Home additionally resolve view configuration before mounting their view data. Project/report reads within the report component run in parallel; they are **not 13 sequential round trips**. Comments and the default transcript body have additional dependent reads.

The application already has `data-sveltekit-preload-data="hover"` (`src/app.html:9`) and a last-resolved view-config cache (`WorkspaceDashboard.svelte:1–9`). SvelteKit route preloading does not itself prefetch component-owned Convex subscriptions. `convex-svelte` starts hook results without data and registers its subscription in an effect. Identical queries can be deduplicated by the shared Convex client; hook count alone is not server call count.

**Fix unit:** profile a signed-in navigation trace first. Consider keeping the common shell/gate at a persistent layout, retaining last successful view data during revalidation, and narrowly prefetching an intended project. Cache by session/user/project and invalidate on logout/access changes. Never bypass capability checks, briefly expose the wrong cohort, or show another project's content under the new title.

**Acceptance:** cold and warm Home ↔ Projects ↔ report traces with realistic data; record click-to-feedback, first project row, report text, and editor-ready separately. Preserve loading/error/empty distinctions, back/forward, search focus, and permission changes. Do not replace live collaboration with one-shot reads merely to lower subscription count.

### 4. Avoid paying for the assistant before it is used — medium priority, lifecycle confirmed

The report aside is conditional on `report && user`, not on chat being visible (`PreviewProjectPage.svelte:1696–1755`; equivalent Current page). Its comment explicitly preserves the mounted panel on close. Hidden mobile/closed desktop panels can therefore retain the assistant's queries and stream processing. `AgentChatPanel.svelte:184–249` subscribes to threads, messages (initial page 80), proposals, research, and user data; later turn/feedback subscriptions depend on loaded data.

Desktop chat defaults open and can restore a remembered preference (`PreviewProjectPage.svelte:540` and its initialization effect). Loading a visible assistant is legitimate. The opportunity is the remembered-closed or mobile-hidden case: keeping state after someone opens chat is useful, while mounting a panel the user cannot see is a separate cost. Current dev has only 14 chat-thread records, so an urgent thread-table redesign is not supported.

**Fix unit:** lazy-mount on first use, then retain state; pass visibility into optional nonessential work where safe. Do not stop an active response or lose a draft when the panel is hidden. Load extra history explicitly. Audit both report variants and mobile view switching.

**Acceptance:** a never-opened assistant has no assistant-only imports/subscriptions; reopening preserves draft, position and in-flight response; hidden settled panels stop nonessential work. Measure actual server/query and frame impact, not just hook registrations.

### 5. Make streaming reconstruction incremental for long responses — medium priority, scaling reproduced

`src/lib/chat/uiMessages.svelte.ts:147–157` flattens all accumulated deltas and re-derives the entire streaming message after each update. Cancellation discards an outdated result but does not cancel work already running. `agentInternal.ts` imports the installed helper; `@convex-dev/agent/dist/deltas.js:373` replays the accumulated chunks through `readUIMessageStream`. The source comment calls this a non-issue for chat-sized messages, but that is an assumption about input size.

Actual helper, Node desktop, five samples per size: 100 chunks / 3,500 characters takes about 1–8 ms; 1,000 / 35,000 takes 11–13 ms; 5,000 / 175,000 takes 171–200 ms **for a single full replay**. Browser rendering and markdown are not included. Replaying prefixes repeatedly adds work with response length; this synthetic stress size is not evidence that typical chat currently stalls.

**Fix unit:** retain incremental stream state or coalesce reconstruction work while keeping finalized persisted messages authoritative. Benchmark markdown and long tool traces separately. Do not remove verification of proposals, receipts, or message ordering for speed.

**Acceptance:** exact text/tool/proposal results under retries, duplicate chunks, out-of-order/final updates and thread switching; measure longest main-thread task and paint delay during a long browser stream. No live paid AI call is required for deterministic stream verification.

Artifacts: `chat-derive-profile.json`, `chat-derive-profile.mjs`.

### 6. Stop the usage dashboard from rescanning all history on every update — medium priority, unbounded query confirmed

The default date range is All time (`src/routes/admin/usage/+page.svelte:22–29`). `convex/aiUsage.ts:325–397` walks the complete indexed time range and resolves project/user labels. `for await` controls iteration but does not split this query into independent transactions. New matching AI usage can invalidate the reactive query.

The complete observed dev table has **1,592 records / 524,687 JSON characters**, with no `durationMs` value. This is currently modest, but the default read grows with all usage history. No query latency or OCC history was available, so this is a growth risk, not a measured current timeout.

**Fix unit:** initially prefer a bounded default range with clear All time behavior. For exact growing all-time totals, compare periodic or maintained rollups with batched snapshot reads. Preserve timezone boundaries, attribution and exact monetary accounting. Rollups require a migration/consistency plan before implementation.

**Acceptance:** cost follows selected range or summary size, not lifetime history; totals match the existing implementation over seeded boundary cases; live refresh behavior remains truthful. Do not insert a silent `.take()` that returns incomplete totals as exact.

### 7. Review wide metadata reads and large list bounds — targeted scaling work, not a blanket rewrite

- **Documents/transcripts:** client payloads correctly omit bodies, but `documents.listDocuments` reads all matching full documents before projection (`convex/documents.ts:171–208`). `listProjectTranscripts` reads at most 21 full transcript rows before returning 20 metadata rows and calculating word counts (`convex/lib/transcripts.ts:65–97`). Server read cost is not the same as returned metadata size. The complete dev transcript sample is 53 records / approximately 2.02 million JSON characters, one per project; the current data does not demonstrate a many-transcript bottleneck. For heavier projects, persist metadata and fetch bodies only when needed; coordinate generation, archive and replacement writers.
- **Version history:** the modal is correctly mounted only when requested, but `snapshots.listSnapshots` reads up to 1,000 full snapshots, joins report versions/provenance, then returns metadata (`convex/snapshots.ts:45–101`). Sixty sampled snapshots total 825,524 JSON characters. Paginate history and budget bytes before a mature project approaches the cap; preserve version ordering and access rules.
- **Financial entries:** `financial.getTimesheetEntries` returns up to 5,000 rows (`convex/financial.ts:148–155`); the page renders every returned row (`src/routes/project/[id]/financial/+page.svelte:382`). Profile a realistically full dataset and use server pagination plus a bounded DOM window if warranted. This is a code-confirmed scale exposure, not a measured freeze.
- **Facets/projects:** `dashboard.getFacets` reads up to 1,001 small projects. Current dev has only 53 / 46,403 JSON characters. Existing company projections, indexed pages, skipped collapsed sections and expansion caps already reduce work. Keep these; measure invalidation before introducing another digest table. Search has a deliberate 250 ms debounce, not a 250 ms JavaScript blockage.

**Acceptance:** same results, correct incomplete-count labels, no dropped older history, correct ownership and authorization; measure documents/bytes read and DOM size at the largest supported dataset. New indexes or denormalized metadata must handle old rows safely.

### 8. Tune interaction motion and guard speed continuously — follow-up after the above

Report rails animate layout-affecting width/padding and use `transition-all duration-[325ms]` (`PreviewProjectPage.svelte:1606–1699`, Current sibling). Even when handlers are quick, a deliberate 325 ms settling animation can feel slower than a short direct response and may require repeated layout. The shader already caps pixels, pauses offscreen/hidden and supports reduced motion; it is not automatically a defect.

**Fix unit:** record panel toggles, rail dragging and scrolling on a real signed-in mobile/desktop session. Narrow transitions, make control feedback immediate, and shorten settling where the design allows. Preserve reduced motion and the established design language. No GPU performance result was obtained in this audit.

The searched app/verification paths contain no route-ready timing or Web Vitals collection/performance budgets. Existing tests prove many behaviors but do not establish a navigation speed SLA. `durationMs` recording now exists in AI instrumentation, yet none of the 1,592 existing dev usage records has it; do not infer AI latency from token counts or query costs.

**Proposed measurable targets:** immediate control feedback within 100 ms; warm project/report navigation visibly useful within 500 ms on the agreed device/network/data profile; field INP ≤200 ms, LCP ≤2.5 s and CLS ≤0.1 at the 75th percentile. The first two are proposed product goals, not measured guarantees. Core Web Vitals thresholds and percentile interpretation come from [Web Vitals](https://web.dev/articles/vitals).

Add route milestones and low-volume real-user measurements without report text, customer names, share tokens, or message bodies. Add repeatable cold/warm performance fixtures to verification, with calibrated tolerances rather than brittle one-run millisecond assertions. Split AI admission/queue, provider first token, full response, and browser rendering durations.

## What should stay simple

The sampled editor is responsive for ordinary report sizes. It already caches metrics by ProseMirror document identity, skips selection-only recomputation, serializes saves, and debounces autosave for one second. Do not replace the editor or rewrite metrics based only on the 50,000-word stress case. Its full-document metrics/JSON work is worth revisiting only if real supported reports exceed the interaction budget.

Keep existing indexed pagination, transcript/document body-on-demand APIs, dynamic file parsers/export, query skips, state preservation, and error handling. No speculative cache layer, database replacement, or universal virtualization is recommended.

## Coverage and remaining checks

| Surface | This audit checked | Remaining runtime proof |
|---|---|---|
| Login/app boot | Live desktop/mobile lab loads, compression, script resources, LCP/shift/long tasks | Real-user distributions |
| Home/Projects/search | Route graph, gate/config/data order, indexed paging, collapsed-query skips, debounce | Signed-in cold/warm navigation, search and scrolling |
| Report/editor | Production module import; real Editor typing/mount stress; save/QA read-write chain | End-to-end editor readiness and Convex autosave RTT |
| Assistant/research | Hidden-panel lifecycle; actual delta-helper scaling; pagination/window callsites | Streaming markdown/tool traces and provider first token |
| QA/comparison/history | Static imports, conditional modal mounting, snapshot read shape | Large comparison render and modal opening |
| Upload/intake | Actual XLSX main-thread stall; parser and upload structure | Representative PDF/DOCX/MSG, slow upload/cancellation |
| Financial | Query limits, full-row rendering, summary query shape | Full dataset scroll and edits |
| Shared review | Route closure and project → report → comments dependency chain | Valid authenticated-by-share-token runtime |
| Admin/usage/settings | All route closure sizes; usage aggregate; ingestion bounded reads | Signed-in large admin views |
| Backend operations | Aggregate-only live dev size samples; sibling read/write inspection | User-authenticated health insights and production query profiles |

## Suggested implementation sequence within BMAD

Keep this audit as evidence for small BMAD specifications/build units rather than starting a new broad loop automatically:

1. Worker-based XLSX parsing, with responsiveness proof and output parity.
2. Report route/panel code splitting, with emitted graph and real navigation measurements.
3. Persistent workspace/first-use assistant lifecycle, driven by signed-in traces.
4. Incremental chat reconstruction with protocol fixtures.
5. Usage/history/financial scale limits where data warrants them, using migration-safe BMAD/Convex guidance for any schema work.
6. Interaction polish and permanent speed budgets, calibrated against the same fixtures and profiles.

For every implementation: baseline reproduction → bounded change → correctness checks and browser checks appropriate to touched components → repeat the same performance measurement → review before shipping. No implementation unit was started by this audit.

## Additional audit targets from the second code pass

These are source-confirmed mechanisms worth measuring, not new measured slowdowns:

- **Large previews:** `src/lib/components/editor/FilesPanel.svelte:820` embeds the original PDF/image URL; extracted text and transcripts are rendered as complete text blocks. Measure decode, layout and scroll cost on representative large files before adding thumbnails or windowed rendering.
- **DOCX export:** `src/lib/exportTemplateDocx.ts:154` fetches the template when bytes are not supplied, then unzips, modifies XML and creates the output ZIP. Time those stages separately; asynchronous APIs alone do not prove absence of main-thread stalls.
- **QA fallback during edits:** `src/lib/components/editor/QAScorePanel.svelte:130` can parse and validate the full report when direct/agent QA data does not supply a usable scorecard. Measure this fallback with large supported reports; do not remove compatibility behavior without preserving its contract.
- **Chat scrolling:** `src/lib/components/chat/primitives/ChatContainer.svelte:108` reads scroll dimensions and adjusts position on resize. Profile long streamed conversations before changing scroll anchoring.
- **Long sessions and connection recovery:** run repeated navigation/panel cycles and sleep/reconnect tests. No memory leak or recovery regression was established in this audit.

## Method and limits

The source hash check covered 6,984 regular files and 13 tracked directory-symlink targets, all unchanged. Separately, 28 external BMAD worktree paths became unavailable during the audit. No command in the scoped audit removed them; their provenance was not established. This observation is not a performance finding.

Convex sampling used sandboxed read-only queries against the existing development deployment. Only aggregate sizes/counts were returned. JSON character size is a shape proxy, not billed database bytes or wire bytes. Health insights rejected deploy-key access, so no health data was obtained.

Chrome DevTools MCP was unavailable. Its skill workflow was stopped at that prerequisite and standalone Playwright/CDP measurements were used instead. No global MCP configuration was changed.

The original local page-paint probe is excluded from the conclusions: the accepted correctness-verification build embedded a placeholder static Convex endpoint. Accepted route-module measurements instead use isolated imports without mounting the app; accepted login measurements use the live canonical app. The editor measurements were repeated with exact production CSS and confirmed inherited Geist font after visual checking. Initial harness/coverage/fixture failures are not included as passing samples.

The committed evidence records 6 module-import, 18 editor, 8 parser, 6 live-login and 15 chat-helper samples. Browser profiles record Chromium versions and conditions. They do not replace signed-in traces or field percentiles.

For repeat measurements, use the audited source tree and lockfile, a production build, representative synthetic inputs and serial timing runs. Preserve cold/warm state, CPU/network settings, viewport, font readiness and error capture. The local measurement scripts are retained with the original audit but are not installed as repository verification tests by this documentation commit. Implementation work must establish a rerunnable performance check before claiming improvements.

No application correctness suite was rerun for this audit-only change. Packaging checks verify structured evidence, sample counts, numerical summary consistency, document links, privacy boundaries and the staged documentation-only diff.

[Convex best practices](https://docs.convex.dev/understanding/best-practices) supports bounded indexed reads and measuring reactive cost; [SvelteKit link options](https://svelte.dev/docs/kit/link-options) describes route preloading; [Web Vitals](https://web.dev/articles/vitals) distinguishes lab evidence from field performance. Repository source and captured measurements support the application-specific findings.
