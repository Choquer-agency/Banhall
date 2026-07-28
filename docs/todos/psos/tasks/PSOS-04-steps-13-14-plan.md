# PSOS-04 — detailed implementation plan for steps 13 and 14

*Written 2026-07-27. Companion to [`PSOS-04-implementation-plan.md`](./PSOS-04-implementation-plan.md)
(the authoritative plan, steps 6–19) and [`PSOS-04.md`](./PSOS-04.md). Every file:line below was
verified against the working tree at time of writing (316 tests + 6 component tests green,
`npm run check` 0 errors). No source file was modified by this pass.*

**Scope.** Step 13 (row builder + receipt components + component tests + styleguide) and
step 14 (the a11y/keyboard suite, resolution (d) assertions 16–23 — the automated oracle for
AC5, funded by human DECISION 3). Implements the ticket's §8 APIs verbatim plus Amendment E's
deltas — nothing here re-litigates them. Every deviation from the ticket's §8/§9 wording or the
authoritative plan is flagged loudly in §10.

---

## 1. Summary table

| Sub-step | Files | Done means | Verification |
|---|---|---|---|
| **13a** — summary-clause copy | `src/lib/uploads/processingStatus.ts`, `processingStatus.test.ts` | `SUMMARY_CLAUSE: Record<ReceiptStatus, string>` + `SUMMARY_LOADING_CLAUSE` exported from the one copy module; banned-substring test extended over them | `npx vitest run src/lib/uploads/processingStatus.test.ts` |
| **13b** — row builder | `src/lib/uploads/receiptRows.ts` (new) + `receiptRows.test.ts` (new) | `ReceiptRow`, `buildReceiptRows`, `summarizeReceipt` per §3 below; AC1–AC4 encoded as data tests; exclusion/dedup/flags/ordering/archived tests pass | `npx vitest run src/lib/uploads/receiptRows.test.ts` |
| **13c** — Button `danger-ghost` variant | `src/lib/components/ui/Button.svelte` | One additive entry in `variantStyles`; existing variants byte-identical | `npm run check` · existing suites green |
| **13d** — components | `src/lib/components/upload/UploadReceiptRow.svelte` (new), `UploadReceipt.svelte` (new) | Presentational only (no `convex-svelte`/`$app`/`$env` import); markup per §5; aria-live region present | `grep -L 'convex-svelte\|\$app/\|\$env/' src/lib/components/upload/*.svelte` lists all files · `npm run check` |
| **13e** — component tests | `UploadReceiptRow.component.test.ts` (new), `UploadReceipt.component.test.ts` (new) | Resolution (d) assertions 6–15 pass in headless Chromium | `npm run test:component` |
| **13f** — styleguide specimens | `src/routes/styleguide/+page.svelte` | Full mixed receipt (6 statuses + loading), empty, denied, busy-row specimens render | `curl -s -o /dev/null -w "%{http_code}" localhost:3001/styleguide` → 200 |
| **14** — a11y/keyboard suite | `src/lib/components/upload/UploadReceipt.a11y.component.test.ts` (new) | Resolution (d) assertions 16–23 pass, incl. the pinned tab-order list (§7.2) and CDP-emulated reduced motion | `npm run test:component` (attach output as AC5 evidence) |

Standing gate after each sub-step: `npm run check` · `npx tsc --noEmit -p convex/tsconfig.json` ·
`npm run test` · `npm run test:component`. **No Convex file changes in steps 13–14** — the server
surface is complete and frozen (steps 1–5, 7).

---

## 2. Verified current state (the facts this plan is built on)

**Server payload shapes (read, not assumed):**

- `listDocuments` returns per row `{_id, fileName, fileType, source, category, createdAt,
  sizeChars, hasFile, mimeType, url, archived, processingStatus, processingDetail}` —
  `convex/documents.ts:182–196`. `processingStatus` is always present (read-time fallback
  `deriveStoredProcessing` at `:179–181`), `processingDetail` may be `null` (`:180`).
- `listUploadAttempts` returns per row `{attemptKey, fileName, fileSizeBytes, origin,
  failureCode, createdAt, displayStatus}` — `convex/uploadAttempts.ts:158–172`. Filtered to
  `in_progress | failed` before projection (`:157`). `displayStatus` is `"failed"` for stale
  `in_progress` (`:168–171`).
- **`listUploadAttempts` does NOT return `documentId` — and structurally cannot need to.**
  `documentId` is written only by `resolveUploadAttempt`, in the same patch as
  `status: "succeeded"` (`convex/lib/uploadAttempts.ts:115–119`), and `succeeded` rows are
  excluded by the list filter (`convex/uploadAttempts.ts:157`). So no attempt that reaches the
  client can carry a `documentId`. **The authoritative plan's "drops any attempt whose
  `documentId` appears in docs" belt-and-braces rule is vacuous against today's server** —
  the server-side exclusion already IS the invariant ("a file never shows twice" enforced at
  the data layer, `:141–144`). The builder keeps the guard anyway (§3) because it costs one
  `Set.has` and protects against a future projection widening or a stale cached payload; the
  ticket's §10 test for it constructs the input shape directly.
- Status/derivation types: `PROCESSING_STATUSES`, `PROCESSING_DETAILS`, `ProcessingStatus`,
  `ReceiptStatus` (= `ProcessingStatus | "upload_failed"`), `ProcessingDetail` —
  `shared/documentStatus.ts:109–140`. `SUPPORTED_ACCEPT` at `:47–48`.

**Copy module:** `src/lib/uploads/processingStatus.ts` — `PROCESSING_STATUS_COPY`
(`Record<ReceiptStatus, {label, explanation, action}>`, `:34–75`), `LOADING_COPY` (`:78–80`),
`DENIED_COPY` (`:87–90`), `statusLabel` (`:92–94`), `statusAction(status, canRetry)` (`:96–102`).
The §9 defence "all user copy comes from one static map in this file" (`PSOS-04.md:437`) is why
sub-step 13a puts the summary clause nouns here, not in `receiptRows.ts`.

**Badge:** `ProcessingStatusBadge.svelte` props `{status: ReceiptStatus | null, size?}`
(`:15–18`); `null` renders `Spinner` (`role="status"`, `Spinner.svelte` bottom) + "Reading…"
with `motion-reduce:animate-none` (`ProcessingStatusBadge.svelte:41–42`); icons `aria-hidden`
(`:44` etc.). Already component-tested (6 tests).

**Button** (`src/lib/components/ui/Button.svelte`): variants
`primary | primary-outline | secondary | ghost | link` (`:4`), sizes `md | sm` (`:25`), spreads
`HTMLButtonAttributes` (`:25,30`). Base classes at `:29` include
`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2` and
`disabled:pointer-events-none disabled:opacity-50`. Two facts that shape §5:

