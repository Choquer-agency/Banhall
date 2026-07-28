# PSOS-04 — Amendment A2 decision record

*Recorded 2026-07-27. Binding decision made under delegated authority for the open
Amendment A2 question in [`PSOS-04-implementation-plan.md`](./PSOS-04-implementation-plan.md).
No source file was modified by this pass; this document is the implementation spec.*

## Decision

**Option (ii): add an exact-literal `stripIngestPrefix()` applied inside
`deriveStoredProcessing` only, so legacy prefix-only rows derive `could_not_read`
instead of `ready`; the matcher strips exactly one leading
`[Previous-year report — fiscal <number>]` line and nothing else (deliberately NOT the
`Note: …` line).**

## Rationale

1. **The false direction of the error is the worse one, and it is the one we currently
   ship.** A legacy scanned previous-year PDF renders "Ready for AI" on day one of the
   receipt. The user — explicitly a low-tech user per the ticket's problem statement —
   trusts a report generated without that file's content. The failure is silent and may
   never be discovered. The opposite mistake (a readable file labelled "Could not read")
   costs one re-upload, which under Amendments A+B produces a fresh, truthfully-labelled
   row — the error self-corrects through the exact action the receipt suggests.
   Additionally, `getContextDocsForGeneration` filters only
   `content.trim().length > 0` (`convex/documents.ts:247`), so a prefix-only row
   *passes* the filter and reaches the model as a `previous_pd`-categorised document
   whose entire text is one line of boilerplate — "Ready for AI" is wrong about the
   receipt AND the row is noise in generation. "Could not read" is truthful on both
   counts and prompts the one action (re-upload) that can actually improve the report.

2. **Waiting is not neutral — the lie is being frozen right now.** `copyProjectInputRows`
   (`convex/projects.ts:412-423`) persists
   `doc.processingStatus ?? deriveStoredProcessing(doc)` onto every duplicated row.
   Every project duplication that touches a legacy prefix-only row **writes `ready`
   permanently** into the copy, behind the backfill's "patch only when undefined" guard.
   Option (i) ("accept, let the follow-up ticket deal with it") therefore degrades over
   time: each duplication converts a read-time-correctable row into one needing a
   `force` migration. Option (ii) fixes the duplication path too, because it fixes the
   one function all three legacy-row consumers share (`listDocuments` fallback
   `convex/documents.ts:179-181`, `copyProjectInputRows`, the deferred backfill).

3. **It is cheap, contained, and reversible by design.** Amendment D deferred the
   backfill precisely so that statuses stay derived at read time and "fixing the pure
   function self-corrects every legacy row" (plan, Amendment A2 paragraph). Nothing is
   persisted by `listDocuments`; deleting the strip call restores prior behaviour
   instantly for every listed row. The change is ~10 lines in one pure module plus
   tests.

4. **The heuristic risk is negligible when the matcher is exact-literal.** The general
   "strip any leading bracket line" rule proposed in the option sketch is rejected. The
   matcher below matches only the byte-exact string the wizard writes (including the
   em-dash and trailing newline), anchored at position 0. The only document it can
   mislabel is one whose *entire* extracted text is exactly
   `[Previous-year report — fiscal <number>]` — a document that contains nothing usable
   anyway, so even the theoretical misfire produces a defensible status.

5. **Scope: this is in scope, not expansion.** The ticket's decision log already
   committed to legacy truth: the read-time-fallback row exists so that "Existing
   documents get truthful statuses immediately" (PSOS-04.md decision log, 2026-07-27),
   and the ticket's purpose line is "Low-tech users need one obvious receipt." A receipt
   that confidently mislabels the known-mislabelled population on day one does not
   deliver that acceptance surface; fixing the derivation the ticket itself introduced
   is completing PSOS-04's own contract, not new scope under queue rule 5. The plan also
   explicitly parked A2 as a decision *inside this ticket* — deciding and implementing
   it here is the recorded path, and Amendment D's deferral was designed to keep exactly
   this option open.

**Why not (iii):** content surgery rewrites user-visible stored `content`, is
irreversible, must itself embed the same matching heuristic (so it carries all of (ii)'s
matching risk with none of its reversibility), and contradicts the repo's established
derive-at-read pattern (invites expiry, attempt staleness). Rejected.

## Blast radius analysis

*The production database cannot be queried from this environment; the population is
reasoned from code. The shape is exact; only the count is unknown.*

**Exactly one call site ever attaches a prefix.** The wizard's `uploadFile` takes
`prefix = ""` by default (`src/routes/project/new/+page.svelte:398-402`) and sends
`content: prefix + parsed.content` (`:420`). A non-empty prefix is passed at exactly one
call site — the previous-year loop (`:436-440`):

```
`[Previous-year report — fiscal ${row.year}]\n${noteLine}\n`
```

