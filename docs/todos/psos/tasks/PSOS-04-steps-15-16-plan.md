# PSOS-04 — detailed implementation plan for steps 15 and 16

*Written 2026-07-27. Companion to [`PSOS-04-implementation-plan.md`](./PSOS-04-implementation-plan.md)
(authoritative, steps 6–19), [`PSOS-04-steps-13-14-plan.md`](./PSOS-04-steps-13-14-plan.md), and
[`PSOS-04.md`](./PSOS-04.md). Every file:line below was verified against the working tree at time
of writing (342 tests + 33 component tests green, `npm run check` 0 errors). No source file was
modified by this pass; two throwaway `tsc` type probes were run and deleted (results recorded in
§3.2 and §5.2).*

**Scope.** Step 15 (FilesPanel internals: DocRow de-drift per resolution (b), attempts query +
denied state per Amendment C, badges + summary + collapsed-header failure count per Amendment E,
failed-attempt rows, `initiallyOpen`) and step 16 (the B5 layout fix and mounts M1/M2 per
resolution (a)). Implements the resolutions and amendments as decided — nothing here re-litigates
them. Every deviation or new finding is flagged loudly in §9.

---

## 1. Summary table

| Sub-step | Files | Done means | Verification |
|---|---|---|---|
| **15a** — Amendment C server change | `convex/uploadAttempts.ts`, `convex/uploadAttempts.test.ts` | `listUploadAttempts` returns `null` on denied access; `displayStatus` type narrowed to `"in_progress" \| "failed"` (§5.2 — new finding, required for 15d to compile); step-5 `[]` test updated; new denied-vs-member test | `npx vitest run convex/uploadAttempts.test.ts` · `npx tsc --noEmit -p convex/tsconfig.json` |
| **15b** — DocRow de-drift | `FilesPanel.svelte` | Hand-written `DocRow` (`:10–22`) replaced by `FunctionReturnType` alias; `as DocRow[]` (`:101`) deleted; refined recurrence-guard grep clean | `npm run check` · `grep -rn "\.data as [A-Z]" src/` empty (§9 D3 — the plan's original grep now false-positives) |
| **15c** — attempts query + denied state | `FilesPanel.svelte` | `useQuery(api.uploadAttempts.listUploadAttempts)` beside `documentsQ`; `data === null` → `DENIED_COPY.explanation` rendered in the open body; `undefined` (loading) never treated as denied | `npm run check` · manual (§7.2) |
| **15d** — receipt composition | `FilesPanel.svelte`, `src/lib/uploads/receiptRows.ts` + `.test.ts` | `buildReceiptRows(documents, attempts, [])` composed; summary line in the open body; new pure `countReceiptFailures` helper + tests; failure count in the collapsed header, omitted at zero | `npx vitest run src/lib/uploads/receiptRows.test.ts` · `npm run check` |
| **15e** — doc-row badges + explanation | `FilesPanel.svelte` | `ProcessingStatusBadge` + always-visible explanation/action line on each document row; suppressed for archived rows (N2); transcript row unbadged | `npm run check` · manual |
| **15f** — failed-attempt rows + Remove | `FilesPanel.svelte` | `UploadReceiptRow` per attempt row rendered above the document list; Remove wired to `dismissUploadAttempt`; Replace button deliberately absent until step 18 (§9 D1 — transient copy mismatch recorded) | `npm run check` · manual reload persistence |
| **15g** — `initiallyOpen` | `FilesPanel.svelte` | `initiallyOpen?: boolean = false` prop seeds `isOpen`; manual toggle unaffected; later prop changes deliberately ignored | `npm run check` · manual |
| **16a** — B5 layout fix | `src/routes/project/[id]/+page.svelte` | `:1053` loses `items-center`; `:1054` gains `my-auto`; §6.1 inertness argument holds visually | manual short-viewport scroll check |
| **16b** — mounts M1 + M2 | `src/routes/project/[id]/+page.svelte` | M1 under `GenerationProgress` gated `{#if !report}` with `initiallyOpen={showFailedGeneration}`; M2 in the reportless `<main>` after `projectMetadata()`; state matrix §6.3 holds | `npm run check` · manual at 375px/1440px per matrix |

Standing gate after each sub-step: `npm run check` · `npx tsc --noEmit -p convex/tsconfig.json` ·
`npm run test` · `npm run test:component`. Deploy ordering unchanged (ticket §12): **Convex
first** — 15a lands before any frontend consumer of the `null` return exists.

---

## 2. FilesPanel current state — full report (Q1, re-verified line numbers)

`src/lib/components/editor/FilesPanel.svelte`, 555 lines. The file has **not** shifted since the
authoritative plan (`:87`, `:93`, `:101`, `:236–297`, `:306`, `:312–318`, `:321` all still hold).

- **Props** (`:79–85`): `{ projectId: Id<"projects">; reportId?: Id<"reports"> }`. `reportId` is
  already optional — the reportless mounts need no prop change beyond `initiallyOpen`.
- **Local `DocRow`** (`:10–22`, in `<script module>`): hand-written 11-field type ending at
  `archived: boolean`. It **omits** `processingStatus`/`processingDetail`, which the server has
  returned since step 4 (`convex/documents.ts:194–195`).
- **The assertion** (`:101`): `const documents = $derived(documentsQ.data as DocRow[] | undefined);`
  — silently discards the two new projection fields. The only `.data as`-style *type assertion*
  in `src/` (see §9 D3 for the grep caveat).
- **State** (`:87–91`): `isOpen = $state(false)`, `preview = $state<DocRow | null>(null)`,
  `showTranscript = $state(false)`, `removal = $state<{doc: DocRow; action: "archive"|"delete"} | null>(null)`,
  `removalBusy = $state<"revise"|"just"|null>(null)`.
- **Queries/mutations** (`:93–99`): `documentsQ = useQuery(api.documents.listDocuments, () => ({projectId}))`
  (`:93`), `transcriptQ` (`:94`), `useConvexClient` (`:95`), `setArchived`/`deleteDoc` (`:96–97`),
  `sendMessage` for the BNH-24 revise handoff (`:99`). `count = documents?.length ?? 0` (`:103`).
- **Collapsed header** (`:200–231`): one full-width `<button>` toggling `isOpen` (`:202`), folder
  icon tile (`:206–214`), then `<span class="text-sm font-medium text-gray-900">Files</span>` +
  `<span class="ml-2 text-xs text-gray-400">{count} file{count !== 1 ? "s" : ""}</span>`
  (`:216–220`), chevron rotating on `isOpen` (`:222–230`).
- **Open body** (`:233–402`): `border-t border-gray-100 px-5 py-3` (`:234`); **pinned transcript
  row** (`:236–297`) with preview (`:262–276`) and download (`:277–295`) 32px icon buttons using
  bare `title=` — stays unbadged (ticket §1: transcripts carry no extraction status); empty state
  (`:299–302`); document list `<ul class="divide-y divide-gray-100">` (`:304`), one `<li>` per doc
  (`:306`) with type-icon tile (`:307`, snippet `:170–182`), name + category pill (`:310–311`,
  snippet `:184–197`), "Archived" pill (`:312–318`), date + "· excluded from AI" (`:320–322`).
- **Per-document actions** (all 32px `title=`-only icon buttons — pre-existing rule-11 violations,
  ticket §12 non-goal): Preview (`:324–338`, sets `preview`), Download (`:339–352`, `download()`
  `:151–167` — storage URL fetch or text fallback), Restore when archived (`:353–367`,
  `restore()` `:115–117`), Archive when not (`:368–383`, opens `removal`), Delete (`:384–397`,
  opens `removal`).
- **Confirmation flows**: preview modal (`:406–461`, PDF iframe / image / text via
  `previewContentQ` `:111–113`); transcript modal (`:464–495`); archive/delete confirmation
  (`:498–554`) with the BNH-24 "& revise report" path (`performRemoval` `:119–139`,
  `craftRevisionMessage` `:24–39`) gated on `reportId` (`:500`, `:541`).
- **Listing/sort**: no client sort — `listDocuments` delivers newest-first
  (`.order("desc")`, `convex/documents.ts:170`) and the `{#each documents ?? [] as doc (doc._id)}`
  (`:305`) renders in that order. Archived rows render inline at `opacity-60` (`:306`).
- **Importers**: `DocRow` is exported but imported nowhere else (verified:
  `grep -rn "DocRow" src/` hits only this file). `FilesPanel` is mounted exactly once today, at
  `project/[id]/+page.svelte:1112` inside the report gate (`:1082`).

`FilesPanel` imports `convex-svelte` (`:75`) → **not component-testable** (harness contract,
steps-13-14 plan §2).

---

## 3. Step 15 — exact changes

### 3.1 (15a) Amendment C: `listUploadAttempts` returns `null` on denied — plus a required type narrowing

**Current** (`convex/uploadAttempts.ts:148`):

```ts
    if (!(await getInternalProjectAccessOrNull(ctx, args.projectId))) return [];
```

**Change to:**

```ts
    // Amendment C: denial is a distinguishable fact, not an empty list. The
    // frontend renders "you may not see this" instead of "nothing failed".
    // (docs/product-domain.md:251 — permission-denied is a per-feature state.)
    if (!(await getInternalProjectAccessOrNull(ctx, args.projectId))) return null;
```

**Consumers:** none outside tests — verified,
`grep -rn "listUploadAttempts" src/ convex/` (excluding tests/generated) hits only the definition,
a comment in `convex/lib/uploadAttempts.ts:101`, and the doc-comment in
`src/lib/uploads/receiptRows.ts:30`. Safe to change (new API from step 5, exactly as Amendment C
assumed). `listDocuments` keeps its `[]` (`convex/documents.ts:165`) — cross-ticket scope,
unchanged.

**Test update** (the exact test Amendment C requires): `convex/uploadAttempts.test.ts:314–332`,
`"an unauthenticated caller cannot read or write attempts"`, asserts at `:322–324`:

```ts
    expect(await t.query(api.uploadAttempts.listUploadAttempts, { projectId })).toEqual(
      []
    );
```

→ becomes `…).toBeNull();`. Add one positive companion in the same describe block: a member
caller still receives an array (`expect(Array.isArray(listed)).toBe(true)`) so the null can never
silently spread to the granted path.

**Reach of the denied state, stated honestly:** `getInternalProjectAccessOrNull`
(`convex/lib/auth.ts:33–42`) returns `null` only when the caller is unauthenticated **or the
project row is gone** — internal access is firm-wide (domain contract D1; confirmed by the step-5
work log, `PSOS-04.md:560`). The page itself gates on `auth.isAuthenticated`
(`project/[id]/+page.svelte:786`), so in practice the denied rendering fires for a
deleted-while-open project and for any future role narrowing. Amendment C is about the contract
being truthful, not about a state users hit daily; recorded, not a reason to skip it.

**NEW FINDING (required in the same touch) — `displayStatus` is not the type the client seam
expects.** Verified by `tsc` probe against the generated API (§9 D2):

```
FunctionReturnType<typeof api.uploadAttempts.listUploadAttempts>[number]["displayStatus"]
  = "in_progress" | "failed" | "succeeded" | "dismissed"   // ← 4-union, NOT 2
```

Cause: the runtime filter at `convex/uploadAttempts.ts:157`
(`.filter((a) => a.status === "in_progress" || a.status === "failed")`) does not narrow the
element type (no type predicate), so the `: a.status` fallback in the `displayStatus` ternary
(`:168–171`) contributes the full stored union. `receiptRows.ts`'s `ListedAttempt.displayStatus`
is `"in_progress" | "failed"` (`src/lib/uploads/receiptRows.ts:42`), so **15d's
`buildReceiptRows(…, attempts, …)` would not compile** against today's server type. Fix in the
same 15a diff, zero runtime change — annotate the fallback:

```ts
        displayStatus:
          a.status === "in_progress" && now - a.updatedAt > STALE_ATTEMPT_MS
            ? ("failed" as const)
            // Safe: the filter above admits only in_progress | failed rows;
            // TS cannot see through a boolean .filter, so we state it.
            : (a.status as "in_progress" | "failed"),
```

(Alternative without a cast: give the filter a type predicate over
`Doc<"documentUploadAttempts">`. The cast + comment is the smaller diff; either is acceptable.)
Add a compile-level guard to the test file so the narrowing cannot silently regress:
a `satisfies`/assignment of one listed row to `{ displayStatus: "in_progress" | "failed" }`.

**Rollback:** restore `[]` and drop the annotation. Nothing else on the server moves.

### 3.2 (15b) DocRow de-drift (resolution (b))

Replace `FilesPanel.svelte:10–22` with:

```ts
  import type { FunctionReturnType } from "convex/server";
  import type { api } from "../../../../convex/_generated/api";

  /** One listDocuments row — always the server's projection, never a hand copy. */
  export type DocRow = FunctionReturnType<typeof api.documents.listDocuments>[number];
```

and change `:101` to:

```ts
  const documents = $derived(documentsQ.data);
```

Facts verified before writing this:

- **Repo idiom confirmed**: `src/lib/stableQuery.svelte.ts:5` imports `FunctionReturnType` from
  `convex/server` and uses it generically (`:23`, `:28`).
- **`import type { api }` + `typeof api` compiles and preserves literal unions** — probed with a
  scratch `tsc --strict` run: `DocRow["fileType"]` stays the 9-literal union (schema
  `convex/schema.ts:544–554`; projection passes `d.fileType` through,
  `convex/documents.ts:185`), so the snippet param `fileTypeIcon(type: DocRow["fileType"])`
  (`:170`) and `FILE_TYPE_COLORS[type]` (`:172`) keep type-checking. A `@ts-expect-error` on a
  bogus literal was honoured — no widening to `string`.
- **What breaks: nothing.** The new `DocRow` is a strict superset (adds
  `processingStatus: ProcessingStatus`, `processingDetail: ProcessingDetail | null` —
  `convex/documents.ts:179–181, 194–195`; both non-optional in the projection because of the
  read-time fallback). All existing uses (`preview`, `removal`, `restore`, `download`,
  `performRemoval`, both snippets) touch only fields present in both shapes.
  `FilingReadinessPanel` is immune — it runs its own `useQuery` and uses only
  `_id`/`fileName`/`archived` (`FilingReadinessPanel.svelte:33`, `:44`, `:78–83`); it never
  imports FilesPanel's `DocRow` (grep: no importer exists).
- The import must live in the `<script module>` block (that's where `DocRow` is declared and
  exported); `import type` is erased, so no runtime module-eval-order concern.

**Recurrence guard (refined — §9 D3):** the authoritative plan's done-check
`grep -rn "\.data as " src/` **now false-positives** on
`src/routes/changelog/+page.svelte:154` (`{#each entriesQ.data as entry (entry._id)}` — an
each-block, not an assertion). Use `grep -rn "\.data as [A-Z]" src/` → must return nothing.

### 3.3 (15c) Attempts query + denied state

In the instance script, beside `documentsQ` (`:93`):

```ts
  const attemptsQ = useQuery(api.uploadAttempts.listUploadAttempts, () => ({ projectId }));
  const dismissAttempt = useMutation(api.uploadAttempts.dismissUploadAttempt);

  // Amendment C: null is a denial verdict; undefined is still loading. Only
  // null may render the denied copy — conflating them would flash "no
  // permission" on every mount.
  const attemptsDenied = $derived(attemptsQ.data === null);
  const attempts = $derived(attemptsQ.data ?? []);
```

Denied rendering, first thing inside the open body (`:234`):

```svelte
      {#if attemptsDenied}
        <p class="py-3 text-sm text-ink-muted">{DENIED_COPY.explanation}</p>
      {:else}
        <!-- transcript row, summary, attempt rows, document list as below -->
      {/if}
```

`DENIED_COPY` is imported from `$lib/uploads/processingStatus` (`:117–120` — the string already
exists and is covered by the banned-substring test). When access is null, `listDocuments` and
`getTranscript` return `[]`/`null` under the same predicate (`convex/documents.ts:165`,
`convex/transcripts.ts:8`), so wrapping the whole body is consistent, not just the attempts slice.
The collapsed header still renders ("0 files"); acceptable — the denial copy is one click away
and the header carries no false counts.

### 3.4 (15d) Receipt composition: rows, summary line, collapsed-header failure count

```ts
  import {
    buildReceiptRows,
    countReceiptFailures,
    summarizeReceipt,
  } from "$lib/uploads/receiptRows";

  // Panel has no ephemeral rows (DECISION 2: after reload the bytes are gone),
  // so every failure the builder emits offers Replace/Remove, never Retry.
  const receiptRows = $derived(buildReceiptRows(documents ?? [], attempts, []));
  // With an empty ephemeral list, rows with an attemptKey are exactly the
  // attempt-backed rows (buildReceiptRows emits attempts before documents).
  const attemptRows = $derived(receiptRows.filter((row) => row.attemptKey !== undefined));
  const failedCount = $derived(countReceiptFailures(receiptRows));
  const summary = $derived(summarizeReceipt(receiptRows));
```

Type fit, verified: a `listDocuments` row satisfies `ListedDocument`
(`receiptRows.ts:19–27`) structurally — `processingStatus: ProcessingStatus` and
`processingDetail: ProcessingDetail | null` both non-optional in the projection
(`convex/documents.ts:194–195`). A `listUploadAttempts` row satisfies `ListedAttempt`
(`receiptRows.ts:37–44`) **only after 15a's `displayStatus` narrowing** (§3.1).

**New pure helper** in `src/lib/uploads/receiptRows.ts` (FilesPanel itself is untestable, so the
one new piece of logic goes in the tested seam):

```ts
/**
 * Rows the collapsed header should count as failed: upload failures only —
 * the same vocabulary as the summary line ("failed" = upload_failed; an
 * unreadable stored file is "unreadable", not "failed"). Archived rows are
 * excluded for the same reason summarizeReceipt excludes them.
 */
export function countReceiptFailures(rows: ReceiptRow[]): number {
  return rows.filter((row) => !row.archived && row.status === "upload_failed").length;
}
```

Vocabulary decision (§9 D4): "failed" in the header = `upload_failed` rows, matching
`SUMMARY_CLAUSE` (`processingStatus.ts:98–107`, where `could_not_read` → "unreadable" and
`skipped_unsupported` → "skipped"). Counting unreadable documents as "failed" would contradict
the summary line one click below.

**Collapsed header** (Amendment E: `"Files · 4 files · 2 failed"`). Extend `:216–220`; the
existing markup is space-separated spans, so the middots are literal text in the new span:

```svelte
      <div>
        <span class="text-sm font-medium text-gray-900">Files</span>
        <span class="ml-2 text-xs text-gray-400">
          {count} file{count !== 1 ? "s" : ""}
        </span>
        {#if failedCount > 0}
          <span class="ml-2 text-xs font-medium text-red-600">
            · {failedCount} failed
          </span>
        {/if}
      </div>
```

- **At zero: the clause is omitted entirely** — the header is byte-identical to today. No
  "0 failed" ever renders.
- Not colour-only: the word "failed" is the signal; red is decoration
  (`docs/product-domain.md:250`).
- `count` stays `documents?.length ?? 0` (`:103`) — documents only, unchanged semantics, so
  "4 files · 2 failed" reads as 4 stored documents plus 2 failures, exactly Amendment E's example
  (§9 D4 flags this reading).
- The count works while collapsed because `attemptsQ` subscribes at component init regardless of
  `isOpen` — that is the point of N5 (failures must not be invisible behind the fold).

**Summary line** in the open body, above the attempt rows / document list (after the transcript
block, `:297`):

```svelte
      {#if !attemptsDenied && receiptRows.length > 0}
        <p class="pt-2 text-data text-ink-muted">{summary}</p>
      {/if}
```

`summarizeReceipt` is already tested to the ticket's pinned string (steps-13-14 plan §6.1 tests
10–14); no new copy is introduced — clause nouns live in the copy module (F5).