1. **No variant reaches 44px tall.** `md` = `py-2.5` (10px×2) + `text-sm` line-height 20px =
   40px; `sm` = 36px. Every receipt action therefore carries `class="min-h-11"` — safe because
   `class` is appended last (`:29`) and nothing in the base sets a `min-h`.
2. **There is no destructive variant, and class-override is unsafe.** Classes merge by string
   concatenation (`:29`), not `cn`/tailwind-merge, so passing `hover:bg-red-50` alongside
   `ghost`'s `hover:bg-primary-wash` (`:14`) leaves both classes in the attribute and CSS
   source order decides — fragile. Design rule 9 ("Destructive hovers stay red",
   `docs/design-system.md:89–90`) therefore needs one additive variant (sub-step 13c, §5.1).

**Focus rings are safe for buttons:** `src/routes/layout.css:238–243` kills focus rings for
`input, textarea, select` only; `Button.svelte:29` supplies the ring. Re-verified this pass.

**`sr-only` exists:** Tailwind v4 built-in, already used 7× in the app (e.g.
`src/lib/components/editor/Editor.svelte:1267`, `CommentInput.svelte:72`). No custom utility
needed for the aria-live region or the hidden file input's label.

**Archived rendering today:** `FilesPanel.svelte:306` (`opacity-60` on the `<li>`), `:312–318`
("Archived" pill), `:321` ("· excluded from AI"). This is the contradiction Amendment E/N2
resolves: a "Ready for AI" badge beside "excluded from AI" would be a lie (§4).

**Harness facts (verified in `node_modules`, not from memory):**

- `vitest-browser-svelte@3.0.0`: `render()` **returns a Promise**; `unmount()` is **async**;
  `rerender(props: Partial<Props>): Promise<void>` — `dist/pure.d.mts` (RenderResult
  interface) and `@testing-library/svelte-core/types.d.ts:89–91`. The existing badge test
  (`ProcessingStatusBadge.component.test.ts:17,21`) already awaits both; steps 13–14 must too.
- Interactivity imports come from `vitest/browser` (the deprecated `@vitest/browser/context`
  path re-exports the same module — `node_modules/vitest/browser/context.d.ts`):
  `userEvent.tab(options?)` exists (`@vitest/browser/context.d.ts:308`), `userEvent.upload`
  (`:330`), `userEvent.keyboard` (`:274–276`), `page.viewport(width, height)` (`:816`),
  `cdp(): CDPSession` (`:942`).
- With the playwright provider, `CDPSession` is augmented to
  `Pick<playwright.CDPSession, "send" | "on" | "off" | "once">`
  (`@vitest/browser-playwright/dist/index.d.ts:106,120`), so
  `cdp().send("Emulation.setEmulatedMedia", …)` typechecks. The provider also accepts
  `contextOptions` (playwright `BrowserContextOptions`, which includes `reducedMotion`) —
  `dist/index.d.ts:24–28` — the documented fallback if per-test CDP emulation misbehaves (§7.3).
- **Programmatic `.focus()` does not match `:focus-visible`** — found by the step-6 probe
  (work log, `PSOS-04.md:556`). Every focus-ring assertion in §7 uses real `userEvent.tab()`.
- `vitest.component.config.ts` aliases only `$lib` and deliberately excludes `sveltekit()`;
  components under test must not import `$app`/`$env`/`convex-svelte`. Type-only imports of
  `Id<…>` from `convex/_generated/dataModel` are erased at compile and are fine (precedent:
  the badge imports types from `shared/documentStatus` and its suite is green).
- `src/lib/test/component-setup.ts` imports `src/routes/layout.css`, so geometry/computed-style
  assertions test real CSS. `divide-line-soft` resolves (`--color-line-soft`,
  `layout.css:48`; already used at `styleguide/+page.svelte:179`).

**Consumers this step must serve (context, not scope):** step 15 composes
`buildReceiptRows(documents, attempts, [])` for `FilesPanel`; step 17 composes
`buildReceiptRows([], [], ephemeral)` for the live chat receipt. Step 13 wires **no consumer**
— styleguide is the only render site until step 15.

---

## 3. `receiptRows.ts` — exact module source sketch

```ts
// src/lib/uploads/receiptRows.ts
//
// PSOS-04: the pure seam between the two server queries (+ the chat panel's
// in-session entries) and the receipt UI. No Svelte, no Convex client — the
// AC1–AC4 acceptance scenarios are data tests over these two functions.
import type { Id } from "../../../convex/_generated/dataModel"; // type-only: erased
import type {
  ProcessingDetail,
  ProcessingStatus,
  ReceiptStatus,
} from "../../../shared/documentStatus";
import { SUMMARY_CLAUSE, SUMMARY_LOADING_CLAUSE } from "./processingStatus";

/**
 * Structural subset of one `listDocuments` row (convex/documents.ts:182–196).
 * The real payload is wider (fileType, source, category, hasFile, mimeType,
 * url); structural typing means it satisfies this without adaptation.
 */
export type ListedDocument = {
  _id: Id<"projectDocuments">;
  fileName: string;
  createdAt: number;
  sizeChars: number;
  archived: boolean;
  processingStatus: ProcessingStatus;
  processingDetail: ProcessingDetail | null;
};

/**
 * Structural match for one `listUploadAttempts` row
 * (convex/uploadAttempts.ts:158–172).
 *
 * `documentId` is NOT in today's projection and cannot be for a listed row:
 * it is only ever written together with status "succeeded"
 * (convex/lib/uploadAttempts.ts:115–119), which the list query excludes
 * (convex/uploadAttempts.ts:157). It is accepted here optionally so the
 * belt-and-braces drop below stays alive if the projection ever widens.
 */
export type ListedAttempt = {
  attemptKey: string;
  fileName: string;
  fileSizeBytes: number | null;
  createdAt: number;
  displayStatus: "in_progress" | "failed";
  documentId?: Id<"projectDocuments"> | null;
};

/**
 * One in-session upload the chat panel is tracking (step 17). `attemptKey` is
 * always present — the wiring generates one UUID per file before any work
 * (AgentChatPanel.svelte:516). `hasFile` reports whether the session still
 * holds the `File` object (resolution (e): the map is keyed by attemptKey).
 */
export type EphemeralEntry = {
  attemptKey: string;
  fileName: string;
  fileSizeBytes?: number;
  /** null while storage/parse/upload are in flight. */
  status: ReceiptStatus | null;
  detail?: ProcessingDetail | null;
  documentId?: Id<"projectDocuments"> | null;
  hasFile: boolean;
};

export type ReceiptRow = {
  key: string;                          // see key derivation below
  fileName: string;
  documentId?: Id<"projectDocuments">;  // present ⇒ a document row exists
  attemptKey?: string;                  // present ⇒ attempt-backed (server or ephemeral)
  status: ReceiptStatus | null;         // null ⇒ in flight (loading row)
  detail?: ProcessingDetail | null;
  archived?: boolean;                   // Amendment E: suppresses badge + copy
  sizeChars?: number;
  fileSizeBytes?: number;
  createdAt?: number;
  canRetry: boolean;                    // true only while this session holds the File
  canReplace: boolean;
  canRemove: boolean;
};

export function buildReceiptRows(
  docs: ListedDocument[],
  attempts: ListedAttempt[],
  ephemeral: EphemeralEntry[]
): ReceiptRow[] { /* algorithm below */ }

export function summarizeReceipt(rows: ReceiptRow[]): string { /* §3.3 */ }
```