where `row.year` is a `number` (`updatePyYear(id: string, year: number)` `:271`;
`minYear - 1` arithmetic `:281-282`) and
`noteLine = row.note.trim() ? `Note: ${row.note.trim()}\n` : ""` (`:434`).

**Every other ingress is clean:**

- Wizard non-previous-year categories call `uploadFile(file, cat.id)` with the default
  empty prefix (`:459-461`) — an unreadable file stores `""` and already derives
  `could_not_read` correctly.
- Wizard pasted category text is guarded `if (s.text.trim())` (`:462`) — never
  boilerplate-only.
- Wizard standalone previous-year note is guarded `row.note.trim()` (`:443`) — its
  content `[Previous-year note — fiscal <year>]\n\n<note>` always carries real user
  text.
- Chat uploads (`AgentChatPanel.uploadFiles`) send raw `parsed.content` — no prefix.
- `review_pd` content is pre-validated non-empty by `handlePdFile` (`:211-231`).

**Affected population, precisely:** `projectDocuments` rows with
`source: "context_input"`, `category: "previous_pd"`, a real file extension, uploaded
before Amendment A ships, where extraction yielded no text (scanned PDF, corrupt file,
parse throw → catch at `:409-414` stores `content: ""` into the prefix). Their stored
content is exactly:

- No note: `"[Previous-year report — fiscal <N>]\n\n"` → **flips to `could_not_read`**
  under this decision (correct).
- With note: `"[Previous-year report — fiscal <N>]\nNote: <user note>\n\n"` → **stays
  `ready`** (deliberate — see spec: the note is real user text that generation consumes).

Plus **duplicates of the no-note rows** created by project duplication
(`convex/projects.ts:408-426`) — with the caveat that duplicates made after PSOS-04
steps 1–5 deployed already have the wrong status *persisted* (see limits).

Realistic fraction: previous-year reports are the category most likely to be old scans,
so the affected path is plausibly the single most failure-prone upload category in the
product — small in absolute rows, but concentrated on exactly the files the receipt
exists to flag.

## Exact implementation spec

**One file changes: `shared/documentStatus.ts`.** Add, in the derivation section:

```ts
/**
 * PSOS-04 Amendment A2: before Amendment A, the wizard's previous-year path
 * stored `prefix + parsed.content`, so an unreadable file persisted this exact
 * boilerplate line and wrongly derived `ready`. Stored rows can no longer tell
 * boilerplate from extracted text, so stored-row derivation strips exactly this
 * one literal line before measuring. Exact-match on purpose: the em-dash, the
 * wording, the numeric year, and the trailing newline must all match — a
 * genuine document beginning with any other bracketed line is untouched.
 * The `Note: …` line is deliberately NOT stripped: it is the user's own text,
 * it is stored, and generation consumes it — a row carrying it is truthfully
 * `ready`. Never applied to live uploads (Amendment A stores "" going forward).
 */
const LEGACY_PY_PREFIX_RE = /^\[Previous-year report — fiscal -?\d+(?:\.\d+)?\]\n/;

export function stripIngestPrefix(content: string): string {
  return content.replace(LEGACY_PY_PREFIX_RE, "");
}
```

Change `deriveStoredProcessing` (currently `:217-226`) to pass the stripped content:

```ts
export function deriveStoredProcessing(row: {
  fileName: string;
  content: string;
}): DerivedProcessing {
  return deriveProcessingStatus({
    fileName: row.fileName,
    content: stripIngestPrefix(row.content),
    intake: getFileExtension(row.fileName) === "" ? "pasted" : "file",
  });
}
```

**Matching rule, spelled out:** anchored at index 0 (`^`, no `m` flag), case-sensitive,
requires the literal text `[Previous-year report — fiscal ` (U+2014 em-dash), a number
(`-?\d+(?:\.\d+)?` — `row.year` is a JS number and `minYear - 1` can in principle go
negative or a user can type a non-integer), the literal `]`, and a trailing `\n`. Strips
at most one occurrence. Note the stripped remainder still feeds `hasTruncationMarker`
unchanged — markers live at the tail, the strip removes only the head line.

**What must NOT change:**

- `deriveProcessingStatus` itself — the live upload path derives from raw content; after
  Amendment A the wizard sends `""` for unreadable files, so live content is never
  prefix-only. The trust-boundary story ("facts in, status out") stays untouched.
- `uploadDocument` (`convex/documents.ts:44-159`) — no new call; it uses live facts.
- `getContextDocsForGeneration` (`convex/documents.ts:239-250`) — generation behaviour
  is out of scope per the ticket; the prefix-only row keeps reaching generation until
  the user acts on the truthful receipt or the follow-up ticket lands.
- The `Note:` line, the standalone-note prefix `[Previous-year note — fiscal <N>]`, and
  the pasted-category content — none are matched or stripped.
- Amendment A (forward fix) and Amendment B (empty-content dedupe skip) — unchanged and
  still required; this decision is read-side only.