### 3.5 (15e) Document-row badges + explanation (option (b) of Q2 — see §4)

Inside the existing doc `<li>` (`:306–398`), two additions, no removals:

1. Badge beside the name/category/archived pills (`:309–319`) — after the archived pill so the
   two never fight for the same slot:

```svelte
                <div class="flex items-center gap-2">
                  <p class="truncate text-sm text-gray-800">{doc.fileName}</p>
                  {@render categoryPill(doc.category, doc.source)}
                  {#if doc.archived}
                    <span class="…">Archived</span>   <!-- existing :312–318, unchanged -->
                  {:else}
                    <ProcessingStatusBadge status={doc.processingStatus} />
                  {/if}
                </div>
```

   `{:else}` — not a sibling `{#if}` — is the N2 suppression: an archived row shows the Archived
   pill and **no** status badge (a "Ready for AI" badge beside "· excluded from AI" at `:321`
   would be the exact contradiction Amendment E resolves). This mirrors the shipped
   `UploadReceiptRow` behaviour (`UploadReceiptRow.svelte:58–66`).

2. Explanation + action line under the date line (`:320–322`), copy from the one static map:

```ts
  // script: derived per-row is not possible in an each-block; use a helper
  function docCopy(doc: DocRow): string | null {
    if (doc.archived || doc.processingStatus === "ready") return null;
    const { explanation } = PROCESSING_STATUS_COPY[doc.processingStatus];
    const action = statusAction(doc.processingStatus, {
      canRetry: false,
      // Step 18 wires document Replace; until then the copy must not name a
      // button that does not exist (the step-13 review's exact finding).
      canReplace: false,
    });
    return action ? `${explanation} ${action}` : explanation;
  }
```

