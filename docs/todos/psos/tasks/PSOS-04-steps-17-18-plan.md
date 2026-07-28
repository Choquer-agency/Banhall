# PSOS-04 — implementation plan for steps 17 and 18 (live chat receipt + Replace flows)

*Written 2026-07-27 on claude-fable-5. Companion to
[`PSOS-04-implementation-plan.md`](./PSOS-04-implementation-plan.md) (authoritative — steps
17/18 at :815–842, resolution (e) at :433–456) and to the step-13/14 and 15/16 plans (flags
F1–F9, D1–D6). Every file:line below was read this pass against the working tree. No source
file was modified by this pass. There is a hard ship deadline (tomorrow): this plan favours
the smallest implementation that satisfies AC1–AC5 and names everything it cuts (§8).*

**State verified before planning.** 346 `npm run test` + 33 component tests green per the
work log (`PSOS-04.md:553–559`). The components, pure modules, and server API this plan
consumes all exist and were read end-to-end:

| Consumed | Evidence |
|---|---|
| `UploadReceipt` props incl. `busy: ReadonlySet<string>` keyed on `row.key`, `onRetry/onReplace/onRemove`, always-mounted `aria-live` | `src/lib/components/upload/UploadReceipt.svelte:13–31, :50, :59` |
| `UploadReceiptRow` — Retry/Replace/Remove text Buttons, callback-gated; Replace already has the hidden `<input type=file>` + `handlePick` delivering `(row, file)` | `UploadReceiptRow.svelte:75–124, :41–47` |
| `buildReceiptRows(docs, attempts, ephemeral)`, `EphemeralEntry` (no `File` field; `hasFile` boolean), flag rules | `src/lib/uploads/receiptRows.ts:47–57, :93–170` |
| `canRetry = upload_failed && hasFile`; `canReplace = upload_failed && !hasFile` (ephemeral), `= failed` (attempt), `= !archived && 3 statuses` (doc, F2) | `receiptRows.ts:116–117, :144–146, :164` |
| Copy map: `upload_failed` action keyed on `canRetry`; `could_not_read` action keyed on `canReplace`; `statusAction()` | `src/lib/uploads/processingStatus.ts:60–82, :126–132` |
| `withUploadTimeout` (30s; offline Convex mutations never settle), `ATTEMPT_BATCH_LIMIT` | `src/lib/uploads/outboxFlush.ts:35–65, :18` |
| Server: `recordUploadAttempts` upsert flips `failed → in_progress`, `succeeded` terminal; `failUploadAttempt`; `dismissUploadAttempt`; `listUploadAttempts` excludes `succeeded`/`dismissed`, projects `origin`, `null` on denial | `convex/uploadAttempts.ts:68–100 (:73–80, :74), :104–123, :129–138, :145–183 (:171)` |
| `uploadDocument`: dedupe skips empty content (:87–92), resolves attempt on **both** paths (:123–130, :150–157), returns the existing `_id` on a dedupe hit (:131) | `convex/documents.ts:44–160` |
| `deleteDocument` deletes the storage bytes too | `convex/documents.ts:224–233 (:230)` |
| `deriveProcessingStatus` is exported from the shared (client-importable) module | `shared/documentStatus.ts:162` |
| `Button` variants `ghost`/`danger-ghost`, `size="sm"`, focus ring | `src/lib/components/ui/Button.svelte:8–9, :19, :25, :37, :41` |
| `ProcessingStatusBadge` accepts `status: ReceiptStatus \| null` | `ProcessingStatusBadge.svelte:16–18` |

---

## 1. Summary table

| Sub-step | Files | Done means | Verification |
|---|---|---|---|
| **17a** — ephemeral receipt state (runes-safe) + helpers; delete `uploadError` | `AgentChatPanel.svelte` | `receiptEntries` `$state`, non-`$state` `retryable` File map, `$derived` rows; `grep -n uploadError` on the file returns nothing | `npm run check` |
| **17b** — input-rejection path feeds rows | `AgentChatPanel.svelte` | Rejected files become `skipped_unsupported` rows sharing the recorded `attemptKey`; no transient string | `npm run check` · manual |
| **17c** — `uploadOne` extraction + `uploadFiles` rewrite; wrap the two bare offline-hanging mutations | `AgentChatPanel.svelte` | Rows go `null → status`; batch-abort still marks remaining rows failed; empty-content/batch-failure strings gone | `npm run test` (unchanged green) · manual mixed batch |
| **17d** — render `UploadReceipt` above composer + Dismiss | `AgentChatPanel.svelte` | Receipt renders in the old `uploadError` slot; Dismiss clears settled rows only | manual · keyboard pass |
| **17e** — in-session Retry | `AgentChatPanel.svelte` | Retry re-runs full pipeline under the **same** `attemptKey`; no duplicate rows anywhere | manual offline→online retry + Convex dashboard |
| **18a** — FilesPanel plumbing + shared `storeReplacement` | `FilesPanel.svelte` | Mutations/imports wired; helper records → uploads → resolves under a given `attemptKey` | `npm run check` |
| **18b** — Replace on failed-attempt rows (same key) | `FilesPanel.svelte` | Picker → pipeline → attempt resolves `succeeded`, row leaves list, document appears (D1 closed for attempt rows) | manual reload + replace |
| **18c** — Replace on persisted non-`ready` docs (fresh key, id-compare, confirm modal) | `FilesPanel.svelte`, `src/lib/uploads/processingStatus.ts` | Three statuses (F2) offer Replace; confirm before destructive delete; `newId === oldId` is a reported no-op | manual · server tests |
| **18d** — copy flags flipped (D1 closed for doc rows) | `FilesPanel.svelte` | `documentStatusCopy` passes real `canReplace`; copy never names an absent button | `npm run check` · manual |
| **18e** — tests | `convex/documents.test.ts`, `src/lib/uploads/processingStatus.test.ts` | Replace/dedupe/attempt-resolution sequences pinned; new copy string passes banned-substring regex | `npx vitest run convex/documents.test.ts src/lib/uploads/processingStatus.test.ts` |
| gate (both steps) | — | — | `npm run check` · `npx tsc --noEmit -p convex/tsconfig.json` · `npm run test` · `npm run test:component` · `npm run build` at the end |