### 3.1 `buildReceiptRows` — merge algorithm (implement literally)

1. `const docIds = new Set(docs.map((d) => d._id))`;
   `const ephemeralKeys = new Set(ephemeral.map((e) => e.attemptKey))`.
2. **Ephemeral rows first, in input order** (the live receipt shows the batch in the order the
   user chose the files). Drop an entry whose `documentId` is in `docIds` (belt-and-braces —
   the chat surface passes no docs today, so this is inert there). Map to:
   - `key: "local:" + e.attemptKey`
   - `status: e.status`, `detail: e.detail ?? null`, `documentId`/`fileSizeBytes` carried
   - `canRetry: e.status === "upload_failed" && e.hasFile`
   - `canReplace: e.status === "upload_failed" && !e.hasFile` (degenerate in practice —
     DECISION 2's two paths fall out of the one `hasFile` predicate; a row offering Retry
     never offers Replace, resolution (e))
   - `canRemove: e.status === "upload_failed" || e.status === "skipped_unsupported"` —
     exactly the rows that put **nothing** in the project; removing them removes noise.
     Rows that DID persist a document (`ready`, `could_not_read`, …) are managed through the
     Files panel's existing archive/delete flow, not the live receipt (§4 "Remove" design).
3. **Attempt rows next, in input order** (the query already delivers newest-first,
   `convex/uploadAttempts.ts:153`). Drop an attempt when:
   - `ephemeralKeys.has(a.attemptKey)` — the in-session entry is fresher and holds the File; or
   - `a.documentId != null && docIds.has(a.documentId)` — vacuous today (§2), kept as armour; or
   - `a.displayStatus !== "failed" && a.displayStatus !== "in_progress"` — a runtime guard
     duplicating the type constraint, so the ticket-§10 "excludes succeeded/dismissed" test is
     a runtime test, not a type-level tautology.
   Map to:
   - `key: "attempt:" + a.attemptKey`
   - `displayStatus === "in_progress"` → `status: null` (the per-file loading row, ticket §4),
     all three flags false;
   - `displayStatus === "failed"` → `status: "upload_failed"`, `canRetry: false`,
     `canReplace: true`, `canRemove: true` (DECISION 2 after-reload degradation).
4. **Document rows last, in input order** (query delivers newest-first,
   `convex/documents.ts:170`). Map to:
   - `key: d._id` (Convex ids and the prefixed keys cannot collide; prefixes make it structural)
   - `status: d.processingStatus`, `detail: d.processingDetail`, `archived: d.archived`,
     `sizeChars`, `createdAt` carried
   - `canRetry: false`
   - `canReplace: !d.archived && (d.processingStatus === "reference_only" ||
     d.processingStatus === "could_not_read" || d.processingStatus === "skipped_unsupported")`
     — see §10 flag F2 for the "non-`ready`" interpretation (deliberately excludes
     `ready_truncated`: its §9 action is "split the file", and a Replace that deletes the old
     row would destroy the part that WAS captured)
   - `canRemove: true` (routes to the existing archive/delete confirmation flow in step 18;
     rendering surfaces may simply not pass `onRemove` for doc rows — the flag states
     capability, the callback prop states intent).

**Ordering, stated plainly (the ticket is silent — decided here, flag F3):** the user sees
ephemeral in-flight/failed work first, then server-recorded failures, then documents (each
group newest-first as delivered). On the persistent panel this puts every failure above the
document list — the "one obvious next action" rule (`docs/product-domain.md`, cross-cutting
UI rule) applied to a mixed list. The builder never re-sorts inside a group, so Svelte keyed
each-blocks stay stable across live status transitions (assertion 12).

**Key derivation + collision avoidance:** three disjoint namespaces — `d._id` raw,
`"attempt:" + attemptKey`, `"local:" + attemptKey`. The same `attemptKey` can legitimately
exist as both an ephemeral entry and a server attempt row (begin recorded, then failed); rule 3
drops the server row, so the pair never co-renders even transiently. §10 flag F1 records the
delta from the ticket's `local:${i}:${name}` sketch.

### 3.2 Flag truth table (the §10 test fixture)

| Row provenance | status | canRetry | canReplace | canRemove |
|---|---|---|---|---|
| ephemeral, in flight | `null` | ✗ | ✗ | ✗ |
| ephemeral, failed, File held | `upload_failed` | ✔ | ✗ | ✔ |
| ephemeral, failed, File gone | `upload_failed` | ✗ | ✔ | ✔ |
| ephemeral, input-rejected | `skipped_unsupported` | ✗ | ✗ | ✔ |
| ephemeral, stored (any ready/could_not_read/reference_only) | as derived | ✗ | ✗ | ✗ |
| attempt, fresh `in_progress` | `null` | ✗ | ✗ | ✗ |
| attempt, `failed` (incl. stale-derived) | `upload_failed` | ✗ | ✔ | ✔ |
| document, `ready` / `ready_truncated` | as stored | ✗ | ✗ | ✔ |
| document, `reference_only` / `could_not_read` / `skipped_unsupported` | as stored | ✗ | ✔ | ✔ |
| document, archived (any status) | as stored, `archived: true` | ✗ | ✗ | ✔ |

### 3.3 `summarizeReceipt` — exact output contract

Target string (ticket §5/UX line, verbatim): `"6 files: 4 ready, 1 reference only, 1 failed"`.

- **Archived rows are skipped entirely** — not counted in the file total, not in any clause.
  Counting an archived document as "ready" would re-create the N2 contradiction in text form.
- `0` countable rows → `""` (empty string). `UploadReceipt` renders `emptyMessage` and no
  summary line (assertion 10); the aria-live region carries the empty string harmlessly.
- Head: `${n} ${n === 1 ? "file" : "files"}: ` — the only pluralised word.
- Clauses in **fixed canonical order**, zero counts omitted, joined with `", "`:

  | status | clause noun (from `SUMMARY_CLAUSE`, sub-step 13a) |
  |---|---|
  | `ready` | `ready` |
  | `ready_truncated` | `truncated` |
  | `reference_only` | `reference only` |
  | `could_not_read` | `unreadable` |
  | `skipped_unsupported` | `skipped` |
  | `upload_failed` | `failed` |
  | `null` (in flight) | `still reading` (`SUMMARY_LOADING_CLAUSE`) |

  Clause counts are not pluralised (`"2 failed"`, `"3 ready"` — the nouns are adjectival).
  **`ready_truncated` gets its own clause** — folding it into "ready" would make the summary
  contradict the row badge AC2 exists to surface. The ticket example contains no truncated
  file, so this adds no drift to the pinned string (§10 flag F4).