```svelte
                {#if docCopy(doc)}
                  <p class="mt-0.5 text-xs text-ink-muted">{docCopy(doc)}</p>
                {/if}
```

   `statusAction`'s signature is `(status, {canRetry, canReplace})`
   (`processingStatus.ts:126–132`); `could_not_read` varies on `canReplace` (`:64–67`), so
   passing `canReplace: false` in step 15 yields the honest "Upload a text-based version…"
   variant. **Step 18 flips this to the row's real `canReplace`** when the document Replace flow
   lands. `ready` and `ready_truncated` and every other status render their §9 copy verbatim —
   no wording is introduced here.

   (Call `docCopy(doc)` once via `{@const copy = docCopy(doc)}` in the each-block to avoid the
   double call — implementation nicety.)

### 3.6 (15f) Failed-attempt rows

Rendered **above** the document list (builder ordering, F3: problems above healthy files), inside
the same visual system. `UploadReceiptRow` renders an `<li>` (`UploadReceiptRow.svelte:50`), so
the attempt rows join a `<ul>`; keeping them in their own `<ul>` directly before the documents
`<ul>` (`:304`) is the smallest change and keeps the two `{#each}` blocks independent:

```svelte
      {#if attemptRows.length > 0}
        <ul class="divide-y divide-gray-100 border-b border-gray-100">
          {#each attemptRows as row (row.key)}
            <UploadReceiptRow
              {row}
              busy={busyRowKey === row.key}
              onRemove={removeAttempt}
            />
          {/each}
        </ul>
      {/if}
```

