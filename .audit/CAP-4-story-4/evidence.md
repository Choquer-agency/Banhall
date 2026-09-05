# CAP-4 story 4 evidence

Implementation revision: `0af7a0fbded31bf53d7b70be2e69b626c9d068bd`.
Canonical baseline: `8d00a441c61279fa8fdbcb0015db1d9e95880eec`.

Implemented independent per-stream diversity admission, exact admitted provenance, separate operational attempts, and administrator inspection. Four independent reviewers completed; seven patches applied, zero new deferrals, nine findings rejected. The story is done; native final run acceptance remains the orchestrator's responsibility.

## Acceptance and matrix mapping

| Requirement | Executed verification |
| --- | --- |
| One writer / one project cannot qualify | Parameterized actual action tests cover all five streams and preserve source rows. |
| Mixed streams omit failures without pooling | Six-comments, no-pooling, four-admitted, and shared-five-minimum tests inspect actual actions, provider calls and saved rows. |
| Missing attribution excluded before diversity | Tests check missing writer/project counts, unique excluded totals and overlapping reasons. |
| Exact admitted inputs determine output | Tests inspect exact IDs, producer counts and cutoff; actual provider message contains exact admitted section/proposal fields and counts. |
| Omitted-only updates do not redistill | Second action sees a newer omitted event, makes no second provider call and leaves immutable candidate/selection untouched. |
| Supported, unsupported and failed distillation | Tests cover both kinds, safe provider/parse failure attempts, no fabricated candidate, and unchanged publication. |
| Producer contributions reflect actual writers | Coherent per-project fixtures use production user document IDs; mixed comments/edits count the same human once. |
| Admin sees candidates, skips, legacy metadata | Actual Chromium page tests use distinct argument-specific QA/style fixtures, inspect scoped counts, open disclosures, verify exact IDs, and preserve privacy gates. |
| Internal admission data stays restricted | Actual history query denies unauthenticated, writer and manager callers; old rows retain absent metadata. |
| Private source content and metadata stay out of provider payload | Intercepted requests exclude IDs, omitted records and known identifiers; stored source records stay intact. |

## Final parent command results

- `npx vitest run convex/learning.test.ts`: [35 tests passed](parent-targeted-final.log).
- `npm test`: [148 files and 1869 tests passed](parent-full-final.log).
- `npx tsc -p convex/tsconfig.json --noEmit`: [exit 0](parent-types-final.log).
- `PUBLIC_CONVEX_URL=https://example.convex.cloud npm run check`: [zero errors and warnings](parent-check-final.log).
- `npx vitest run --config vitest.component.config.ts --no-file-parallelism src/routes/admin/reviews/reviewsPublishGate.component.test.ts`: [canonical startup failure](parent-browser.log), Rolldown cannot resolve its virtual runtime `node:module` with `Tsconfig not found`, before any tests execute.
- `npx vitest run --config .audit/CAP-4-story-4/component-diagnostic.config.ts --no-file-parallelism src/routes/admin/reviews/reviewsPublishGate.component.test.ts`: [11 actual Chromium tests passed](parent-browser-final.log). The [audit-only wrapper](component-diagnostic.config.ts) imports the normal config and applies optimizer tsconfig/builtin settings locally; repository component configuration remains unchanged.
- `git diff --check` and staged whitespace check: exit 0, no diagnostics.

## Regression and visual evidence

Both controlled mutations that replace an admitted edit payload block with `[]` fail the targeted test: [section failure](review-empty-sections-mutation.log), [proposal failure](review-empty-proposals-mutation.log), [exit-code record](review-payload-mutation-results.json). The original action was restored before final passing runs.

Screenshots render the real page in Chromium with deterministic query fixtures: [baseline](reviews-before.png), [final collapsed details](reviews-final-collapsed.png), [expanded exact provenance](reviews-final-expanded.png). The parent directly inspected the final collapsed screenshot and production/source test diffs. These are component-rendered fixtures, not a live production session.

