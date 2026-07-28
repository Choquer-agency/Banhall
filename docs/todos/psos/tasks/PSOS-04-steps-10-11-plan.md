# PSOS-04 — detailed implementation plan for steps 10 and 11

*Written 2026-07-27. Companion to [`PSOS-04-implementation-plan.md`](./PSOS-04-implementation-plan.md)
(the authoritative plan, steps 6–19) and [`PSOS-04.md`](./PSOS-04.md). Every file:line below
was verified against the working tree at time of writing (293 tests + 6 component tests green).
No source file was modified by this pass.*

**Scope.** Step 10 (attempt wiring, append side) and step 11 (outbox flush + sign-out clear)
only. Implements the authoritative plan's step 10/11 sections and resolutions (c) (outbox
flush design) and (e) (Retry vs Replace) as decided — nothing here re-litigates them.
Deviations from the plan's *wording* are flagged loudly in §9.

---

## 1. Summary table

| Sub-step | Files | Done means | Verification |
|---|---|---|---|
| **10a** — shared flush/predicate module | `src/lib/uploads/outboxFlush.ts` (new) + `outboxFlush.test.ts` (new) | `shouldDropOutboxEntry`, `attemptsPayload`, `flushOutboxFor`, `ATTEMPT_BATCH_LIMIT` exported, pure-testable; nothing imports them yet except tests | `npx vitest run src/lib/uploads/outboxFlush.test.ts` · `npm run test` still green |
| **10b** — chat wiring | `src/lib/components/chat/AgentChatPanel.svelte` | Per-file `attemptKey`; batched begin before the loop; per-file + batch failure recording with outbox fallback; input rejections recorded as `rejected_unsupported`; `uploadDocument` carries `attemptKey`; **zero visible UX change** (uploadError strings byte-identical) | `npm run check` · manual: DevTools-offline batch → `npx convex run uploadAttempts:listUploadAttempts` / dashboard shows failed rows |
| **10c** — wizard wiring | `src/routes/project/new/+page.svelte` | `uploadFile` catch records a failed attempt (`origin:"context_input"`); `review_pd` upload records on failure (`origin:"review_pd"`); network-dead failures land in the outbox; pre-`createProject` rejections stay session-only; toast behaviour unchanged | `npm run check` · manual: cut network mid-commit → attempt rows / outbox entries exist |
| **11a** — page-level flush | `src/routes/project/[id]/+page.svelte` | `$effect` flushes this user's entries for this project once per app session; clears only after the mutation resolves; domain error → drop; network error → keep; module-local `Set` guard | manual: offline batch → reload → row appears; reload twice → still one row |
| **11b** — chat opportunistic flush | `src/lib/components/chat/AgentChatPanel.svelte` | `uploadFiles` fires a non-blocking flush at its top | covered by 11a manual + code review |
| **11c** — sign-out clear | `src/lib/components/ui/UserMenu.svelte` (+ flagged: `src/routes/signup/[token]/+page.svelte`, see §9.2) | `clearAllOutboxes()` runs after a successful `authClient.signOut()`, before navigation | manual two-user check: A queues offline entries, signs out → keys gone; B signs in → nothing flushes |

Standing gate after each sub-step: `npm run check` · `npx tsc --noEmit -p convex/tsconfig.json` ·
`npm run test` · `npm run test:component`. **No Convex file changes in steps 10–11** — the whole
server surface (steps 1–5) already exists.

---

## 2. Verified current state (answers to the specific questions)

### 2.1 Chat panel — exact current code and every failure point

`src/lib/components/chat/AgentChatPanel.svelte`. Mutations declared at :221–225
(`uploadDocument` :223, `generateUploadUrl` :224). The panel imports `useQuery, useMutation`
from `convex-svelte` (:2) but has **no** `useAuth` and **no** `getCurrentUser` query today.
`projectId` and `reportId` are **required props** (:54–55), and the panel is mounted only at
`src/routes/project/[id]/+page.svelte:1173–1175` with a real `projectId` and `report._id` —
so `projectId` always exists at every wiring point below.

`uploadFiles` is :436–494:

```ts
436	  async function uploadFiles(files: File[], category: ContextCategoryId) {
437	    if (!files || files.length === 0) return;
438	    pendingFiles = null;
439	    uploading = true;
440	    uploadError = null;
441	    try {
442	      for (const file of files) {
443	        let storageId: Id<"_storage"> | undefined;
444	        try {
445	          const url = await generateUploadUrl({});
446	          const res = await fetch(url, { ... });          // :446–450
451	          const json = (await res.json()) as { storageId: Id<"_storage"> };
452	          storageId = json.storageId;
453	        } catch (e) {
454	          console.error("File storage upload failed", e);   // ← swallowed (Q3)
455	        }
457	        let parsed;
458	        let extractionFailed = false;
459	        try {
460	          parsed = await parseFileToText(file);
461	        } catch (e) {
462	          console.error("Parse failed", e);
463	          extractionFailed = true;
464	          parsed = { fileName: file.name, fileType: guessFileType(file.name), content: "" };
465	        }
467	        const documentId = await uploadDocument({           // :467–480, NOT caught per-file
             ...  extractionOutcome: extractionFailed ? "failed" : "ok",  // :477
468-480      });
481	        attachments = [...attachments, { documentId, fileName: file.name, category }];
483	        if (!parsed.content.trim()) {
484	          uploadError = `"${trimName(file.name)}" was added to Files, but no readable text …`;
485	        }
486	      }
487	    } catch (e) {
488	      console.error("Upload failed", e);
489	      uploadError = "Upload failed. Please try again.";
490	    } finally {
491	      uploading = false;
492	      if (fileInputEl) fileInputEl.value = "";
493	    }
494	  }
```

File-input rejection path is :715–736 (input element :715, handler :721):

```ts
721	        onchange={(e) => {
722	          const target = e.currentTarget;
723	          if (target.files && target.files.length) {
724	            const all = Array.from(target.files);
725	            const ok = all.filter((f) => isSupportedFile(f.name));
726	            const bad = all.filter((f) => !isSupportedFile(f.name));
727	            if (bad.length) {
728	              uploadError = `Unsupported file type: ${bad
729	                .map((f) => f.name)
730	                .join(", ")}. Supported: ${SUPPORTED_LABEL}.`;
731	            }
732	            if (ok.length) pendingFiles = ok;
733	          }
734	          target.value = "";
735	        }}
```

**Every point an upload can fail in chat today, and what happens:**