- One row: `"1 file: 1 ready"`.
- The clause nouns live in `src/lib/uploads/processingStatus.ts` (the single copy module, §9
  defence 3) as `SUMMARY_CLAUSE: Record<ReceiptStatus, string>` + `SUMMARY_LOADING_CLAUSE`,
  and the existing banned-substring test extends over them. `receiptRows.ts` only assembles
  numbers around imported nouns (§10 flag F5).

Implementation sketch:

```ts
const CLAUSE_ORDER: (ReceiptStatus | null)[] = [
  "ready", "ready_truncated", "reference_only",
  "could_not_read", "skipped_unsupported", "upload_failed", null,
];

export function summarizeReceipt(rows: ReceiptRow[]): string {
  const counted = rows.filter((r) => !r.archived);
  if (counted.length === 0) return "";
  const counts = new Map<ReceiptStatus | null, number>();
  for (const r of counted) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
  const clauses = CLAUSE_ORDER.filter((s) => counts.has(s)).map((s) => {
    const noun = s === null ? SUMMARY_LOADING_CLAUSE : SUMMARY_CLAUSE[s];
    return `${counts.get(s)} ${noun}`;
  });
  return `${counted.length} ${counted.length === 1 ? "file" : "files"}: ${clauses.join(", ")}`;
}
```

---

## 4. Archived rows (Amendment E / N2) — exact behaviour

`buildReceiptRows` **does not null the status** (null means loading) — it carries
`archived: true` and the truthful stored status on the row. Suppression is the row component's
job, in one place:

- `UploadReceiptRow` with `row.archived`: renders **no `ProcessingStatusBadge`**, **no
  explanation/action copy**, no Retry/Replace controls; the row keeps the muted treatment the
  panel already uses (`opacity-60`, matching `FilesPanel.svelte:306`) and shows a plain
  `Archived` pill in the badge slot (same visual as `FilesPanel.svelte:312–318`) so the slot
  is not just blank. What the user reads: file name, "Archived", date — consistent with the
  existing "· excluded from AI" line, contradicting nothing.
- `summarizeReceipt` skips archived rows entirely (§3.3).
- Component test 13 (§6) asserts the absence of the status label text on an archived row;
  a companion assertion pins the `Archived` pill text so the suppression can't decay into an
  empty confusing row.

---

## 5. Components — prop APIs and markup skeletons (Svelte 5 runes)

### 5.1 Button: one additive variant (sub-step 13c)

```ts
// Button.svelte — variantStyles gains one entry; nothing else changes
"danger-ghost":
  "border border-transparent text-red-600 hover:bg-red-50 hover:text-red-700 focus-visible:ring-red-500",
```

Why not class-override: §2 (string concat, not cn-merge — conflicting `hover:bg-*` utilities
would be resolved by stylesheet order, silently). Why not `IconAction`: resolution (d) N7 —
no focus ring (`IconAction.svelte:21–22`), bare `title=` (`:33/:36`), both design-rule
violations. Remove is the only destructive receipt action and uses this variant; Retry and
"Replace file…" use `variant="ghost"`. All three carry `class="min-h-11"` (§2: no stock
variant reaches 44px). Flagged as F6 in §10 — it is a shared-primitive touch, additive-only.

### 5.2 `UploadReceiptRow.svelte`

```svelte
<script lang="ts">
  import { SUPPORTED_ACCEPT } from "../../../../shared/documentStatus";
  import { PROCESSING_STATUS_COPY, statusAction } from "$lib/uploads/processingStatus";
  import type { ReceiptRow } from "$lib/uploads/receiptRows";
  import ProcessingStatusBadge from "./ProcessingStatusBadge.svelte";
  import Button from "../ui/Button.svelte";

  let {
    row,
    busy = false,
    onRetry,
    onReplace,
    onRemove,
  }: {
    row: ReceiptRow;
    busy?: boolean;
    onRetry?: (row: ReceiptRow) => void | Promise<void>;
    onReplace?: (row: ReceiptRow, file: File) => void | Promise<void>;
    onRemove?: (row: ReceiptRow) => void | Promise<void>;
  } = $props();

  let fileInput: HTMLInputElement | null = $state(null);

  const explanation = $derived(
    row.archived || row.status === null || row.status === "ready"
      ? null
      : PROCESSING_STATUS_COPY[row.status].explanation
  );
  const action = $derived(
    row.archived || row.status === null || row.status === "ready"
      ? null
      : statusAction(row.status, row.canRetry)
  );

  function handlePick(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (file && onReplace) onReplace(row, file);
    if (fileInput) fileInput.value = ""; // same file can be picked twice
  }
</script>

<li
  class={`flex min-h-11 items-start gap-3 py-2.5 transition-colors hover:bg-primary-wash ${row.archived ? "opacity-60" : ""}`}
>
  <div class="min-w-0 flex-1">
    <div class="flex items-center gap-2">
      <p class="text-body truncate">{row.fileName}</p>
      {#if row.archived}
        <span class="flex-shrink-0 rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-medium text-gray-500">
          Archived
        </span>
      {:else}
        <ProcessingStatusBadge status={row.status} />
      {/if}
    </div>
    {#if explanation}
      <p class="mt-0.5 text-xs text-ink-muted">
        {explanation}{action ? ` ${action}` : ""}
      </p>
    {/if}
    {#if row.createdAt}
      <p class="text-data text-ink-muted">{new Date(row.createdAt).toLocaleDateString()}</p>
    {/if}
  </div>

  {#if row.canRetry && onRetry}
    <Button variant="ghost" size="sm" class="min-h-11" disabled={busy} aria-busy={busy}
      aria-label={`Retry — ${row.fileName}`} onclick={() => onRetry(row)}>Retry</Button>
  {/if}
  {#if row.canReplace && onReplace}
    <Button variant="ghost" size="sm" class="min-h-11" disabled={busy} aria-busy={busy}
      aria-label={`Replace file… — ${row.fileName}`} onclick={() => fileInput?.click()}>
      Replace file…
    </Button>
    <input
      bind:this={fileInput}
      type="file"
      class="hidden"
      tabindex={-1}
      aria-hidden="true"
      accept={SUPPORTED_ACCEPT}
      onchange={handlePick}
    />
  {/if}
  {#if row.canRemove && onRemove}
    <Button variant="danger-ghost" size="sm" class="min-h-11" disabled={busy} aria-busy={busy}
      aria-label={`Remove — ${row.fileName}`} onclick={() => onRemove(row)}>Remove</Button>
  {/if}
</li>
```