**Callers that pick the fix up automatically (no edits needed):** `listDocuments`
fallback (`convex/documents.ts:179-181`), `copyProjectInputRows`
(`convex/projects.ts:412-414`), and the deferred backfill migration (Amendment D), which
must continue to route through `deriveStoredProcessing` and gains a `force` arg per the
already-filed follow-up.

**Sequencing:** land with (or immediately after) plan step 8 (Amendment A), before
step 15 ships the receipt UI. It is a pure-module change gated by the existing test
suite; no deploy-ordering hazard (Convex-first ordering already covers it).

## Test plan

Add to `src/lib/uploads/documentStatus.test.ts` (or the shared module's existing test
home). All go through `deriveStoredProcessing` unless noted.

**Flips (the fix):**
1. `{fileName: "scan.pdf", content: "[Previous-year report — fiscal 2024]\n\n"}` →
   `could_not_read` / `no_text_extracted`.
2. Different years: `fiscal 1999`, `fiscal -1`, `fiscal 2024.5` → all strip → same result.

**Must NOT flip (adversarial):**
3. Prefix + real extracted text →
   `"[Previous-year report — fiscal 2024]\nActual report text…"` stays `ready` /
   `text_extracted`.
4. Prefix + note, no extracted text →
   `"[Previous-year report — fiscal 2024]\nNote: called the client about this\n\n"`
   stays `ready` (pinned as deliberate: the note is stored user text that generation
   consumes).
5. Standalone note doc: `{fileName: "Previous-year note (FY 2024)", content:
   "[Previous-year note — fiscal 2024]\n\nText"}` → `ready` / `pasted_text` ("note" ≠
   "report"; no strip; extensionless → pasted).
6. Genuine document legitimately beginning with a different bracket line:
   `"[DRAFT]\nReal content"` and `"[Previous-year report]\nReal content"` (no
   `— fiscal <N>`) → untouched, `ready`.
7. ASCII hyphen instead of em-dash:
   `"[Previous-year report - fiscal 2024]\n\n"` → NOT stripped → stays `ready`
   (proves exact-literal matching; such a row cannot exist from our writer anyway).
8. Prefix appearing mid-content, not at index 0 → untouched.
9. Prefix line with no trailing newline (`"[Previous-year report — fiscal 2024]"` as the
   entire content) → NOT stripped by the regex → stays `ready`. Accepted: the wizard
   always writes the newline, so this shape cannot come from our writer.
10. Truncated doc: prefix + text + `CAP_TRUNCATION_MARKER` at tail → `ready_truncated`
    (strip does not disturb tail scanning).

**Boundary of the fix:**
11. `deriveProcessingStatus` (live path) with prefix-only content still returns `ready`
    — pins that the live path is untouched and documents *why* Amendment A must send
    `""` (extends the existing Amendment A hazard test).
12. Integration (`convex/projects.test.ts` or `documents.test.ts`): duplicating a legacy
    prefix-only row (no stored status) persists `could_not_read` on the copy, not
    `ready`.
13. `stripIngestPrefix` unit: strips at most one line
    (`"[…fiscal 2024]\n[…fiscal 2023]\nText"` keeps the second line).

## What this does NOT fix

- **Rows with the wrong status already persisted.** Two known writers: (a) any
  previous-year unreadable upload made *after* PSOS-04 steps 1–5 deployed (server-side
  derivation live, `uploadDocument` writes `processingStatus` at insert) but *before*
  Amendment A ships — those persisted `ready` at write time; (b) any project
  duplication of a legacy prefix-only row in that same window. The read-time fallback
  never fires for them. Home: the deferred backfill migration's `force` mode
  (Amendment D follow-up), run after this lands. The window is small (same ticket) but
  not zero, and must be stated in the close-out.
- **Prefix-with-note rows.** They keep `ready` by design; the receipt says "Ready for
  AI" about a row whose usable text is the user's note, not the file. Truthful about
  the stored content, silent about the file. The extraction-metadata follow-up ticket is
  the home for per-file provenance.
- **Generation noise.** Prefix-only rows still pass `getContextDocsForGeneration`'s
  filter until the user re-uploads or removes them. Generation behaviour is explicitly
  out of scope for PSOS-04.
- **The theoretical exact-collision document** (entire extracted text is exactly the
  prefix line): labelled `could_not_read`. Accepted — such a document has no usable
  text in any meaningful sense.

## Reversal path

Delete the `stripIngestPrefix` call from `deriveStoredProcessing` (keep or delete the
helper) and drop the tests. Because Amendment D keeps legacy statuses derived at read
time, every `listDocuments` row re-derives the old way on the next query — instant,
complete, no data touched. Residue: rows duplicated via `copyProjectInputRows` while the
fix was live have `could_not_read` persisted; if reversal is ever needed *and* those are
deemed wrong, the Amendment D `force` backfill rewrites them from the then-current
derivation. No stored `content` is ever modified under this decision, so there is
nothing irreversible anywhere in it.
