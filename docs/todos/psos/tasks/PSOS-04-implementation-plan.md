# PSOS-04 — authoritative implementation plan for the remaining work (steps 6–19)

*Written 2026-07-27 on claude-fable-5 (the ticket's required planning model). Supersedes in
full the prior plan file at this path, which was written on the wrong model (Opus) and is
treated as input only. Companion to [`PSOS-04.md`](./PSOS-04.md); every design decision in
the ticket's §2 (derivation precedence), §4 (attempt lifecycle), §8 (component APIs and
mounting), and §9 (copy table) is preserved verbatim unless it appears under
**Proposed amendments**, where each change is flagged loudly with a verified reason.*

**State at time of writing.** Ticket §11 steps 1–5 are implemented and green
(251/251 `npm run test`). Verified by reading the files:

| Landed | Evidence |
|---|---|
| Pure derivation + registry + markers | `shared/documentStatus.ts` (`deriveProcessingStatus`, `deriveStoredProcessing`, `PROCESSING_STATUSES`, `PROCESSING_DETAILS`, `hasTruncationMarker`) |
| `parseDocument` re-exports registry | `src/lib/parseDocument.ts` |
| Schema widen + attempts table | `convex/schema.ts` (`processingStatus`/`processingDetail` on `projectDocuments`; `documentUploadAttempts` + both indexes) |
| Server derivation | `convex/documents.ts`: `uploadDocument` :44–148 (facts args :55–63, dedupe find :79–81, backfill-on-touch :100–108, dedupe-path resolve :112–119, insert :123–137, resolve :139–146); `listDocuments` :151–188 (read-time fallback :164–170, projection :183–184) |
| Duplication carry-over | `convex/projects.ts` (`copyProjectInputRows`) |
| Attempts lifecycle | `convex/uploadAttempts.ts` (`recordUploadAttempts` upsert + `MAX_BATCH` 50, `failUploadAttempt`, `dismissUploadAttempt`, `listUploadAttempts` with read-time staleness), `convex/lib/uploadAttempts.ts` (`requireAttemptKey` UUID gate, `capFileName` 200, `ATTEMPT_CAP` 100, `STALE_ATTEMPT_MS` 10 min, `attemptIdsToPrune`, `pruneUploadAttempts`, `findAttempt`, `resolveUploadAttempt`) |

