# Evidence · tests-2-real-proposal-access-roster-tests
commit: c755e003c7027135c9adf5ac3e67c617ddc7cce5   branch: factory/tests-2-real-proposal-access-roster-tests   baseline: aad4788d44fb1abb7229260f7757b3b5d733c181   date: 2026-09-05T09:05:00Z   kind: refactor

The coverage, gate and pin sections below were first written at d9ee062. Their
counts and every `convex/chatProposalsApply.test.ts` line pointer are now resolved
against the c755e00 tree, the only tree this file describes; the earlier d9ee062
pointers were stale by roughly 34 lines because the reader-parity block landed at
:255-287. `## Independent review corrections` and `## Re-verification, attempt 1`
record what changed at c755e00 and what was re-run against it.

## Coverage
- AC1 pinned report + audit tuple, newest report untouched → convex/chatProposalsApply.test.ts:290 `edits the pinned report, leaves the project's newest report untouched` ✓   [ladder 4]
- AC1 requireUniqueTarget + legacy researchSessionId gates, STALE_REVISION, no writes → convex/chatProposalsApply.test.ts:330 `a single-target proposal (%s) refuses an ambiguous repeated passage` (2 cases) ✓   [ladder 4]
- AC1 missing target → `{applied:false,count:0}`, stale, no snapshot, repeat INVALID_INPUT → convex/chatProposalsApply.test.ts:364 ✓   [ladder 4]
- AC1 replay of an applied proposal is a no-op → convex/chatProposalsApply.test.ts:387 ✓   [ladder 4]
- AC1 empty replacement deletes the target, one revision bump → convex/chatProposalsApply.test.ts:405 ✓   [ladder 4]
- AC1 ordered replacement list, exact prose, count 2, one bump → convex/chatProposalsApply.test.ts:420 ✓   [ladder 4]
- AC2 Consultant with an open assigned work item succeeds → convex/chatProposalsApply.test.ts:456 ✓   [ladder 4]
- AC2 Consultant denied once the assignment is closed → convex/chatProposalsApply.test.ts:465 ✓   [ladder 4]
- AC2 unrelated eligible Consultant denied (and is the project creator) → convex/chatProposalsApply.test.ts:488 ✓   [ladder 4]
- AC2 Manager succeeds on a project it does not own → convex/chatProposalsApply.test.ts:504 ✓   [ladder 4]
- AC2 durable Owner success, Admin success, anonymous denial with no writes → cited, not duplicated: convex/reportAuthz.test.ts:428, :442, :406 (comment at convex/chatProposalsApply.test.ts:450-454)   [ladder 4, existing tests]
- AC2 production gate untouched → `git diff --stat convex/chatV2.ts convex/lib convex/schema.ts convex/_generated` is empty   [ladder 4]
- AC3 updateProposalWording stores wording, target unchanged, exactly one proposalWordingEditEvents row → convex/chatProposalsApply.test.ts:515 ✓   [ladder 4]
- AC3 updateProposalWording rejects a changed target, proposal and event rows unchanged → convex/chatProposalsApply.test.ts:543 ✓   [ladder 4]
- AC3 rejectProposal for Manager and unrelated eligible writer → convex/chatProposalsApply.test.ts:578 (2 cases) ✓   [ladder 4]
- AC3 rejectProposal anonymous denied, no writes → convex/chatProposalsApply.test.ts:589 ✓   [ladder 4]
- AC3 edge: rejecting an applied proposal is INVALID_INPUT (current behaviour, pinned) → convex/chatProposalsApply.test.ts:603 ✓   [ladder 4]
- AC4 saveProposal rejects a target copied from an unapplied candidate, no new row → convex/chatProposalsApply.test.ts:682 ✓   [ladder 4]
- AC4 saveProposal stores tool + prompt association, requireUniqueTarget, pending → convex/chatProposalsApply.test.ts:701 ✓   [ladder 4]
- AC4 saveProposal dedupes by toolCallId (same id, one row; edge: a retry with different wording returns the first row untouched) → convex/chatProposalsApply.test.ts:727 ✓   [ladder 4]
- AC5 unrelated eligible writer internal read → NOT already asserted at convex/reportAuthz.test.ts:248-316 (its eligible table at :265 uses the project's Owner, plus Manager and Admin), so added at convex/projectAccess.test.ts:125 ✓   [ladder 4]
- AC5 getTeamRosterMemberOrNull over real rows: duplicate display name resolved by id, anonymous record refused, missing id refused → convex/users.test.ts:32 ✓   [ladder 4]
- AC5 api.users.listTeam excludes anonymous records → convex/users.test.ts:74 ✓   [ladder 4]
- AC5 tests/teamRoster.test.ts keeps only its two pure label cases → tests/teamRoster.test.ts:19,29; `! rg -q 'MutationCtx|QueryCtx' tests/teamRoster.test.ts` exit 0   [ladder 4]
- AC6 both fake-db files deleted → `! test -e` both, exit 0   [ladder 4]
- AC6 one decisions.tsv row per scenario → 32 `map` rows = 20 orphan-test-map.md scenarios (the combined :541-569 reader row was superseded by one row per actor at c755e00) + 10 projectReviewAccess cases + 2 teamRoster cases; dispositions 18 ported / 12 covered / 2 retired   [ladder 4]
- AC6 no product code changes → `git diff --stat convex/chatV2.ts convex/lib` empty   [ladder 4]

## Gates
| command | exit | note |
| --- | --- | --- |
| `npx vitest run convex/chatProposalsApply.test.ts convex/projectAccess.test.ts convex/users.test.ts tests/teamRoster.test.ts` | 0 | 4 files, 38 tests |
| `bash scripts/loop-verify.sh` | 0 | tsc + svelte-check + full vitest (140 files, 1516 tests) + both uploader harnesses |
| `test -f convex/chatProposalsApply.test.ts` | 0 | |
| `rg -q 'updateProposalWording' convex/chatProposalsApply.test.ts` | 0 | |
| `rg -q 'rejectProposal' convex/chatProposalsApply.test.ts` | 0 | |
| `rg -q 'getTeamRosterMemberOrNull' convex/users.test.ts` | 0 | |
| `! test -e tests/chatProposals.test.ts` | 0 | |
| `! test -e tests/projectReviewAccess.test.ts` | 0 | |
| `! rg -q 'MutationCtx|QueryCtx' tests/teamRoster.test.ts` | 0 | |

## Output tails
### npx vitest run convex/chatProposalsApply.test.ts convex/projectAccess.test.ts convex/users.test.ts tests/teamRoster.test.ts
```
 RUN  v4.1.10 /Users/johnnynguyen/Documents/Repos/Banhall/.factory/worktrees/tests-2-real-proposal-access-roster-tests

 Test Files  4 passed (4)
      Tests  38 passed (38)
   Duration  1.25s (transform 677ms, setup 0ms, import 550ms, tests 1.16s, environment 191ms)
```
### bash scripts/loop-verify.sh
```
1788597276888 COMPLETED 5862 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS
 RUN  v4.1.10 /Users/johnnynguyen/Documents/Repos/Banhall/.factory/worktrees/tests-2-real-proposal-access-roster-tests
 Test Files  140 passed (140)
      Tests  1516 passed (1516)

50 passed, 0 failed        (scripts/client-uploader/tests/run-tests.ps1)
18 passed, 0 failed        (scripts/client-uploader/tests/run-tests.sh)
```

## Pin
The two fake-db suites were run with Bun at the baseline tree before anything was
deleted. Full logs: `pin-chatProposals-baseline.log`, `pin-projectReviewAccess-baseline.log`.

```
$ bun test tests/chatProposals.test.ts
 12 pass
 10 fail
 57 expect() calls
Ran 22 tests across 1 file. [103.00ms]

$ bun test tests/projectReviewAccess.test.ts
 10 pass
 0 fail
 44 expect() calls
Ran 10 tests across 1 file. [28.00ms]
```

The ten failures are all fixture rot (the handmade db lacks `writerProfiles`/`houseStyle`/`workItems`
tables and current turn state), not behaviour changes; the one dead contract is
`:777 apply allows an unrelated authenticated writer`. Bun 1.3 prints no per-case
line for passes, so the case-level mapping is recorded in `decisions.tsv` instead:
32 `map` rows, one per scenario, each carrying `ported:`, `covered:` or `retired:`.
Every passing old case has a `ported` or `covered` row; every failing old case has a
`ported` row except `:777`, which is `retired`.

## After
Equivalence on the real artifact: the same scenarios now run against the real
Convex functions in the gate.

- `npx vitest run convex/chatProposalsApply.test.ts convex/projectAccess.test.ts convex/users.test.ts tests/teamRoster.test.ts` → 38 passed, exit 0.
- Full gate `bash scripts/loop-verify.sh` → exit 0: tsc clean, svelte-check 0 errors over
  5862 files, 140 vitest files / 1516 cases green, both uploader harnesses green. The
  migrated cases now run inside that gate; at the baseline they ran in no gate at all
  (`vitest.config.ts` excluded both files by name).
- Assertions fail loud (ladder 4): three expectations were deliberately inverted —
  the unrelated-writer denial (`NOT_AUTHORIZED` → `NO_ERROR`), the newest-report
  isolation (`revisionNumber` 2 → 3), and the `toolCallId` dedupe (1 row → 2) — and
  exactly those three cases failed (`3 failed | 17 passed`). Reverted immediately;
  the committed file is the unmutated one.

Reader load fell: 1008 lines of handmade database and its mirrored query builder
are gone; the replacement is 754 lines that call the real endpoints.

## Live surface
untested: this ticket adds no UI and touches no product code (`ui: false`). The
runtime surface it exercises is the Convex backend, driven for real by
convex-test through `api.chatV2.applyProposal`, `api.chatV2.updateProposalWording`,
`api.chatV2.rejectProposal`, `internal.chatV2.saveProposal`, `api.users.listTeam`
and `getProjectAccess`. A human wanting the same proof by hand:
`bash scripts/loop-verify.sh`.

## Not proven
- SUPERSEDED at c755e00, kept as history: `listProposals` per-role read parity was
  claimed here as helper-covered rather than proven. It is now proven directly at
  `convex/chatProposalsApply.test.ts:255-287`, which calls the real query for Manager,
  Admin and an unrelated eligible writer through persisted thread, turn and proposal
  rows and asserts the proposal ID. It is no longer unproven.
- Concurrent apply of two proposals targeting the same paragraph (ticket edge case,
  explicitly out of scope). Not seeded; see `deferred`.
- `convex/lib/auth.ts:66 requireProjectCreator` is now untested. It has no production
  caller and the ticket forbids testing or repurposing it (`orphan-test-map.md:20`).
  To confirm it is still callerless: `rg -n 'requireProjectCreator\b' convex src`.

## Independent review corrections, 2026-09-05T08:44:36Z

This section supersedes the earlier claims that reader-role parity was covered and
that the ordered replacement assertion proved exact prose. The earlier artifacts
and mapping rows remain unchanged as history. This correction makes no product
changes. Tested source SHA-256: `13da3dca5517958b2f4e566b677dab372648dfa2dcf98493975af017af22b7fe`.

### Correction coverage
- AC1: `convex/chatProposalsApply.test.ts:420` compares the entire final editor JSON
  with the expected single paragraph, alongside count 2 and revision 8. The former
  substring assertion did not prove the entire document. [ladder 4]
- AC4: `convex/chatProposalsApply.test.ts:669-681` freezes timers before the three
  real `sendMessage` fixtures, then clears pending timers before restoring real
  timers. No timer drain and no provider mock were added. The scheduled
  `streamChatReply` action is intentionally left queued; the real `saveProposal`
  mutations run against that turn. [ladder 4 for the proposal endpoint; scheduled
  provider execution is outside this test and was not exercised]
- AC6: `convex/chatProposalsApply.test.ts:255-287` adds Manager, Admin and unrelated
  eligible writer rows through `api.chatV2.listProposals`. Each identity is a new
  user with no project creator, owner or assignment relationship. Real
  `agentChatThreads` and `chatTurns` rows connect the persisted proposal, and the
  returned ID list must equal `[f.proposalId]`. [ladder 4]
- The anonymous reader remains covered on the actual mapped endpoint at
  `convex/chatTurns.test.ts:1532-1545` and passes in the full gate.
- Four appended mapping rows supersede the former combined `:541-569` covered
  row: three `ported` positive actors and one `covered` anonymous actor. There are
  now 32 physical map rows (28 historical + 4 superseding) and 31 effective scenario
  mappings when the superseded combined row is excluded. The other 27 historical
  mappings retain their dispositions. Append-only history explains the difference
  from the earlier 28-row count.
- The historical reader-parity entry is resolved. The two remaining deferred
  items are concurrent overlapping applies (explicitly out of scope) and the
  callerless `requireProjectCreator` helper (ticket forbids changing it).

### Verification after correction
| command | exit | result |
| --- | --- | --- |
| `npx vitest run convex/chatProposalsApply.test.ts convex/projectAccess.test.ts convex/users.test.ts tests/teamRoster.test.ts` | 0 | 4 files, 38 tests; initial and restored final runs |
| `npx vitest run convex/chatProposalsApply.test.ts -t "listProposals reader roles"` with test-only mismatched mapping | 1 expected | all 3 actor assertions fail on empty IDs; exact source restored in finally |
| `bash scripts/loop-verify.sh` | 0 | Convex tsc, svelte-check 0 errors/0 warnings, 140 files/1516 tests, PowerShell uploader 50 pass, Bash uploader 18 pass |
| all eight `done_when` commands, serially | 0 each | exact commands and individual statuses in `fix-predicates.log` |
| baseline product-file diff and `git diff --check` | 0 | `fix-scope-check.log`; only correction test and assigned ticket modified |

The mapping-loss negative control changed only the newly added test's thread
mapping from `cpa-thread` to `cpa-unmapped-thread`. The actual query then returned
`[]`, and each actor's expected proposal-ID assertion failed. It did not change
product code or run provider work. The final targeted run and full gate used the
restored source. The negative-control test names say "for a" because a grammar
correction changed the final names to "to" before both the full gate and the final
predicate run; the assertions and mapping were unchanged by that wording edit.

The prior baseline pin remains valid; no rerun of the unsafe real-timer fixture
was needed to reconfirm the source-proven scheduling defect. No shared backend or
provider was accessed. UI and concurrent applies remain outside this ticket.
The transcript is not exposed in an `agent-transcripts` directory for this task;
trail review uses the recorded command outputs, source diff and these artifacts.

### New output tails

### fix-targeted-initial.log
```text
$ npx vitest run convex/chatProposalsApply.test.ts convex/projectAccess.test.ts convex/users.test.ts tests/teamRoster.test.ts

 RUN  v4.1.10 /Users/johnnynguyen/Documents/Repos/Banhall/.factory/worktrees/tests-2-real-proposal-access-roster-tests


 Test Files  4 passed (4)
      Tests  38 passed (38)
   Start at  01:40:08
   Duration  1.23s (transform 646ms, setup 0ms, import 540ms, tests 1.09s, environment 264ms)


exit: 0

```

### fix-reader-negative-control.log
```text
+ []

 ❯ convex/chatProposalsApply.test.ts:285:55
    283|       .query(api.chatV2.listProposals, { threadId: "cpa-thread" });
    284|
    285|     expect(proposals.map((proposal) => proposal._id)).toEqual([f.propo…
       |                                                       ^
    286|   });
    287| });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/3]⎯


 Test Files  1 failed (1)
      Tests  3 failed | 20 skipped (23)
   Start at  01:40:43
   Duration  639ms (transform 269ms, setup 0ms, import 205ms, tests 265ms, environment 49ms)


exit: 1
```

### fix-loop-verify.log
```text
ok    AC1 zero-result block reports walked, per-reason skips, extensions, OneDrive
ok    edge empty folder reports zeros and 'Extensions seen: none'
ok    AC1 extension histogram is capped at 8, ties broken alphabetically
ok    edge ext_of matches .NET GetExtension for dotfiles and bare names
ok    AC3 root_state answers ok / is_file / missing
ok    AC3 a file path prints 'That path is a file, not a folder' and exits 1
ok    AC3 a folder passes and a missing path reports 'does not exist'
ok    AC2 an unreadable file logs READ_ERROR and never calls the endpoint
ok    AC2 control: a readable file does reach the stubbed endpoint
ok    AC2 sha256_of returns nothing for an unreadable or missing file
ok    AC1 under_onedrive answers yes / no / unknown
ok    AC5 scripts/loop-verify.sh runs this harness exactly once
ok    AC5 an injected failing case exits non-zero
ok    shape banhall-uploader.sh uses no bash 4 constructs
ok    shape every function is defined above the lib-only guard

18 passed, 0 failed

exit: 0

```

### fix-predicates.log
```text
exit: 0

$ ! test -e tests/projectReviewAccess.test.ts
exit: 0

$ ! rg -q 'MutationCtx|QueryCtx' tests/teamRoster.test.ts
exit: 0

$ npx vitest run convex/chatProposalsApply.test.ts convex/projectAccess.test.ts convex/users.test.ts tests/teamRoster.test.ts

 RUN  v4.1.10 /Users/johnnynguyen/Documents/Repos/Banhall/.factory/worktrees/tests-2-real-proposal-access-roster-tests


 Test Files  4 passed (4)
      Tests  38 passed (38)
   Start at  01:42:36
   Duration  2.25s (transform 1.87s, setup 0ms, import 1.33s, tests 2.15s, environment 251ms)

exit: 0

```

### fix-scope-check.log
```text
$ git diff --exit-code aad4788d44fb1abb7229260f7757b3b5d733c181 -- convex/chatV2.ts convex/lib convex/schema.ts convex/_generated src shared scripts package.json package-lock.json
exit: 0

$ git diff --check
exit: 0

$ git status --short
 M .factory/tickets/tests-2-real-proposal-access-roster-tests.md
 M convex/chatProposalsApply.test.ts
exit: 0

```

## Correction commit
commit: c755e003c7027135c9adf5ac3e67c617ddc7cce5   branch: factory/tests-2-real-proposal-access-roster-tests   baseline: aad4788d44fb1abb7229260f7757b3b5d733c181   date: 2026-09-05T08:45:19Z   kind: refactor

`git status --short` is empty after this commit. The current deferred frontmatter
contains only the two open items. The resolved reader item's exact original text
is preserved in the ticket's Correction result section and historical evidence.
Audit artifacts remain ignored for the engine to collect, following factory rules;
the test and current ticket metadata are committed.

## Correction trail review, 2026-09-05T08:50:08Z

Review was dispatched with `model: gpt-5.5`. It found no behavioral flags and two
low readability flags: the original top-level commit header predates the
correction, and correction planning rows retain initial states. The historical
header and rows remain unchanged under the append-only rule. The new
`fix-current-proof.md` index identifies current commit `c755e003c7027135c9adf5ac3e67c617ddc7cce5` and the final
proof artifacts, and appended closure rows resolve those planning checkpoints.

The reviewer used committed source and captured outputs. It did not rerun tests
or inspect an unavailable private transcript. Its self-label followed the
inherited generic GPT-6 persona; the stated review model is the explicit tool
dispatch configuration. No product/test source changed after verification.

## Re-verification, attempt 1 (2026-09-05T08:56Z)

This implement run made no source change: the delivered tree at c755e00 already
satisfies every acceptance criterion. What this run adds is a fresh verdict on
that exact SHA (principle 22a: a prior session exiting 0 is not this run's proof),
plus two evidence corrections above — the header now names the current commit, and
the `## Not proven` reader-parity bullet is marked superseded because
`convex/chatProposalsApply.test.ts:255-287` now proves it directly.

| command | exit | note |
| --- | --- | --- |
| `npx vitest run convex/chatProposalsApply.test.ts convex/projectAccess.test.ts convex/users.test.ts tests/teamRoster.test.ts` | 0 | 4 files, 38 tests; `a1-targeted.log` |
| `bash scripts/loop-verify.sh` | 0 | Convex tsc, svelte-check 5862 files 0 errors, 140 files / 1516 tests, uploader harnesses 50 and 18 pass; `a1-loop-verify.log` |
| the seven file and rg predicates | 0 each | `a1-predicates.log` |
| `git diff --stat aad4788..HEAD -- convex/chatV2.ts convex/lib convex/schema.ts convex/_generated src` | 0 | empty: no product code changed |

### npx vitest run (targeted four files)
```
 RUN  v4.1.10 /Users/johnnynguyen/Documents/Repos/Banhall/.factory/worktrees/tests-2-real-proposal-access-roster-tests


 Test Files  4 passed (4)
      Tests  38 passed (38)
   Start at  01:52:26
   Duration  1.25s (transform 677ms, setup 0ms, import 550ms, tests 1.16s, environment 191ms)

exit=0
```
### bash scripts/loop-verify.sh
```
ok    AC4 symlink to an allowed file is skipped and counted under link
ok    AC1 argument prefix is prepended to the relative path
ok    AC1 zero-result block reports walked, per-reason skips, extensions, OneDrive
ok    edge empty folder reports zeros and 'Extensions seen: none'
ok    AC1 extension histogram is capped at 8, ties broken alphabetically
ok    edge ext_of matches .NET GetExtension for dotfiles and bare names
ok    AC3 root_state answers ok / is_file / missing
ok    AC3 a file path prints 'That path is a file, not a folder' and exits 1
ok    AC3 a folder passes and a missing path reports 'does not exist'
ok    AC2 an unreadable file logs READ_ERROR and never calls the endpoint
ok    AC2 control: a readable file does reach the stubbed endpoint
ok    AC2 sha256_of returns nothing for an unreadable or missing file
ok    AC1 under_onedrive answers yes / no / unknown
ok    AC5 scripts/loop-verify.sh runs this harness exactly once
ok    AC5 an injected failing case exits non-zero
ok    shape banhall-uploader.sh uses no bash 4 constructs
ok    shape every function is defined above the lib-only guard

18 passed, 0 failed
loop-verify exit=0
```
### done_when predicates
```
--- test -f convex/chatProposalsApply.test.ts
exit=0
--- rg -q 'updateProposalWording' convex/chatProposalsApply.test.ts
exit=0
--- rg -q 'rejectProposal' convex/chatProposalsApply.test.ts
exit=0
--- rg -q 'getTeamRosterMemberOrNull' convex/users.test.ts
exit=0
--- ! test -e tests/chatProposals.test.ts
exit=0
--- ! test -e tests/projectReviewAccess.test.ts
exit=0
--- ! rg -q 'MutationCtx|QueryCtx' tests/teamRoster.test.ts
exit=0
```

The eighth predicate is the targeted vitest run above.


## Re-verification, attempt 2 (2026-09-05T09:05Z) — stale Coverage pointers

Findings file: `findings-1.md`, one `[medium/act]` item: the `## Coverage` section
carried d9ee062 line numbers after the reader-parity block landed at
`convex/chatProposalsApply.test.ts:255-287`, so 18 pointers resolved roughly 34 lines
short of the case each row named, and the reader-load sentence still said 703 lines.

Verified before acting, not taken on trust: `git diff --stat d9ee062 c755e00` shows
only the ticket file and `convex/chatProposalsApply.test.ts` changed, so no other
file's pointers could have gone stale. Each claimed pointer was then resolved
against the working tree.

### What changed (audit file only; no source, no product code)
| row | was | now | resolves to |
| --- | --- | --- | --- |
| AC1 pinned report | :256 | :290 | `test("edits the pinned report, leaves the project's newest report untouched"` |
| AC1 unique-target / legacy gates | :296 | :330 | `test.each([` (2 cases) |
| AC1 missing target | :330 | :364 | `test("a missing target marks the proposal stale and cannot be retried"` |
| AC1 replay no-op | :353 | :387 | `test("re-applying an applied proposal is a no-op"` |
| AC1 empty replacement | :371 | :405 | `test("an empty replacement deletes the target with one revision bump"` |
| AC1 ordered replacement | :386 | :420 | `test("an ordered replacement list yields the exact prose with one revision bump"` |
| AC2 Consultant, open assignment | :416 | :456 | `test("a Consultant with an open assigned work item may apply"` |
| AC2 Consultant, closed assignment | :425 | :465 | `test("a Consultant is denied once the assignment is no longer open"` |
| AC2 unrelated eligible Consultant | :448 | :488 | `test("an unrelated eligible Consultant is denied, even as the project creator"` |
| AC2 Manager | :464 | :504 | `test("a Manager may apply on a project it does not own"` |
| AC2 cited-rows comment | :409-413 | :450-454 | `// The remaining rows of this table are already proven …` |
| AC3 wording stored | :475 | :515 | `test("stores the new wording, leaves the canonical target, writes one audit row"` |
| AC3 wording rejects target change | :503 | :543 | `test("refuses to change the replacement targets and writes nothing"` |
| AC3 reject, Manager + unrelated writer | :538 | :578 | `test.each([["manager"], ["unrelatedWriter"]] as const)(` |
| AC3 reject, anonymous | :549 | :589 | `test("an anonymous caller cannot reject, and nothing is written"` |
| AC3 reject an applied proposal | :563 | :603 | `test("an applied proposal cannot be rejected"` |
| AC4 unapplied-candidate target | :631 | :682 | `test("rejects a target copied from an unapplied candidate"` |
| AC4 tool + prompt association | :650 | :701 | `test("stores the tool and prompt association for a valid pending edit"` |
| AC4 toolCallId dedupe | :676 | :727 | `test("deduplicates a repeated tool execution by toolCallId"` |

Also corrected: the `## After` reader-load sentence now says 754 lines
(`wc -l convex/chatProposalsApply.test.ts` = 754, not the d9ee062 count of 701), and
the header note no longer claims every d9ee062 claim still held, because the
pointers did not.

Pointers left as they were, each re-resolved and correct at c755e00:
`convex/reportAuthz.test.ts:248, :406, :428, :442`, `convex/projectAccess.test.ts:125`,
`convex/users.test.ts:32, :74`, `tests/teamRoster.test.ts:19,29`. Those four files are
unchanged between d9ee062 and c755e00.

`decisions.tsv` rows 1-73 were not edited; 11 rows were appended (74-84).

### Resolver (the check a reviewer reruns)
Every `file:line` in the `## Coverage` section is resolved against the working tree
and the line it lands on is printed:

```python
import re, pathlib
lines = pathlib.Path(".audit/tests-2-real-proposal-access-roster-tests/evidence.md").read_text().split("\n")
start, end = lines.index("## Coverage"), lines.index("## Gates")
for row in lines[start:end]:
    for f, n in re.findall(r"([\w./-]+\.test\.ts):(\d+)", row):
        print(f"{f}:{n} -> {pathlib.Path(f).read_text().split(chr(10))[int(n)-1].strip()[:96]}")
```

25 pointers printed, each on the test, describe or comment its row names. No row
resolves to an unrelated case. [ladder 4]

### Gates re-run at c755e00
| command | exit | note |
| --- | --- | --- |
| `npx vitest run convex/chatProposalsApply.test.ts convex/projectAccess.test.ts convex/users.test.ts tests/teamRoster.test.ts` | 0 | 4 files, 38 tests |
| `bash scripts/loop-verify.sh` | 0 | `a2-loop-verify.log`: tsc, svelte-check, 140 files / 1516 tests, both uploader harnesses |
| all eight `done_when` predicates, serially | 0 each | `a2-predicates.log` |
| `git status --porcelain` | 0 | empty; the tree is unchanged at c755e00 |
| `git diff --stat aad4788 HEAD -- convex/chatV2.ts convex/lib convex/schema.ts convex/_generated` | 0 | empty |

No commit was made this attempt. The correction is entirely inside `.audit/`, which
is gitignored by design and copied out by the engine; the product tree already at
`c755e00` is the one the gates above ran against.

#### bash scripts/loop-verify.sh
```
ok    AC3 root_state answers ok / is_file / missing
ok    AC3 a file path prints 'That path is a file, not a folder' and exits 1
ok    AC3 a folder passes and a missing path reports 'does not exist'
ok    AC2 an unreadable file logs READ_ERROR and never calls the endpoint
ok    AC2 control: a readable file does reach the stubbed endpoint
ok    AC2 sha256_of returns nothing for an unreadable or missing file
ok    AC1 under_onedrive answers yes / no / unknown
ok    AC5 scripts/loop-verify.sh runs this harness exactly once
ok    AC5 an injected failing case exits non-zero
ok    shape banhall-uploader.sh uses no bash 4 constructs
ok    shape every function is defined above the lib-only guard

18 passed, 0 failed
exit: 0
```

#### done_when predicates
```
$ test -f convex/chatProposalsApply.test.ts
exit: 0
$ rg -q 'updateProposalWording' convex/chatProposalsApply.test.ts
exit: 0
$ rg -q 'rejectProposal' convex/chatProposalsApply.test.ts
exit: 0
$ rg -q 'getTeamRosterMemberOrNull' convex/users.test.ts
exit: 0
$ ! test -e tests/chatProposals.test.ts
exit: 0
$ ! test -e tests/projectReviewAccess.test.ts
exit: 0
$ ! rg -q 'MutationCtx|QueryCtx' tests/teamRoster.test.ts
exit: 0
$ npx vitest run convex/chatProposalsApply.test.ts convex/projectAccess.test.ts convex/users.test.ts tests/teamRoster.test.ts
exit: 0
```

## QA · 2026-09-05T09:12:00Z · claude-code/claude-fable-5-1
commit: c755e003c7027135c9adf5ac3e67c617ddc7cce5   verdict: test-verified
| check | result | ladder | note |
| --- | --- | --- | --- |
| gates: `bash scripts/loop-verify.sh` | passed | 4 | exit 0; tsc clean, svelte-check 5862 files 0 errors, vitest 140 files / 1516 tests, uploader harnesses 50 + 18 |
| ticket verification: targeted vitest + 7 `done_when` predicates | passed | 4 | 4 files / 38 tests exit 0; each predicate run verbatim, exit 0 |
| smoke | skipped | 1 | `smoke=''`; nothing configured |
| criteria coverage AC1-AC6 | passed | 4 | every criterion has a covering test that ran in the gate and asserts it (list below) |
| evidence audit | passed | 4 | commit = HEAD; all 25 Coverage pointers plus the reportAuthz/projectAccess/users/teamRoster/chatTurns/preEditSnapshot citations resolve to the named case; gate counts match my run; 32 map rows = 22 old chatProposals cases + 10 projectReviewAccess cases (18 ported / 12 covered / 2 retired) |
| kind proof (refactor pin rerun) | skipped | 3 | `git checkout <baseline> -- tests/…` and `bun test` are outside the QA allowlist. Implementer pin logs show 12 pass / 10 fail and 10 pass / 0 fail; `git diff aad4788..HEAD -- convex/chatV2.ts convex/lib convex/schema.ts convex/_generated src` is empty, so the code the pin exercised is unchanged |
| live drive | skipped | – | no verify skill; `ui: false`; surface is the Convex backend driven by convex-test |
| side effects | passed | 4 | `git status --porcelain` empty before and after; no product-file diff since baseline |

### Output tails
#### bash scripts/loop-verify.sh (exit 0)
```
1788599414739 COMPLETED 5862 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS
 Test Files  140 passed (140)
      Tests  1516 passed (1516)
50 passed, 0 failed
18 passed, 0 failed
```
#### npx vitest run convex/chatProposalsApply.test.ts convex/projectAccess.test.ts convex/users.test.ts tests/teamRoster.test.ts (exit 0)
```
 Test Files  4 passed (4)
      Tests  38 passed (38)
   Start at  02:09:42
   Duration  1.15s
```
#### done_when predicates, run verbatim one per call
`test -f convex/chatProposalsApply.test.ts`, `rg -q 'updateProposalWording' …`, `rg -q 'rejectProposal' …`, `rg -q 'getTeamRosterMemberOrNull' convex/users.test.ts`, `! test -e tests/chatProposals.test.ts`, `! test -e tests/projectReviewAccess.test.ts`, `! rg -q 'MutationCtx|QueryCtx' tests/teamRoster.test.ts` → all exit 0.

### Criteria coverage (verified)
- AC1 pinned report + audit tuple, newest untouched → convex/chatProposalsApply.test.ts::edits the pinned report, leaves the project's newest report untouched ✓ asserts new content, revision 7→8, hash, provenance cleared, latest report content and revision unchanged, one snapshot with provenance/generation/transcript/sourceRevision 7, none on latest   [4]
- AC1 requireUniqueTarget + legacy researchSessionId → ::a single-target proposal (%s) refuses an ambiguous repeated passage (2) ✓ STALE_REVISION; report, proposal rows deep-equal before; no snapshot   [4]
- AC1 missing target → ::a missing target marks the proposal stale and cannot be retried ✓ `{applied:false,count:0}`, state stale, no snapshot, content unchanged, retry INVALID_INPUT   [4]
- AC1 replay → ::re-applying an applied proposal is a no-op ✓ `{applied:true,count:0,alreadyApplied:true}`, report row deep-equal, snapshot count equal   [4]
- AC1 empty replacement → ::an empty replacement deletes the target with one revision bump ✓ count 1, target gone, revision 8   [4]
- AC1 ordered list → ::an ordered replacement list yields the exact prose with one revision bump ✓ count 2, whole editor JSON equals expected, revision 8   [4]
- AC2 Consultant open assignment → ::a Consultant with an open assigned work item may apply ✓   [4]
- AC2 Consultant closed assignment → ::a Consultant is denied once the assignment is no longer open ✓ NOT_AUTHORIZED, report unchanged   [4]
- AC2 unrelated eligible writer → ::an unrelated eligible Consultant is denied, even as the project creator ✓ NOT_AUTHORIZED, report/proposal/snapshot unchanged   [4]
- AC2 Manager → ::a Manager may apply on a project it does not own ✓   [4]
- AC2 durable Owner / Admin / anonymous → convex/reportAuthz.test.ts:428 (owner = project ownerId), :442 (admin), :406 (rejectedActors includes "no identity", report/proposal/snapshot ids unchanged); cited in comment at chatProposalsApply.test.ts:450-454   [4, ran in gate]
- AC2 production gate untouched → diff of convex/chatV2.ts, convex/lib, convex/schema.ts, convex/_generated empty   [4]
- AC3 wording stored → ::stores the new wording, leaves the canonical target, writes one audit row ✓ targetText unchanged, newText, wordingEditedBy, count 1, exactly one proposalWordingEditEvents row with original/edited text   [4]
- AC3 changed target rejected → ::refuses to change the replacement targets and writes nothing ✓ INVALID_INPUT, proposal deep-equal, zero events   [4]
- AC3 rejectProposal Manager + unrelated writer → ::an internal %s may reject a pending proposal (2) ✓ state rejected   [4]
- AC3 rejectProposal anonymous → ::an anonymous caller cannot reject, and nothing is written ✓ NOT_AUTHENTICATED, proposal deep-equal   [4]
- AC3 edge (applied then reject) → ::an applied proposal cannot be rejected ✓ INVALID_INPUT, state stays applied   [4]
- AC4 unapplied-candidate target → ::rejects a target copied from an unapplied candidate ✓ ok:false with reason, zero proposal rows; turn seeded via real `sendMessage` under fake timers   [4]
- AC4 valid edit → ::stores the tool and prompt association for a valid pending edit ✓ one row with agentThreadId, toolCallId, promptMessageId, requireUniqueTarget true, pending   [4]
- AC4 toolCallId dedupe → ::deduplicates a repeated tool execution by toolCallId ✓ same result thrice incl. different wording, one row, first wording kept   [4]
- AC5 unrelated writer internal read → reportAuthz.test.ts:265 eligible table is owner/manager/admin only (checked), so convex/projectAccess.test.ts::grants internal access to an eligible writer unrelated to the project ✓ kind internal, user id, via getProjectAccess and getInternalProjectAccessOrNull   [4]
- AC5 getTeamRosterMemberOrNull → convex/users.test.ts::selects by users-table id, and refuses anonymous or missing rows ✓ real rows via t.run, two same-name users resolved by id, anonymous row present but null, deleted id null   [4]
- AC5 listTeam excludes anonymous → convex/users.test.ts::keeps anonymous records out of the selectable roster ✓   [4]
- AC5 teamRoster keeps two label cases → tests/teamRoster.test.ts:19,29; MutationCtx/QueryCtx imports gone; Doc/Id kept because `user()` still uses them   [4]
- AC6 files deleted, vitest exclusions removed (`configDefaults` still used at vitest.config.ts:56) → predicates exit 0   [4]
- AC6 decisions.tsv → 32 map rows; old chatProposals 22 cases (:541-569 ×4, :572, :587, :608, :629, :649, :670, :674, :694 ×2, :722, :736, :749, :760, :777, :781, :795-822 ×3) and projectReviewAccess 10 cases (:70 ×4, :88, :108, :121, :136, :157, :172) each have a ported/covered/retired row; retired = :777 and :88 only. Minor: six projectReviewAccess rows cite lines inside the test body (e.g. :110 for the test at :108), not the header; mapping is by behaviour and unambiguous   [4]
- Listed reader-role parity (review correction) → ::returns the persisted proposal to %s (Manager, Admin, unrelated eligible writer) ✓ real listProposals query, asserts `[proposalId]`; anonymous at convex/chatTurns.test.ts:1532 NOT_AUTHENTICATED   [4]

### Live drive
- skipped: no verify skill, `ui: false`; the real surface is the Convex backend exercised by convex-test inside the gate.

### Skipped / needs operator
- Refactor pin rerun — `git checkout` and `bun test` are outside the QA allowlist — a human reruns: `git checkout aad4788 -- tests/chatProposals.test.ts tests/projectReviewAccess.test.ts && bun test tests/chatProposals.test.ts tests/projectReviewAccess.test.ts; git rm -f tests/chatProposals.test.ts tests/projectReviewAccess.test.ts` and expects 12 pass / 10 fail and 10 pass / 0 fail.
- Smoke — none configured.

Principles behind this verdict: 22 (verdict from an agent that did not write the code; the implementer's green runs were re-executed, not trusted), 16 (every claim checked against the real tree and real runs), 19 (kind proof left at ladder 3 and reported as skipped rather than rounded up; verdict stays test-verified, which meets `min_verdict`).

## Root integrated closeout

Source correction c755e003c7027135c9adf5ac3e67c617ddc7cce5 is integrated at merge14e80a0 (done metadata df1b349). Independent review1 approved and QA1 returned done/test-verified. Canonical QA report: qa-1.md. QA reran the full gate and targeted38cases; the historical Bun pin rerun was skipped by its allowlist, and no live authenticated journey was claimed. Implementer baseline logs and source mapping remain the pin evidence.

Mapping reconciliation: 28 historical mapping rows (16 grouped proposal scenarios, 10 access actor/scenario rows, 2 roster rows), plus 4 rows replacing the original combined reader row, give 32 physical rows and 31 effective grouped mappings. Expanding the two single-target gates and three reject actors yields 34 old test cases: proposal22 =18ported+3covered+1retired; access10 =1ported+8covered+1retired; roster2 =2ported. Thus expanded dispositions are21ported/11covered/2retired. Physical ledger row counts are not test-case counts. The earlier QA aggregate conflated them; its actual execution result remains4files/38tests and fullgate140files/1516tests.

Old ledger numeric pointers belong to their recorded 0fdcacf/d9ee062 source state. Their case-name results remain the stable identifiers; current Coverage pointers resolve against c755e00. The correction adds different offsets in different regions, so a blanket +34 adjustment is insufficient. No rows are rewritten.

Nonblocking review follow-up: the deletion-only case currently proves target absence, count1 and revision8 but does not assert all surviving prose. Adding exact final JSON would strengthen it. The existing seven errorCode copies are retained under the ticket’s permitted file-local fixture convention; any shared test-helper extraction needs its own caller migration.