## Integrity and limits

[Protected-byte comparison](protected-bytes.json) verifies all forbidden files and native ledger bytes against the full baseline. Generated APIs also have no diff. No ledger entries were authored, staged or changed. [Decision trail](decisions.tsv) is append-only.

De-identification remains best effort. Counts describe bounded recent windows, and freshness retains the existing maximum timestamp rule. Latest attempts are operational records, while candidate metadata remains immutable. The environment's canonical browser optimizer issue remains documented; the actual page suite passes with the isolated wrapper. No push or deployment occurred.

## Follow-up review verification

Reviewed implementation revision: `1cec4e4723daa99afcab36ecb8856149d655126b`.
The follow-up patch adds exact QA provider payload proof, mixed valid/missing attribution within one stream, and admitted private edit-field scrubbing with source preservation in `convex/learning.test.ts`. Four review layers produced four applied patches (three medium, one low), zero new deferrals and nine rejected findings.

- `npm test`: [148 files, 1870 tests pass](followup-full.log).
- `PUBLIC_CONVEX_URL=https://example.convex.cloud npm run check`: [zero errors/warnings](followup-check.log).
- `npx tsc -p convex/tsconfig.json --noEmit`: [exit 0](followup-types.log).
- `npx vitest run --config vitest.component.config.ts --no-file-parallelism src/routes/admin/reviews/reviewsPublishGate.component.test.ts`: [canonical startup failure reproduced](followup-canonical-browser.log).
- `npx vitest run --config .audit/CAP-4-story-4/component-diagnostic.config.ts --no-file-parallelism src/routes/admin/reviews/reviewsPublishGate.component.test.ts`: [11 Chromium tests pass](followup-browser.log).
- Replacing the QA provider payload with an empty array: [new assertion fails](followup-qa-mutation.log). `git diff --exit-code -- convex/ai/learning.ts` then exits 0, proving exact restoration.
- [Protected-byte check](followup-protected-bytes.json): every forbidden file and the native deferred-work ledger match the recorded baseline SHA-256. Ledger bytes remain untouched.

The browser optimizer limitation persists. The story's follow-up review recommendation is true (score 10). Native final run acceptance remains outside this agent's completion claim.

Follow-up logs preserve command output with ANSI colors and trailing whitespace removed. Focused command `npx vitest run convex/learning.test.ts`: [36 tests pass](followup-targeted.log).

## Additional follow-up review

Reviewed starting revision: `6f7731c88e733e2690fc52eda20e81b983281ffa`.
Four review layers completed. This pass applies two medium test patches and one low evidence patch, with zero deferrals and nine rejected findings. Production files remain unchanged from the starting revision.

- Complete ordered scoring payloads now have distinct comments, valid 4–9 human scores and distinct QA scores. Exact QA, section, proposal and approved-feedback assertions also distinguish each admitted row.
- The [controlled scoring truncation](rereview-scoring-truncation.log) fails the new assertion; [mutation evidence](rereview-mutation.json) records exit 1 and exact production restoration.
- [Commands and exit codes](rereview-commands.json) record every check, including silent TypeScript success. [36 focused tests](rereview-targeted.log), [1870 tests in 148 files](rereview-full.log), [zero Svelte errors/warnings](rereview-check.log), and [11 Chromium tests](rereview-browser.log) pass.
- The [canonical browser startup failure](rereview-canonical-browser.log) persists. Actual page tests pass with the existing isolated audit wrapper; no repository browser configuration change was made.
- [Protected-byte evidence](rereview-protected-bytes.json) matches all eight forbidden source paths and the native deferred-work ledger against the recorded baseline. No ledger bytes were authored, reopened, rewritten or staged.

The existing acceptance mapping above remains applicable. Follow-up review recommendation is true (score 7). Native final run acceptance remains outside this completion claim.

Verified test artifact SHA-256: `bb5be95cf27c380dff27848e42212d26c4617a44c8d2fd4d020062b6a57b5dd0`.