**Human DECISION 3 applied.** Q3 accepted (storage-bytes-failure-with-text-success stays
unchanged in v1 → follow-up ticket). Q6 **rejected** — the component-test harness is
funded and in scope; component states and keyboard nav are automated here. The ticket's
§10 waiver paragraph, §12 non-goal "A jsdom component-test harness (Q6)", and the §13 AC5
waiver are **superseded** (struck with a supersession note in step 19, matching the
ticket's own `SUPERSEDED (DECISION 1)` convention).

---

## Corrections to the superseded draft

The prior plan file was reviewed critically; this plan resolves every blocking finding
and dispositions every non-blocking one. What changed and why:

1. **Amendment A redesigned — the draft's fix caused data loss (B1).** The underlying bug
   is real: the wizard sends `content: prefix + parsed.content`
   (`src/routes/project/new/+page.svelte:420`), so an unreadable previous-year PDF stores
   non-empty boilerplate and wrongly derives `ready`. But the draft's one-liner
   (`content: text.trim() ? prefix + text : ""`) **deleted the user's note**: for a
   previous-year row with both a note and files, `noteLine` travels only inside the
   prefix (:434, built :436–440), and the standalone note upload (:443) is guarded
   `row.note.trim() && row.files.length === 0` — blanking content for every unreadable
   file in the row erased the note with no toast, no `skippedFiles` entry, and no server
   trace. The draft's justification was also factually wrong: `category` is the literal
   `previous_pd` (`convex/documents.ts:27–33`) and encodes **no** fiscal year. The
   corrected design (Amendment A below) has `uploadFile` report whether it stored text
   and falls back to the standalone note upload when no file in the row carried it.
2. **New dedupe collision found and fixed (B2).** After blanking, two unreadable
   `scan.pdf` files in different fiscal-year rows (or different categories) both arrive
   as `(fileName, "")` and the second dedupes into the first
   (`convex/documents.ts:74–81`): one receipt row for two files (AC1 failure), both
   `attemptKey`s resolved to the same `documentId` (:112–119 — the audit trail lies), and
   silent cross-category mislabelling. Fixed by Amendment B: `uploadDocument` skips the
   dedupe when `content.trim() === ""` — empty rows carry no text worth deduping and
   distinct unreadable files must stay distinct rows.
3. **Browser-provider config corrected (B3).** In installed vitest 4.1.10,
   `provider: "playwright"` as a *string* throws a TypeError during **config
   resolution** (`node_modules/vitest/dist/chunks/coverage.DM_a_rWm.js:506–508` demands a
   factory) — before any project filtering runs, so a wrong shape in the root config
   would break `npm run test` itself. The plan uses the factory
   (`import { playwright } from "@vitest/browser-playwright"` → `provider: playwright()`)
   **and** moves the browser project into its own config file
   (`vitest.component.config.ts`) so a config mistake can never take down the standing
   gate — which also leaves the `npm run test` script untouched (N16).
4. **Outbox user-scoped (B4).** The draft's `banhall.uploadAttemptOutbox.v1` key had no
   user namespace, and sign-out (`src/lib/components/ui/UserMenu.svelte:58–74`) clears no
   storage. `recordUploadAttempts` stamps `createdBy: user._id` under firm-wide internal
   access — on a shared browser, user A's queued failures would flush in user B's session
   and be attributed to B, on the audit table. Now: key is
   `banhall.uploadAttemptOutbox.v2:{userId}`, every entry carries `userId`, flush drops
   non-matching entries, and sign-out clears all `banhall.uploadAttemptOutbox.*` keys
   (Amendment F).
5. **Failed-generation layout fix corrected (B5).** The draft placed the panel *inside*
   `:1028` but left the container `:1027`
   (`flex min-h-0 flex-1 items-center overflow-y-auto`) alone. A centred flex item that
   overflows its scroll container has an unreachable start edge in every browser —
   adding a panel under `GenerationProgress` makes the top of the progress card
   unscrollable on short screens (the same failure mode the draft used to reject the
   sibling mount). Fix: drop `items-center` from :1027 and put `my-auto` on :1028 —
   identical centring when content fits, reachable top when it doesn't.
6. **Backfill migration deferred (B6).** Persisting statuses now would freeze the
   legacy prefix-only mislabelling permanently: once `backfillProcessingStatus` stores
   `ready`, the read-time fallback stops firing and the "patch only when undefined" guard
   blocks correction without new code — while the legacy-row decision (Amendment A2) is
   still open for the human. The migration is a pure persistence optimisation with no
   consumer (the fallback at `convex/documents.ts:164–170` is the truth source), so it
   moves to a follow-up ticket to run **after** the legacy-row decision (Amendment D).
7. **Zero-panel state fixed (N4) + state matrix.** The wizard's default handoff
   (`commit()` → `generateReport` → `goto`) arrives with `isGenerating` true, and the
   draft's mounts left **no** FilesPanel and **no** outbox flush for the whole
   generation — the ticket's §8.4 promise ("commit-loop failures surface on the project
   files panel after navigation") was false in the default path. Now the panel mounts
   under `GenerationProgress` during generation too (collapsed), and the outbox flush
   moves to a **page-level** `$effect` so it fires in every page state.
8. **Steps split for reviewability (N15).** The draft's steps 13/14 bundled DocRow
   retype + new query + row composition + badges + attempt rows + outbox effect + two
   mounts across a 555-line component and a 1613-line page. Split into steps 15/16/17.
9. **CI workflow removed from scope (N13).** `.github/workflows/checks.yml` is queue-rule-5
   scope expansion; the draft flagged it but still listed it under step 6's files/done.
   It is now a follow-up ticket needing human approval. `npm ci` has never run the test
   suite here and the lockfile divergence is real.
10. **Smaller dispositions:** `exclude` uses `[...configDefaults.exclude, …]` (N11);
    `status: ReceiptStatus | null` on the badge is flagged as a §8 amendment, not called
    "unchanged" (N12); tailwindcss added to the lockfile watch list — installed 4.2.2 vs
    lock 4.3.3 (N14); archived rows suppress the status badge (N2); `review_pd` rows keep
    "Ready for AI" with rationale recorded (N3); FilesPanel gains a failure count in its
    collapsed header and opens on the failure surface (N5); flush gets NOT_FOUND
    drop + 7-day TTL (N6); new controls are text `Button`s, never `IconAction` (N7);
    geometry assertions exclude hidden file inputs (N8); an `aria-live="polite"` region is
    designed and tested (N9); permission-denied gets a real state via
    `listUploadAttempts` returning `null` (N10, Amendment C); the truncation-vs-15k-slice
    gap is recorded as an accepted limitation + follow-up (N1); citation slips fixed
    (`docs/svelte-migration.md:9` says Kit config lives in `vite.config.ts` — nothing
    about SSR defaults; FilingReadinessPanel map is :78–83) (N17).

**Carried forward from the draft (independently re-verified, not re-litigated):** the
mutual exclusivity proof skeleton for the mounts; `DocRow` widening via
`FunctionReturnType` (repo idiom `src/lib/stableQuery.svelte.ts:5`) and deleting the
`as DocRow[]` assertion (`FilesPanel.svelte:101`, the only `.data as` in `src/`);
`$effect` never running during SSR (patterns at `AgentChatPanel.svelte:265–271`,
`project/[id]/+page.svelte:337–353`); the in-session `File` map keyed by `attemptKey`
outside `$state`; the package/peer verification and the `--project` filtering behaviour;
`layout.css:238–243` focus-ring kill being scoped to `input, textarea, select` only;
no universal reduced-motion reset; `Spinner.svelte` needing
`motion-reduce:animate-none` via its cn-merged `class` prop; FilingReadinessPanel's
immunity to a widened DocRow (uses only `_id`/`fileName` — query :33, filter :44,
map :78–83).

---

## Summary of steps

Numbering continues the ticket's §11 (steps 1–5 done). After **every** step run the
standing gate: `npm run check` · `npx tsc --noEmit -p convex/tsconfig.json` ·
`npm run test`. From step 6 onward also `npm run test:component`. Every step leaves the
app working.

| # | Step | Files | Verify |
|---|---|---|---|
| 6 | **Component-test harness** — separate `vitest.component.config.ts`, factory provider, probe component. `npm run test` script untouched. | `package.json`, `package-lock.json`, `bun.lock`, `vitest.config.ts` (exclude only), `vitest.component.config.ts` (new), `src/lib/test/component-setup.ts` + `Smoke.svelte` + `Smoke.component.test.ts` (new) | `npm run test:component` · `npm run test` (251 still green) |
| 7 | **Server: dedupe skips empty content** (Amendment B) + tests. | `convex/documents.ts`, `convex/documents.test.ts` | `npx vitest run convex/documents.test.ts` |
| 8 | **Client facts + Amendment A** — `extractionOutcome`, `intake:"pasted"`, truthful-empty content with note fallback. | `AgentChatPanel.svelte`, `src/routes/project/new/+page.svelte`, `convex/documents.test.ts`, `src/lib/uploads/documentStatus.test.ts` | `npx vitest run convex/documents.test.ts src/lib/uploads/documentStatus.test.ts` · manual |
| 9 | **Outbox module** — user-scoped, whitelisted, TTL'd; pure + tested; no wiring. | `src/lib/uploads/attemptOutbox.ts` + `.test.ts` (new) | `npx vitest run src/lib/uploads/attemptOutbox.test.ts` |
| 10 | **Attempt wiring** — attemptKey per file; begin/fail in chat + wizard commit loop; input-rejection attempts; outbox appends on network failure. | `AgentChatPanel.svelte`, `src/routes/project/new/+page.svelte` | manual offline batch → Convex dashboard shows rows |
| 11 | **Flush + sign-out clear** — page-level `$effect` flush; sign-out clears outbox keys. | `src/routes/project/[id]/+page.svelte`, `src/lib/components/ui/UserMenu.svelte` | manual: offline batch → reload → row appears; reload twice → one row |
| 12 | **Copy map + `ProcessingStatusBadge`** + component test + styleguide; delete probe. | `src/lib/uploads/processingStatus.ts` + `.test.ts`, `ProcessingStatusBadge.svelte` + `.component.test.ts`, `src/routes/styleguide/+page.svelte` | `npx vitest run src/lib/uploads/processingStatus.test.ts` · `npm run test:component` |
| 13 | **Row builder + receipt components** + component tests + styleguide. | `src/lib/uploads/receiptRows.ts` + `.test.ts`, `UploadReceipt.svelte`, `UploadReceiptRow.svelte` + `.component.test.ts` ×2, styleguide | `npx vitest run src/lib/uploads/receiptRows.test.ts` · `npm run test:component` |
| 14 | **A11y + keyboard component suite** (AC5): tab order, focus rings, names, activation, 44px, aria-live, reduced motion, denied state. | `UploadReceipt.a11y.component.test.ts` (new) | `npm run test:component` |
| 15 | **FilesPanel internals** — DocRow de-drift, attempts query + denied state, badges + summary + failure count, attempt rows, `initiallyOpen`. | `FilesPanel.svelte`, `convex/uploadAttempts.ts` (Amendment C), `convex/uploadAttempts.test.ts` | `npm run check` · `npx vitest run convex/uploadAttempts.test.ts` · manual reload persistence |
| 16 | **Page mounts + layout fix** — B5 fix at :1027/:1028; mounts M1 (generation container) and M2 (reportless main). | `src/routes/project/[id]/+page.svelte` | `npm run check` · manual at 375px/1440px per state matrix |
| 17 | **Live chat receipt + in-session Retry** — `uploadError` removed. | `AgentChatPanel.svelte` | manual mixed batch incl. offline file |
| 18 | **Replace flows** — failed attempts (same attemptKey); persisted non-ready docs (id-compare guard). | `UploadReceiptRow.svelte`, `FilesPanel.svelte`, `convex/documents.test.ts` | `npx vitest run convex/documents.test.ts` · `npm run test:component` · manual |
| 19 | **Close-out** — ticket updates, evidence per AC, follow-up tickets, README. | `PSOS-04.md`, `docs/todos/psos/README.md` | full gate incl. `npm run build` · `git diff --check` |

---

## Proposed amendments to the ticket (read before implementing)

### Amendment A (required — corrected receipt-lie fix, no data loss)

**Bug (verified).** `uploadFile` sends `content: prefix + parsed.content`
(`src/routes/project/new/+page.svelte:420`). For a previous-year file the prefix is
`` `[Previous-year report — fiscal ${row.year}]\n${noteLine}\n` `` (:436–440). When
extraction fails (catch :409–414 → `content: ""`) or yields nothing (scanned PDF), the
mutation still receives non-empty content, `deriveProcessingStatus` sees text, and the
row derives `ready` — the receipt lies on exactly the file it exists to flag. Verified:
no other call site has this pattern (the standalone note :443 is guarded by
`row.note.trim()`; pasted category text :462–470 by `s.text.trim()`; `review_pd`
content is guaranteed non-empty by `handlePdFile` :211–231; chat sends raw
`parsed.content`).

**Fix — three coordinated changes in `uploadFile` and the `pyRows` loop, no derivation
change, no new trust input:**

1. `uploadFile` computes `const hasText = parsed.content.trim().length > 0` and sends
   `content: hasText ? prefix + parsed.content : ""`. The server then derives
   `could_not_read` (or `parse_failed`) truthfully. Readable files keep the prefix and
   fiscal-year line exactly as today.
2. `uploadFile`'s return type becomes `"stored_text" | "stored_empty" | "failed"`
   (`"failed"` from the existing catch that feeds `skippedFiles`).
3. The `pyRows` loop tracks `let noteCarried = false`, set true when any file in the row
   returns `"stored_text"`. The standalone note upload's guard at :443 changes from
   `row.note.trim() && row.files.length === 0` to `row.note.trim() && !noteCarried`.
   A row whose files all failed to store text still persists the user's note as the
   existing `Previous-year note (FY <year>)` document (with `intake: "pasted"`, step 8).
   `files.length === 0` implies `!noteCarried`, so the change is a strict superset of
   today's behaviour — **no note can be lost**.

**What is genuinely lost, stated plainly:** for an unreadable file with no note, the
`[Previous-year report — fiscal X]` line is no longer stored. It had zero value:
generation already excludes empty/whitespace content
(`convex/documents.ts:237` filter), and a boilerplate-only document contributed nothing
but the lie. The fiscal year for *readable* files is untouched.

### Amendment A2 (open human decision — do NOT implement unprompted)

Legacy rows already stored with prefix-only content derive `ready` from the read-time
fallback and will keep doing so — the fallback cannot distinguish boilerplate from
extracted text after the fact. Options: (i) accept and document (recommended — small
population, harmless row, and the follow-up extraction-metadata ticket is the right
home); (ii) a `stripIngestPrefix()` heuristic inside `deriveStoredProcessing` only
(drops leading `[…]` bracket lines / `Note: …` line before measuring) — a heuristic on
user-visible truth, needs human sign-off; (iii) content surgery on stored rows — not
recommended. **This plan assumes (i)** and records it at close-out. Amendment D
(migration deferral) exists precisely to keep (ii) viable: as long as statuses are
derived at read time, fixing the pure function self-corrects every legacy row.

### Amendment B (required — server change: dedupe skips empty content)

`uploadDocument`'s dedupe on `(fileName, content)` (`convex/documents.ts:74–81`) merges
all same-named empty-content uploads once Amendment A lands: two unreadable `scan.pdf`
files from different fiscal-year rows — or different categories — collapse into one row.
Consequences verified against the code: one receipt row for two files (AC1 failure);
`resolveUploadAttempt` called on the dedupe path (:112–119) marks **both** attemptKeys
`succeeded` against the **same** documentId, so the audit trail claims success for a file
never stored; the second file's category is silently discarded. **Change:** compute
`const dup = args.content.trim().length > 0 ? existingDocs.find(…) : undefined;` —
empty-content uploads never dedupe. Each unreadable file keeps its own row, its own
`storageId` (original bytes preserved for Replace), and its own resolved attempt.
Accepted trade-off: uploading the identical unreadable file twice now creates two rows —
two upload actions, two receipt rows, which is honest. Non-empty dedupe behaviour is
untouched.

### Amendment C (§4/§6 change — permission-denied becomes distinguishable)

`listUploadAttempts` currently returns `[]` for callers without access — indistinguishable
from "no failures", which renders denial as the empty state.
`docs/product-domain.md:251` makes permission-denied a per-feature acceptance criterion.
**Change:** `listUploadAttempts` returns `null` when `getInternalProjectAccessOrNull`
fails (it is new API from step 5 with no consumer yet, so this is safe); FilesPanel
renders a denied state ("You don't have permission to view this project's files.") when
`attemptsQ.data === null`. `listDocuments` keeps its `[]` (it has two existing consumers;
changing it is cross-ticket scope). Update the step-5 test that asserts `[]`.

### Amendment D (§7/§11 change — backfill migration deferred to a follow-up ticket)

Rationale in correction 6 above: the read-time fallback makes the migration a pure
persistence optimisation with no consumer, and persisting now would permanently freeze
the legacy prefix-only mislabelling behind the "patch only when undefined" guard while
Amendment A2 is still open. Follow-up ticket (filed at close-out): run
`deriveStoredProcessing`-based backfill **after** the A2 decision, mirroring
`convex/emailMigration.ts`, and include an explicit `force` arg for corrective re-runs.
The ticket's Rollout line was already amended once (wrong literal rule); this defers its
timing, not its design.

### Amendment E (§8 API deltas — flagged, not buried)

- `ProcessingStatusBadge`: `status: ReceiptStatus | null` (null = loading row). The
  ticket's §8 block shows `status: ReceiptStatus`; nullability is an addition.
- `ReceiptRow` gains `archived?: boolean`; `buildReceiptRows` suppresses the status badge
  for archived documents (N2 — otherwise "Ready for AI" renders beside the existing
  "· excluded from AI" copy at `FilesPanel.svelte:306/:321`, a direct contradiction).
  The archived row keeps its existing muted rendering; no badge.
- `UploadReceipt` gains a visually-hidden `aria-live="polite"` region reflecting
  `summarizeReceipt(rows)` (N9 — rows transition `null → status` asynchronously and a
  screen-reader user otherwise hears nothing; squarely inside AC5).
- `FilesPanel` gains `initiallyOpen?: boolean` (default false) and a failure count in its
  collapsed header ("Files · 4 files · 2 failed") so failures are not invisible behind
  the collapsed panel (N5 — `isOpen = $state(false)` at :87).
- One new copy-map entry for the denied state (Amendment C). The §9 table's existing
  seven rows are transcribed **verbatim** — no wording changes.

### Amendment F (§4 change — outbox v2, user-scoped)

Key becomes `banhall.uploadAttemptOutbox.v2:{userId}`; every entry carries `userId`; the
flush drops entries whose `userId` differs from the current session's; sign-out clears
every `banhall.uploadAttemptOutbox.*` key (including any stale unscoped `v1` key, which
is never read). Entries older than 7 days are dropped at parse time (TTL). Flush wraps
each project's `recordUploadAttempts` in try/catch: a Convex domain error (project
deleted → NOT_FOUND, or access denial) **drops** that project's entries; a network error
keeps them for the next flush. Rationale: B4 (cross-user audit corruption on shared
browsers — `recordUploadAttempts` stamps `createdBy: user._id` under firm-wide access)
and N6 (poison-entry infinite retry).