Deploy ordering: **no server code changes in either step** (only `convex/documents.test.ts`),
so there is no deploy-ordering constraint beyond what already shipped.

---

## 2. Current code — exact anchors in `AgentChatPanel.svelte`

*(The authoritative plan's line numbers have drifted; these are current.)*

- **`uploadError` state:** `:298` — `let uploadError = $state<string | null>(null);`
- **`attachments`:** `:299–301` — `let attachments = $state<{ documentId; fileName; category }[]>([]);` (rendered `:786–804`; untouched by this plan)
- **`pendingFiles`:** `:302`; **`uploading`:** `:252`
- **`uploadFiles`:** `:501–619`. Begin loop `:519–535` (**bare** `await recordUploadAttempts` at `:521` — no `withUploadTimeout`); per-file loop `:537–597`; storage POST `:539–551` (**bare** `await generateUploadUrl({})` at `:541`); parse + `extractionFailed` `:553–561`; `uploadDocument` wrapped in `withUploadTimeout` `:563–590`; success append `:591–592`; batch `catch` `:598–614`; `finally` `:615–618`
- **The three `uploadError` producers:**
  1. Empty-content warning `:594–596` — `"…was added to Files, but no readable text was found…"`
  2. Batch failure `:600` — `uploadError = "Upload failed. Please try again.";`
  3. Unsupported rejection `:853–855` — `` uploadError = `Unsupported file type: …` `` inside the input `onchange` `:846–870` (which already records `rejected_unsupported` attempts at `:858–865`, generating attempt keys **inline** and discarding them)
- **`uploadError` render site:** `:746–759` (not `:616–629` as the authoritative plan says — correction §9.1), inside the `composer` snippet, above `PromptInput`; the snippet renders at `:1081` (empty state) and `:1174` (normal state)
- **Per-file `attemptKey` generation:** `:516`
- **`recordFailedChatAttempts`:** `:460–499` (batched, timeout-wrapped, outbox fallback — reused as-is)

**Latent offline hang (found this pass, fixed in 17c).** `withUploadTimeout` wraps
`uploadDocument` (`:565`) and the failure recorder (`:467`), but **not** the begin call
(`:521`) or `generateUploadUrl` (`:541`). An offline Convex mutation never settles
(`outboxFlush.ts:22–27`), so a fully-offline batch today hangs at `:521` forever — the
spinner never stops and no failure path ever runs. Wrapping both (their catches already
tolerate rejection) makes the verified offline story true end-to-end. One-line each, inside
the function this step rewrites anyway.

---

## 3. Step 17 — live chat receipt + in-session Retry

### 3.1 Ephemeral state design (Q1) — runes-safe, File map outside `$state`

```ts
// New imports
import { SvelteSet } from "svelte/reactivity";                       // repo idiom: dashboard/+page.svelte:16
import UploadReceipt from "$lib/components/upload/UploadReceipt.svelte";
import Button from "$lib/components/ui/Button.svelte";
import { buildReceiptRows, type EphemeralEntry, type ReceiptRow } from "$lib/uploads/receiptRows";
import { deriveProcessingStatus } from "../../../../shared/documentStatus";

// Reactive: one plain, serializable entry per file this session touched.
// EphemeralEntry (receiptRows.ts:47–57) has NO File field by design — that
// absence is both the leak-proofing and the proxy-proofing.
let receiptEntries = $state<EphemeralEntry[]>([]);

// NOT $state. A File is a host object and must never enter the $state proxy;
// reactivity is carried entirely by receiptEntries.hasFile (authoritative plan,
// resolution (e) :435–441 and carried-forward list :122–124). Keyed by
// attemptKey; category stored beside the File because Retry must re-send it.
const retryable = new Map<string, { file: File; category: ContextCategoryId }>();

// Row keys with a Retry in flight (UploadReceipt busy prop is keyed on row.key,
// which for ephemeral rows is `local:${attemptKey}` — receiptRows.ts:105).
const receiptBusy = new SvelteSet<string>();

// The live receipt shows ONLY this batch's work. Documents/attempts stay the
// FilesPanel's job (ticket §8 mount 1, PSOS-04.md:427).
const chatReceiptRows = $derived(buildReceiptRows([], [], receiptEntries));
const receiptSettled = $derived(chatReceiptRows.every((r) => r.status !== null));

function updateEntry(attemptKey: string, patch: Partial<EphemeralEntry>) {
  const i = receiptEntries.findIndex((e) => e.attemptKey === attemptKey);
  if (i !== -1) receiptEntries[i] = { ...receiptEntries[i], ...patch };
}
```

- **`null → status` transition:** entries are seeded `{ status: null, hasFile: true }` before
  any work; `updateEntry` replaces the element wholesale (`receiptEntries[i] = {…}`), which
  the `$state` deep proxy tracks; `chatReceiptRows` re-derives; the keyed `{#each}` in
  `UploadReceipt` (`:58`) updates the row in place (stable UUID keys — step-13 flag F1).
  Whole-element replacement (rather than field mutation) keeps every stored object a plain
  literal and makes the "no File in reactive state" property structural.
- **Coexistence:** `retryable` and `receiptEntries` share `attemptKey` as the join key.
  `hasFile` is stamped into the entry at each transition (`true` on seed/failure, `false` on
  success/removal) because the Map is non-reactive by design. `canRetry` then falls out of
  `buildReceiptRows` (`receiptRows.ts:116`) with zero component logic.
- **Release:** `retryable.delete(attemptKey)` on upload success (17c), on per-row Remove
  (17d), and on Dismiss of a settled row (17d). The Map dies with the component instance —
  never serialized, never in the outbox (`OutboxEntry` has no bytes field,
  `attemptOutbox.ts` whitelist tests).
- **Verified caveat (§10.1):** `docs/svelte-migration.md` contains **no** explicit
  File/proxy/DataCloneError note (grepped for `proxy`, `DataClone`, `host object`,
  `structuredClone` — nothing). The rule's source is resolution (e) itself; it is still
  correct and is followed.

**Delete `uploadError`** (`:298`) and its render block (`:746–759`) entirely.
Done-check: `grep -n "uploadError" src/lib/components/chat/AgentChatPanel.svelte` → empty.

### 3.2 What replaces `uploadError` (Q2) — producer-by-producer

| Old producer | New behaviour |
|---|---|
| Empty-content warning (`:594–596`) | Deleted. The row itself shows the truth: on success the entry's status is re-derived client-side with the **same** pure function the server ran (`deriveProcessingStatus`, `shared/documentStatus.ts:162`) over the same facts (`fileName`, `parsed.content`, `extractionFailed`, `intake: "file"`), so an empty extraction renders `could_not_read` with its §9 copy (`processingStatus.ts:60–68`, `canReplace: false` variant — the chat receipt has no Replace button, exactly the case the step-13 review fixed). Same function, same inputs ⇒ display matches the stored status by construction; after reload FilesPanel shows the server's copy of the same truth. |
| Batch failure (`:600`) | Deleted. The file that threw gets `status: "upload_failed"` (17c); every not-yet-started file in the aborted batch gets the same, mirroring today's `remaining` bookkeeping (`:604–614`). Each failed row offers **Retry** (File still held). |
| Unsupported rejection (`:853–855`) | Deleted. Each rejected file becomes an entry `{ status: "skipped_unsupported", detail: "unsupported_extension", hasFile: false }` whose copy already includes `SUPPORTED_LABEL` (`processingStatus.ts:69–74`). The existing `recordFailedChatAttempts(..., "rejected_unsupported")` call is kept but now **shares its `attemptKey`s with the entries** (today they're generated inline at `:860` and discarded), so per-row Remove can dismiss the durable row too. |

`uploadError` is **deleted entirely** — nothing keeps it. **Dismissibility:** two levels.
Per-row **Remove** on `upload_failed` and `skipped_unsupported` rows (builder already grants
`canRemove` only there — `receiptRows.ts:119–121`, flag F8): drops the entry, frees the File,
and best-effort `dismissUploadAttempt` so FilesPanel doesn't resurrect a row the user
explicitly removed (ticket §4, PSOS-04.md:320). A whole-receipt **Dismiss** text `Button`
(min-h-11, N7 — no icon-only controls) clears **settled** entries only (in-flight rows are
retained; discarding a row mid-upload would lie) and does **not** dismiss server attempts —
closing the transient surface must not erase the durable audit surface.

### 3.3 Pipeline extraction + `uploadFiles` rewrite (17c)

Extract the per-file body (`:537–597`) into `uploadOne` so Retry re-runs the identical code:

```ts
/** Full per-file pipeline under one attemptKey. Throws on upload failure
 *  (after recording it), so uploadFiles keeps today's batch-abort semantics. */
async function uploadOne(file: File, category: ContextCategoryId, attemptKey: string) {
  let storageId: Id<"_storage"> | undefined;
  try {
    const url = await withUploadTimeout(generateUploadUrl({}));   // was bare (:541) — offline hang fix
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    storageId = ((await res.json()) as { storageId: Id<"_storage"> }).storageId;
  } catch (e) {
    console.error("File storage upload failed", e);               // Q3 unchanged in v1 — no status impact
  }

  let parsed;
  let extractionFailed = false;
  try {
    parsed = await parseFileToText(file);
  } catch (e) {
    console.error("Parse failed", e);
    extractionFailed = true;
    parsed = { fileName: file.name, fileType: guessFileType(file.name), content: "" };
  }

  let documentId: Id<"projectDocuments">;
  try {
    documentId = await withUploadTimeout(
      uploadDocument({
        projectId, reportId,
        fileName: file.name, fileType: parsed.fileType, content: parsed.content,
        source: "chat_upload", category,
        extractionOutcome: extractionFailed ? ("failed" as const) : ("ok" as const),
        attemptKey,
        ...(storageId ? { storageId } : {}),
        ...(file.type ? { mimeType: file.type } : {}),
      })
    );
  } catch (e) {
    updateEntry(attemptKey, { status: "upload_failed", detail: null });   // hasFile stays true → Retry
    await recordFailedChatAttempts(
      [{ attemptKey, fileName: file.name, fileSizeBytes: file.size }],
      "upload_failed"
    );
    throw e;
  }

  const derived = deriveProcessingStatus({
    fileName: file.name, content: parsed.content,
    extractionFailed, intake: "file",
  });
  retryable.delete(attemptKey);
  updateEntry(attemptKey, {
    status: derived.status, detail: derived.detail, documentId, hasFile: false,
  });
  attachments = [...attachments, { documentId, fileName: file.name, category }];
}
```

`uploadFiles` becomes:

```ts
async function uploadFiles(files: File[], category: ContextCategoryId) {
  if (!files || files.length === 0) return;
  pendingFiles = null;
  uploading = true;
  // opportunistic outbox flush — unchanged (:507–514)

  const batch = files.map((file) => ({ file, attemptKey: crypto.randomUUID() }));
  for (const { file, attemptKey } of batch) {
    retryable.set(attemptKey, { file, category });
    receiptEntries = [
      ...receiptEntries,
      { attemptKey, fileName: file.name, fileSizeBytes: file.size, status: null, hasFile: true },
    ];
  }

  const settled = new Set<string>();
  try {
    for (let i = 0; i < batch.length; i += ATTEMPT_BATCH_LIMIT) {
      await withUploadTimeout(                                     // was bare (:521) — offline hang fix
        recordUploadAttempts({ projectId, attempts: batch.slice(i, i + ATTEMPT_BATCH_LIMIT).map(/* as today :523–528 */) })
      );
    }
  } catch (e) {
    console.error("Failed to open upload attempts", e);            // lost begin is safe — comment :532–534 stands
  }

  try {
    for (const { file, attemptKey } of batch) {
      try {
        await uploadOne(file, category, attemptKey);
      } finally {
        settled.add(attemptKey);                                   // covers both outcomes (was :584/:591)
      }
    }
  } catch (e) {
    console.error("Upload failed", e);
    const remaining = batch.filter((b) => !settled.has(b.attemptKey));
    for (const b of remaining) updateEntry(b.attemptKey, { status: "upload_failed" });
    if (remaining.length) {
      await recordFailedChatAttempts(remaining.map(/* as today :607–611 */), "upload_failed");
    }
  } finally {
    uploading = false;
    if (fileInputEl) fileInputEl.value = "";
  }
}
```

**Batch-abort semantics are deliberately preserved** (an `uploadOne` throw aborts the loop;
remaining files get honest `upload_failed` rows with Retry). Switching to per-file
continue-on-error was considered and rejected: offline, each file would burn its own 30s
timeout sequentially (N files × 30s of spinner), and the diff from today's proven code would
be larger. The failed-fast rows all hold their `File`, so recovering is one Retry per row.

### 3.4 Render (17d) — replacing `:746–759`

```svelte
{#if chatReceiptRows.length > 0}
  <div class="mb-2 rounded-lg border border-line-soft bg-white px-3 py-2">
    <UploadReceipt
      rows={chatReceiptRows}
      busy={receiptBusy}
      onRetry={retryUpload}
      onRemove={removeEntry}
    />
    <div class="mt-1 flex justify-end">
      <Button
        variant="ghost" size="sm" class="min-h-11"
        disabled={uploading || !receiptSettled}
        onclick={dismissReceipt}
      >
        Dismiss
      </Button>
    </div>
  </div>
{/if}
```

No `onReplace` is passed — see §5. Default heading ("Processing receipt") and the built-in
`aria-live` summary region (`UploadReceipt.svelte:50`) come free. `min-h-11` on Dismiss keeps
the 44px contract for new controls.

```ts
function dismissReceipt() {
  receiptEntries = receiptEntries.filter((e) => e.status === null);   // keep in-flight rows
  for (const key of [...retryable.keys()]) {
    if (!receiptEntries.some((e) => e.attemptKey === key)) retryable.delete(key);
  }
}

function removeEntry(row: ReceiptRow) {
  if (!row.attemptKey) return;
  receiptEntries = receiptEntries.filter((e) => e.attemptKey !== row.attemptKey);
  retryable.delete(row.attemptKey);
  // Durable row (failed / rejected_unsupported) is dismissed too — §4 Remove
  // semantics (PSOS-04.md:320). Best-effort; a failure leaves the row for
  // FilesPanel's own Remove.
  void withUploadTimeout(dismissUploadAttempt({ projectId, attemptKey: row.attemptKey }))
    .catch((e) => console.error("Could not dismiss upload attempt", e));
}
```

New mutation binding: `const dismissUploadAttempt = useMutation(api.uploadAttempts.dismissUploadAttempt);`
(server: `convex/uploadAttempts.ts:129–138`; no-ops on `succeeded`).

Input-rejection rewrite (17b), replacing `:852–866`:

```ts
if (bad.length) {
  const rejected = bad.map((f) => ({
    attemptKey: crypto.randomUUID(), fileName: f.name, fileSizeBytes: f.size,
  }));
  receiptEntries = [
    ...receiptEntries,
    ...rejected.map((r) => ({
      ...r, status: "skipped_unsupported" as const,
      detail: "unsupported_extension" as const, hasFile: false,
    })),
  ];
  void recordFailedChatAttempts(rejected, "rejected_unsupported");   // SAME keys as the entries
}
```

### 3.5 Retry mechanics (Q3, 17e)

```ts
async function retryUpload(row: ReceiptRow) {
  const attemptKey = row.attemptKey;
  if (!attemptKey || receiptBusy.has(row.key) || uploading) return;
  const held = retryable.get(attemptKey);
  if (!held) return;                       // structurally unreachable while canRetry is true
  receiptBusy.add(row.key);
  updateEntry(attemptKey, { status: null, detail: null });          // row shows "Reading…" again
  try {
    try {
      await withUploadTimeout(recordUploadAttempts({
        projectId,
        attempts: [{ attemptKey, fileName: held.file.name,
                     fileSizeBytes: held.file.size, origin: "chat_upload" as const }],
      }));
    } catch (e) {
      console.error("Failed to reopen upload attempt", e);          // lost begin safe, as in uploadFiles
    }
    await uploadOne(held.file, held.category, attemptKey);
  } catch {
    /* uploadOne already set the row to upload_failed and recorded the failure */
  } finally {
    receiptBusy.delete(row.key);
  }
}
```

- **What re-runs:** the **whole** pipeline — fresh `generateUploadUrl` + storage POST
  (simplest and always correct; any bytes stored by the failed try are orphaned storage the
  dedupe path already knows how to drop, `convex/documents.ts:107–110`), re-parse (cheap,
  deterministic), then `uploadDocument` under the **same** `attemptKey`.
- **Server convergence:** the begin upsert flips `failed → in_progress`
  (`uploadAttempts.ts:73–80`); success resolves it `succeeded` in the same transaction as the
  insert (`documents.ts:150–157`) or the dedupe hit (`:123–130`). If the *original* timed-out
  mutation later lands from Convex's replay queue, the attempt is already `succeeded`
  (terminal, `:74`/`:116`) and the retried upload dedupes into the same document — no
  duplicate rows on any surface.
- **During retry:** `status: null` ⇒ badge renders Spinner + "Reading…"
  (`ProcessingStatusBadge.svelte:41`); `receiptBusy` disables the row's buttons with
  `aria-busy` (`UploadReceiptRow.svelte:80–82`).
- **Repeat failure:** `uploadOne`'s catch sets `upload_failed` again; `hasFile` is still
  `true`, so Retry is offered again; `failed`-state recording converges server-side.
- **File source/release:** from `retryable`; deleted on success inside `uploadOne`, on
  Remove, on Dismiss. Never anywhere reactive or serialized.

---

## 4. Step 18 — Replace flows (both paths)

**Correction to the authoritative plan's file list:** `UploadReceiptRow.svelte` needs **no
change** — its Replace button, hidden picker, and `(row, file)` callback shipped complete in
step 13 (`UploadReceiptRow.svelte:88–111`) and are component-tested (step-13 assertions 7–9,
N8 geometry exclusion). Step 18 touches `FilesPanel.svelte`, `processingStatus.ts` (one
constant), and tests.

### 4.1 Plumbing (18a)

New bindings/imports in `FilesPanel.svelte` (beside the existing ones at `:111–120`):

```ts
import { parseFileToText, SUPPORTED_ACCEPT } from "$lib/parseDocument";
import { withUploadTimeout } from "$lib/uploads/outboxFlush";
import Button from "$lib/components/ui/Button.svelte";
import { REPLACE_UNCHANGED_COPY } from "$lib/uploads/processingStatus";

const uploadDoc = useMutation(api.documents.uploadDocument);
const generateUploadUrl = useMutation(api.documents.generateUploadUrl);
const recordUploadAttempts = useMutation(api.uploadAttempts.recordUploadAttempts);
const failUploadAttempt = useMutation(api.uploadAttempts.failUploadAttempt);

let replaceBusyDocId = $state<Id<"projectDocuments"> | null>(null);
let pendingReplace = $state<{ doc: DocRow; file: File } | null>(null);
let replaceTarget = $state<DocRow | null>(null);        // which doc the shared picker serves
let replaceInputEl: HTMLInputElement | null = $state(null);
```

Shared pipeline (mirrors 17c's `uploadOne`, minus ephemeral state — this panel is fully
reactive, so the two server queries repaint every outcome on their own):

```ts
async function storeReplacement(opts: {
  attemptKey: string;
  file: File;
  origin: "chat_upload" | "context_input" | "review_pd";
  source: string;
  category?: DocRow["category"];
}): Promise<Id<"projectDocuments">> {
  const { attemptKey, file } = opts;
  try {
    await withUploadTimeout(recordUploadAttempts({
      projectId,
      attempts: [{ attemptKey, fileName: file.name, fileSizeBytes: file.size, origin: opts.origin }],
    }));
  } catch (e) { console.error("Failed to open replace attempt", e); }

  let storageId: Id<"_storage"> | undefined;
  try {
    const url = await withUploadTimeout(generateUploadUrl({}));
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    storageId = ((await res.json()) as { storageId: Id<"_storage"> }).storageId;
  } catch (e) { console.error("File storage upload failed", e); }

  let parsed;
  let extractionFailed = false;
  try {
    parsed = await parseFileToText(file);
  } catch (e) {
    console.error("Parse failed", e);
    extractionFailed = true;
    parsed = { fileName: file.name, fileType: "other" as const, content: "" };
  }

  try {
    return await withUploadTimeout(uploadDoc({
      projectId,
      fileName: file.name, fileType: parsed.fileType, content: parsed.content,
      source: opts.source,
      ...(opts.category ? { category: opts.category } : {}),
      extractionOutcome: extractionFailed ? ("failed" as const) : ("ok" as const),
      attemptKey,
      ...(storageId ? { storageId } : {}),
      ...(file.type ? { mimeType: file.type } : {}),
    }));
  } catch (e) {
    void withUploadTimeout(
      failUploadAttempt({ projectId, attemptKey, failureCode: "upload_failed" })
    ).catch(() => {});
    throw e;
  }
}
```

(`fileType: "other"` on parse failure is a display-icon hint only — `FILE_TYPE_COLORS`
falls back to `other` at `FilesPanel.svelte:48`; status derivation uses `fileName`, not
`fileType`.)

### 4.2 Path (a) — failed attempt row, **same** `attemptKey` (18b)

```ts
async function replaceAttempt(row: ReceiptRow, file: File) {
  if (!row.attemptKey || busyAttemptKey) return;
  const origin =
    attempts.find((a) => a.attemptKey === row.attemptKey)?.origin ?? "chat_upload";
  busyAttemptKey = row.attemptKey;      // existing busy channel (:127) — one attempt op at a time
  try {
    await storeReplacement({
      attemptKey: row.attemptKey,       // SAME key: begin flips failed → in_progress,
      file,                             // uploadDocument resolves it (DECISION 2, §4)
      origin,
      source: origin,                   // origin vocabulary mirrors projectDocuments.source (schema §3b)
    });
    // Nothing else to do: the attempt resolved `succeeded` in the same
    // transaction as the insert, so it leaves listUploadAttempts and the new
    // document appears in listDocuments — both reactive.
  } catch (error) {
    toast.error(userErrorMessage(error, "Couldn't upload the replacement. Please try again."));
  } finally {
    busyAttemptKey = null;
  }
}
```

Wire it at the existing render site (`FilesPanel.svelte:385–391`):

```svelte
<UploadReceiptRow
  {row}
  busy={busyAttemptKey === row.attemptKey}
  onRemove={removeAttempt}
  onReplace={replaceAttempt}
/>
```

The button appears automatically (`canReplace` is already `true` on failed attempt rows —
`receiptRows.ts:145`; the control is callback-gated at `UploadReceiptRow.svelte:88`). The
`upload_failed` action copy ("Use \"Replace file…\"…", keyed on `canRetry: false` —
`processingStatus.ts:78–82`) becomes truthful, closing D1's transient mismatch for attempt
rows. The attempt keeps its original `fileName` as audit (upsert patch touches only
status/failureCode/updatedAt — `uploadAttempts.ts:75–79`); the document carries the new name,
exactly as §4 specifies. During the pipeline the row's `displayStatus` is `in_progress` ⇒
the builder renders it as a loading row — visible progress for free. On failure it flips
back to `failed` and stays offered.

### 4.3 Path (b) — persisted non-`ready` document, **fresh** key + id-compare (18c)

**Which statuses (per the decision-log refinement, `PSOS-04.md:106` / flag F2):**
`reference_only`, `could_not_read`, `skipped_unsupported` — **not** `ready_truncated`, and
not `ready`. Do not re-derive this list: read it off the rows the panel already builds
(`receiptRows.ts:164` is the single source of the flag):

```ts
const docCanReplace = $derived(
  new Map(
    receiptRows
      .filter((r): r is ReceiptRow & { documentId: Id<"projectDocuments"> } => !!r.documentId)
      .map((r) => [r.documentId, r.canReplace])
  )
);
```

**Doc-row control** — a visible text `Button` in the action cluster of the document `<li>`
(`FilesPanel.svelte:429–502`), before the preview button, plus **one** shared hidden input at
panel level (single input + `replaceTarget`, so no per-row `bind:this` bookkeeping):

```svelte
{#if !doc.archived && docCanReplace.get(doc._id)}
  <Button
    variant="ghost" size="sm" class="min-h-11 flex-shrink-0"
    disabled={replaceBusyDocId !== null}
    aria-busy={replaceBusyDocId === doc._id}
    aria-label={`Replace file… — ${doc.fileName}`}
    onclick={() => { replaceTarget = doc; replaceInputEl?.click(); }}
  >
    Replace file…
  </Button>
{/if}

<!-- once, at panel level -->
<input
  bind:this={replaceInputEl}
  type="file" class="hidden" tabindex={-1} aria-hidden="true"
  accept={SUPPORTED_ACCEPT}
  onchange={(e) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    if (file && replaceTarget) pendingReplace = { doc: replaceTarget, file };
    replaceTarget = null;
    input.value = "";
  }}
/>
```

**Confirmation (Q4):** one modal for **every** persisted-doc Replace, mirroring the existing
removal modal's markup and interaction (`FilesPanel.svelte:604–660`). Rationale: the review's
`reference_only` concern is real — `deleteDocument` destroys the stored bytes
(`convex/documents.ts:230`), i.e. the downloadable image the §9 copy promises is "kept for
people to open and download" — and `could_not_read` scans also carry downloadable originals.
One unconditional modal is simpler than per-status branching and safer for a destructive,
non-undoable operation. Copy:

> **Replace "{doc.fileName}"?**
> The current file will be permanently removed from the project and replaced by
> "{file.name}". *(Cancel / Replace file)*

```ts
async function runDocReplace() {
  if (!pendingReplace) return;
  const { doc, file } = pendingReplace;
  replaceBusyDocId = doc._id;
  try {
    const origin =
      doc.source === "context_input" || doc.source === "review_pd"
        ? doc.source
        : ("chat_upload" as const);
    const newId = await storeReplacement({
      attemptKey: crypto.randomUUID(),          // FRESH key — DECISION 2's second path
      file,
      origin,
      source: doc.source,                       // replacement inherits provenance + category
      category: doc.category ?? undefined,
    });
    if (newId !== doc._id) {
      // MANDATORY guard: the dedupe (convex/documents.ts:87–92) can return an
      // existing row's id (:131). Unconditional delete could destroy the row
      // the mutation just returned.
      await deleteDoc({ documentId: doc._id });
    } else {
      toast.info(REPLACE_UNCHANGED_COPY);       // identical content — reported no-op
    }
    pendingReplace = null;
  } catch (error) {
    toast.error(
      userErrorMessage(error, "Couldn't upload the replacement. The original file was not changed.")
    );
  } finally {
    replaceBusyDocId = null;
  }
}
```

**What the user sees when `newId === oldId`:** nothing changes in the list (same row), and a
toast explains why. New constant in the single copy module (§9 defence 3, F5 precedent):

```ts
// src/lib/uploads/processingStatus.ts
/** Shown when a replacement dedupes into the very row it was meant to replace. */
export const REPLACE_UNCHANGED_COPY =
  "That file is identical to the one already saved, so nothing was changed.";
```

**Honesty note (verified, §9.6):** for the three replace-able statuses the old row's
`content` is empty by derivation (rules 3/5/8), and empty-content uploads never dedupe
(`documents.ts:87–92`) — so `newId === oldId` is effectively unreachable except for legacy
`stripIngestPrefix` rows whose stored content is non-empty boilerplate. The guard stays
because the decision log mandates it (`PSOS-04.md:104`) and it costs one comparison.

**Order of operations:** upload first, delete second. A crash between the two leaves *both*
rows — recoverable by hand — never zero rows.

### 4.4 Copy flags flipped — D1 closed for doc rows (18d)

`documentStatusCopy` (`FilesPanel.svelte:144–154`) currently hard-codes
`canReplace: false` with the step-15 comment "Replace arrives in step 18…" (`:147–151`).
Change to:

```ts
const action = statusAction(doc.processingStatus, {
  canRetry: false,
  canReplace: docCanReplace.get(doc._id) ?? false,
});
```

and delete the transitional comment. Now `could_not_read`'s copy names "Replace file…"
exactly when the button renders (`processingStatus.ts:64–67`).

### 4.5 Surface ownership (Q5) — final matrix

| Surface | Retry | Replace | Remove |
|---|---|---|---|
| **Chat receipt (live, ephemeral)** | ✔ failed rows (File held) | ✘ — not passed. `canReplace` on an ephemeral row requires `upload_failed && !hasFile` (`receiptRows.ts:117`), which this design never produces: the File is held until success or removal. After reload the ephemeral list is empty and FilesPanel owns the row. One surface, one job. | ✔ failed + skipped rows only (F8); also dismisses the server attempt |
| **FilesPanel attempt rows** | ✘ (no bytes) | ✔ same `attemptKey` (18b) | ✔ existing `dismissUploadAttempt` (`:156–169`) |
| **FilesPanel document rows** | ✘ | ✔ fresh key + id-compare + confirm, three statuses only (18c) | existing archive/delete flow, untouched (`:604–660`) |

---

## 5. Test plan (Q6) — automatable vs Chrome

### Genuinely automatable (write these)

1. **`convex/documents.test.ts` — the id-compare invariant, scripted as the client sequence
   (18e):**
   - *Identical-content replace is a no-op:* upload doc A (non-empty content), then upload
     again with the same `fileName`+`content` and a fresh `attemptKey` → returned id
     **equals** A's id; exactly one row exists; the fresh attempt resolved `succeeded`
     against A. (This is the case the guard exists for — the client would skip the delete.)
   - *Empty-content replace creates a distinct row:* upload doc B with `content: ""`, upload
     a non-empty replacement → **different** id (dedupe skipped, `documents.ts:87–92`); then
     `deleteDocument(B)` → B gone, its storage deleted.
   - *Same-key replace resolves the failed attempt:* `recordUploadAttempts` with
     `failureCode` (row `failed`) → `uploadDocument` with that `attemptKey` → attempt
     `succeeded` + `documentId` set; `listUploadAttempts` no longer returns it.
2. **`src/lib/uploads/processingStatus.test.ts`:** add `REPLACE_UNCHANGED_COPY` to the
   banned-substring sweep (AC3 stays structurally testable).
3. **Nothing new at the `receiptRows`/component layer:** every flag this plan relies on is
   already pinned (step-13 truth table + tests; `UploadReceiptRow` Replace mechanics tested
   incl. keyboard reachability and N8 geometry — step-13 assertions 7–9, step-14 suite).

**Not automatable here, stated plainly:** `AgentChatPanel` and `FilesPanel` both import
`convex-svelte` (`AgentChatPanel.svelte:2`, `FilesPanel.svelte:72`) and cannot mount in the
browser harness without a mock layer that does not exist (the step-13 presentational
contract exists precisely because of this). The wiring in 17c–17e/18b–18c is therefore
manual-checklist territory.

### The 5 highest-value Chrome checks (in priority order)

1. **AC1/AC4 live:** chat batch of 1 unsupported + 1 unreadable (scanned/corrupt PDF) +
   2 good files → 4 rows appear (`skipped_unsupported` immediately; others "Reading…" →
   derived statuses), summary line correct, copy matches §9, no `uploadError` remnant.
2. **Offline honesty + Retry (AC4):** DevTools offline → upload 2 files → rows flip to
   `upload_failed` after the 30s timeout (not a permanent spinner — this validates the 17c
   hang fix); go online → **Retry** one row → it transitions Reading… → `ready`; Convex
   dashboard shows **one** attempt row for that key, `succeeded`; no duplicate row in chat
   receipt or FilesPanel.
3. **Replace after reload, attempt path (DECISION 2):** with a recorded failed attempt,
   reload → FilesPanel shows the failed row with "Replace file…" → pick a good file → row
   leaves the failures list, document appears with a truthful badge; dashboard: same
   `attemptKey`, `succeeded`.
4. **Replace on a persisted doc, both outcomes:** on a `could_not_read` doc → confirm modal
   → replace with a readable file → old row gone (and old bytes gone), new row `ready`; on a
   `reference_only` image confirm the warning names permanent removal before anything is
   deleted. Verify `ready_truncated` and `ready` rows show **no** Replace button (F2).
5. **Keyboard + dismissal:** Tab reaches Retry/Remove/Dismiss in the chat receipt and
   Replace/Remove in FilesPanel in DOM order with visible focus rings; Enter activates; the
   doc-row picker opens from the keyboard; per-row Remove in chat also removes the row from
   FilesPanel (dismissed); receipt Dismiss clears settled rows but leaves FilesPanel's
   durable rows alone.

---

## 6. Risks and rollback, per sub-step

| Sub-step | Risk | Mitigation | Rollback |
|---|---|---|---|
| 17a–17b | A `File` leaks into reactive state later | `EphemeralEntry` type has no File field; entries are replaced as plain literals; the Map is const and non-exported | revert `AgentChatPanel.svelte` — old `uploadError` UI returns; FilesPanel (steps 15/16) still shows every durable failure, so partial rollback is safe (authoritative rollback table :912) |
| 17c | Timeout-wrapping the begin/`generateUploadUrl` changes offline behaviour | It only converts an infinite hang into the already-designed failure path; catches already tolerate rejection; timeout-then-late-landing converges via terminal `succeeded` (`uploadAttempts.ts:74`) + dedupe | same as above |
| 17c | Client-side re-derivation disagrees with the server | Same exported pure function, same facts — divergence is impossible without a code change to `shared/documentStatus.ts`, which both sides import | same |
| 17e | Retry duplicates rows/documents | Same `attemptKey` end-to-end; upsert + terminal resolution + dedupe are all server-tested (step 5/7 suites) | same |
| 18b | Replaced context file mislabelled | `origin` read from the attempt row's projection (`uploadAttempts.ts:171`) and mapped to `source` | revert `FilesPanel.svelte` — Remove stays (step 15 state), copy reverts with it |
| 18c | User loses a downloadable original | Unconditional confirm modal naming permanent removal; upload-before-delete ordering; id-compare guard | same |
| 18c | Upload succeeds, delete fails (network die between) | Both rows remain visible; user deletes manually via the existing flow; no data lost — accepted, recorded | same |
| 18d | Copy names a button that isn't rendered | Flag comes from the same `receiptRows` build that drives rendering — one source | same |
| 18e | New tests flake on convex-test transform time | `testTimeout: 30_000` already set on the convex project (step-6 work log) | delete tests |

---

## 7. Verification per step (standing gate)

After 17 and after 18: `npm run check` (0 errors) · `npx tsc --noEmit -p convex/tsconfig.json`
· `npm run test` · `npm run test:component` (33/33 — no component files change, so any
movement is a regression signal). After 18 additionally: `npx vitest run
convex/documents.test.ts src/lib/uploads/processingStatus.test.ts`, `npm run build`,
`git diff --check`, and the 5 Chrome checks. Done-greps: `grep -n uploadError
src/lib/components/chat/AgentChatPanel.svelte` → empty; `grep -n "canReplace: false"
src/lib/components/editor/FilesPanel.svelte` → empty.

---

## 8. Cut list (explicit, with risks)

1. **Replace affordance in the live chat receipt — cut.** Structurally unreachable
   (`canReplace` needs `!hasFile`, and this design holds the File until success/removal).
   DECISION 2's Replace path is fully served by FilesPanel. *Risk: none observed; if a
   future change drops Files early, the builder flag lights up and the button is one prop
   away.*
2. **New component tests for 17/18 wiring — cut.** Both host components import
   `convex-svelte` and cannot mount in the harness; all presentational mechanics were
   already tested in steps 13–14. *Risk: wiring regressions caught only by the 5-check
   manual list — accepted under deadline; AC5's automated oracle (step 14) is untouched.*
3. **Outbox wiring for FilesPanel replace failures — cut.** A network-dead replace leaves
   the surfaces truthful (attempt row stays `failed`; doc row keeps its non-ready status);
   only the *fresh-key* doc-replace attempt can vanish if the begin never lands. *Risk: a
   marginal audit gap in an already-degraded network case; the user-visible state never
   lies.*
4. **Per-status confirmation nuance — cut.** One generic confirm modal for every
   persisted-doc Replace instead of special-casing `reference_only`. *Risk: one extra click
   on `could_not_read` replaces whose §9 copy already recommends the action — accepted; the
   operation is destructive and non-undoable.*
5. **`reportId` association for replaced documents — cut** (not in the `listDocuments`
   projection; passing the panel's own `reportId` could re-associate a doc that had none).
   *Risk: a replaced chat upload loses its report link; nothing reads it for these flows
   today. Follow-up if ever needed.*
6. **Attachments-pill dedup in chat — cut** (success rows and the existing pills at
   `:786–804` briefly say similar things). *Risk: mild redundancy; zero correctness cost;
   removing pills is unrelated-behaviour churn the ticket forbids.*
7. **Receipt survival across panel unmount/full-screen toggle — cut** (ephemeral by
   DECISION 2's own boundary; durable rows already live in FilesPanel). *Risk: a user who
   toggles views mid-batch loses the live view but not the truth.*
8. **Batch continue-on-error — cut** (kept today's abort semantics; §3.3 rationale). *Risk:
   remaining files need per-row Retry after a mid-batch failure — the receipt makes that a
   one-click recovery.*

---

## 9. Corrections to the authoritative plan (record in the work log at close-out)

1. **Line drift:** `uploadError` renders at `AgentChatPanel.svelte:746–759` (plan says
   `:616–629`); `uploadFiles` is `:501–619` (plan's step-8-era `:436–489`).
2. **Step 18 file list:** `UploadReceiptRow.svelte` requires no edit — its Replace
   mechanics shipped complete in step 13.
3. **Offline gap:** the begin call (`:521`) and `generateUploadUrl` (`:541`) are **not**
   timeout-wrapped, so a fully-offline batch hangs before any failure path runs —
   contradicting the steps-10-11 log's "every upload/record mutation" claim. Fixed in 17c
   (two one-line wraps).
4. **`docs/svelte-migration.md` has no File/proxy hazard note** — the non-`$state` File-map
   rule's only written source is resolution (e); this plan follows it and records the
   citation gap.
5. **`newId === oldId` is near-unreachable** for the three replace-able statuses (their
   content is empty ⇒ dedupe skipped). Guard kept per the decision log; the no-op toast is
   the only UX for a mostly-legacy edge.
6. **Input-rejection attempts now share keys with their receipt rows** (today the keys are
   generated inline and discarded, `:860`) — required so Remove can dismiss the durable row.

---

## 10. What I could not verify — check before relying on it

1. **`toast.info` in the installed `svelte-sonner`** — only `toast.error` is used in this
   codebase (`FilesPanel.svelte:165`). If `info` is absent, use plain `toast(...)`.
2. **Whether the workspace's full-screen toggle (`isFull`) remounts `AgentChatPanel`** —
   if it does, the live receipt (and `retryable`) drop on toggle. Durable rows survive
   regardless; check during Chrome pass 1.
3. **`userErrorMessage(error, fallback)` signature** — inferred from the live call site
   (`FilesPanel.svelte:165`), not from reading `$lib/errors`.
4. **`DocRow["category"]` assignability to `uploadDocument`'s `categoryValidator` union** —
   both derive from the same literal set (`convex/documents.ts:27–33` / projection `:187`),
   but the projection types it via `FunctionReturnType`; if `string | null` widening bites,
   narrow with the existing `ContextCategoryId` type.
5. **Practical wait before offline rows flip failed** is the full 30s
   (`UPLOAD_MUTATION_TIMEOUT_MS`) — unmeasured whether that feels acceptable; changing the
   constant is a one-liner but touches steps-10-11 tested behaviour, so it is not changed
   here.
6. **`replaceBusyDocId !== null` disabling every doc Replace button during one replace** —
   deliberate (one destructive op at a time) but unverified against any design rule about
   concurrent row actions.