with:

```ts
  let busyRowKey = $state<string | null>(null);

  async function removeAttempt(row: ReceiptRow) {
    if (!row.attemptKey) return;
    busyRowKey = row.key;
    try {
      await dismissAttempt({ projectId, attemptKey: row.attemptKey });
    } finally {
      busyRowKey = null;
    }
  }
```

- Behaviour by row, all falling out of the already-tested builder
  (`receiptRows.ts:125–148`): fresh `in_progress` → `status: null` → spinner + "Reading…" (an
  upload racing in another tab); `failed` (incl. stale-derived) → `upload_failed` badge, §9
  explanation, `canReplace: true`, `canRemove: true`.
- **Remove** = `dismissUploadAttempt` (`convex/uploadAttempts.ts:129–138`) — marks `dismissed`,
  audit row kept, the list query drops it, the panel updates reactively. No confirmation dialog:
  the row represents nothing stored in the project (unlike document delete at `:498–554`), and
  dismissal is recorded, not destructive.
- **Replace is NOT wired in step 15** — `onReplace` is not passed, so the component renders no
  Replace button (verified contract: callback absent → control absent,
  `UploadReceiptRow.svelte:88`; component test 7). The full Replace pipeline (storage POST +
  parse + `uploadDocument` under the same `attemptKey`, plus the document id-compare flow) is
  step 18 per the authoritative plan. **Consequence flagged loudly in §9 D1:** between steps 15
  and 18 the `upload_failed` action copy (keyed on `canRetry` only,
  `processingStatus.ts:78–82`) says `Use "Replace file…" to choose it again` while no such
  button renders. Options and recommendation in D1.