### Amendment G (housekeeping)

Strike the ticket's §10 component-harness waiver paragraph, the §12 "jsdom harness"
non-goal, and the §13 AC5 waiver as **SUPERSEDED (DECISION 3)** during step 19 — noted,
not silently deleted.

---

## Resolutions

### (a) FilesPanel mounting — state matrix, no double render, no zero-panel state

**Layout precondition (B5).** `src/routes/project/[id]/+page.svelte:1027` is
`<div class="flex min-h-0 flex-1 items-center overflow-y-auto">` and :1028 is the
`mx-auto w-full max-w-3xl px-6 py-8` content div. `items-center` on the scroll container
makes overflowing content's top edge unreachable. **Change :1027 to
`flex min-h-0 flex-1 overflow-y-auto` and :1028 to
`mx-auto my-auto w-full max-w-3xl px-6 py-8`.** Auto margins centre the child when it
fits and collapse to zero when it overflows — visually identical today, scrollable with
the panel added.

**Mounts.** One snippet, three render points total (one pre-existing):

- **M1 (new):** inside :1028, directly under `<GenerationProgress …/>`, gated
  `{#if !report}` (the container itself is gated
  `generation && (isGenerating || showFailedGeneration)` at :1026). Passes
  `initiallyOpen={showFailedGeneration}`. Mounting **during** generation (collapsed) is
  deliberate: the wizard's default handoff lands here with `isGenerating` true, and the
  ticket's §8.4 promise — commit-loop failures surface on the files panel after
  navigation — must hold in the default path (N4). The panel is collapsed, one header
  row; its two queries are indexed single-project reads.
