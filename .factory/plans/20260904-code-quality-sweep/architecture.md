# Architecture: code quality, performance and agent verification sweep

Nine tickets, one mental model: the repo has exactly two test runners, one gate script that CI and the factory both run, no file that nothing imports, and hot paths that do their work once and skip it when there is none. Principle citations are in brackets and name the principle that changed the decision.

## Invariants

1. `npm test` never opens a browser; `vitest.component.config.ts` never gains `sveltekit()` (`AGENTS.md`, `vitest.component.config.ts:14-22`).
2. Every `*.test.ts` tracked by git is discovered by one of the two vitest configs. Proven by a script, not a comment [23 encode lessons in structure; 9 build the lever].
3. No product code changes to satisfy an obsolete test expectation, and no test is called obsolete because its fixture broke. Every old case maps to a row in `orphan-test-map.md`: migrated unchanged, ported as a real convex-test case, superseded by a named current case, or retired because its contract is dead (one case: `tests/chatProposals.test.ts:777`). The mapping lives in `decisions.tsv`.
4. A deletion ticket deletes; it does not rename, reformat or tidy what stays [1 laziness protocol]. `rg` over `src shared convex scripts` returning nothing is the proof of each deletion.
5. Every performance change ships with a unit test that fails at baseline on a count (timers pending, document traversals) and a golden-output check captured from the baseline implementation, plus the auditor's benchmark before and after. Timing alone is never the criterion [16 prove it works; 24 exit condition as predicate]. An optimisation may not add work to a path that did none: an empty proposal batch walks the document zero times.
6. `?workspace=current` stays the rollback surface; no ticket changes what a user sees on any route except a measured touch-target fix (ui-1) proven by before/after screenshots. workspace-2 (escalated) owns the gate files.
7. CI and `[verify].commands` run the same script [5 minimize reader load; 23].
8. The browser suite becomes a gate only after it is green; a gate that is red at baseline is a suppressed gate [16].
9. Ticket size follows `[sizing]` (2 packages, 6 criteria, 12 files); the idea's "3 to 6 tickets" was a preference, not an exemption.

## Usage

The caller is the next agent or human opening the repo.

Fresh worktree, prove the change:
```
bash scripts/loop-verify.sh
# → [1/7] preflight: node v24.19.0, npm 11.x, pwsh 7.5, PUBLIC_CONVEX_URL=placeholder
# → [2/7] convex tsc … ok 14s
# → [3/7] svelte-check … ok 41s
# → [4/7] vitest … ok 38s
# → [5/7] test discovery … ok (140 files, 0 orphans)
# → [6/7] uploader pwsh … ok 5s
# → [7/7] uploader bash … ok 3s
```
A missing tool fails at step 1 with its name and an install hint. A failing step prints its name and the last lines and exits non-zero.

UI change, prove it on the real surface:
```
npm run test:component        # 51 files at baseline, 52 after perf-1 adds Editor.component.test.ts; exit 0; screenshots under **/__screenshots__/
```
QA runs the same command from `[qa].smoke`.

A test file no runner discovers:
```
node scripts/check-test-discovery.mjs
# → orphan: tests/newThing.test.ts is tracked but no vitest project includes it
# exit 1
```

Proposal preview with twenty pairs: one document walk, one case fold, same highlights as at baseline. Ordinary typing with no preview: zero walks, as at baseline. A 40-page PDF upload: identical text, no timers left behind. The reviewer reruns the measurement from the repo, at any commit:
```
node scripts/bench/editor-search.mjs
# → {"kind":"synthetic_editor_cpu","chars":22790,"proposalPairs":20,"iterations":30,"descendantTraversals":30,…,"matchPositionsSha256":"<same as baseline>"}
# → {"kind":"deadline_helper_only_not_pdf_integration",…,"successfulOperations":201,"pendingAfterCompletion":0}
```

## Change