- New imports: `UploadReceiptRow` from `$lib/components/upload/UploadReceiptRow.svelte`,
  `ProcessingStatusBadge` likewise, `PROCESSING_STATUS_COPY`/`statusAction`/`DENIED_COPY` from
  `$lib/uploads/processingStatus`, builder trio from `$lib/uploads/receiptRows`. All are
  presentational/pure modules — FilesPanel keeps its `convex-svelte` imports; the three upload
  components keep their grep-enforced purity (nothing changes in them in step 15).

### 3.7 (15g) `initiallyOpen`

```ts
  let {
    projectId,
    reportId,
    initiallyOpen = false,
  }: {
    projectId: Id<"projects">;
    reportId?: Id<"reports">;
    /** Seed for the collapse state. Read once at mount — the user's manual
     *  toggle owns the state afterwards (a later prop change is ignored,
     *  which is what "initially" means; resolution (a) records that the
     *  generating→failed transition does not force the panel open). */
    initiallyOpen?: boolean;
  } = $props();

  let isOpen = $state(initiallyOpen);
```

- `$state(initiallyOpen)` captures the prop's value at initialization only — the documented
  Svelte 5 "initial value" pattern. The toggle button (`:202`) keeps mutating `isOpen` freely;
  no `$effect` syncs the prop afterwards, **by design** (Amendment E: default false; resolution
  (a)/accepted limitation: M1 mounted during generation stays collapsed through a live
  generating→failed transition, failure count visible in the header).
- Existing mount at `:1112` passes nothing → default `false` → behaviour byte-identical.

---

## 4. Q2 — how receipt rows coexist with FilesPanel's document rows (the decision)

**Decision: (b) — keep FilesPanel's document rows and augment them; render only *attempt* rows
through `UploadReceiptRow`; use the pure builder for composition, counts, and the summary; do
not mount `<UploadReceipt>` inside FilesPanel.**

This is what the ticket §8.2 and authoritative step 15 already describe ("FilesPanel gains the
summary line, a `ProcessingStatusBadge` + explanation per document row, and failed-attempt rows
with Replace/Remove"), and it survives adversarial comparison:

- **Against (a) — replace the document list with `<UploadReceipt>`:** `UploadReceiptRow` renders
  name + badge + copy + Retry/Replace/Remove (`UploadReceiptRow.svelte:50–125`) and nothing
  else. FilesPanel's document rows carry Preview, Download, Archive/Restore, Delete with a
  two-step confirmation and the BNH-24 revise-report handoff (§2), plus category pills and
  file-type icon tiles. Porting five actions + two modals + a confirmation flow into the
  presentational component would (i) regress or duplicate the existing flows, (ii) destroy the
  three components' grep-enforced purity or force a callback explosion through `UploadReceipt`'s
  frozen §8 prop API, and (iii) rewrite markup this ticket's §12 explicitly left alone (32px
  buttons, bare `title=` — listed non-goals). Rejected.
- **Against mounting `<UploadReceipt>` for just the attempt rows:** `UploadReceipt` brings its
  own `heading` ("Processing receipt"), its own summary computed **only from the rows it is
  given**, an aria-live region, and its own empty state (`UploadReceipt.svelte:36–63`). Feeding
  it only attempts would render a summary like "2 files: 2 failed" beside a panel showing six
  documents — a lying count; feeding it everything double-renders the documents. Its chrome is
  designed for the standalone live receipt (step 17), not for embedding inside another panel's
  ledger. Using bare `UploadReceiptRow` items gets the tested row rendering (badge, copy,
  actions, busy state, 44px controls) without the wrapper's contradictions.
- **What (b) preserves, explicitly:** every existing document action and confirmation flow
  (untouched markup except the two additive insertions in §3.5); the pinned transcript row
  (`:236–297`, no badge — ticket §1); `FilingReadinessPanel` (own query, immune — §3.2);
  `summarizeReceipt` counting *both* sources truthfully because it is fed the full
  `buildReceiptRows(documents, attempts, [])` output.

**Resulting open-body shape** (denied branch omitted):

```
<div class="border-t border-gray-100 px-5 py-3">
  [transcript row]                       ← :236–297, unchanged, unbadged
  [summary line]                         ← new, §3.4 (only when rows exist)
  [<ul> failed/in-flight attempt rows]   ← new, UploadReceiptRow each, §3.6
  [empty state | <ul> document rows]     ← existing, each <li> + badge + copy, §3.5
</div>
```

One caveat folded into the empty state: today `count === 0` shows "No supporting files yet…"
(`:299–302`). With attempt rows present the panel is not empty — gate the empty-state paragraph
on `count === 0 && attemptRows.length === 0` so a project whose only content is a failed upload
shows the failure, not "no files yet" above it. (Strictly a truthfulness fix; flagged D5.)

---

## 5. Step 16 — page mounts + layout fix

### 5.1 (16a) B5 fix — current lines re-verified

The page grew a `<script module>` block (`:1–8`, the outbox-flush `Set` from step 11), shifting
the plan's `:1027/:1028` to **`:1053/:1054`** and `:1056/:1086` to **`:1082/:1112`**. Current
markup (`:1051–1058`):

```svelte
    <!-- Generation progress — no metadata header; the progress card is the page -->
    {#if generation && (isGenerating || showFailedGeneration)}
      <div class="flex min-h-0 flex-1 items-center overflow-y-auto">        <!-- :1053 -->
        <div class="mx-auto w-full max-w-3xl px-6 py-8">                    <!-- :1054 -->
          <GenerationProgress generationId={generation._id} />
        </div>
      </div>
    {/if}
```