- **M2 (new):** inside the reportless `<main>` (:1469–1471), after
  `{@render projectMetadata()}`. The `<main>` is already `overflow-y-auto`.
- **M3 (pre-existing, untouched):** report editor at :1086.

**State matrix** (`isGenerating` = `reserved || (running && !isIterative)` :742–745;
`showFailedGeneration` = `failed && !report && mode !== "review"` :749–751):

| Page state | M1 | M2 | M3 | Panels |
|---|---|---|---|---|
| Generating, no report (default wizard handoff) | ✔ (collapsed) | ✘ (`!isGenerating` in gate) | ✘ (no report) | 1 |
| Failed generation, no report | ✔ (open) | ✘ (`!showFailedGeneration` in gate) | ✘ | 1 |
| Report editor (report && !awaitingSelection && !stepper) | ✘ (`!report` gate) | ✘ (report) | ✔ | 1 |
| Generating **with** report (regeneration edge, if reachable) | ✘ (`!report` gate) | ✘ | ✔ | 1 |
| Awaiting selection | ✘ (container gate) | ✘ (gate) | ✘ (:1056 excludes) | 0 — accepted |
| Iterative stepper | ✘ | ✘ (gate) | ✘ | 0 — accepted |
| Reportless idle (incl. review-mode failed, which `showFailedGeneration` excludes) | ✘ | ✔ | ✘ | 1 |

No state renders two panels. The two zero-panel states are full-height mid-workflow
surfaces, not upload dead ends; the outbox flush does **not** depend on the panel (it is
page-level, resolution (c)), so no state loses the flush. Accepted and recorded.

### (b) `DocRow` widening + killing the drift class

`FilesPanel.svelte:10–22` hand-writes `DocRow` (stops at `archived`) and :101 asserts
`documentsQ.data as DocRow[] | undefined` — the only `.data as` in `src/`. The assertion
silently discards the projection's new `processingStatus`/`processingDetail`
(`convex/documents.ts:183–184`). Fix (step 15):

```ts
import type { FunctionReturnType } from "convex/server";
export type DocRow = FunctionReturnType<typeof api.documents.listDocuments>[number];
```

(repo idiom: `src/lib/stableQuery.svelte.ts:5`), and delete the assertion —
`const documents = $derived(documentsQ.data);` is already correctly typed. Any future
projection change becomes a compile-time signal at every consumer.
`FilingReadinessPanel` is immune (uses only `_id`/`fileName` — :33 query, :44 filter,
:78–83 map). **Recurrence guard:** step 15's done-check includes
`grep -rn "\.data as " src/` returning nothing.

### (c) Outbox flush — no SSR breakage, no cross-user leakage, no poison loops

- **SSR safety.** `attemptOutbox.ts` does zero work at module scope; every
  storage-touching function opens with `if (typeof localStorage === "undefined") return`
  and wraps access in try/catch (repo pattern `AgentChatPanel.svelte:265–271`). All
  effect-driven call sites are `$effect`s, which never run during SSR (verified patterns
  at `AgentChatPanel.svelte:265–271`, `project/[id]/+page.svelte:337–353`).
- **User scoping (B4 / Amendment F).** Append requires the current user's id. The
  project page already queries it (`api.users.getCurrentUser`, :77/:112), the wizard at
  :55; `AgentChatPanel` adds the same one-line `useQuery`. If the user query hasn't
  resolved at failure time, the append is skipped (rare, accepted — recorded limitation).
- **Flush site: page-level.** A `$effect` in `project/[id]/+page.svelte` reading
  `projectId` + the loaded user: takes this user's entries for this project, calls
  `recordUploadAttempts`, clears entries **only after** the mutation resolves
  (crash-between is safe — upsert by attemptKey). Guarded by a module-local
  `Set<string>` of flushed `projectId`s so re-renders can't re-fire. Page-level (not
  FilesPanel-level) so flushing works in every state of the matrix, including
  awaiting-selection/stepper. A second opportunistic flush runs at the top of
  `AgentChatPanel.uploadFiles`.
- **Poison/TTL (N6).** Entries older than 7 days drop at parse. Flush catch: Convex
  domain/auth error → drop that project's entries (a deleted project would otherwise
  retry forever as an unhandled rejection); network error → keep.
- **Entries for other projects** flush when the user next visits those projects; TTL
  cleans abandoned ones. Cross-device durability remains impossible client-side
  (ticket §4, unchanged).

### (d) Component-test assertion list

All in real headless Chromium (which is why geometry/focus assertions are meaningful).
**Primitive rule (N7): every receipt action is a text `Button`** (`ui/Button.svelte` —
supplies `focus-visible:ring-2` at :29), labels "Retry", "Replace file…", "Remove".
**Never `IconAction`** (`IconAction.svelte:21–22` has no focus ring and uses bare
`title=` at :33/:36, violating design rule 11). No icon-only controls in new markup ⇒ no
tooltip dependency and better low-tech usability; assert
`container.querySelectorAll("[title]").length === 0`.

`ProcessingStatusBadge.component.test.ts` (step 12):
1. Each of the 6 statuses renders its literal §9 label (loop over the exported const
   array — mechanised "no colour-only state", `docs/product-domain.md:249`).
2. Icon svg is `aria-hidden="true"`.
3. Runtime exhaustiveness over `PROCESSING_STATUSES` + `"upload_failed"`.
4. `status={null}` renders `Spinner` (`role="status"`) **and** literal "Reading…".
5. The spinner element carries `motion-reduce:animate-none` (passed through Spinner's
   cn-merged `class` prop — `Spinner.svelte:18` hard-codes `animate-spin` and no global
   reduced-motion reset exists).

`UploadReceiptRow` / `UploadReceipt` component tests (step 13):
6. Explanation + suggested action visible without interaction for non-`ready` statuses
   (`getComputedStyle(el).display !== "none"`).
7. Action affordances match flags (`canRetry`→Retry, `canReplace`→Replace file…,
   `canRemove`→Remove; negative case = control **absent**).
8. Busy row: controls `disabled` + `aria-busy="true"`; click does not invoke callback.
9. Callbacks receive the row (`onReplace` receives `(row, file)`).
10. Empty state: `rows={[]}` → `emptyMessage`, no `<li>`, no summary line.
11. Summary: 6 mixed rows → exactly "6 files: 4 ready, 1 reference only, 1 failed";
    zero counts omitted; singular handled.
12. Stable keys — re-render with one status changed updates in place.
13. **Archived row (N2):** `archived: true` → no status badge text in the row.
14. **Denied state (N10/Amendment C):** denied input renders the permission copy, not the
    empty state.
15. **aria-live (N9):** a `[aria-live="polite"]` region exists; re-rendering with a row
    transitioned `null → could_not_read` changes its text.

`UploadReceipt.a11y.component.test.ts` (step 14) — the AC5 core, over a 4-row fixture
(`ready`, `could_not_read`, `upload_failed`+`canRetry`, `upload_failed`+`canReplace`):
16. Tab order equals DOM order (real browser Tab traversal; collect
    `document.activeElement` accessible names; pin the expected list when markup lands).