| # | Failure | Caught where | Current behaviour |
|---|---|---|---|
| C-1 | Unsupported extension at the picker | :725–731 | Transient `uploadError` string; the file never reaches any server table. **This is what 10b makes durable** (`rejected_unsupported`). |
| C-2 | `generateUploadUrl` / storage `fetch` / `res.json()` throws | inner catch :453–455 | **Swallowed** (`console.error` only). `storageId` stays `undefined`; the flow continues to parse + `uploadDocument`. If parse succeeded, a document row is created *with text but without original bytes* — the Q3 case, human-decided "unchanged in v1". Step 10 must not touch this catch. |
| C-3 | `parseFileToText` throws | inner catch :461–465 | `extractionFailed = true`, `content: ""` → server derives `could_not_read`/`parse_failed`. A document row **exists**, so this is an *extraction* failure, not an upload failure. The attempt (once wired) resolves `succeeded`. |
| C-4 | `uploadDocument` mutation throws (network down, or a domain error) | **outer** catch :487–489 | Generic `"Upload failed. Please try again."`; **the loop aborts** — files after the failed one are silently never uploaded. No durable record anywhere. This is the core step-10 target. |
| C-5 | Tab closed mid-upload | nowhere | After 10b's begin call exists: an `in_progress` attempt row goes stale and `listUploadAttempts` displays it as failed after 10 min (`convex/uploadAttempts.ts:168–171`, `STALE_ATTEMPT_MS` at `convex/lib/uploadAttempts.ts:42`). No client work needed. |

**Q3 confirmation:** C-2 (storage POST fails, insert succeeds) is decided as unchanged in v1
(ticket DECISION 3, plan header). Step 10 leaves the :444–455 try/catch byte-identical; the
attempt for such a file still resolves `succeeded` via `uploadDocument`'s `attemptKey`
(the document row is real). Recorded again as an accepted limitation.

### 2.2 Wizard — exact current code and every failure point

`src/routes/project/new/+page.svelte`. Verified:

- User query at **:55–57** — `const user = useQuery(api.users.getCurrentUser, () => auth.isAuthenticated ? {} : "skip")`.
  The plan's ":55" claim is correct. `api.users.getCurrentUser` returns
  `getCurrentUserOrNull(ctx)` (`convex/users.ts:13–18`) — a full user doc (`_id` present) or
  `null`, never a throw. So the outbox `userId` is `user.data?._id`.