Notes, each verified:

- **Every action is a text `Button`** (N7); accessible names embed the file name so four
  "Remove" buttons in a list are distinguishable to a screen reader, while containing the
  visible label verbatim (WCAG 2.5.3 label-in-name holds).
- **The file input is `class="hidden"` + `tabindex={-1}` + `aria-hidden="true"`** — 0×0 by
  design, excluded from geometry (N8) and from the tab order; a `display:none` file input
  still opens the picker from a programmatic `.click()` in Chromium. `sr-only` was rejected
  for it deliberately: an sr-only element is 1×1 and still in the a11y tree, which would trip
  assertions 19/21.
- Explanation + action render as one always-visible second line for non-`ready` statuses
  (ticket §8, `PSOS-04.md:422`) — no hover, no disclosure. `ready_truncated` is "non-ready"
  for copy purposes (it has §9 explanation + action) even though it gets no Replace control.
- Busy rows: `disabled` + `aria-busy` on each control; `disabled:pointer-events-none` +
  the native `disabled` semantics make the no-callback-on-click assertion (8) hold.
- The 300ms bare `transition-colors` follows design rule 8; hover fill is `primary-wash`
  (rule 9); destructive hover is red via the variant.

### 5.3 `UploadReceipt.svelte`

```svelte
<script lang="ts">
  import { SvelteSet } from "svelte/reactivity";
  import { DENIED_COPY } from "$lib/uploads/processingStatus";
  import { summarizeReceipt, type ReceiptRow } from "$lib/uploads/receiptRows";
  import UploadReceiptRow from "./UploadReceiptRow.svelte";

  let {
    rows,
    heading = "Processing receipt",
    busy = new SvelteSet<string>(),
    emptyMessage = "No files yet.",
    denied = false,
    onRetry,
    onReplace,
    onRemove,
  }: {
    rows: ReceiptRow[];
    heading?: string;
    busy?: ReadonlySet<string>;
    emptyMessage?: string;
    denied?: boolean;
    onRetry?: (row: ReceiptRow) => void | Promise<void>;
    onReplace?: (row: ReceiptRow, file: File) => void | Promise<void>;
    onRemove?: (row: ReceiptRow) => void | Promise<void>;
  } = $props();

  const summary = $derived(denied ? "" : summarizeReceipt(rows));
</script>

<section aria-label={heading}>
  <div class="flex items-baseline justify-between gap-3">
    <h3 class="text-label">{heading}</h3>
    {#if !denied && rows.length > 0 && summary}
      <p class="text-data text-ink-muted">{summary}</p>
    {/if}
  </div>

  <!--
    Amendment E / N9: rows transition null → status asynchronously; without a
    live region a screen-reader user hears nothing when a file finishes or
    fails. The region is ALWAYS mounted (live regions must pre-exist in the DOM
    to announce reliably); its text is the same summarizeReceipt string.
  -->
  <p class="sr-only" aria-live="polite">{summary}</p>

  {#if denied}
    <p class="mt-2 text-sm text-ink-muted">{DENIED_COPY.explanation}</p>
  {:else if rows.length === 0}
    <p class="mt-2 text-sm text-ink-muted">{emptyMessage}</p>
  {:else}
    <ul class="divide-y divide-line-soft">
      {#each rows as row (row.key)}
        <UploadReceiptRow {row} busy={busy.has(row.key)} {onRetry} {onReplace} {onRemove} />
      {/each}
    </ul>
  {/if}
</section>
```

Notes:

- Props are the ticket's §8 block verbatim (`PSOS-04.md:392–404`) plus two Amendment E
  additions: the aria-live region and `denied?: boolean` (the Amendment C denied state must be
  renderable by a presentational component — the panel passes `denied={attemptsQ.data === null}`
  in step 15). The visible summary is plain (no `aria-live`) so it never double-announces.
- `busy` is typed `ReadonlySet<string>` — a `SvelteSet` (repo idiom,
  `dashboard/+page.svelte:16,97`) satisfies it and callers get reactivity; the component only
  reads `.has`.
- **Presentational contract (enforced by done-check):** no `convex-svelte`, `$app/*`, `$env/*`
  imports in any of the three upload components —
  `grep -l 'convex-svelte\|\$app/\|\$env/' src/lib/components/upload/*.svelte` must print
  nothing.

### 5.4 Styleguide specimens (sub-step 13f)

Follow the file's existing section conventions (`<h2 class="text-label mt-12">` + `.card mt-3`,
as at `styleguide/+page.svelte:172–195`). One "Upload receipt" section with four specimens,
all fed by literal `ReceiptRow[]` fixtures (no builder, no queries):

1. Mixed receipt — 7 rows: all six statuses + one loading row; the summary line renders.
2. Empty (`rows={[]}`) — shows `emptyMessage`.
3. Denied (`denied`) — shows the permission copy.
4. Busy — one failed row whose key is in `busy`, controls disabled.

---

## 6. Step 13 test lists

### 6.1 `src/lib/uploads/receiptRows.test.ts` (node project — runs in `npm run test`)

Fixture helpers `doc(over?)`, `attempt(over?)`, `eph(over?)` returning the §3 input shapes
(ids as `"d1" as Id<"projectDocuments">` — convex-test style casts, precedent throughout
`convex/*.test.ts`).

**Builder mechanics:**
1. Merges the three sources; output keys are unique and prefixed (`local:`/`attempt:`/raw id).
2. Excludes `succeeded`/`dismissed` attempt payloads (cast through the runtime guard, ticket
   §10) — only `in_progress`/`failed` survive.
3. Drops a server attempt whose `attemptKey` has an ephemeral entry — one row, the ephemeral
   one (holds `canRetry`).