17. No positive `tabindex`.
18. Focus visible: focused controls match `:focus-visible` with computed
    `outline-style !== "none"` or a box-shadow ring (safe: `layout.css:238–243` kills
    rings only for `input, textarea, select`; `Button.svelte:29` supplies the ring).
19. Every **visible** interactive control has a non-empty accessible name.
20. Enter and Space both activate Retry exactly once each.
21. **44×44 measured (N8 caveat):** for every element in the fixture's expected-controls
    list, `getBoundingClientRect()` width and height ≥ 44 at a 375px viewport. Hidden
    `<input type="file">` elements (0×0 by design — triggered via a visible labelled
    button) are explicitly excluded from geometry, not just from naming.
22. Consecutive rows' rects don't overlap; rows don't clip at 375px.
23. Reduced motion: with `prefers-reduced-motion: reduce` emulated, no element in the
    receipt reports a running non-zero `animation-duration`.

Not attempted (stated plainly): colour-contrast ratios (needs an axe-class dependency;
badges pair colour with literal text so colour is never the sole carrier) and
screen-reader announcement *order* (no automatable oracle — the aria-live region's
existence and updates are asserted; ordering stays on the manual checklist).

### (e) In-session Retry vs Replace-after-reload

- `AgentChatPanel` keeps a plain `let files = new Map<string, File>()` keyed by
  `attemptKey` — **not** `$state` (a `File` is a host object; reactivity is carried by
  the `ReceiptRow[]`, which holds only `canRetry`). Never serialized; the outbox entry
  type has no `File`/`Blob`/bytes field and the whitelist test proves it.
- `canRetry = files.has(attemptKey)`, recomputed by `buildReceiptRows` from the ephemeral
  list. After reload the map is empty, so every failed row degrades to
  `canRetry: false, canReplace: true` — DECISION 2's two code paths fall out of one
  predicate.
- **Retry** re-runs storage POST → parse → `uploadDocument` under the **same**
  `attemptKey`: `recordUploadAttempts` flips `failed → in_progress` and `uploadDocument`
  resolves on success. No duplicate rows ever.
- **Replace** (step 18): failed attempt row → picker, normal pipeline under the same
  `attemptKey` (attempt keeps original `fileName` as audit; document carries new name).
  Persisted non-`ready` document → upload with a **fresh** attemptKey, then
  `if (newId !== oldId) await deleteDocument(oldId)` — mandatory id-compare because the
  dedupe can return the old row itself; identical-content replace is a reported no-op.
  (Amendment B narrows when that can happen — empty-content uploads never dedupe — but
  the guard stays for the non-empty case.)
- A row offering both shows **Retry** and hides Replace (one obvious next action,
  `docs/product-domain.md:249`); the §9 copy's two `upload_failed` action variants key
  off `canRetry` exactly as the ticket specifies.
- Map entries are deleted on success/Remove/dismiss; bounded by the 50-file batch cap.

---

## Step detail

### Step 6 — Component-test harness (first, alone, no product code)

**Packages** (availability + peers verified: `@vitest/browser@4.1.10` peers
vitest 4.1.10 ✓ installed; `@vitest/browser-playwright@4.1.10` peers vitest 4.1.10 +
playwright * ✓; `vitest-browser-svelte@3.0.0` peers svelte ^5 / vitest ^4 ✓):

```
npm install -D vitest-browser-svelte@3.0.0 @vitest/browser@4.1.10 \
               @vitest/browser-playwright@4.1.10 playwright@1.62.0
npx playwright install chromium
```

**Config — two files, and why.** The browser project lives in its **own**
`vitest.component.config.ts` rather than a third project in `vitest.config.ts`:

- **B3:** in vitest 4.1.10, `provider` must be a factory —
  `provider: "playwright"` (string) throws a TypeError during **config resolution**
  (`node_modules/vitest/dist/chunks/coverage.DM_a_rWm.js:506–508`), *before* project
  filtering — so a browser project in the root config with the wrong shape would break
  `npm run test` itself. Isolating it means a config mistake can only break
  `test:component`.
- **N16:** the `npm run test` script (`"vitest run"`) is the standing gate for every
  PSOS ticket; it stays byte-identical, needs no Chromium, and needs no `--project`
  flags.

New `vitest.component.config.ts`:

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { playwright } from "@vitest/browser-playwright";