**tests-1-pure-suites-to-vitest** (refactor; `tests/`, `vitest.config.ts`)
- The ten whole-file pure suites (`diff`, `reportSections`, `reportEdits`, `qaScoring`, `brainScienceRouting`, `generationMode`, `craScienceCodes`, `industries`, `lineLimits`, `exportValidation`) change only their import line. `tests/snapshots.test.ts` and `tests/teamRoster.test.ts` change their import line; `snapshots:83-160` (superseded by `convex/lib/snapshots.test.ts:91,126`) is deleted; the two fake-ctx roster cases (`teamRoster:56,71`) stay for tests-2 to replace.
- `vitest.config.ts:29`: `"tests/aiUsage.test.ts"` becomes `"tests/**/*.test.ts"`; `tests/chatProposals.test.ts` and `tests/projectReviewAccess.test.ts` are excluded by name with a comment naming tests-2. Fallback if edge-runtime rejects a suite: a `tests` project with `environment: "node"`.

**tests-2-real-proposal-access-roster-tests** (refactor; `convex/`, `tests/`)
- New `convex/chatProposalsApply.test.ts` (convex-test, seeded like `convex/reportAuthz.test.ts`) covering the `orphan-test-map.md:30-47` rows against the real endpoints: `applyProposal` (`chatV2.ts:415`: pinned older report vs newer report, `requireUniqueTarget` and legacy `researchSessionId` gates, missing target marks stale then repeat rejected, replay no-op, deletion-only replacement, ordered list, permission table owner / open assignment / closed assignment / unrelated writer denied / manager / admin), `updateProposalWording` (`:624`: wording updated with one audit event, changed target rejected), `rejectProposal` (`:701`: manager, unrelated eligible writer, anonymous), `saveProposal` (`:851`, via a real turn: canonical-target rejection, edit tool association with unique target, same `toolCallId` deduplicated to one row). Rows already covered (`preEditSnapshot.test.ts:162,191`, `reportAuthz.test.ts:406,428,442`) are cited, not duplicated.
- `convex/projectAccess.test.ts`: the unrelated-eligible-writer read case if `reportAuthz.test.ts:248-316` does not already assert it.
- Roster: `getTeamRosterMemberOrNull` proven against real rows through `t.run` (duplicate names resolved by id, anonymous and non-member rejected) and `listTeamRoster` anonymous filtering through `api.users.listTeam`; then `tests/teamRoster.test.ts:56-71` deleted.
- Delete `tests/chatProposals.test.ts` and `tests/projectReviewAccess.test.ts`. `requireProjectCreator` stays (inventory #13).

**tests-3-runner-cleanup-and-guard** (chore; `scripts/`, root configs)
- `vitest.config.ts`: remove the two excludes. `package.json`: remove `@types/bun`. `tsconfig.json:16-18`: remove the `test/**` lines. `bun.lock`: delete (npm is the lockfile CI uses; `bun.lock` only ever served the orphan runner).
- `scripts/check-test-discovery.mjs`: `git ls-files '*.test.ts'` versus `npx vitest list --filesOnly --json=<tmpfile>` for both configs (read from the file; stdout carries a `[vite-plugin-svelte]` warning first); prints orphans; exit 1 on any. Listing the component config needs no Chromium (`orchestrator-review.md:21`, `discovery-without-chromium.log`: exit 0, 51 files with `PLAYWRIGHT_BROWSERS_PATH=/nonexistent`), so the guard can run inside the browser-free gate.

**slop-1-dead-components** (refactor; `src/`): delete the nine abandoned ports (S1). Nothing else.

**slop-3-mywork-island** (refactor; `src/`): delete the eight My Work files (S2). Nothing else.

**slop-2-dead-helpers-and-deps** (refactor; `src/`, `package.json`): unchanged from the first draft (intent wrappers, stage grouping and filtering, `extractSections`, four dependencies).

**perf-1-parser-timers-editor-index** (perf; `src/`, `scripts/`)
- `withDeadline` clears its timer on settle. Same `ParseTimeout`, same absolute deadline; a cumulative-delay test (load 20 s, page 1 at 40 s, page 2 never; resolved at exactly 60 s) rules out a per-call timer, and async-rejection cases prove cleanup on the failure path.
- `normalizeForMatch`, `buildSearchIndex`, `findAllOccurrencesCI` and `Range` move from `Editor.svelte`'s module block into `src/lib/components/editor/docSearch.ts`, plus `findOccurrencesBatch(doc, finds): Range[][]` (index-aligned, so duplicate needles and empty slots need no map) that returns without touching the document when every needle normalises to empty and otherwise builds the index once and lowercases the haystack once [17 fix root causes: the per-needle case fold is the second half of the waste, not just the walk]. `findAllInDoc` and `SIG_WORD` stay in `Editor.svelte` and import the two helpers [1 laziness protocol: a three-mode fuzzy matcher with no golden coverage does not move in a perf ticket]. `buildDecorationSet` and `findReplaceMatches` call the batch once. Golden ranges captured from the baseline implementation (before the move) are literal expectations in `docSearch.test.ts`, so the batch and the moved per-call function cannot agree on a shared regression [16].
- Proof against the real artifact: `src/lib/components/editor/Editor.component.test.ts` mounts `Editor` in Chromium with seeded report JSON and drives `previewProposal`, `clearProposalPreview`, `findReplaceMatches`, `replaceRange` and `highlightText` through the exported handle (`vitest-browser-svelte` exposes exports on `component`); it passes at baseline and at HEAD because it pins behaviour. Walk counts are asserted in node against a spied fixture doc, not in the browser, where four other `descendants` callers make a prototype spy ambiguous [19 confidence ladder: say what each proof proves].
- `scripts/bench/editor-search.mjs` is the plan-dir harness plus one step: when `docSearch.ts` exists it is transpiled and its exports injected into the module-block evaluation. Same fixtures, same counting, same hash, same deadline section; it reproduces 600 / 201 at `11bfe3e` and is the `verify` command [9 build the lever: the harness the reviewer reruns lives in the repo and survives the refactor it measures].

**ui-1-component-suite-green** (bug; `src/`, `ui: true`): one acceptance criterion per triage row in `dx-audit.md:55-64`: routes URL parsed by parts; button class inventory replaced by semantic checks; chrome follows the Settings link and opens the Sign out dialog with real input; rail fixtures seed `isOwner`/`isDeveloper` (`WorkspaceRail.svelte:228`) and assert sanctioned destinations including House rules; header "New project" measured at 390px against the 44px contract and fixed in the header caller if short.

**dx-1-one-verify-entry** (chore; `scripts/`, `docs/`, `.github/`, root files, `.factory/factory.toml`): `loop-verify.sh` preflight and named steps and the discovery step; CI runs the script plus a browser job; `.nvmrc`; README and `env.example`; stale doc recipes marked historical; `[qa].smoke`. README's "running the real app" section states the hermetic recipe from `dx-audit.md:76-86` as the next step for `factory verify-skill`, not as done.

Deleted in this plan: 17 component/helper files, 4 dependencies, 2 legacy bun harness files, 6 test-only exports, the `test/**` tsconfig lines, `bun.lock`, the README template, two stale doc recipes, the CI step list [4 subtract before you add].

## Trace

| Criterion | Lands in | Proof |
|---|---|---|
| tests-1 AC1 twelve files import vitest, unchanged cases | `tests/*.test.ts` (12) | `test "$(rg -l 'bun:test' tests \| wc -l)" -eq 2`; bun pass counts before next to vitest counts after |
| tests-1 AC2 include + two excludes | `vitest.config.ts:29` | `rg -q 'tests/\*\*/\*\.test\.ts' vitest.config.ts`; `npx vitest run tests` |
| tests-1 AC3 stale snapshot case superseded | `tests/snapshots.test.ts` | `decisions.tsv` row; `npx vitest run tests/snapshots.test.ts convex/lib/snapshots.test.ts` |
| tests-2 AC1-AC4 real endpoint cases | `convex/chatProposalsApply.test.ts` | `npx vitest run convex/chatProposalsApply.test.ts`; `rg -q 'updateProposalWording\|rejectProposal' convex/chatProposalsApply.test.ts` |
| tests-2 AC5 access and roster | `convex/projectAccess.test.ts`, `convex/users.test.ts` | targeted runs; `rg -q 'getTeamRosterMemberOrNull' convex/users.test.ts` |
| tests-2 AC6 bun files gone, every row mapped | `tests/` | `! test -e` both; `decisions.tsv` has one row per `orphan-test-map.md:30-47` scenario |
| tests-3 AC1-AC3 cleanup | `vitest.config.ts`, `package.json`, `tsconfig.json`, `bun.lock` | `! rg -q 'bun:test' tests`; `! rg -q '@types/bun' package.json`; `! rg -q '"test/\*\*' tsconfig.json`; `! test -e bun.lock`; `npm run check` |
| tests-3 AC4 guard | `scripts/check-test-discovery.mjs` | `node scripts/check-test-discovery.mjs` exit 0, also with `PLAYWRIGHT_BROWSERS_PATH=/nonexistent`; injected orphan exits 1 |
| slop-1 AC1-AC3 | `src/lib/components/{comments,editor,generation,ui}` | `! test -e` each; `rg` empty; gate; `npm run build` |
| slop-3 AC1-AC3 | `src/lib/components/mywork`, `src/lib/mywork` | `rg` empty; mywork and HomeParity component suites |
| slop-2 AC1-AC6 | see ticket | unchanged from first draft |
| perf-1 AC1-AC2 timers | `src/lib/parseDocument.ts`, `.test.ts` | `vi.getTimerCount()` cases incl. cumulative 20+20+never at 59,999/60,000 ms and three async rejections; fail at baseline |
| perf-1 AC3 one walk, one case fold, zero for empty | `docSearch.ts`, `docSearch.test.ts` | `descendants` spy = 0 for `[]` and `["", "  "]`, 1 for 20 needles; `toLowerCase` receiver-length spy = 1 for 20 needles |
| perf-1 AC4 golden ranges from baseline | `docSearch.test.ts` | literal expected ranges for `findAllOccurrencesCI` captured at `11bfe3e` via the benchmark's module-extraction method |
| perf-1 AC5 `Editor.svelte` wired, `findAllInDoc` stays, exports unchanged | `Editor.svelte` | `rg -q 'docSearch' Editor.svelte`; `rg -q 'function findAllInDoc' Editor.svelte`; `npm run check` |
| perf-1 AC6 real editor + benchmark before/after | `src/lib/components/editor/Editor.component.test.ts`, `scripts/bench/editor-search.mjs`, `.audit/perf-1-…/evidence.md` | browser suite green at baseline and HEAD; 600 → 30 traversals; `matchPositionsSha256` equal; 201 → 0 timers |
| ui-1 AC1-AC5 per triage row | the five test files, `WorkspaceHeader.svelte` (likely), fixtures | targeted component run; `npm run test:component` exit 0 |
| ui-1 AC6 decisions + screenshots | `.audit/ui-1-…/` | one row per row of `dx-audit.md:55-64`; `*before*.png` / `*after*.png` for the header |
| dx-1 AC1-AC6 | `scripts/loop-verify.sh`, `.github/workflows/ci.yml`, `.nvmrc`, `README.md`, `env.example`, `AGENTS.md`, three docs, `.factory/factory.toml` | `rg` predicates in the ticket; gate run output |

Path check at `11bfe3e`: every "lands in" path exists except those marked new (`docSearch.ts`, `docSearch.test.ts`, `Editor.component.test.ts`, `scripts/bench/editor-search.mjs`, `chatProposalsApply.test.ts`, `check-test-discovery.mjs`, `.nvmrc`); verified with `ls`/`rg` during research and revision, and again with Glob/Grep on 2026-09-05 (no `scripts/bench/` yet; no suite under `src/lib/components/editor` or `chat`).

## Alternatives considered

- **One migration ticket for all 14 suites.** Rejected on sizing (21+ files) and on kind: converting imports is mechanical, porting proposal scenarios to real endpoints is judgement work with its own fixture. Three units, each ending in a check [18 sequence work into verifiable units].
- **Colocate the suites beside their modules.** Rejected: cross-runtime imports make `tests/` the honest home; the guard makes discovery mechanical [1].
- **Keep a bun runner.** Rejected: a third runner to drift.
- **Treat `convex/chatProposals.test.ts` as the counterpart of the old proposal suite.** Rejected after re-reading: it drives `markProposalApplied`, the old suite drives `applyProposal`; different endpoints, different gates. The real scenarios are ported, not mapped away.
- **Unconditional batch index in `buildDecorationSet`.** Rejected: baseline does zero walks with no diffs (the common typing case); the batch entry returns early for an empty or all-empty batch.
- **Compare batch results only with the moved per-call function.** Rejected: both could share a regression; golden ranges are captured from the baseline implementation first.
- **Re-pin the header test to `h-8`.** Rejected: the 44px mobile target is a product contract (`docs/product-domain.md:233`); measure at 390px, fix the caller if short.
- **Delete the rail Admin assertions as retired UI.** Rejected: the group exists for `admin && (isOwner || isDeveloper)` (`WorkspaceRail.svelte:228`); the fixture lacked the flags. Fix the fixture, keep structure checks, drop colour-count mirrors.
- **One deletion ticket for all 17 files.** Rejected on sizing; abandoned ports and the My Work island are two islands with two verification sets.
- **Lazy-load the unselected project page shell now.** Deferred pending the product decision about instant `?workspace=current` restoration; the fresh node-closure artifact is `bundle-baseline.json` (inventory #21).
- **Wire the browser suite as a CI job with `continue-on-error`.** Rejected [16].
- **Defer the hermetic harness because signups are invite-only.** Withdrawn: the updated DX audit shows an anonymous local backend plus an imported inviter and invitation drive real signup without any bypass; the deferral reason is implementation scope.

## Risks

`[risky_domains]`: none apply. tests-2 writes tests against auth-gated endpoints but changes no auth code; the permission table it adds pins the current `requireReportEditAccess` contract (`roleCapabilities.ts:82`) and must never weaken it.

- Deletions and branches elsewhere: a `codex/*` or lane branch importing a deleted file fails `npm run check` on rebase with the file name. Rollback: revert the ticket's merge commit.
- tests-1 under edge-runtime: fallback to a node-environment `tests` project; never `sveltekit()`.
- tests-2 fixture effort: real turns for `saveProposal` need `chatTurns.test.ts`-style seeding (`:740,1262`); reuse those helpers. If a scenario cannot reach the real endpoint without a fake db, record it in `deferred` with the exact blocker instead of faking.
- perf-1 golden capture: done before moving the helpers, using the benchmark's module-extraction method. The maintained harness `scripts/bench/editor-search.mjs` is written and proven at baseline (600 / 201) before any helper moves; the plan-dir original stays as the baseline artifact and is never edited.
- perf-1 browser suite: `Editor.svelte` imports only Kit-free children and `svelte-tiptap`, all pre-bundled by the component config; if the mount still needs a stub, add it to `vitest.component.config.ts` aliases as the workspace suites do, never `sveltekit()`.
- ui-1 header fix touches a shared primitive only if the measurement proves the caller cannot fix it alone; default is a caller-local mobile min size. Screenshots before and after at 390px and desktop.
- ui-1 routes file overlaps escalated workspace-2 on different lines; the engine's overlap check flags it; the ticket edits only `:52-55` and records the overlap.
- dx-1: CI needs `pwsh` (present on `ubuntu-latest`) and Chromium (installed in the job).
- `package.json` and `package-lock.json` are touched by tests-3 and slop-2 (dx-1 does not edit them); both now list the files in `touches`, so the engine's prefix match sees them for overlap and parallel checks. `max_parallel` is 1 this run, so merges are serial and conflicts are textual.

Rollback path for every ticket: revert its merge commit; no data, schema or deployment state changes.

## Non-goals

- Any user-visible change beyond the measured touch-target fix in ui-1.
- `.factory/verify/` and the hermetic harness (inventory #29; next step named).
- Schema, index or projection changes (inventory #18-#23).
- Consolidating duplicate helpers (inventory #9); deleting `listProjects`, `requireProjectCreator` (inventory #13-#14).
- An ESLint setup.
- Touching workspace-2's files beyond `workspaceRoutes.component.test.ts:52-55`.

## Revision

Orchestrator review (`orchestrator-review.md`) applied on 2026-09-04, before any ticket ran:
- [high] Failing proposal cases are no longer inferred obsolete; every row of `orphan-test-map.md` is mapped, nine failures are fixture gaps, one is a dead contract. → tests-1 narrowed, tests-2 added.
- [high] `convex/chatProposals.test.ts` (`markProposalApplied`) is no longer cited as `applyProposal` coverage; real endpoint scenarios are ported. → tests-2, research S3, this file.
- [medium] Roster lookup coverage goes through `getTeamRosterMemberOrNull` against real rows, not only `listTeam`. → tests-2 AC5.
- [medium] Sizing: migration split in three, deletions split in two. → nine tickets.
- [medium] Header failure is measured at 390px against the 44px contract, not re-pinned to `h-8`. → ui-1 AC5.
- [high] Rail Admin group is not retired; fixtures get `isOwner`/`isDeveloper`; chrome follows the Settings link and Sign out dialog. → ui-1 AC3-AC4, per `dx-audit.md:55-64`.
- [high] Empty batch performs zero traversals. → perf-1 AC3, invariant 5.
- [medium] Golden ranges captured from the baseline implementation. → perf-1 AC4.
- [medium] Hermetic backend is feasible; deferral reason is scope. → research inventory #29, README section in dx-1.
- [low] Inventory says "planned", not "fixed". → research.

Validation 1 (`validation-1.md`, verdict request_changes) applied on 2026-09-05, before any ticket ran. Every `[high]` and `[medium]` is fixed in place; the orchestrator-review items the validator found unapplied (root files in `touches`, compatible harness, real Editor suite) are now applied and listed here.
- [high] perf-1 `verify` ran the plan-dir benchmark, which breaks once `findAllOccurrencesCI` leaves the module block. → `scripts/bench/editor-search.mjs`: same fixtures, counting, hash and deadline section; injects `docSearch.ts` exports when the file exists; proven at baseline first; `verify` and `done_when` point at it; plan-dir original untouched [9 build the lever; 16].
- [high] slop-1 `verify` included `src/lib/components/ui`, red at baseline (`Button.component.test.ts:46`) with no dep on ui-1. → `verify` names the nine suites green at baseline near the deleted files; no new dep, so slop-1 still runs independently [24 exit condition as a checkable predicate; 1 laziness protocol over serialising behind ui-1].
- [high] perf-1 AC6 cited `projectRoute.component.test.ts` (never mounts Editor) and non-existent editor/chat suites, leaving `findReplaceMatches` typecheck-only. → `Editor.component.test.ts` under the component config drives the exported handle on a seeded report; its command is in `verify`; the projectRoute claim is gone [16 prove it works; 22 a verdict needs a run].
- [medium] perf-1 AC2 could not detect a per-call deadline reset and named a synchronous `getDocument` throw. → cumulative case (20 s + 20 s + never, pending at 59,999 ms, resolved at 60,000 ms with `pdfPageStopMarker(2)`) and three async rejection cases (`loadingTask.promise`, `getPage`, `getTextContent` after a prior page) [19 confidence ladder].
- [medium] perf-1 moved `findAllInDoc` with goldens only for `findAllOccurrencesCI`. → `findAllInDoc` and `SIG_WORD` stay in `Editor.svelte` and import the two helpers; `done_when` pins `function findAllInDoc` in `Editor.svelte` [1 laziness protocol].
- [medium] perf-1's batch still lowercased the whole haystack per needle. → AC3 requires one index build and one case fold per non-empty batch; a `toLowerCase` receiver-length spy proves it [17 fix root causes].
- [medium] `touches` omitted root files. → tests-1 `[tests, vitest.config.ts]`; tests-3 adds `vitest.config.ts, package.json, package-lock.json, tsconfig.json, bun.lock`; slop-2 adds `package.json, package-lock.json`; dx-1 adds `.github, README.md, env.example, .nvmrc, .factory/factory.toml`; perf-1 adds `scripts` [9a blast radius before the first edit].
- [low] dx-1 AC4 listed two unread env names and missed `PUBLIC_BUILD_TIME`. → exactly `PUBLIC_CONVEX_URL`, `PUBLIC_CONVEX_SITE_URL`, `PUBLIC_BUILD_TIME`, each with its reader; the `rg -o` equality check is the proof [12 parse at the boundary: list what the boundary reads].
- [low] tests-3 assumed listing the component config needs no Chromium. → the orchestrator's follow-up already proved it (`orchestrator-review.md:21`, `discovery-without-chromium.log`); AC4 now requires the `PLAYWRIGHT_BROWSERS_PATH=/nonexistent` run in evidence and reads vitest's JSON from `--json=<file>`, never stdout [16].
- [low] slop-2 named tests-1 as owner of `@types/bun` and left `bun.lock` to reviewer judgement. → "`@types/bun` and `bun.lock` are tests-3's; do not touch either here" [22b the brief is the product].
- [low] dx-1 `verify` duplicated `[verify].commands`. → `verify: []`, with the reason in the ticket [1].
- [low] perf-1 notes misstated the module-block range. → the four moved symbols are named with their lines (`:88`, `:96-104`, `:113-146`, `:256-284`); the block spans `:30-672` [25 write it clean].
- [low] tests-1 edits 13 files against the 12-file hint: accepted as written; twelve one-line import swaps plus one config line, pin is mechanical [18].
- [low] tests-2 `risky: []` while testing auth-gated endpoints: accepted as written; the ticket edits no auth code and `confirm = auto` makes the flag inert [11].
Ticket keys unchanged. perf-1 now touches seven files (`parseDocument.ts`, its test, `docSearch.ts`, its test, `Editor.svelte`, `Editor.component.test.ts`, `scripts/bench/editor-search.mjs`), two packages, six criteria; still within `[sizing]`, so it is not split.

## Orchestrator closeout of validation 2

The medium documentation drift finding is accepted: dx-1 now updates the Running and verifying bullets in AGENTS.md, the historical browser-gate note, and system-map Q8 alongside CI. The actual PUBLIC_CONVEX_SITE_URL consumer is uploader setup, not the authClient comment. UI acceptance counts all discovered suites rather than fixing the baseline count. Project bundle deferral now cites the recorded fresh build and retains the product decision as its reason. The second reviewer reported no high findings; these concrete scope corrections satisfy its remaining requested changes before execution.

## Upload-read addendum

Add `perf-2-empty-upload-reads` as a tenth independent ticket. `upload-read-addendum.md` traces its four criteria to `convex/documents.ts`, the existing `documents.test.ts`, the existing upload-attempt tests and the public transaction-metrics runner. The only production change guards the existing dedupe collection with its existing nonempty-content predicate after access validation. There is no schema or API delta. The root independently reproduced baseline 3 queries / 5 document reads / 301074 bytes with three bodies and verified the named-test completion gate fails when absent. The existing document/upload-attempt suites pass with assertions required (33 tests). This replaces the metric-based PERF-3 deferral; larger document indexing remains deferred. Independent addendum review is in `upload-read-review.md`; main validation-2 covered only the preceding nine tickets.

## Runtime-discovered duplicate extension

The passing real Editor baseline exposed duplicate Underline registration. The source and actual headless editor proof are in `underline-registration-proof.md` and its executable. Extend pending slop-2 AC4 with the two-line explicit registration removal in `src/lib/tiptapConfig.ts` and keep its dependency declaration. Eleven implementation files, six criteria, same refactor scope. Add a dependency on perf-1 so its real editor browser suite verifies this registration cleanup. This was discovered during execution, not included in plan validation-2; independent source and actual-command verification supports the narrow addendum.

## Sequential deadline proof follow-up

Add `proof-1-parser-budget-sequence` after perf-1. Root and independent performance review found its two 20-second fake delays start eagerly together; the production optimization was approved and QA passed, so this is a correction to the existing test fixture and its intermediate phase assertions. `parser-budget-addendum.md` traces the exact callback mechanics; `parser-budget-review.md` independently approves factory parsing, syntax, baseline source-guard failure and the eager negative control. Only two existing test files change, with no new test count or production edits. This eleventh ticket will run after the current ten-ticket engine selection finishes; it is required before sweep closeout.