- `uploadOriginal` :333–347 — storage POST wrapped in its own try/catch, returns
  `undefined` on failure (the wizard's Q3-analogue; also unchanged).
- `commit()` :349–553. `createProject` is awaited at :360–378; `createdProjectId = projectId`
  at :379. **Every upload happens after this point**, so a `projectId` exists at every wizard
  failure site step 10 touches. Confirmed.
- `uploadFile` :398–440. Already returns `"stored_text" | "stored_empty" | "failed"` (step 8).
  The catch is :435–439:

  ```ts
  435	        } catch (e) {
  436	          console.error(`upload failed for ${file.name}`, e);
  437	          skippedFiles.push(file.name);
  438	          return "failed";
  439	        }
  ```

  Unlike chat, the wizard **continues** after a per-file failure (the catch returns instead
  of rethrowing); `skippedFiles` becomes one toast at :528–532.
- `pyRows` loop :443–471 — `uploadFile(file, "previous_pd", prefix)` at :449–453,
  `noteCarried` at :447/:454, standalone-note upload at :461–469 (**not** inside
  `uploadFile`'s try — a throw there propagates to the commit catch; pre-existing, unchanged).
- Other-categories loop :474–491 — `uploadFile(file, cat.id)` at :478; pasted category text
  at :481–489 (direct `uploadDocument`, `intake: "pasted"`).
- `review_pd` path :495–510 — direct `uploadDocument` at :500–508 (`source: "review_pd"`),
  **not** wrapped per-file: a throw propagates to the commit catch :534–553, which toasts
  `userErrorMessage(e, …)` and lands the writer on the created project (:546–551).
- Commit catch :534–553 — the only wizard-level failure surface.

**Failure points in the wizard:**

| # | Failure | Caught where | Current behaviour | Step-10 action |
|---|---|---|---|---|
| W-1 | Unsupported file at staging time (before commit) | `CategoryRow.svelte:46–51` / `PreviousYearRow.svelte:54–59` (`partitionSupported`) | Inline `rejected` chips, session-only | **None** — no `projectId` exists yet; ticket §8.4 boundary, unchanged |
| W-2 | `createProject` throws | commit catch :534 | Toast; no project | **None** — nothing recordable |
| W-3 | `uploadOriginal` fails inside `uploadFile` | :343–346, swallowed | Doc may store with text, no bytes (Q3 analogue) | **None** (unchanged in v1) |
| W-4 | Parse throws inside `uploadFile` | :410–417 | `extractionFailed`, `content:""` → `could_not_read` doc row | **None** — extraction failure, not upload failure |
| W-5 | `uploadDocument` throws inside `uploadFile` | :435–439 | `skippedFiles` + toast; loop continues | Record failed attempt, `origin:"context_input"`; outbox on network death |
| W-6 | `review_pd` `uploadDocument` throws | commit catch :534 | Toast + land on project | Record failed attempt, `origin:"review_pd"`, then rethrow (flow preserved) |
| W-7 | Standalone-note / pasted-text `uploadDocument` throws (:461, :481) | commit catch :534 | Toast + land on project | **None** — pasted text is not a file; DECISION 1 covers *files*. Session-only, recorded limitation |
| W-8 | `startPdReview` / `generateReport` throws | commit catch :534 | Toast + land on project | **None** — not an upload |

### 2.3 `attemptKey` — origin and flow

- **Generation:** `crypto.randomUUID()`, one per file, generated at the moment the batch is
  assembled (chat) or per `uploadFile` invocation (wizard). No existing usage in `src/`
  (grep verified); the server-side helper already documents this exact expectation
  (`convex/lib/uploadAttempts.ts:12` — "The client generates this with `crypto.randomUUID()`").
  Availability: all call sites are user-gesture/async client code inside event handlers —
  **never module scope, never SSR**, so there is no SSR concern. `crypto.randomUUID()`
  requires a secure context; `localhost:3001` (dev) and production HTTPS both qualify.
  Output is lowercase UUID v4 and passes both the client regex
  (`attemptOutbox.ts:34–35`) and the server gate (`requireAttemptKey`,
  `convex/lib/uploadAttempts.ts:20–25`, which also lowercases defensively).
- **Flow (happy path, chat):**
  1. `recordUploadAttempts({ projectId, attempts: [{attemptKey, fileName, fileSizeBytes, origin}] })`
     — upsert by `(projectId, attemptKey)`, inserts `in_progress`
     (`convex/uploadAttempts.ts:68–97`).
  2. Storage POST + parse (unchanged).
  3. `uploadDocument({ …, attemptKey })` — validates the key (`requireAttemptKey`) and
     resolves the attempt to `succeeded` + `documentId` **in the same transaction** on both
     the insert path (`convex/documents.ts:150–157`) and the dedupe path (:123–130).
- **Flow (failure):** the catch records the failure. Design note (flagged, §9.1): failures
  are recorded via `recordUploadAttempts` with `failureCode: "upload_failed"` (a single-entry
  upsert-to-failed) rather than `failUploadAttempt`, because `failUploadAttempt` **cannot
  create a row** — it returns silently when no attempt exists
  (`convex/uploadAttempts.ts:116`). If the begin call was lost to a network blip that has
  since recovered, `failUploadAttempt` would silently lose the record; the upsert inserts it.
  `recordUploadAttempts` with a `failureCode` inserts/patches to `failed`
  (:70, :75–80, :83–96) and treats `succeeded` as terminal (:74) — identical semantics
  otherwise.
- **Begin call itself fails (the outbox case):** the failure-recording mutation is the thing
  that gates the outbox, not the begin. If the begin batch throws it is logged and swallowed
  (a lost begin is already tolerated by the whole design — see `resolveUploadAttempt`'s
  docstring, `convex/lib/uploadAttempts.ts:104–106`). Then, per file, when the
  failure-recording `recordUploadAttempts` call *also* throws:
  - `shouldDropOutboxEntry(err)` **true** (domain error — server reachable and said no):
    do **not** queue; console only. Queuing would poison the outbox with entries the server
    will reject forever.
  - **false** (network): `appendOutbox(userId, entry)` with the same `attemptKey` — the
    flush later replays it through the same upsert, so double-recording is impossible.
  - **Why the begin-failure itself never queues:** if the begin is lost but the upload
    *succeeds* (transient blip), a queued entry would later flush a `failed` row for a file
    that is demonstrably in the project — a false audit row with no `documentId` to
    cross-check against. Appending only at *terminal per-file failure* makes the outbox
    record only real failures.

### 2.4 Distinguishing failure modes (AC4) — the matrix is in §5

- **Extraction failure** → a `projectDocuments` row with `processingStatus:"could_not_read"`
  (detail `parse_failed` or `no_text_extracted`), derived server-side from
  `extractionOutcome`/empty content (`convex/documents.ts:93–98`). The attempt resolves
  `succeeded` — the upload *worked*.
- **Upload failure** → a `documentUploadAttempts` row with `status:"failed"`,
  `failureCode:"upload_failed"`, and **no** `documentId`. No document row exists.
- Distinct tables, distinct statuses, distinct provenance — `buildReceiptRows` (step 13)
  keys off exactly this.
- **The third case (Q3):** storage POST fails but insert succeeds → document row (possibly
  `ready`) with `hasFile:false`; attempt resolves `succeeded`. Verified unchanged by this
  plan: the chat catch :453–455 and wizard `uploadOriginal` :343–346 are untouched.

### 2.5 The drop-vs-keep predicate (network vs domain failure)

Server domain failures are always `domainError(code, message)` →
`throw new ConvexError({ code, message })` (`convex/lib/contracts.ts:23–25`). Client-side,
`src/lib/errors.ts` already decodes exactly this shape: `userErrorCode(error)` returns the
code when `error.data.code` is a string (the live `ConvexError` object surfaced by
convex-svelte) **or** when the message embeds `"Uncaught ConvexError: {...}"` (:6–24);
it returns `null` for everything else — including `TypeError: Failed to fetch`,
WebSocket-level failures, and Convex's opaque `"Server Error"` (a non-ConvexError server
exception).

**The predicate, precisely:**

```ts
/** Drop the queued entry iff the server answered with a typed domain error. */
export function shouldDropOutboxEntry(error: unknown): boolean {
  return userErrorCode(error) !== null;
}
```

- Drop (server reachable, request rejected): `NOT_FOUND` (project deleted),
  `NOT_AUTHORIZED`, `NOT_AUTHENTICATED`, `INVALID_INPUT`, … — any of the codes in
  `domainErrorCodes` (`convex/lib/contracts.ts:4–19`). Retrying can never succeed.
- Keep (request may never have arrived): fetch/WebSocket failures, timeouts, and the generic
  `"Server Error"`. A transient server bug therefore retries until the 7-day TTL
  (`OUTBOX_TTL_MS`, `attemptOutbox.ts:30`) — bounded, accepted.

### 2.6 Flush hook facts (step 11)

- `src/routes/project/[id]/+page.svelte` already has everything the effect needs:
  `projectId` (:63, `$derived(page.params.id as Id<"projects">)`),
  `userQ = useQuery(api.users.getCurrentUser, …)` (:77–79), `useMutation` in scope (:4),
  and `useConvexClient` (:62) if ever needed.
- **`$effect` never runs during SSR** — proof by existing pattern: the effect at :336–347
  calls `localStorage.getItem(...)` with **no** existence guard and no try/catch; it would
  throw on every server render if effects ran there. Same pattern at
  `AgentChatPanel.svelte:265–271`. (Svelte 5 effects are client-only by design; the repo
  relies on it in shipped code.)
- "Module-local `Set`" = a `<script module>` block (Svelte 5), so the guard survives
  page remounts within one app session. The page currently has only an instance
  `<script lang="ts">` (:1); a module script is added above it.
- Error handling predicate: §2.5. Clear-after-success is already the shape of
  `flushOutboxFor` (§3.1) — `clearOutboxFor` runs only after `record()` resolves or after a
  confirmed domain rejection.

### 2.7 Sign-out facts

`UserMenu.handleSignOut` is `src/lib/components/ui/UserMenu.svelte:58–74`:

```ts
58	  async function handleSignOut() {
59	    if (signingOut) return;
60	    signingOut = true;
61	    open = false;
62	    try {
63	      await authClient.signOut();
64	      // Use one client-side navigation after the session cookie is cleared. …
67	      await goto(resolve("/login"), { replaceState: true, invalidateAll: true });
68	    } catch (error) { … toast … }
71	    finally { signingOut = false; }
```

`clearAllOutboxes()` goes **between :63 and :67** — synchronously, after `signOut()` resolves
and before `goto` is even started, so navigation speed cannot skip it. It must not run when
`signOut()` throws (user is still signed in; their queue stays theirs).

**In-flight flush race:** a flush that already called `takeOutboxFor` holds its entries in
memory. After the sweep, its `recordUploadAttempts` fails `NOT_AUTHENTICATED` → drop path →
`clearOutboxFor` on already-removed keys (a no-op — `clearOutboxFor` only removes,
`attemptOutbox.ts:168–179`). Nothing is resurrected, nothing is attributed to the next user.
Converse race: an upload failing *concurrently* with sign-out could `appendOutbox` after the
sweep — the entry is user-scoped, so the next user never flushes it; the same user's next
sign-in flushes it correctly; TTL bounds the leftover. Accepted, recorded.

**Second sign-out site found (not in the plan):** `src/routes/signup/[token]/+page.svelte:127–133`
— "You're already signed in / Sign out first to accept this invite" calls
`authClient.signOut()` then reloads the invite page. This is *precisely* the shared-browser
handoff Amendment F exists for. Flagged in §9.2 with a one-line fix.

---

## 3. Exact code-level changes

### 3.1 Sub-step 10a — new module `src/lib/uploads/outboxFlush.ts` (+ tests)

Pure seam between the two big untestable components and the already-tested outbox. Zero
module-scope work; imports only `$lib/errors` and `./attemptOutbox`.

```ts
import { userErrorCode } from "$lib/errors";
import {
  clearOutboxFor,
  takeOutboxFor,
  type OutboxEntry,
  type OutboxFailureCode,
  type OutboxOrigin,
} from "./attemptOutbox";

/** Mirrors MAX_BATCH in convex/uploadAttempts.ts:36 (not exported server-side). */
export const ATTEMPT_BATCH_LIMIT = 50;

/** The exact wire shape recordUploadAttempts accepts — nothing else survives. */
export type AttemptPayload = {
  attemptKey: string;
  fileName: string;
  fileSizeBytes?: number;
  origin: OutboxOrigin;
  failureCode: OutboxFailureCode;
};

/**
 * Drop the queued entry iff the server answered with a typed domain error
 * (convex/lib/contracts.ts domainError → ConvexError({code, message})).
 * A network failure — the request may never have arrived — keeps the entry
 * for a later flush. "Server Error" (untyped server exception) also keeps:
 * retry until the outbox TTL bounds it.
 */
export function shouldDropOutboxEntry(error: unknown): boolean {
  return userErrorCode(error) !== null;
}

/** Whitelist-map outbox entries to the mutation payload. userId/projectId/at never cross. */
export function attemptsPayload(entries: OutboxEntry[]): AttemptPayload[] {
  return entries.map((e) => ({
    attemptKey: e.attemptKey,
    fileName: e.fileName,
    ...(e.fileSizeBytes !== undefined ? { fileSizeBytes: e.fileSizeBytes } : {}),
    origin: e.origin,
    failureCode: e.failureCode,
  }));
}

export type FlushResult = "empty" | "flushed" | "dropped" | "kept";

/**
 * Flush this user's queued entries for this project through the caller's
 * recordUploadAttempts. Entries clear only after the server accepted them
 * (or definitively rejected them). OUTBOX_CAP (50) ≤ the server's MAX_BATCH
 * (50), so one call always suffices. Never throws.
 */
export async function flushOutboxFor(
  userId: string,
  projectId: string,
  record: (attempts: AttemptPayload[]) => Promise<unknown>
): Promise<FlushResult> {
  const entries = takeOutboxFor(userId, projectId);
  if (entries.length === 0) return "empty";
  const keys = entries.map((e) => e.attemptKey);
  try {
    await record(attemptsPayload(entries));
  } catch (error) {
    console.error("Outbox flush failed", error);
    if (shouldDropOutboxEntry(error)) {
      clearOutboxFor(userId, projectId, keys); // deleted project / lost access: poison, drop
      return "dropped";
    }
    return "kept"; // network — try again next session/upload
  }
  clearOutboxFor(userId, projectId, keys);
  return "flushed";
}
```

`src/lib/uploads/outboxFlush.test.ts` (node project; reuse the `MemoryStorage` +
`beforeEach` pattern from `attemptOutbox.test.ts:36–60`):

1. `shouldDropOutboxEntry`: `{ data: { code: "NOT_FOUND", message: "…" } }` → `true`;
   an `Error` whose message contains `Uncaught ConvexError: {"code":"NOT_AUTHORIZED","message":"x"}`
   → `true`; `new TypeError("Failed to fetch")` → `false`; `new Error("Server Error")` →
   `false`; `new Error("[CONVEX M(...)] …")` → `false`; `undefined` / string / `null` → `false`.
2. `attemptsPayload`: emits exactly the five whitelisted fields; omits `fileSizeBytes` when
   absent; a poisoned entry (extra `message`/`stack` keys via cast) contributes nothing extra
   (`Object.keys` asserted) — the leak-proofing test at the wire boundary.
3. `flushOutboxFor` — empty queue → `"empty"`, `record` never called.
4. Success → `record` called once with the mapped payload; entries gone from storage;
   `"flushed"`.
5. `record` rejects with a domain-shaped error → entries gone (dropped); `"dropped"`.
6. `record` rejects with `TypeError` → entries **still present**; `"kept"`.
7. Isolation: another user's and another project's entries survive both 4 and 5.
8. Entries appended *during* the flush (from inside the `record` stub, different
   `attemptKey`) survive the post-flush clear — pins the `clearOutboxFor`-by-key design.

### 3.2 Sub-step 10b — `AgentChatPanel.svelte`

**New imports/declarations** (beside :221–225):

```ts
import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
import { appendOutbox } from "$lib/uploads/attemptOutbox";
import {
  ATTEMPT_BATCH_LIMIT,
  flushOutboxFor,               // used by 11b; import lands with 10b harmlessly or in 11b
  shouldDropOutboxEntry,
} from "$lib/uploads/outboxFlush";

const auth = useAuth();
const currentUserQ = useQuery(api.users.getCurrentUser, () =>
  auth.isAuthenticated ? {} : "skip"
);                                                       // idiom: wizard :55, page :77
const recordUploadAttempts = useMutation(api.uploadAttempts.recordUploadAttempts);
```

**New component-local helper** (near `uploadFiles`):

```ts
type AttemptInfo = { attemptKey: string; fileName: string; fileSizeBytes: number };

/** Record failures durably; queue to the outbox only when the network is down.
 *  Never throws — failure recording must never break the upload flow. */
async function recordFailedChatAttempts(
  entries: AttemptInfo[],
  failureCode: "rejected_unsupported" | "upload_failed"
) {
  for (let i = 0; i < entries.length; i += ATTEMPT_BATCH_LIMIT) {
    const slice = entries.slice(i, i + ATTEMPT_BATCH_LIMIT);
    try {
      await recordUploadAttempts({
        projectId,
        attempts: slice.map((a) => ({
          attemptKey: a.attemptKey,
          fileName: a.fileName,
          fileSizeBytes: a.fileSizeBytes,
          origin: "chat_upload" as const,
          failureCode,
        })),
      });
    } catch (err) {
      console.error("Failed to record upload attempts", err);
      if (shouldDropOutboxEntry(err)) continue;       // server said no — don't queue poison
      const userId = currentUserQ.data?._id;
      if (!userId) continue;                          // recorded limitation (plan res. (c))
      for (const a of slice) {
        appendOutbox(userId, {
          userId,
          projectId,
          attemptKey: a.attemptKey,
          fileName: a.fileName,
          fileSizeBytes: a.fileSizeBytes,
          origin: "chat_upload",
          failureCode,
          at: Date.now(),
        });
      }
    }
  }
}
```

**`uploadFiles` rewrite** (:436–494 → below; storage try/catch :444–455, parse try/catch
:459–465, the `attachments` push, the empty-content message :483–485, the outer-catch
message :489, and the `finally` block are all **byte-identical** — only the marked lines are
new):

```ts
async function uploadFiles(files: File[], category: ContextCategoryId) {
  if (!files || files.length === 0) return;
  pendingFiles = null;
  uploading = true;
  uploadError = null;
  {                                                              // NEW (11b) — opportunistic flush
    const userId = currentUserQ.data?._id;
    if (userId) {
      void flushOutboxFor(userId, projectId, (attempts) =>
        recordUploadAttempts({ projectId, attempts })
      );
    }
  }
  const batch = files.map((file) => ({                           // NEW — one key per file
    file,
    attemptKey: crypto.randomUUID(),
  }));
  const settled = new Set<string>();                             // NEW — resolved or failed
  try {                                                          // NEW — begin (in_progress rows)
    for (let i = 0; i < batch.length; i += ATTEMPT_BATCH_LIMIT) {
      await recordUploadAttempts({
        projectId,
        attempts: batch.slice(i, i + ATTEMPT_BATCH_LIMIT).map((b) => ({
          attemptKey: b.attemptKey,
          fileName: b.file.name,
          fileSizeBytes: b.file.size,
          origin: "chat_upload" as const,
        })),
      });
    }
  } catch (e) {
    // A lost begin is tolerated everywhere downstream: the failure path
    // upserts its own row, and resolveUploadAttempt no-ops without one.
    console.error("Failed to open upload attempts", e);
  }
  try {
    for (const { file, attemptKey } of batch) {                  // CHANGED loop header
      let storageId: Id<"_storage"> | undefined;
      try { /* :444–455 unchanged */ } catch (e) { console.error("File storage upload failed", e); }

      let parsed;
      let extractionFailed = false;
      try { /* :459–465 unchanged */ } catch (e) { /* unchanged */ }

      let documentId: Id<"projectDocuments">;
      try {                                                      // NEW — per-file catch
        documentId = await uploadDocument({
          projectId,
          reportId,
          fileName: file.name,
          fileType: parsed.fileType,
          content: parsed.content,
          source: "chat_upload",
          category,
          extractionOutcome: extractionFailed ? "failed" : "ok",
          attemptKey,                                            // NEW — same-tx resolution
          ...(storageId ? { storageId } : {}),
          ...(file.type ? { mimeType: file.type } : {}),
        });
      } catch (e) {
        settled.add(attemptKey);
        await recordFailedChatAttempts(
          [{ attemptKey, fileName: file.name, fileSizeBytes: file.size }],
          "upload_failed"
        );
        throw e;             // preserve today's batch-abort + generic message (until step 17)
      }
      settled.add(attemptKey);
      attachments = [...attachments, { documentId, fileName: file.name, category }];

      if (!parsed.content.trim()) { /* :483–485 unchanged */ }
    }
  } catch (e) {
    console.error("Upload failed", e);
    uploadError = "Upload failed. Please try again.";            // unchanged string
    const remaining = batch.filter((b) => !settled.has(b.attemptKey));  // NEW — abort honesty
    if (remaining.length) {
      await recordFailedChatAttempts(
        remaining.map((b) => ({
          attemptKey: b.attemptKey,
          fileName: b.file.name,
          fileSizeBytes: b.file.size,
        })),
        "upload_failed"
      );
    }
  } finally { /* :490–493 unchanged */ }
}
```

Why the batch-abort honesty block: today a mid-batch failure silently strands the rest of
the batch (C-4). After the begin call those files have `in_progress` rows; without the block
they would read as stale-failed only after 10 minutes. Marking them `failed` immediately is
truthful — the batch died and they were never uploaded. User-visible behaviour (which files
get uploaded, which message shows) is **unchanged**.

**Input-rejection recording** — one addition inside the `onchange` handler, after :731:

```ts
if (bad.length) {
  uploadError = `Unsupported file type: …`;                      // :727–731 unchanged
  void recordFailedChatAttempts(                                 // NEW — durable per DECISION 1
    bad.map((f) => ({
      attemptKey: crypto.randomUUID(),
      fileName: f.name,
      fileSizeBytes: f.size,
    })),
    "rejected_unsupported"
  );
}
```

`projectId` always exists here (required prop, §2.1). The handler stays synchronous
(`void`-fired); the transient message behaviour is otherwise untouched until step 17.

### 3.3 Sub-step 10c — `src/routes/project/new/+page.svelte`

**New imports/declarations** (beside :50–57):

```ts
import { appendOutbox } from "$lib/uploads/attemptOutbox";
import { shouldDropOutboxEntry } from "$lib/uploads/outboxFlush";

const recordUploadAttempts = useMutation(api.uploadAttempts.recordUploadAttempts);
```

**New helper** (above `commit()`; `projectId` passed in because it is commit-scoped):

```ts
/** Durable record of a commit-loop upload failure; outbox when the network is
 *  down. Never throws — one failed record must not sink the commit. */
async function recordFailedWizardAttempt(
  projectId: Id<"projects">,
  a: {
    attemptKey: string;
    fileName: string;
    fileSizeBytes?: number;
    origin: "context_input" | "review_pd";
  }
) {
  try {
    await recordUploadAttempts({
      projectId,
      attempts: [
        {
          attemptKey: a.attemptKey,
          fileName: a.fileName,
          ...(a.fileSizeBytes !== undefined ? { fileSizeBytes: a.fileSizeBytes } : {}),
          origin: a.origin,
          failureCode: "upload_failed" as const,
        },
      ],
    });
  } catch (err) {
    console.error("Failed to record upload attempt", err);
    if (shouldDropOutboxEntry(err)) return;
    const userId = user.data?._id;                       // user query at :55–57
    if (!userId) return;                                 // recorded limitation
    appendOutbox(userId, {
      userId,
      projectId,
      attemptKey: a.attemptKey,
      fileName: a.fileName,
      ...(a.fileSizeBytes !== undefined ? { fileSizeBytes: a.fileSizeBytes } : {}),
      origin: a.origin,
      failureCode: "upload_failed",
      at: Date.now(),
    });
  }
}
```

**`uploadFile` edits** (:398–440). Two changes — a key per invocation and the catch:

```ts
const uploadFile = async (
  file: File,
  category: ContextCategoryId,
  prefix = ""
): Promise<"stored_text" | "stored_empty" | "failed"> => {
  progress = `Uploading ${file.name}…`;
  const attemptKey = crypto.randomUUID();                        // NEW
  try {
    /* :405–422 unchanged (uploadOriginal, parse, hasText) */
    await uploadDocument({
      projectId,
      fileName: file.name,
      fileType: parsed.fileType,
      content: hasText ? prefix + parsed.content : "",
      source: "context_input",
      category,
      extractionOutcome: extractionFailed ? "failed" : "ok",
      attemptKey,                                                // NEW
      ...(storageId ? { storageId } : {}),
      ...(file.type ? { mimeType: file.type } : {}),
    });
    return hasText ? "stored_text" : "stored_empty";
  } catch (e) {
    console.error(`upload failed for ${file.name}`, e);          // :436 unchanged
    skippedFiles.push(file.name);                                // :437 unchanged
    await recordFailedWizardAttempt(projectId, {                 // NEW
      attemptKey,
      fileName: file.name,
      fileSizeBytes: file.size,
      origin: "context_input",
    });
    return "failed";                                             // :438 unchanged
  }
};
```

No begin call in the wizard (per the authoritative plan's step-10 text): the commit loop has
no live receipt to feed, failures insert directly as `failed` via the upsert, and successes
carry `attemptKey` so a hypothetical stray row would resolve. `resolveUploadAttempt` no-ops
when no row exists (`convex/lib/uploadAttempts.ts:113–114`), so passing `attemptKey` on the
success path is free and keeps chat/wizard symmetric.

**`review_pd` edit** (:495–510):

```ts
} else if (mode === "review" && pdDoc) {
  progress = `Uploading ${pdDoc.name}…`;                         // :498 unchanged
  const storageId = await uploadOriginal(pdDoc.file);            // :499 unchanged
  const pdAttemptKey = crypto.randomUUID();                      // NEW
  let documentId: Id<"projectDocuments">;
  try {                                                          // NEW wrapper
    documentId = await uploadDocument({
      projectId,
      fileName: pdDoc.name,
      fileType: guessFileType(pdDoc.name),
      content: pdDoc.content,
      source: "review_pd",
      attemptKey: pdAttemptKey,                                  // NEW
      ...(storageId ? { storageId } : {}),
      ...(pdDoc.file.type ? { mimeType: pdDoc.file.type } : {}),
    });
  } catch (e) {
    await recordFailedWizardAttempt(projectId, {
      attemptKey: pdAttemptKey,
      fileName: pdDoc.name,
      fileSizeBytes: pdDoc.file.size,
      origin: "review_pd",
    });
    throw e;   // commit catch (:534–553) keeps its toast + land-on-project behaviour
  }
  progress = "Starting PD review…";                              // :509 unchanged
  await startPdReview({ projectId, documentId });                // :510 unchanged
}
```

Note the mode-check subtlety: `review_pd` has **no** `extractionOutcome` today (:500–508)
because `handlePdFile` (:211–231) guarantees non-empty pre-parsed content; unchanged.

**Untouched on purpose:** the standalone-note upload (:461–469) and pasted category text
(:481–489) — pasted text, not files (W-7); the pre-`createProject` staging rejections
(W-1); `uploadOriginal`'s swallow (W-3); the `skippedFiles` toast (:528–532).

### 3.4 Sub-step 11a — `src/routes/project/[id]/+page.svelte`

**New module script** (above the existing `<script lang="ts">` at :1):

```svelte
<script lang="ts" module>
  // PSOS-04 resolution (c): one outbox-flush attempt per project per app
  // session. Module-local so remounts (route re-entry) don't re-fire it;
  // a "kept" (network) result retries on the next full reload or via the
  // chat panel's opportunistic flush.
  const flushedOutboxProjects = new Set<string>();
</script>
```

**Instance-script additions** — imports beside :53, mutation beside :96–106, effect beside
the existing localStorage effect at :336:

```ts
import { flushOutboxFor } from "$lib/uploads/outboxFlush";
// …
const recordUploadAttempts = useMutation(api.uploadAttempts.recordUploadAttempts);
// …
// PSOS-04: flush this user's queued upload-attempt failures for this project.
// Page-level (not FilesPanel-level) so it fires in every page state of the
// resolution-(a) matrix, including awaiting-selection and the stepper.
// $effect never runs during SSR (cf. the unguarded localStorage effect above).
$effect(() => {
  const userId = userQ.data?._id;
  const pid = projectId;
  if (!userId || !pid || flushedOutboxProjects.has(pid)) return;
  flushedOutboxProjects.add(pid); // added synchronously: reactive re-runs can't double-fire
  void flushOutboxFor(userId, pid, (attempts) =>
    recordUploadAttempts({ projectId: pid, attempts })
  );
});
```

Semantics, stated plainly:

- Entries clear only inside `flushOutboxFor` after `record()` resolves (or a domain
  rejection) — resolution (c)'s "clear only after the mutation resolves". A crash between
  mutation and clear re-flushes next session; the server upsert makes that a no-op.
- Other projects' entries flush when the user next visits those projects (resolution (c));
  the TTL cleans abandoned ones.
- A `"kept"` result (offline page load) does **not** remove `pid` from the Set: the retry
  happens on the next full reload (module state resets) or the next chat upload (11b).
  Chosen over remove-on-kept to make a reactive retry loop structurally impossible;
  recorded as a limitation in §8.

### 3.5 Sub-step 11b — chat opportunistic flush

Already shown inline in §3.2's `uploadFiles` (the block right after `uploadError = null`).
Fire-and-forget (`void`), not guarded by the module Set — it is idempotent server-side and
free when the queue is empty (`takeOutboxFor` → `[]` → `"empty"` without any network call).

### 3.6 Sub-step 11c — `UserMenu.svelte`

```ts
import { clearAllOutboxes } from "$lib/uploads/attemptOutbox";
// …
    try {
      await authClient.signOut();                                // :63 unchanged
      // PSOS-04 Amendment F: the next person on this browser must never
      // inherit queued upload-audit rows. Prefix sweep, internally try/caught.
      clearAllOutboxes();                                        // NEW
      await goto(resolve("/login"), { replaceState: true, invalidateAll: true }); // :67
```

`clearAllOutboxes` is already internally try/caught and localStorage-guarded
(`attemptOutbox.ts:186–198`) — it can never block sign-out. Placement analysis in §2.7.

**Flagged addition (§9.2):** the same one-liner after
`src/routes/signup/[token]/+page.svelte:128`'s `await authClient.signOut();`.

---

## 4. Call-order summary (chat happy path / failure path)

```
uploadFiles(files, category)
 ├─ 0. void flushOutboxFor(userId, projectId, record)          (11b, non-blocking)
 ├─ 1. batch = files → {file, attemptKey: crypto.randomUUID()}
 ├─ 2. recordUploadAttempts({attempts: […, no failureCode]})   begin → in_progress rows
 │      └─ throws → console.error, CONTINUE (lost begin tolerated)
 └─ 3. per file:
     ├─ storage POST   (fail → swallowed :453–455, Q3, unchanged)
     ├─ parse          (fail → extractionOutcome:"failed", content:"", unchanged)
     ├─ uploadDocument({…, attemptKey})
     │    ├─ ok  → attempt resolved `succeeded` + documentId, same tx
     │    │        (convex/documents.ts:150–157; dedupe path :123–130)
     │    └─ throws →
     │        recordUploadAttempts([{…, failureCode:"upload_failed"}])   upsert→failed
     │          ├─ ok      → durable failed attempt
     │          ├─ domain error (shouldDropOutboxEntry) → console only
     │          └─ network → appendOutbox(userId, entry)                 ← the outbox case
     │        rethrow → outer catch: uploadError string (unchanged),
     │                  remaining batch entries → same failure recording
     └─ (loop continues only if no throw — today's abort semantics preserved)
```

---

## 5. Failure-mode matrix (after steps 10–11; UI columns are the v1 state — steps 15/17 add the receipt surfaces)

| # | What fails | Where | What is recorded (durable) | What the user sees in v1 |
|---|---|---|---|---|
| 1 | Unsupported type at chat picker | `AgentChatPanel.svelte:725–731` | Attempt `failed` / `rejected_unsupported` | Transient red `uploadError` banner (unchanged); durable row surfaces in step 15 |
| 2 | Unsupported type at wizard staging | `CategoryRow.svelte:46–51`, `PreviousYearRow.svelte:54–59` | **Nothing** (no project yet — ticket §8.4 boundary) | Inline rejected chips (unchanged) |
| 3 | Extraction throws / yields nothing | chat :459–465, wizard :407–417 | **Document row** `could_not_read` (`parse_failed`/`no_text_extracted`); attempt `succeeded` | Chat: "…no readable text was found…" banner (:483–485); wizard: nothing per-file (unchanged) |
| 4 | Storage POST fails, text extracted (Q3) | chat :444–455, wizard :333–347 | Document row (possibly `ready`), `hasFile:false`; attempt `succeeded` | Nothing (unchanged in v1 — human decision, follow-up ticket) |
| 5 | `uploadDocument` throws, server reachable (domain error) | chat per-file catch / wizard :435–439 | Attempt `failed` / `upload_failed` | Chat: generic banner, batch aborts (unchanged); wizard: `skippedFiles` toast (unchanged) |
| 6 | `uploadDocument` throws, network down | same | **Outbox entry** (user-scoped, whitelisted) → flushed to a `failed` attempt on next project visit / chat upload / reload | Same as #5; row appears after flush |
| 7 | Begin batch lost (chat, network down) | new begin call | Nothing yet — per-file failures then follow #6 | — |
| 8 | Batch aborts mid-way (chat) | outer catch :487 | Not-yet-attempted files → attempts `failed` / `upload_failed` immediately (instead of 10-min stale) | Generic banner (unchanged) |
| 9 | Tab closed mid-upload | — | Attempt stays `in_progress`; `listUploadAttempts` displays `failed` after 10 min (`convex/uploadAttempts.ts:168–171`) | Nothing in v1 |
| 10 | Wizard `review_pd` upload throws | :500–508 (wrapped) | Attempt `failed` / `upload_failed`, `origin:"review_pd"` | Commit-catch toast + land on project (unchanged) |
| 11 | Wizard pasted-text/note upload throws | :461–469, :481–489 | **Nothing** (not a file — recorded limitation) | Commit-catch toast (unchanged) |
| 12 | Flush hits deleted project / lost access | page effect | Entries **dropped** (domain error) — no retry loop | Nothing |
| 13 | Flush hits dead network | page effect | Entries **kept**; retried next reload / next chat upload; 7-day TTL bound | Nothing |

**AC4 in one line:** upload failure = `documentUploadAttempts` row (`upload_failed`, no
`documentId`, no document); extraction failure = `projectDocuments` row (`could_not_read`)
with a `succeeded` attempt. Different tables, different types, impossible to conflate.

---

## 6. Testing — what is automatable, what is not

**Automatable (step 10a):** everything in `outboxFlush.test.ts` (§3.1) — the drop-vs-keep
predicate against every error shape the client can see, the wire-payload whitelist, and the
full flush lifecycle against in-memory storage with stubbed `record` functions. This is the
entire *decision logic* of steps 10–11; the components only glue it to `useMutation`.

**Not automatable, and why:** `AgentChatPanel.svelte`, `project/new/+page.svelte`,
`project/[id]/+page.svelte`, and `UserMenu.svelte` all import `convex-svelte` (and the pages
import `$app/*`), which the component harness deliberately excludes (step 13's
presentational contract: the browser config has no `sveltekit()` plugin and no Convex
client; 31 such components are untestable without a mocking layer this ticket does not
fund). `convex-test` covers the server half already (steps 5/7 suites). The seam between
them — "does the catch actually call the helper with the right arguments" — is glue code
verified by `npm run check` (types make wrong wiring fail compilation: `AttemptPayload`,
`OutboxEntry`, and the mutation arg types are all exact) plus the manual checklist.

**Honest coverage limits:** no automated test proves (a) the begin batch fires before the
loop, (b) the `$effect` fires on page load, (c) sign-out sweeps keys. All three are two-line
glue over tested primitives; all three are on the checklist below and re-verified in
steps 15/17 when the UI makes them visible.

## 7. Manual verification checklist

Run against dev (`npm run dev` → :3001) with the dev Convex deployment. Inspect rows via
dashboard or `npx convex run uploadAttempts:listUploadAttempts '{"projectId":"<id>"}'`.

1. **Online happy batch (regression):** chat-upload 2 good files → 2 documents, attempts
   table has 2 `succeeded` rows (dashboard; excluded from `listUploadAttempts`), no outbox
   key in localStorage, `attachments` chips unchanged.
2. **Offline batch (chat):** DevTools → Network → Offline → upload 2 files → generic
   "Upload failed" banner (unchanged copy); `localStorage["banhall.uploadAttemptOutbox.v2:<userId>"]`
   holds 2 entries, none with a `message` field. Go online → reload the project page →
   `listUploadAttempts` shows 2 `failed`/`upload_failed` rows; the localStorage key is gone.
3. **Reload twice → still exactly the flushed rows** (upsert idempotency): reload the
   project page again; row count unchanged; no new rows, no console errors.
4. **Unsupported type (chat):** pick a `.zip` via the picker ("All files" in the OS dialog
   overrides the `accept` filter) → transient banner unchanged; one
   `failed`/`rejected_unsupported` attempt row exists and survives reload.
5. **Wizard commit failure:** fill the wizard, click Generate, cut network after
   "Creating project…" passes (throttle to Offline during the upload progress) →
   skipped-files toast; wizard user's outbox holds `context_input` entries; restore network
   → open the created project → rows flushed to `failed` attempts.
6. **Deleted project (drop path):** queue offline entries for project P (step 2 setup),
   delete P (or revoke access), go online, visit P's URL → entries are **dropped** (key
   gone), no retry loop in the console, no attempt rows.
7. **Two-user shared browser:** as user A, queue offline entries; sign out via the avatar
   menu → **all** `banhall.uploadAttemptOutbox.*` keys gone; sign in as user B, open the
   same project → no flush call, no rows with `createdBy: B`. Repeat via the
   `signup/[token]` "Sign out" button if §9.2 is accepted.
8. **Retry / re-upload (interim semantics):** re-upload a file that failed in step 2's run
   (fresh pick → **new** attemptKey in v1; true same-key Retry is step 17) → new `succeeded`
   attempt + document row; the old `failed` row remains until dismissed — expected interim
   state, resolved by steps 15/17/18.
9. **Stale in-progress (optional, slow):** start a large upload, kill the tab mid-flight;
   after 10 minutes `listUploadAttempts` returns the row with `displayStatus:"failed"`.
10. **`crypto.randomUUID` sanity:** no console errors on :3001 (secure context) — keys in
    the attempts table are lowercase UUIDs.

## 8. Risks and rollback, per sub-step

| Sub-step | Risk | Why real / mitigation | Rollback | Residue |
|---|---|---|---|---|
| 10a | None (no importer) | Pure module + tests | Delete both files | None |
| 10b | Restructured `uploadFiles` changes batch behaviour | Loop-abort semantics deliberately preserved (per-file catch **rethrows**); all user-facing strings byte-identical; diff-review the function against §3.2 | Revert the file | Orphaned `in_progress` rows → read-time staleness + prune-on-write (`ATTEMPT_CAP` 100) |
| 10b | Begin batch = +1 mutation per upload batch | Ticket §12 accepted write amplification; batched, bounded 50 | same | same |
| 10b | >50 failures offline → outbox FIFO drops oldest | `OUTBOX_CAP` 50 by design (Amendment F); recorded | — | — |
| 10c | `recordFailedWizardAttempt` slowing the commit loop | Only runs on failures; never throws; single-entry calls | Revert the file | Valid `failed` rows remain (harmless audit) |
| 11a | Effect double-fire / retry loop | Set added synchronously before any await; `"kept"` never removes from the Set (no reactive loop possible) | Remove module script + effect + import | Entries stay inert under their keys, TTL-bounded |
| 11a | User query unresolved at failure/append time | Skip-append guard (plan res. (c) recorded limitation); frequency unmeasured | — | — |
| 11b | Flush racing the begin batch | Different attemptKeys; upsert; `clearOutboxFor` removes only flushed keys — appended-during-flush entries survive (tested, §3.1 test 8) | Remove the block | None |
| 11c | Clearing before an in-flight flush completes | Analysed §2.7: drop-path `clearOutboxFor` on missing keys is a no-op; nothing resurrected | Remove import + line | None |
| 11 (both) | "kept" flush retries only on next reload/chat upload | Deliberate (§3.4); worst case = durable record delayed, never lost (TTL 7d) | — | — |

Deploy ordering: nothing to order — steps 10–11 are frontend-only against server APIs that
shipped in steps 1–5 (Convex-first ordering already satisfied).

## 9. Deviations from / additions to the authoritative plan — read before review

1. **`failUploadAttempt` is not called in step 10 (plan step-10 text says "per-file and
   batch catches call `failUploadAttempt`").** Failures are recorded via
   `recordUploadAttempts` with `failureCode:"upload_failed"` instead. Reason, verified in
   code: `failUploadAttempt` silently no-ops when no attempt row exists
   (`convex/uploadAttempts.ts:116` — `if (!attempt || attempt.status === "succeeded") return;`).
   If the begin call was lost to a transient network blip that recovered by failure time,
   `failUploadAttempt` loses the record; the upsert inserts it
   (`recordUploadAttempts` docstring even anticipates this use: "to record a client-side
   type rejection … and to flush the offline outbox — all the same call", :39–46).
   Identical terminal-`succeeded` guard on both (:74 vs :116). No server change; no new
   scope; `failUploadAttempt` remains in place for later steps. This is a mechanism
   substitution inside step 10, not a change to resolutions (c)/(e).
2. **Second sign-out call site, not in the plan's file list:**
   `src/routes/signup/[token]/+page.svelte:127–133` signs the current user out so a
   *different person* can accept an invite on the same browser — exactly Amendment F's
   shared-browser scenario. Recommended: the same `clearAllOutboxes()` one-liner after its
   `authClient.signOut()`. This is one file beyond the plan's step-11 list; it implements
   Amendment F's stated behaviour ("sign-out clears every `banhall.uploadAttemptOutbox.*`
   key") rather than new scope, but it is flagged here for explicit reviewer approval
   (PSOS queue rule 5 discipline).
3. **New file `src/lib/uploads/outboxFlush.ts` not named in the plan's step-10/11 file
   lists.** The plan's lists name only the touched components; this module is the
   testability seam (pure core + tests, the same pattern as step 9's `attemptOutbox.ts`).
   Without it, the drop-vs-keep predicate and flush lifecycle would live untested inside
   two `convex-svelte` components. Flagged as an addition.
4. **Chat begin call is chunked (≤50), not literally "one `recordUploadAttempts` before the
   loop".** The server hard-rejects batches over `MAX_BATCH` 50
   (`convex/uploadAttempts.ts:36`, :63–65). Chunking is compliance with the plan's own §4
   ("max 50 entries"), not a deviation; noted for completeness.
5. **Batch-abort honesty block (chat outer catch marks not-yet-attempted files failed).**
   Not spelled out in the plan's step-10 bullet, but implied by "batch catches" and required
   for truthfulness once begin rows exist: without it, stranded files sit `in_progress` for
   10 minutes and then *display* as failed anyway. No user-visible change in v1.
6. **`"kept"` flush result does not clear the module-Set guard** (retry waits for the next
   reload or chat upload). The plan's resolution (c) doesn't specify retry-within-session;
   chosen to make reactive retry loops structurally impossible. Recorded limitation.
7. **Verified-correct plan claims worth restating:** wizard user query at :55 ✓ (:55–57);
   chat needs the `getCurrentUser` one-liner ✓ (none exists today); wizard commit failures
   all occur after `createProject` ✓ (:360 vs :398+); pre-`createProject` rejections have no
   `projectId` ✓ (staging components); `$effect` SSR-safety pattern ✓ (:336–347 unguarded
   `localStorage`); FilesPanel currently has no flush hook ✓.

## 10. What I could not verify

1. **`crypto.randomUUID()` under the oldest browser the firm actually uses.** Baseline since
   2021 (Chrome/Edge 92, Firefox 95, Safari 15.4) and available in the dev/prod secure
   contexts; no polyfill exists in the repo and none is added. If an ancient browser
   matters, the call throws at upload time — visible, not silent.
2. **The exact error *instance* shape convex-svelte surfaces for a `ConvexError` over its
   WebSocket path** (i.e., whether `error.data.code` is always populated vs. the
   `"Uncaught ConvexError: "` string form). `src/lib/errors.ts:6–24` handles **both** forms,
   and the wizard already routes real Convex failures through `userErrorMessage`
   (`+page.svelte:539`) successfully in production — so the predicate covers whichever form
   arrives — but I could not exercise a live failure from this environment. Checklist
   items 2/6 confirm both branches.
3. **`getCurrentUser` resolution timing at failure/append time** (how often the
   skip-append guard actually fires). Same unknown the plan records (its item 6); the guard
   makes it safe, frequency unmeasured.
4. **Convex dashboard visibility of `succeeded` rows** for checklist item 1 (the list query
   excludes them by design; the dashboard data browser shows them — assumed available on the
   dev deployment).
5. **Whether any other `authClient.signOut()` caller exists beyond the two found**
   (`UserMenu.svelte:63`, `signup/[token]/+page.svelte:128`) — grep over `src/` found exactly
   these two; a future caller would silently miss the sweep. A close-out grep is listed in
   step 19's evidence anyway.
6. `docs/design-system.md` was not re-read end-to-end for this pass: steps 10–11 introduce
   **zero** markup/visual changes (all new strings are console-only), so no design-system
   surface is touched. Re-verify at steps 15–17 as the plan already requires.