// PSOS-04 component tests: real Svelte components in headless Chromium.
// Separate config on purpose — the root vitest.config.ts (npm run test) must
// never depend on a browser binary, and vitest 4's provider is a factory whose
// misconfiguration throws during config resolution.
export default defineConfig({
  plugins: [tailwindcss(), svelte()],
  resolve: {
    alias: { $lib: fileURLToPath(new URL("./src/lib", import.meta.url)) },
    conditions: ["browser"],
  },
  test: {
    name: "component",
    include: ["src/**/*.component.test.ts"],
    setupFiles: ["./src/lib/test/component-setup.ts"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
    },
  },
});
```

Never `sveltekit()` here — it drags `$app`/`$env` virtual modules and Kit's SSR graph;
the three new components are presentational and must not need them (step 13's contract).

One edit to `vitest.config.ts` — the `src` project must not pick up
`*.component.test.ts` (its `src/**/*.test.ts` include matches them; they would run in
Node with no DOM). Per N11, `exclude` **replaces** vitest's defaults, so spread them:

```ts
import { configDefaults, defineConfig } from "vitest/config";
// … src project:
exclude: [...configDefaults.exclude, "src/**/*.component.test.ts"],
```

This is the only touch to the root config; it changes nothing about the existing 251
tests (the excluded files don't exist yet).

**Scripts:** add `"test:component": "vitest run --config vitest.component.config.ts"`.
`"test"` unchanged.

**Contributor without Chromium:** `npm run test` never touches the browser.
`npm run test:component` fails with Playwright's own actionable message — *"Executable
doesn't exist at … Run `npx playwright install`"* — a clear failure, not a mystery.
Document the one-time `npx playwright install chromium` in the scripts' vicinity
(package.json comment is impossible; add one line to the setup file's header comment and
to the ticket's work log).

**Naming:** `*.component.test.ts`, colocated beside the component (matches the repo's
colocation convention, e.g. `src/lib/parseDocument.test.ts`). The distinct infix is what
makes the root-config exclude a one-liner.

**Setup file** `src/lib/test/component-setup.ts`:
`import "../../routes/layout.css";` — pulls Tailwind v4 + the `@theme` tokens through
the config's `tailwindcss()` plugin so geometry/focus/motion assertions test real CSS,
not class-name theatre. (Tailwind source detection under a test-only entry is on the
could-not-verify list; fallback is an explicit `@source` directive.)

**Lockfile handling (N14).** `.npmrc` documents npm as what Vercel/CI use;
`node_modules` is bun-installed and diverges from `package-lock.json`
(Kit 2.69.0↔2.70.1, plugin 7.1.2↔7.2.0, svelte 5.56.4↔5.56.6, vite 8.1.3↔8.1.5, **and
tailwindcss 4.2.2↔4.3.3**). Procedure: `npm install -D …` then `bun install` in the
same commit; inspect `git diff --stat package-lock.json bun.lock`; expect only the four
packages + transitive deps. **If npm materialises the pre-existing divergence into
unrelated entries: stop and escalate to the human.** Do not reconcile the lockfiles here
(follow-up ticket); do not silently bump Kit/Vite/Svelte/Tailwind inside a UI ticket.

**Probe** `src/lib/test/Smoke.svelte` + `Smoke.component.test.ts`: mounts; click fires
callback; `min-h-11` measures ≥44 (proves Tailwind loaded); focus ring computes after
keyboard focus; reduced-motion emulation works. **Deleted in step 12** once the badge
test covers the same ground.

**No CI in this step (N13).** There is no test CI today (`.github/workflows/` contains
only `publish-changelog.yml`); adding `checks.yml` is queue-rule-5 scope expansion →
follow-up ticket needing human approval. Recorded risk: until CI exists, the component
suite is developer-run only — a durability gap for the AC5 automation DECISION 3 funded.

**Fallbacks** if Browser Mode proves unworkable (Chromium won't launch; provider API
fights 4.1.10; Tailwind won't resolve; wall-clock absurd):
1. `@testing-library/svelte` + `jsdom` — same file naming and layout, honest losses:
   44px/overlap become class assertions, focus-visible becomes "received focus",
   `display` checks become DOM presence; keyboard via emulated `tab()`.
2. If even that fails: **stop and re-open DECISION 3 with the human.** Q6's waiver was
   explicitly rejected; silently reverting to it is not the agent's call.

**Done means:** probe green via `npm run test:component`; `npm run test` still 251/251
with zero new environment requirements; `npm run check` clean.
**Rollback:** revert 4 devDeps, both lockfiles, both configs, scripts, `src/lib/test/`.
Zero product code.

### Step 7 — Server: dedupe skips empty content (Amendment B)

**File.** `convex/documents.ts` (one expression at :79–81), `convex/documents.test.ts`.

**Tests:** two same-named empty-content uploads with distinct attemptKeys → two rows,
each attempt resolved to its own documentId; empty-content upload with a different
category → own row, own category; non-empty dedupe unchanged (existing tests stay
green); dedupe-path backfill-on-touch still covered for non-empty.

**Done means:** distinct unreadable files can never merge; audit resolution is 1:1.
**Verify:** `npx vitest run convex/documents.test.ts`.
**Rollback:** restore the unconditional find. Rows created meanwhile are valid documents;
no cleanup needed.

### Step 8 — Client facts + Amendment A

**Files.** `AgentChatPanel.svelte`, `src/routes/project/new/+page.svelte`,
`convex/documents.test.ts`, `src/lib/uploads/documentStatus.test.ts`.

1. Chat `uploadFiles` (:436–489): parse catch (:457–462) sets a local
   `extractionFailed = true` beside the existing `console.error` (raw error stays in the
   console, never crosses the wire); pass
   `...(extractionFailed ? { extractionOutcome: "failed" as const } : {})`.
2. Wizard `uploadFile` (:398–430): same `extractionOutcome` treatment, **plus Amendment
   A** — `hasText` gate on the prefix, tri-state return.
3. `pyRows` loop: `noteCarried` tracking; :443 guard becomes
   `row.note.trim() && !noteCarried`; the standalone note upload gains
   `intake: "pasted"`.
4. Pasted category text (:462–470): `intake: "pasted"`.
5. `review_pd` (:474–492): no change (real file, guaranteed non-empty content).

**Tests:** `intake:"pasted"` ± text; `extractionOutcome:"failed"` ± text (partial text →
still `ready`, pinning §2 rules 7–8 precedence); the Amendment A hazard documented as a
derivation test — content `"[Previous-year report — fiscal 2024]\n\n"` derives `ready`,
which is exactly why the client must send `""`; a note-only fallback payload derives
`ready`/`pasted_text`.

**Done means:** an unreadable previous-year PDF stores `could_not_read`; a row with a
note and all-unreadable files still persists the note document; nothing but validated
enums crosses the boundary (grep the diff for new string args).
**Verify:** targeted vitest runs · `npm run check` · manual on `:3001` (corrupt PDF via
chat; unreadable previous-year PDF + note via wizard).
**Rollback:** drop the new args and restore `content: prefix + parsed.content` and the
`row.files.length === 0` guard. Server ignores absent optional args.

### Step 9 — Outbox module

**Files.** `src/lib/uploads/attemptOutbox.ts` + `.test.ts` (new). Pure core, storage
shell, per Amendment F:

```ts
export const OUTBOX_KEY_PREFIX = "banhall.uploadAttemptOutbox.";  // sign-out clears prefix*
export const outboxKey = (userId: string) => `${OUTBOX_KEY_PREFIX}v2:${userId}`;
export const OUTBOX_CAP = 50;
export const OUTBOX_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type OutboxEntry = {
  userId: string;
  projectId: string;
  attemptKey: string;      // UUID-validated client-side too
  fileName: string;        // capped 200 by the serializer
  fileSizeBytes?: number;
  origin: "chat_upload" | "context_input" | "review_pd";
  failureCode: "rejected_unsupported" | "upload_failed";
  at: number;
};
// No message/stack/error field exists. That absence IS the leak-proofing.