4. Drops an attempt carrying a `documentId` present in docs (belt-and-braces; input built by
   hand since today's server cannot emit it — documented in the test).
5. Drops an ephemeral entry whose `documentId` is in docs.
6. Fresh `in_progress` attempt → `status: null`, all flags false; `failed` attempt →
   `upload_failed`, `canReplace`/`canRemove` true, `canRetry` false.
7. Flag truth table (§3.2) — one assertion per row of the table.
8. Ordering: ephemeral (input order) → attempts → docs; no re-sorting within a group.
9. **Archived suppression (N2):** archived doc → `archived: true` on the row, `canReplace`
   false, and `summarizeReceipt` output counts it nowhere.

**`summarizeReceipt`:**
10. 6 mixed rows (4 `ready`, 1 `reference_only`, 1 `upload_failed`) → exactly
    `"6 files: 4 ready, 1 reference only, 1 failed"` (the ticket's pinned string).
11. Singular: one ready row → `"1 file: 1 ready"`.
12. Zero rows → `""`; zero counts omitted (no `"0 skipped"` ever).
13. Canonical clause order regardless of row order (ready, truncated, reference only,
    unreadable, skipped, failed, still reading).
14. Loading rows counted as `still reading`; `ready_truncated` reported as its own
    `truncated` clause, never folded into `ready`.

**The four acceptance scenarios as data tests (ticket §10, `PSOS-04.md:469`):**
15. **AC1 — mixed 4-file batch:** ephemeral entries for one `skipped_unsupported` (input-
    rejected), one `could_not_read` (stored, `documentId` set), two `ready` → exactly 4 rows,
    statuses in order, actions per the truth table (`canRemove` only on the skipped row;
    no Retry/Replace anywhere since nothing upload-failed). A second case adds an
    `upload_failed` + `hasFile` entry and asserts `canRetry` on it alone.
16. **AC2 — truncated:** doc row with `processingStatus: "ready_truncated"` → row status
    `ready_truncated`; `PROCESSING_STATUS_COPY.ready_truncated.explanation` (the copy the row
    will render) mentions the cut-off consequence; summary reports `1 truncated`.
17. **AC3 — persistence across reload:** rows rebuilt from `listDocuments`-shaped +
    `listUploadAttempts`-shaped payloads alone (empty ephemeral) reproduce identical statuses;
    every failed attempt degrades to `canRetry: false, canReplace: true` (DECISION 2); the row
    type carries no free-text field (statuses/details are enums by type — asserted by a
    runtime `PROCESSING_STATUSES`/`upload_failed` membership sweep over the output).
18. **AC4 — provenance distinction:** an `upload_failed` row (from attempts: `attemptKey`,
    no `documentId`) vs a `could_not_read` row (from docs: `documentId`, no `attemptKey`) —
    different statuses, different copy (via `statusLabel`), different provenance fields;
    the network failure is never conflated with the extraction failure.

### 6.2 `src/lib/uploads/processingStatus.test.ts` (extend, sub-step 13a)

19. `SUMMARY_CLAUSE` exhaustive over `ReceiptStatus` (compile-time `Record` + runtime loop);
    every clause + `SUMMARY_LOADING_CLAUSE` non-empty and passes the existing banned-substring
    regex.

### 6.3 `UploadReceiptRow.component.test.ts` (browser — resolution (d) 6–9)

All: `const r = await render(UploadReceiptRow, { row: …, … })` — awaited; `await unmount()`.
A `<ul>` wrapper is unnecessary for rendering an `<li>` in the harness (validation is not
enforced), but note the container child is the `<li>` itself.

- (6) For each non-`ready` status: explanation and action text present and
  `getComputedStyle(el).display !== "none"` — visible without interaction. `ready` renders no
  second line.
- (7) Controls match flags: `canRetry`→"Retry", `canReplace`→"Replace file…", `canRemove`→
  "Remove"; each negative case asserts the control is **absent** (`queryByRole`-equivalent:
  locator count 0 / `querySelector` null). Callbacks absent → control absent even when the
  flag is true.
- (8) `busy`: all rendered buttons have `disabled` and `aria-busy="true"`; native
  `btn.click()` (DOM API, not `userEvent` — playwright refuses to click disabled elements)
  invokes no spy.
- (9) Callbacks receive the row: click Retry → `onRetry(row)` with the exact object; for
  Replace, `await userEvent.upload(input, new File(["x"], "b.pdf"))` on the hidden input →
  `onReplace(row, file)` with the picked `File`. (The visible Replace button is not clicked in
  tests — in headless Chromium it would open a real picker dialog path; `userEvent.upload`
  drives the same `onchange`.) Also: `[title]` selector finds nothing in the row (N7 —
  no bare tooltips).

### 6.4 `UploadReceipt.component.test.ts` (browser — resolution (d) 10–15)

- (10) `rows={[]}` → `emptyMessage` rendered, zero `<li>`, no visible summary text.
- (11) The 6-row fixture → summary text is exactly
  `"6 files: 4 ready, 1 reference only, 1 failed"`.
- (12) Stable keys: render 3 rows, keep a reference to row 2's `<li>` element, `await
  rerender({ rows })` with row 2's status flipped `null → ready` — same element identity
  (updated in place), other rows untouched.
- (13) Archived row: no status label text in that row; the `Archived` pill text present.
- (14) `denied` → `DENIED_COPY.explanation` rendered; `emptyMessage` NOT rendered.
- (15) aria-live: a `[aria-live="polite"]` element exists on first render; after
  `rerender` with one row transitioned `null → could_not_read`, its `textContent` changed and
  contains the `unreadable` clause.

---

## 7. Step 14 — `UploadReceipt.a11y.component.test.ts` (resolution (d) 16–23)

### 7.1 Fixture

Literal `ReceiptRow[]` (no builder — the a11y suite pins markup, not merge logic), file names
chosen to make accessible names unique:

```ts
const ROWS: ReceiptRow[] = [
  { key: "d1", fileName: "notes.docx", documentId: "d1" as Id<"projectDocuments">,
    status: "ready", detail: "text_extracted", canRetry: false, canReplace: false, canRemove: true },
  { key: "d2", fileName: "scan.pdf", documentId: "d2" as Id<"projectDocuments">,
    status: "could_not_read", detail: "no_text_extracted", canRetry: false, canReplace: true, canRemove: true },
  { key: "local:a3", fileName: "budget.xlsx", attemptKey: "a3",
    status: "upload_failed", canRetry: true, canReplace: false, canRemove: true },
  { key: "attempt:a4", fileName: "minutes.pdf", attemptKey: "a4",
    status: "upload_failed", canRetry: false, canReplace: true, canRemove: true },
];
```

(The reduced-motion test appends a fifth `status: null` row so a live spinner exists to
assert against — §7.3.)

All spies passed (`onRetry`, `onReplace`, `onRemove`) so every flagged control renders.

### 7.2 Assertions 16–22 as runnable sketches

```ts
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { cdp, page, userEvent } from "vitest/browser";
import UploadReceipt from "./UploadReceipt.svelte";

const name = (el: Element) =>
  el.getAttribute("aria-label") ?? el.textContent?.trim() ?? "";
```

**(16) Tab order equals DOM order — pinned accessible-name list.** Real keyboard traversal
(`userEvent.tab()`, `@vitest/browser/context.d.ts:308`); programmatic `.focus()` is banned
(step-6 probe finding, `PSOS-04.md:556`).

```ts
const EXPECTED_TAB_ORDER = [
  "Remove — notes.docx",         // row 1: ready → Remove only
  "Replace file… — scan.pdf",    // row 2: could_not_read
  "Remove — scan.pdf",
  "Retry — budget.xlsx",         // row 3: upload_failed + canRetry
  "Remove — budget.xlsx",
  "Replace file… — minutes.pdf", // row 4: upload_failed + canReplace
  "Remove — minutes.pdf",
];

it("tab order equals DOM order", async () => {
  const { container } = await render(UploadReceipt, { rows: ROWS, onRetry, onReplace, onRemove });
  const visited: string[] = [];
  for (let i = 0; i < EXPECTED_TAB_ORDER.length; i++) {
    await userEvent.tab();
    const active = document.activeElement!;
    expect(container.contains(active), `stop ${i}`).toBe(true);
    visited.push(name(active));
  }
  expect(visited).toEqual(EXPECTED_TAB_ORDER);
  await userEvent.tab(); // one more: focus leaves the receipt
  expect(container.contains(document.activeElement)).toBe(false);
});
```

**(17) No positive tabindex:**
`[...container.querySelectorAll("[tabindex]")].every(el => Number(el.getAttribute("tabindex")) <= 0)`.

**(18) Focus ring visible on keyboard focus.** After each `userEvent.tab()` stop:
`active.matches(":focus-visible")` is true, and
`getComputedStyle(active)` has `outlineStyle !== "none"` **or** `boxShadow !== "none"` —
`Button.svelte:29` supplies `focus-visible:ring-2` (box-shadow); the `layout.css:238–243`
ring-kill applies only to `input/textarea/select`, so buttons are safe.

**(19) Accessible names.** Every visible interactive element (the 7 buttons) has a non-empty
computed name; the hidden file inputs are excluded by construction (`aria-hidden`,
`tabindex=-1`, `display:none`). Also assert `container.querySelectorAll("[title]").length === 0`.

**(20) Enter and Space both activate Retry exactly once each.**

```ts
// Tab to "Retry — budget.xlsx" (stop 4), then:
await userEvent.keyboard("{Enter}");
expect(onRetry).toHaveBeenCalledTimes(1);
await userEvent.keyboard(" ");
expect(onRetry).toHaveBeenCalledTimes(2);
expect(onRetry).toHaveBeenLastCalledWith(ROWS[2]);
```

(Native `<button>` semantics supply both keys; the assertion pins that no wrapper stole them.)

**(21) 44×44 measured at 375px (N8 caveat).**

```ts
await page.viewport(375, 812);
const controls = [...container.querySelectorAll("button")]; // the 7 visible Buttons
for (const el of controls) {
  const r = el.getBoundingClientRect();
  expect(r.height, name(el)).toBeGreaterThanOrEqual(44);
  expect(r.width, name(el)).toBeGreaterThanOrEqual(44);
}
// Hidden file inputs are 0×0 BY DESIGN and excluded from geometry entirely:
for (const input of container.querySelectorAll('input[type="file"]')) {
  expect(getComputedStyle(input).display).toBe("none");
}
```

**(22) Rows don't overlap or clip at 375px.**

```ts
const lis = [...container.querySelectorAll("li")].map(li => li.getBoundingClientRect());
for (let i = 1; i < lis.length; i++) {
  expect(lis[i].top).toBeGreaterThanOrEqual(lis[i - 1].bottom - 1); // divide-y hairline
}
for (const r of lis) {
  expect(r.left).toBeGreaterThanOrEqual(0);
  expect(r.right).toBeLessThanOrEqual(375);
}
```

### 7.3 Assertion 23 — reduced motion, exact emulation mechanism

There is **no `page.emulateMedia` in this harness** — verified against
`BrowserPage` (`@vitest/browser/context.d.ts:812–869`: `viewport`, `screenshot`, `mark`,
`extend`, `elementLocator`, `frameLocator` only). The supported route is CDP: `cdp()` is
exported from `vitest/browser` (`context.d.ts:942`) and, under the playwright provider, is a
playwright `CDPSession` (`send/on/off/once` — `@vitest/browser-playwright/dist/index.d.ts:106,120`),
Chromium-only, which this suite is (`vitest.component.config.ts` instances).

```ts
it("respects prefers-reduced-motion", async () => {
  const rows = [...ROWS, { key: "local:a5", fileName: "photo.png", attemptKey: "a5",
    status: null, canRetry: false, canReplace: false, canRemove: false }];
  const { container } = await render(UploadReceipt, { rows });

  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  // Guard: if the emulation did not reach this frame, fail HERE, loudly,
  // instead of vacuously passing the animation sweep below.
  expect(window.matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(true);

  for (const el of container.querySelectorAll("*")) {
    const s = getComputedStyle(el);
    // `motion-reduce:animate-none` must have zeroed every animation; anything
    // still named and running is a regression.
    expect(s.animationName, el.className).toBe("none");
  }

  await cdp().send("Emulation.setEmulatedMedia", { features: [] }); // restore
});
```

The fifth (loading) row guarantees a spinner is present, so the sweep proves suppression
rather than absence. The `matchMedia` guard converts the one unverifiable link (does the CDP
emulation reach the vitest test iframe — same-process, so it should; see §11.2) into a loud
failure. **Fallback if the guard fails in practice:** the provider accepts
`contextOptions: { reducedMotion: "reduce" }` (`@vitest/browser-playwright/dist/index.d.ts:24–28`,
playwright `BrowserContextOptions`) — move this one test into a tiny second config/instances
entry with that option. Do not silently skip the assertion; it is AC5-funded scope.

---

## 8. Risks

| Risk | Why real | Mitigation | Detect |
|---|---|---|---|
| CDP media emulation doesn't reach the test iframe | vitest runs tests in an iframe of the tester page; `Emulation.setEmulatedMedia` is per-target | Same-origin iframe = same renderer target, and the `matchMedia` guard fails loudly before the real assertion; documented `contextOptions.reducedMotion` fallback | Assertion 23's guard line |
| Clicking "Replace file…" in a test opens a native picker and hangs | Real Chromium, real `<input type=file>.click()` | Tests never activate Replace; `userEvent.upload` drives `onchange` directly (`context.d.ts:330`) | 13e test 9 green without timeout |
| Button height silently <44px | Stock `md` is 40px (§2) — the class is the only thing making 44 | `min-h-11` on every receipt Button + assertion 21 measures it | a11y suite |
| `danger-ghost` styling collides with base classes | String-concat class merging (§2) | The variant introduces only utilities absent from the base (`text-red-*`, `hover:bg-red-50`, `focus-visible:ring-red-500` — base sets no `ring-{color}`) | Visual check on styleguide; existing Button call sites unchanged (`npm run check`) |
| Summary copy drifts out of the copy module's leak test | Clause nouns are user copy but live outside `PROCESSING_STATUS_COPY` | Sub-step 13a puts them IN `processingStatus.ts` and extends the banned-substring test | 13a test |
| aria-live region announces nothing (inserted-with-content) | Live regions must exist before their first update | Region is unconditionally mounted from first render; assertion 15 pins text *change* on rerender | 13e test 15 |
| Keyed-each remount breaks assertion 12 | Unstable keys (the ticket's `local:${i}:${name}` sketch shifts on removal) | Keys are UUID-based (`local:${attemptKey}`) — flag F1 | 13e test 12 |
| `ReceiptRow` builder policies pre-empt step 15/17 wiring wrongly | Flags computed now, consumed two steps later | Truth table §3.2 is the contract; steps 15/17 plans consume it as written, and every interpretation is flagged in §10 for veto now | review of this plan |

## 9. Rollback, per sub-step

| Sub-step | Rollback | Residue |
|---|---|---|
| 13a | Remove the two exports + test block | None — nothing else imports them until 13b |
| 13b | Delete `receiptRows.ts` + test | None — no consumer until step 15 |
| 13c | Remove the one `variantStyles` entry | None — no call site until 13d |
| 13d | Delete both components | Styleguide section must go too (13f) |
| 13e | Delete both test files | Component states lose their oracle — re-opens part of DECISION 3's funded scope; needs human sign-off, same as step 14 |
| 13f | Delete the styleguide section | None |
| 14 | Delete the a11y file — **re-opens AC5 (DECISION 3): needs human sign-off** | AC5 loses its oracle |

---

## 10. Flagged deviations and decisions (read before implementing — veto here)

- **F1 (delta from ticket §8 sketch).** Ephemeral row keys are `local:${attemptKey}`, not the
  sketch's `local:${i}:${name}` (`PSOS-04.md:370`). Since step 10 landed, every ephemeral
  entry carries a UUID `attemptKey` (`AgentChatPanel.svelte:516`); index-based keys shift when
  a row is removed, remounting every later row (breaks assertion 12 and flashes the DOM).
  Strictly better, zero information lost.
- **F2 (interpretation of "non-`ready`" for document `canReplace`).** DECISION 2's log row
  (`PSOS-04.md:104`) says "failed attempts and non-`ready` documents offer Replace". Read
  literally, `ready_truncated ≠ ready` would offer Replace on a truncated row — but its §9
  action is "split the file and upload that section on its own" (`PSOS-04.md:442`), and
  step 18's Replace **deletes the old row**, destroying the text that WAS captured. This plan
  maps "non-`ready`" to the three AI-unusable statuses (`reference_only`, `could_not_read`,
  `skipped_unsupported`) and excludes both `ready*` statuses. §9 copy is preserved verbatim
  either way; only the button's presence is at stake. **Veto here if the literal reading was
  intended.**
- **F3 (ordering — ticket silent, decided here).** Ephemeral → attempts → documents, each in
  delivered order (newest-first from both queries). Failures render above documents on the
  persistent panel ("one obvious next action"). No builder re-sorting.
- **F4 (summary clauses — ticket example under-constrains).** `ready_truncated` gets its own
  `truncated` clause; `could_not_read` summarizes as `unreadable`; `skipped_unsupported` as
  `skipped`; loading rows as `still reading`; archived rows excluded from the summary
  entirely. The ticket's pinned string ("6 files: 4 ready, 1 reference only, 1 failed") is
  reproduced exactly by its own scenario and pinned in tests 10/11.
- **F5 (copy-module addition).** `SUMMARY_CLAUSE`/`SUMMARY_LOADING_CLAUSE` live in
  `processingStatus.ts` so §9's "all user copy comes from one static map in this file" defence
  (`PSOS-04.md:437`) stays true and the banned-substring test covers them. Small §9-consistent
  addition, not a wording change to the seven transcribed rows.
- **F6 (shared-primitive touch).** `Button.svelte` gains the additive `danger-ghost` variant
  (§5.1). Rationale: design rule 9 requires red destructive hovers; Button's string-concat
  class merge makes override-by-class unsound (§2); `IconAction` is banned (N7). Additive
  only — existing variants and every current call site are byte-identical. If this is judged
  scope expansion under queue rule 5, the fallback is `variant="ghost"` with default (gray)
  hover for Remove and a recorded design-rule deviation — worse, but contained.
- **F7 (`denied` prop).** Not in the ticket's §8 prop block; required so a purely
  presentational component can render Amendment C's denied state (the harness cannot mock
  `convex-svelte`, so the panel must pass the fact down). Copy already exists (`DENIED_COPY`,
  `processingStatus.ts:87–90`).
- **F8 (Remove semantics on ephemeral stored rows).** Live-receipt rows that persisted a
  document (`ready`, `could_not_read`, …) get `canRemove: false` — their lifecycle belongs to
  the Files panel's existing archive/delete confirmation flow (step 18 keeps it "untouched").
  Only rows representing nothing-in-the-project (`upload_failed`, `skipped_unsupported`) are
  removable from the live receipt (§4's "ephemeral rows just drop from local state").
- **F9 (documentId cross-check is vacuous today).** Verified: no listed attempt can carry
  `documentId` (§2). The guard is kept (cheap, future-proof) and its test constructs the
  widened shape by hand. This is a *finding about* the authoritative plan's belt-and-braces
  rule, not a change to it.
- **New scope under queue rule 5: none** beyond F5/F6's additive touches, both flagged above.
  No new dependencies, no config changes, no server changes.

## 11. What I could not verify — check before relying on it

1. **CDP emulation reaching the test iframe** (§7.3). Typed and exported
   (`context.d.ts:942`; playwright augmentation verified), and the step-6 probe's work-log
   claims "reduced-motion emulation works" (`PSOS-04.md:556`) — but the probe file was deleted
   in step 12 and never committed (git history has no `src/lib/test/Smoke.component.test.ts`),
   so the exact mechanism it used is unrecoverable. The `matchMedia` guard makes any gap loud;
   the `contextOptions.reducedMotion` fallback is specified.
2. **`:focus-visible` matching inside the vitest iframe after `userEvent.tab()`** — the probe
   reportedly proved this ("focus ring computes after keyboard focus", `PSOS-04.md:556`), but
   again the probe is gone. If tab() focuses but `:focus-visible` doesn't match, assertion 18
   fails honestly; do not swap in programmatic `.focus()` to make it pass.
3. **Accessible-name computation** in assertion 16 uses `aria-label ?? textContent` rather
   than a full AccName algorithm — adequate for these buttons (aria-label always set), but a
   markup change that drops the labels would degrade the assertion to trimmed text. The
   non-empty-name assertion (19) still holds either way.
4. **`toLocaleDateString()` stability across CI locales** for the row meta line — no test
   asserts the date string (deliberately), only presence. If a future test pins it, inject a
   formatter instead.
5. **Exact rendered height of the explanation line at 375px** for assertion 22's overlap
   epsilon (−1px for the `divide-y` hairline) — chosen from the CSS model, not measured; if
   Chromium sub-pixel rounding trips it, widen the epsilon with a comment, don't delete the
   assertion.
6. Whether step 15 will want an `origin`/`failureCode` passthrough on `ReceiptRow` (audit
   display). Not added — no §8/§9 copy consumes them; adding fields later is non-breaking.