**Change:** `:1053` → `class="flex min-h-0 flex-1 overflow-y-auto"` (drop `items-center`);
`:1054` → `class="mx-auto my-auto w-full max-w-3xl px-6 py-8"` (add `my-auto`).

**Why it is visually inert today (the proof):** the scroll container has exactly one flex child.
For a single child in a row-direction flex container, `align-items: center` and the child's own
`margin-block: auto` distribute the identical free cross-axis space — when the child is shorter
than the container, both centre it at the same pixel offset; `w-full`/`mx-auto` make the main
axis unchanged. The two diverge only when the child **overflows**: `items-center` keeps centring
(top edge pushed above the scroll origin — unreachable in every browser), while auto margins
collapse to zero and the content scrolls from its top. So today (progress card alone, normally
fits) nothing moves; the only behavioural delta is the currently-broken overflow case becoming
scrollable — which is exactly the case M1 creates. Verify manually at a short viewport
(step 16 done-check), since no automated oracle exists for this page.

### 5.2 (16b) Mounts M1 and M2

Gate expressions, re-verified at current lines: `isIterative` `:763`, `showIterativeStepper`
`:764–767`, `isGenerating` `:768–771`
(`reserved || (running && !isIterative)`), `awaitingSelection` `:772`, `showFailedGeneration`
`:775–777` (`failed && !report && project?.mode !== "review"`). M3 (pre-existing, untouched):
`:1112`, inside `{#if !awaitingSelection && !showIterativeStepper && report}` (`:1082`).
Reportless `<main>`: `:1495–1497`, gated
`{#if !report && !isGenerating && !awaitingSelection && !showIterativeStepper && !showFailedGeneration}`,
already `overflow-y-auto` (`:1496`), `{@render projectMetadata()}` at `:1497`.

**M1** — inside `:1054`, directly under `<GenerationProgress …/>` (`:1055`):

```svelte
          <GenerationProgress generationId={generation._id} />
          {#if !report}
            <div class="mt-4">
              <FilesPanel {projectId} initiallyOpen={showFailedGeneration} />
            </div>
          {/if}
```

`{#if !report}` is M1's own gate (the container is already gated
`generation && (isGenerating || showFailedGeneration)` at `:1052`); `mt-4` matches the panel's
existing spacing idiom at `:1111`. No `reportId` — there is no report. `initiallyOpen` evaluates
at mount: wizard handoff arrives with `isGenerating` true → collapsed; landing on a failed
generation → open. A live generating→failed transition does not remount this branch, so the
panel stays collapsed with the header failure count visible — the accepted limitation the
authoritative plan records (step 16 note + accepted-limitations list).

**M2** — inside the reportless `<main>`, after `{@render projectMetadata()}` (`:1497`):

```svelte
        {@render projectMetadata()}

        <div class="mt-8">
          <FilesPanel {projectId} />
        </div>
```

`mt-8` matches the sibling sections (`:1509`, `:1518`). Default collapsed (Amendment E default);
the header failure count is the always-visible signal.

**Snippet note (§9 D6):** resolution (a) says "one snippet, three render points". The two new
mounts differ only in the `initiallyOpen` prop and their margin wrapper; a snippet wrapping a
single one-line component adds indirection without deduplication, so this plan specifies two
direct mounts. If the reviewer prefers the letter of resolution (a):
`{#snippet projectFiles(open: boolean = false)}<FilesPanel {projectId} initiallyOpen={open} />{/snippet}`
at top level and `{@render projectFiles(showFailedGeneration)}` / `{@render projectFiles()}` at
the two sites — functionally identical either way.

### 5.3 Re-verified state matrix (resolution (a), against current markup)

| Page state | Gate facts | M1 (`:1052` ∧ `!report`) | M2 (`:1495`) | M3 (`:1082`) | Panels |
|---|---|---|---|---|---|
| Generating, no report (default wizard handoff) | `isGenerating` ✓, `report` ✗ | ✔ collapsed | ✘ (`!isGenerating` fails) | ✘ (no report) | 1 |
| Failed generation, no report, mode ≠ review | `showFailedGeneration` ✓ | ✔ **open** | ✘ (`!showFailedGeneration` fails) | ✘ | 1 |
| Report editor | `report` ✓, not awaiting/stepper | ✘ (`!report` fails) | ✘ (`!report` fails) | ✔ (at `:1112`, with `reportId`) | 1 |
| Generating **with** report (regeneration edge, if reachable) | `isGenerating` ✓, `report` ✓ | container ✔ but M1 ✘ (`!report`) | ✘ | ✔ | 1 |
| Awaiting selection | `awaitingSelection` ✓ ⇒ `isGenerating` ✗, `showFailedGeneration` ✗ | ✘ (container gate) | ✘ (`!awaitingSelection` fails) | ✘ | 0 — accepted |
| Iterative stepper (`running`/`awaiting_input`, iterative) | `showIterativeStepper` ✓ ⇒ `isGenerating` ✗ (`!isIterative` clause) | ✘ | ✘ | ✘ | 0 — accepted |
| Reportless idle (incl. review-mode failed — `showFailedGeneration` excludes `mode === "review"` at `:776`) | all gates ✗ | ✘ | ✔ | ✘ | 1 |