export function sanitizeEntry(raw: unknown): OutboxEntry | null;       // pure whitelist
export function serializeOutbox(entries: OutboxEntry[]): string;       // pure, FIFO cap
export function parseOutbox(raw: string | null, now: number): OutboxEntry[]; // tolerant, TTL
export function appendOutbox(userId: string, entry: OutboxEntry): void;
export function takeOutboxFor(userId: string, projectId: string): OutboxEntry[];
export function clearOutboxFor(userId: string, projectId: string, keys: string[]): void;
export function clearAllOutboxes(): void;                              // sign-out
```

Zero module-scope work; storage functions guard `typeof localStorage === "undefined"`
and try/catch every access.

**Tests** (node project): whitelist strips poisoned fields (`message`/`stack`/`error`/
`file`); non-UUID attemptKey rejected by `sanitizeEntry`; fileName capped at 200; TTL
drops entries older than 7 days; malformed JSON → `[]` without throwing; FIFO cap drops
oldest; `takeOutboxFor` filters by user **and** project and leaves others intact; a
mismatched-`userId` entry is never returned for flush; double-serialize is
byte-identical (idempotent flush payloads).

**Rollback:** delete both files; nothing imports them yet.

### Step 10 — Attempt wiring (append side)

**Files.** `AgentChatPanel.svelte`, `src/routes/project/new/+page.svelte`.

- **Chat batch:** `attemptKey = crypto.randomUUID()` per file; one
  `recordUploadAttempts` before the loop; per-file and batch catches call
  `failUploadAttempt({failureCode: "upload_failed"})`; if that mutation *also* throws
  (offline), `appendOutbox`. `AgentChatPanel` adds the repo's
  `useQuery(api.users.getCurrentUser, …)` one-liner (idiom: wizard :55, page :77) for
  the outbox userId; if unresolved at failure time, skip the append (recorded
  limitation).
- **Chat input rejection** (:720–726): `bad` files also get
  `recordUploadAttempts({…failureCode: "rejected_unsupported"})` — `projectId` exists,
  so these become durable rows. The transient message behaviour is otherwise unchanged
  until step 17.
- **Wizard commit loop:** `uploadFile`'s catch records/fails the attempt with
  `origin: "context_input"`; the `review_pd` upload with `origin: "review_pd"`;
  network-dead failures append to the outbox. Pre-`createProject` rejections stay
  session-only (no projectId — ticket §8.4 boundary, unchanged). The `skippedFiles`
  toast (:509–512) stays as a summary.

**Verify:** manual DevTools-offline batch → Convex dashboard/`npx convex run
uploadAttempts:listUploadAttempts` shows failed rows (UI arrives in step 15).
**Rollback:** remove the calls. Orphaned `in_progress` rows are handled by read-time
staleness + prune-on-write.

### Step 11 — Flush + sign-out clear

**Files.** `src/routes/project/[id]/+page.svelte`, `src/lib/components/ui/UserMenu.svelte`.

- Page-level `$effect` per resolution (c): current user + current project only; clear
  after success; drop on domain/auth error; keep on network error; module-local flushed
  set. Opportunistic flush also at the top of `uploadFiles` (chat).
- `UserMenu.handleSignOut` (:58–74): after `authClient.signOut()` succeeds, call
  `clearAllOutboxes()` (prefix sweep, try/caught) before navigation.

**Verify:** offline batch → reload → row appears after flush; reload twice → still one
row; sign out → keys gone; sign in as another user → nothing flushes.
**Rollback:** remove effect + sign-out line. Entries stay inert under their keys.

### Step 12 — Copy map + `ProcessingStatusBadge`

**Files.** `src/lib/uploads/processingStatus.ts` + `.test.ts`,
`src/lib/components/upload/ProcessingStatusBadge.svelte` + `.component.test.ts`,
`src/routes/styleguide/+page.svelte`. Delete the step-6 probe.

Copy map transcribes the ticket's §9 table **verbatim** (one `upload_failed` entry with
`action` keyed by `canRetry`), plus the Amendment C denied-state string. Badge per
ticket §8 with the Amendment E nullability. Badge classes per the ticket's §8 table —
all tokens verified in `src/routes/layout.css` (`primary-selected` :20, `primary-wash`
:21, `chrome` :12, ink :42–46, line :47–48; amber/red are stock Tailwind; the gray ramp
is remapped :27–40 and used as such). Loading renders
`<Spinner size="sm" class="motion-reduce:animate-none" />` + "Reading…".

**Tests:** map exhaustive over `ReceiptStatus` (compile-time `Record` + runtime loop);
banned-substring regex `/error|exception|stack|convex|openrouter|anthropic|undefined|\bat \w+\(/i`
over every string (AC3 made testable); `skipped_unsupported` action contains
`SUPPORTED_LABEL`; both `upload_failed` variants distinct and non-empty. Component test:
resolution (d) 1–5. Styleguide: one section, all statuses + loading, following the
file's existing section conventions.

**Rollback:** delete files + styleguide section; no consumer.

### Step 13 — Row builder + receipt components

**Files.** `src/lib/uploads/receiptRows.ts` + `.test.ts`, `UploadReceipt.svelte`,
`UploadReceiptRow.svelte` + two `.component.test.ts`, styleguide.

APIs are the ticket's §8 signatures verbatim plus Amendment E deltas (`archived`,
aria-live region, denied rendering). `busy` uses `SvelteSet` from `svelte/reactivity`.
**Presentational contract, enforced:** no `convex-svelte`, no `$app/*`, no `$env/*`
imports in the three components (31 components import `convex-svelte` and are
untestable without mocks; these three must stay pure — done-check:
`grep -L 'convex-svelte\|\$app/\|\$env/' src/lib/components/upload/*.svelte` lists all
three). Type-only `Id<…>` imports are fine (erased).

Visual spec per ticket §8: ledger `<ul class="divide-y divide-line-soft">`, `min-h-11`
rows, summary eyebrow, explanation always visible for non-ready, `hover:bg-primary-wash`,
bare `transition-*` (300ms default), **text Buttons only** (resolution (d) N7),
44×44 targets on new controls (FilesPanel's existing 32px buttons remain a ticket §12
non-goal).

**Tests:** `receiptRows.test.ts` exactly as ticket §10 specifies — the four AC scenarios
as data tests (AC1 mixed batch; AC2 truncated + copy; AC3 rebuild from server payload
shapes; AC4 attempt-vs-document provenance), `summarizeReceipt` strings, exclusion of
`succeeded`/`dismissed`, `documentId` cross-check, `canRetry`/`canReplace` flags, plus
**archived suppression** (N2). Component tests: resolution (d) 6–15.

**Rollback:** delete files + styleguide sections; no consumer.

### Step 14 — A11y + keyboard suite (AC5)

**File.** `src/lib/components/upload/UploadReceipt.a11y.component.test.ts` — resolution
(d) 16–23 over the 4-row fixture. Its own step because a failure here is a design
failure (focus order, target size), not a logic failure. **Done means:** AC5 has an
automated, re-runnable oracle; attach passing output to the evidence log.
**Rollback:** deleting this file re-opens AC5, which DECISION 3 funded — needs the same
human sign-off as step 6's fallback 2.

### Step 15 — FilesPanel internals

**Files.** `FilesPanel.svelte`, `convex/uploadAttempts.ts` (Amendment C),
`convex/uploadAttempts.test.ts`.

1. `DocRow` de-drift per resolution (b); delete `as DocRow[]` (:101).
2. Amendment C: `listUploadAttempts` returns `null` on no access; update the step-5
   test asserting `[]`.
3. Add `useQuery(api.uploadAttempts.listUploadAttempts, …)` beside `documentsQ` (:93);
   `data === null` → denied state copy.
4. Compose `buildReceiptRows(documents, attempts, [])` — panel has no ephemeral rows, so
   every failure offers Replace/Remove (DECISION 2 after reload).
5. Render: summary line; badge + explanation per document row (suppressed when
   archived); failed-attempt rows with Replace/Remove; **failure count in the collapsed
   header** ("Files · 4 files · 2 failed"); `initiallyOpen` prop (default false). The
   pinned transcript row (:236–297) stays unbadged.

**Done means:** statuses + failures survive hard reload; denied renders as denial, not
emptiness; `npm run check` 0 errors; `grep -rn "\.data as " src/` empty;
FilingReadinessPanel unaffected (manual check).
**Rollback:** revert files. Server keeps writing statuses/attempts harmlessly.

### Step 16 — Page mounts + layout fix

**File.** `src/routes/project/[id]/+page.svelte`.

B5 fix (:1027 loses `items-center`; :1028 gains `my-auto`), then M1 and M2 per
resolution (a)'s state matrix, via one `{#snippet}`. M1 passes
`initiallyOpen={showFailedGeneration}`; note the branch does not remount across the
generating→failed transition, so a live transition keeps the panel collapsed with the
failure count visible in the header — accepted, recorded.

**Done means:** every row of the state matrix manually verified at 375px and 1440px; the
top of the progress card reachable by scroll on a short viewport with the panel present;
report editor unchanged.
**Rollback:** revert the file (also reverts the layout fix — acceptable, it only matters
with the panel mounted). **If the ticket must stop somewhere, stop after this step** —
steps 15+16 together satisfy "reachable later" + AC3.

### Step 17 — Live chat receipt + Retry

**File.** `AgentChatPanel.svelte`.

Replace the overwriting `uploadError` string (rendered :616–629) with `ReceiptRow[]`
state rendered through `UploadReceipt` in the same slot, dismissible. Per file:
`status: null` row before work → derived status on success → `upload_failed` in catch →
`skipped_unsupported` for input-rejected files. In-session `File` map + Retry per
resolution (e). **Delete `uploadError` entirely** (grep the diff); the input-rejection
path (:720–726) now feeds rows instead of the string.

**Done means:** mixed batch (1 unsupported + 1 unreadable + 2 good + 1 offline) → 5
truthful rows with per-file loading; Retry reuses the attemptKey, no duplicates.
**Rollback:** revert the file; failures remain visible in FilesPanel (step 15) — safe
partial rollback.

### Step 18 — Replace flows

**Files.** `UploadReceiptRow.svelte`, `FilesPanel.svelte`, `convex/documents.test.ts`.

Per resolution (e). Remove: attempts → `dismissUploadAttempt`; documents → existing
archive/delete flow (:324–397), untouched. **Tests:** id-compare end-to-end (upload →
replace with identical non-empty content → same `_id`, row intact); replace of an
empty-content doc → new row + old deleted (Amendment B interaction); component test —
picker trigger is a visible labelled button reachable by keyboard, `onReplace` receives
`(row, file)`, hidden file input excluded from geometry (N8).

**Rollback:** remove the affordance; Remove stays.

### Step 19 — Close-out

Update `PSOS-04.md`: apply Amendment G strikes; record Amendments A–F and the A2
decision request; accepted limitations (below); evidence per AC (attach the a11y suite
output for AC5, the banned-substring test for AC3, the data tests + manual screenshots
for AC1/2/4); file follow-up tickets; update `../README.md`; status → `done`.

**Follow-up tickets to file (queue rule 5 — each needs human approval as new scope):**
1. Backfill migration after the A2 decision (Amendment D), with `force`.
2. CI checks workflow (`checks.yml` — no test CI exists at all today).
3. Lockfile reconciliation (npm↔bun divergence incl. tailwindcss).
4. Generation-side truncation honesty (N1 below).
5. Structured truncation metadata (already a ticket §12 non-goal).
6. Q3 storage-bytes-failure-with-text-success.
7. `tests/` bun suite not in `npm run test`.
8. FilesPanel pre-existing bare `title=` / 32px targets / `IconAction` focus ring.

**Accepted limitations to record:**
- **N1 — `ready_truncated` vs the generation slice.** `getContextDocsForGeneration`
  slices content at 15,000 chars (`convex/documents.ts:240`) while `ready_truncated`
  derives from the parser's ~400k cap markers: a 200k-char document shows "Ready for AI"
  while generation reads 7.5% of it. AC2's copy is truthful about *storage*, not about
  *consumption*. Changing either side is generation-behaviour change (ticket: out of
  scope). Accepted for v1, follow-up ticket 4; the §9 copy is not softened without a
  human decision (§9 is preserved verbatim).
- **N3 — `review_pd` rows show "Ready for AI".** They are excluded from
  `getContextDocsForGeneration` (no category, by design) but the PD review agent reads
  them directly — the badge is truthful about AI usability. No change.
- Legacy prefix-only rows derive `ready` until A2 is decided (Amendment A2).
- Outbox is same-browser-profile, same-user only; entries appended only when the user
  query has resolved.
- M1's `initiallyOpen` doesn't re-trigger on a live generating→failed transition.
- Component suite is developer-run until the CI follow-up lands.

---

## Risks

| Risk | Why real | Mitigation | Detect |
|---|---|---|---|
| Browser-project config breaks the standing gate | vitest 4.1.10 throws on a string provider **during config resolution** | Separate `vitest.component.config.ts`; factory provider; root config touched only by the exclude line | `npm run test` 251/251 after step 6 |
| Component tests run twice (Node + browser) | `src` include glob matches `*.component.test.ts` | `[...configDefaults.exclude, "src/**/*.component.test.ts"]` (N11 — exclude replaces defaults) | `npx vitest list --project src` shows zero `.component.` entries |
| Lockfile churn ships a framework bump | npm↔bun divergence incl. tailwindcss 4.2.2↔4.3.3 | Step 6 procedure: both lockfiles in one commit, diff inspection, stop-and-escalate on unrelated movement | `git diff package-lock.json \| grep -E '"(@sveltejs/kit\|svelte\|vite\|tailwindcss)"'` clean |
| Amendment A drops a user's note | The note travels inside the prefix for rows with files | `noteCarried` fallback — strict superset of the current guard; tested | Step 8 tests + manual note-with-unreadable-file |
| Amendment B creates row duplication | Empty-content uploads no longer dedupe | Deliberate: distinct files must be distinct rows; retry correctness comes from `attemptKey`, not dedupe | Step 7 tests |
| Unreachable progress-card top | `items-center` + `overflow-y-auto` (:1027) with added panel | B5 fix: `my-auto` on the child instead | Manual short-viewport check, step 16 |
| Panel noise during generation | M1 mounts while `isGenerating` | Collapsed by default; one header row; two indexed single-project queries | Convex insights after step 16 (ticket §12) |
| Cross-user outbox flush | Shared browser, `createdBy` stamping | Amendment F: per-user key + per-entry userId + sign-out sweep | Step 11 manual two-user check |
| Flush retry loop on deleted project | Entries cleared only on success | Drop on domain/auth error; 7-day TTL; try/catch around flush | Step 11: delete project with queued entries → no console errors, entries gone |
| Removing `uploadError` loses a message surface | Step 17 deletes the only current upload-error UI | Receipt is strictly more informative; step 15 ships the durable surface first | Step 17 manual mixed batch |
| Reduced-motion regression | No universal reset; Spinner hard-codes `animate-spin` | `motion-reduce:animate-none` through the cn-merged class prop | Assertions 5 and 23 |
| `DocRow` widening breaks a consumer | Structurally larger derived type | `npm run check`; FilingReadinessPanel verified immune (:78–83) | `npm run check` 0 errors |

## Rollback position, per step

| Step | Rollback | Residue |
|---|---|---|
| 6 | Revert deps, lockfiles, configs, scripts, `src/lib/test/` | None — no product code |
| 7 | Restore unconditional dedupe find | Extra empty-content rows created meanwhile are valid documents |
| 8 | Drop new args; restore prefix expression + `files.length === 0` guard | Rows written keep correct statuses; server ignores absent optionals |
| 9 | Delete module + test | None — no importer |
| 10 | Remove mutation calls | Orphaned `in_progress` handled by staleness + prune |
| 11 | Remove effect + sign-out line | Inert localStorage entries, TTL-bounded |
| 12 | Delete files + styleguide section | None |
| 13 | Delete files + styleguide sections | None |
| 14 | Delete file — **re-opens AC5 (DECISION 3): needs human sign-off** | AC5 loses its oracle |
| 15 | Revert FilesPanel; restore `[]` in `listUploadAttempts` | Server keeps writing statuses/attempts harmlessly |
| 16 | Revert page | Layout fix reverts too (only mattered with the panel) |
| 17 | Revert chat panel → old error string | Failures still visible in FilesPanel |
| 18 | Remove Replace affordance | None |
| 19 | N/A | — |

**Deploy ordering (ticket §12, unchanged):** Convex first. All new/changed server
behaviour is additive or argument-optional; an old bundle against the new server derives
from content alone. Amendment C's `null` return lands (step 15) before any frontend
consumer exists.

## What I could not verify — check before relying on it

1. **The exact `playwright()` factory typings/exports** in
   `@vitest/browser-playwright@4.1.10`. The string form provably throws (B3, verified in
   the installed vitest bundle); the factory import shape should be confirmed against the
   installed package's `exports`/`.d.ts` at step 6. The separate-config design bounds the
   blast radius either way.
2. **Tailwind v4 source detection** when `layout.css` is imported from a vitest setup
   file rather than the Kit app graph. If generated utilities are missing in component
   tests, add an explicit `@source` directive.
3. **Whether "generation running with report present" is reachable** (regeneration). The
   M1 `!report` gate makes the matrix safe either way; the row is included defensively.
4. **Component-suite wall clock** — unmeasured until step 6 runs.
5. **The final tab-order list** (assertion 16) — pinned when step 13's markup lands.
6. **`getCurrentUser` load timing** at outbox-append sites — the skip-if-unresolved
   guard covers it, but the practical frequency is unmeasured.
7. The full `docs/design-system.md` beyond rules 7–11 and the cited token ranges was not
   re-read end to end this pass; re-scan before step 12.
8. Styleguide section-convention line numbers were taken from the prior pass; confirm
   against the file when editing it in step 12.