- **No state renders two panels.** The only state where two *containers* co-render is
  "generating with report" (`:1052` container + `:1082` editor) — M1's `!report` gate keeps the
  panel count at 1 there (the matrix row is defensive; reachability unverified, as in the
  authoritative plan's could-not-verify item 3).
- **No upload-dead-end state renders zero panels.** The two zero-panel states
  (awaiting-selection, stepper) are full-height mid-workflow surfaces; the outbox flush does not
  depend on any panel — it is the page-level `$effect` at `:350–360`, which runs in every state
  (resolution (c), already shipped in step 11).
- Status enum sanity: a generation status is one of
  `reserved/running/awaiting_input/awaiting_selection/failed/…completed`; `isGenerating`,
  `awaitingSelection`, `showIterativeStepper`, `showFailedGeneration` are pairwise exclusive by
  construction over that enum (a `failed` status is not `reserved/running`; `awaiting_input`
  only reaches the stepper via `isIterative`). Verified against `:763–777`.

---

## 6. Test plan (Q8 — honest split)

### 6.1 Automatable

| Test | File | Asserts |
|---|---|---|
| Denied → `null` (Amendment C) | `convex/uploadAttempts.test.ts:314–332` (update `:322–324`) | unauthenticated `listUploadAttempts` → `toBeNull()`; mutations still throw |
| Granted → array (new) | same file | member caller receives an array — the null cannot leak into the granted path |
| `displayStatus` narrowing (new, compile-level) | same file | one listed row assignable to `{ displayStatus: "in_progress" \| "failed" }` (a `satisfies` line — fails to compile if 15a's annotation regresses) |
| `countReceiptFailures` (new) | `src/lib/uploads/receiptRows.test.ts` | counts `upload_failed` only (a mixed fixture with `could_not_read` + `skipped_unsupported` docs counts 0 of them); archived `upload_failed`-shaped rows excluded; empty → 0; matches Amendment E's "2 failed" for a 2-failure fixture |
| Standing gates | — | `npm run check` 0 errors (a11y included), `npx tsc --noEmit -p convex/tsconfig.json`, `npm run test`, `npm run test:component` (33 existing — unchanged; steps 15–16 add **no** component tests) |
| Recurrence guard | — | `grep -rn "\.data as [A-Z]" src/` → empty (§3.2) |

Everything else the panel renders is already covered at the pure layer: builder flags/ordering/
exclusions and AC1–AC4 (`receiptRows.test.ts`, steps-13-14 §6.1), copy + banned substrings
(`processingStatus.test.ts`), row/receipt rendering + a11y in Chromium
(`*.component.test.ts` — `UploadReceiptRow` is the exact component reused in 15f).

### 6.2 Not automatable — manual checklist (FilesPanel imports `convex-svelte`; the page is a
route). Record results in the work log as evidence.

At `localhost:3001`, dev deployment:

1. **AC3 / reload persistence:** upload a mixed batch via chat (1 good, 1 image, 1 empty PDF);
   DevTools-offline a fourth → hard reload → FilesPanel shows correct badges per doc, one
   `upload_failed` attempt row above the list, summary line counts all of it, collapsed header
   shows "· 1 failed".
2. **Header at zero:** project with only healthy docs → header byte-identical to today (no
   failed clause).
3. **Remove:** dismiss the failed attempt → row disappears, header count drops, Convex dashboard
   shows the row `dismissed` (not deleted).
4. **Archived suppression (N2):** archive a `ready` doc → Archived pill, no status badge, no
   copy line, excluded from summary and failure count.
5. **Transcript row:** still unbadged, preview/download intact.
6. **Existing actions unregressed:** preview modal, download, archive→restore, delete with
   confirmation + revise-handoff (report project).
7. **FilingReadinessPanel:** renders unchanged on a report project.
8. **Denied state:** (hard to reach as an internal user — D1) simulate by deleting the project in
   another tab with the panel open, or temporarily point `attemptsDenied` at a forced null in dev
   tools; the open body shows the `DENIED_COPY` line, not the empty state.
9. **Step 16 matrix:** walk all 7 rows of §5.3 at 375px and 1440px — one panel or an accepted
   zero everywhere, never two.
10. **B5:** on a short viewport (e.g. 700px tall) with the panel open under a failed generation,
    the **top** of the progress card is reachable by scroll; with content fitting, the card sits
    visually centred as today.
11. **`initiallyOpen`:** land directly on a failed-generation project → panel open; wizard
    handoff (generating) → collapsed; manual toggle works in both and survives status changes.
12. **Keyboard:** Tab reaches the panel header button, then each attempt row's Remove, then the
    document rows' icon buttons, in DOM order; Remove activates with Enter and Space; focus ring
    visible on the new `Button`-based controls (the old 32px icon buttons remain the recorded
    §12 non-goal).
13. **Known-transient (D1):** the `upload_failed` attempt row's copy mentions "Replace file…"
    with no such button until step 18 — expected at this step, verify it resolves in step 18's
    checklist.

---

## 7. Risks and rollback

| Risk | Why real | Mitigation | Detect |
|---|---|---|---|
| `displayStatus` type mismatch blocks 15d | Verified by probe: today's server type is the 4-union (§3.1) | 15a fixes it server-side with a commented cast + compile-level test | convex `tsc` + the new `satisfies` test |
| `null` return breaks an unknown consumer | — | Verified: zero non-test consumers of `listUploadAttempts` | grep in §3.1 |
| DocRow widening breaks a FilesPanel use | Structurally larger type | Verified superset; probe confirmed literal unions survive; no external importer | `npm run check` 0 errors |
| Header count double-vocabulary confusion | "failed" could be read as "any bad status" | `countReceiptFailures` uses the summary line's own vocabulary; unit-tested | 15d tests |
| Panel noise / query load during generation (M1) | Two extra subscriptions while collapsed | Both are single-project indexed reads (`by_projectId`, `.take(200)` / `.collect()` on an already-listed set); collapsed = one header row | Convex insights after step 16 (ticket §12) |
| B5 fix shifts the progress card visually | Layout change on a primary surface | Single-flex-child equivalence argument (§5.1); manual check both viewport sizes | checklist 10 |
| Empty-state lie ("No supporting files yet" above a failure row) | New attempt rows coexist with `count === 0` | Empty state gated on `count === 0 && attemptRows.length === 0` (D5) | checklist 1 |
| Transient copy names an absent Replace button | Step split 15 vs 18 (authoritative) | Flagged D1; document rows get `canReplace: false` copy variant now; attempt rows accept the one-step gap or pull-forward per human call | checklist 13 |

**Rollback:**

| Sub-step | Rollback | Residue |
|---|---|---|
| 15a | Restore `return []` + drop the annotation; restore the `[]` test | None — no consumer until 15c ships |
| 15b–15g | Revert `FilesPanel.svelte` (one file) | Server keeps writing statuses/attempts harmlessly (authoritative step-15 rollback) |
| 15d helper | Remove `countReceiptFailures` + tests | None once FilesPanel reverted |
| 16a/16b | Revert the page file | Layout fix reverts too — acceptable, it only matters with the panel mounted (authoritative step-16 rollback). Partial rollback (mounts only, keep B5 fix) is also safe: the fix is inert without overflow |

Deploy ordering: Convex first (15a), then the frontend — the `null` return exists before its
consumer, and an old bundle never calls `listUploadAttempts` at all.

**If the ticket must stop somewhere, stop after step 16** (authoritative plan): steps 15+16
together satisfy "reachable later from the project files panel" + AC3.

---

## 8. Findings, deviations, and decisions — read before implementing (veto here)

- **D1 (sequencing gap in the authoritative plan, resolved here — veto if disagreed).**
  Authoritative step 15 says "failed-attempt rows with Replace/Remove", but step 18 owns the
  Replace *flows* (pipeline under the same `attemptKey`; document id-compare). Wiring a Replace
  button in step 15 without the pipeline means a dead control; wiring the pipeline means pulling
  most of step 18 forward into a step the plan split for reviewability (N15). **This plan wires
  Remove in step 15 and defers Replace (button auto-absent — callback-gated) to step 18.**
  Consequence: for the one intermediate step, the `upload_failed` action copy (keyed on
  `canRetry` only, `processingStatus.ts:78–82`) names "Replace file…" while the button is
  absent — the same *class* of defect the step-13 review fixed for `could_not_read`, accepted
  here only because it is transient within one ticket and §9 copy is frozen verbatim.
  Alternatives: (i) pull attempt-Replace forward into step 15 (bigger diff, against N15);
  (ii) key the `upload_failed` action on `canReplace` too (a §9 copy-structure change —
  needs sign-off). Document rows have no such gap: their copy is passed `canReplace: false`
  until step 18 (§3.5), which the existing copy map supports.
- **D2 (new verified finding).** `listUploadAttempts`' inferred `displayStatus` type is
  `"in_progress" | "failed" | "succeeded" | "dismissed"` — the boolean `.filter` at
  `convex/uploadAttempts.ts:157` does not narrow, and the ternary fallback at `:171` leaks the
  stored union. Confirmed by a `tsc --strict` probe against `_generated/api` (conditional-type
  check failed for the 2-union). Without 15a's annotation, step 15d does not compile against
  `ListedAttempt` (`receiptRows.ts:42`). Zero runtime change; flagged because no prior plan
  caught it.
- **D3 (done-check correction).** Resolution (b)'s recurrence guard
  `grep -rn "\.data as " src/` now false-positives on `src/routes/changelog/+page.svelte:154`
  (`{#each entriesQ.data as entry (entry._id)}` — Svelte each-block syntax, not a cast). Refined
  to `grep -rn "\.data as [A-Z]" src/`.
- **D4 (Amendment E interpretation).** "Files · 4 files · 2 failed": "N files" stays the
  existing documents-only count (`:103`, unchanged semantics); "N failed" counts non-archived
  rows with `status === "upload_failed"` only — the summary line's own vocabulary
  (`SUMMARY_CLAUSE`), so `could_not_read` documents are "unreadable" in the summary and **not**
  "failed" in the header. Veto if "failed" was meant to cover every non-ready status.
- **D5 (truthfulness fix, tiny new behaviour).** The empty-state paragraph (`:299–302`) is
  additionally gated on `attemptRows.length === 0` so "No supporting files yet" cannot render
  above a failure row. Strictly consistent with the ticket's intent; flagged as it changes a
  rendered state not named by any amendment.
- **D6 (trivial deviation from resolution (a)'s letter).** Two direct one-line mounts instead of
  a shared `{#snippet}` (§5.2) — the snippet wraps a single component call and deduplicates
  nothing. Functional behaviour identical; either form acceptable.
- **New scope under queue rule 5: none.** `countReceiptFailures` is a pure helper inside an
  existing PSOS-04 module serving Amendment E's header count; D5 is a two-condition gate on an
  existing paragraph. No new dependencies, no new components, no config changes, no copy-map
  wording changes (the §9 table stays verbatim; `DENIED_COPY` already exists from step 12).

---

## 9. What I could not verify — check before relying on it

1. **Svelte-check acceptance of the exact `<script module>` type import** — the
   `import type { api } … typeof api` pattern was probed with plain `tsc` (clean), not through
   `svelte-check`'s compiler pass. Expected identical (type-only, erased); if svelte-check
   objects, fall back to declaring `DocRow` in the instance script and re-exporting a type alias
   from the module block.
2. **`$state(initiallyOpen)` warning-free under svelte-check** — the initial-value-from-prop
   pattern is documented Svelte 5 usage; not compiled here. If a `state_referenced_locally`-class
   warning appears, silence with the documented `$state.snapshot`-free initializer comment or an
   explicit `// svelte-ignore` with rationale.
3. **Visual equivalence of the B5 fix** — argued from the flex model (§5.1), not measured; no
   automated oracle exists for the page. Manual checklist item 10 is the verification.
4. **Reachability of "generating with report"** (matrix row 4) — carried defensively from the
   authoritative plan's could-not-verify item 3; M1's `!report` gate makes it safe either way.
5. **Practical reachability of the denied state for an internal user** — under D1 firm-wide
   access, `null` fires only for unauthenticated callers (page redirects first) or a deleted
   project (§3.1). The state is contract-correct but hard to hit; manual checklist 8 describes
   the simulation.
6. **Convex insights impact of M1's two extra collapsed-panel subscriptions during generation**
   — bounded reads argued in §7; actual load unmeasured until step 16 ships (ticket §12 says
   watch insights).
7. **Whether the header's `· N failed` span needs a `text-red-600` token audit** — `red-600` is
   stock Tailwind already used for destructive affordances in this file (`:388`) and the badge
   spec (`bg-red-50 text-red-600`, ticket §8 table); not re-checked against the full
   design-system doc this pass (authoritative could-not-verify 7 applies).
