---
key: tests-2-real-proposal-access-roster-tests
status: todo
kind: refactor
deps: [tests-1-one-runner]
touches: [convex, tests]
risky: []
verify: [npx vitest run convex/chatProposalsApply.test.ts convex/projectAccess.test.ts convex/users.test.ts tests/teamRoster.test.ts]
done_when: [test -f convex/chatProposalsApply.test.ts, "rg -q 'updateProposalWording' convex/chatProposalsApply.test.ts", "rg -q 'rejectProposal' convex/chatProposalsApply.test.ts", "rg -q 'getTeamRosterMemberOrNull' convex/users.test.ts", ! test -e tests/chatProposals.test.ts, ! test -e tests/projectReviewAccess.test.ts, "! rg -q 'MutationCtx|QueryCtx' tests/teamRoster.test.ts", npx vitest run convex/chatProposalsApply.test.ts convex/projectAccess.test.ts convex/users.test.ts tests/teamRoster.test.ts]
title: "The proposal, project-access and roster scenarios from the two fake-db suites are proven against the real Convex endpoints with convex-test; the fake-db files and cases are deleted"
plan: 20260904-code-quality-sweep
ui: false
updated: "2026-09-05T08:15:53.310Z"
---
## Intent
For the maintainer of `convex/chatV2.ts` and `convex/lib/teamRoster.ts`: the behaviours the old bun suites protected are pinned by tests that run in the gate and drive the real functions, and the handmade database that mirrored the implementation is gone. `tests/chatProposals.test.ts` (821 lines) invokes `applyProposal`, `updateProposalWording`, `rejectProposal` and `saveProposal`; the current `convex/chatProposals.test.ts:176-336` invokes `markProposalApplied`, a different endpoint, so nothing in the gate proves pinned-report isolation, unique-target gates, stale-then-retry, replay, deletion-only and ordered replacement, wording audit events, or the reject permission table (`orphan-test-map.md:26-47`). Nine of the ten failing old cases fail because the fixture lacks current tables or turn state, not because the behaviour changed; only "unrelated writer may apply" (`:777`) is a dead contract (`roleCapabilities.ts:75-104`; `docs/product-domain.md:188,1458`). `tests/projectReviewAccess.test.ts` is mostly covered by `convex/reportAuthz.test.ts:248-316` and `convex/projectAccess.test.ts:96-181`. `tests/teamRoster.test.ts:56,71` prove roster eligibility through a fake ctx; `api.users.listTeam` does not call `getTeamRosterMemberOrNull`, whose real callers are project creation (`convex/projects.ts:687`), reassignment (`projectWorkflow.ts:279`, `ownerBackfill.ts:384`) and `eligibleOwner.ts:9`. Principle: [16 prove it works] against the real artifact; [3 redesign from first principles]: a real fixture, not a second fake.

## Acceptance
- AC1: `convex/chatProposalsApply.test.ts` (convex-test, seeded the way `convex/reportAuthz.test.ts` and `convex/preEditSnapshot.test.ts` seed reports and proposals; reuse their helpers or copy the seeding code, never a fake db) proves `applyProposal` (`chatV2.ts:415`): a proposal pinned to an older report updates that report and its audit tuple while the project's newest report is untouched; `requireUniqueTarget` and the legacy `researchSessionId` gate each reject with `STALE_REVISION` and leave report, proposal and snapshot rows unchanged; a missing target returns `{ applied: false, count: 0 }`, marks the proposal stale, writes no snapshot, and a repeat is rejected with `INVALID_INPUT`; re-applying an applied proposal is a no-op (count 0, `alreadyApplied`, unchanged content, revision and snapshot count); an empty replacement deletes the target with one revision bump; an ordered replacement list yields the exact prose with count 2 and one bump.
- AC2: The same file holds an `applyProposal` permission table: durable Owner succeeds; Consultant with an open assigned work item succeeds; Consultant whose assignment is closed is denied; unrelated eligible writer is denied; Manager and Admin succeed; anonymous is denied with no writes. Rows already proven at `reportAuthz.test.ts:406,428,442` are cited in a comment, not duplicated. The production gate (`requireReportEditAccess`, `roleCapabilities.ts:82`) is not edited.
- AC3: `updateProposalWording` (`:624`): new wording is stored, the canonical target is unchanged, exactly one `proposalWordingEditEvents` row exists; a changed target is rejected and proposal and event rows are unchanged. `rejectProposal` (`:701`): Manager, unrelated eligible writer (current broad permission, not tightened), and anonymous (denied, no writes).
- AC4: `saveProposal` (`:851`) through a real live turn seeded the way `convex/chatTurns.test.ts:740,1262` seeds turns: a target copied from an unapplied candidate is rejected with its reason and no new proposal row; a valid edit stores tool and prompt association, satisfies `requireUniqueTarget`, and is pending; the same `toolCallId` twice returns the same id and leaves exactly one row.
- AC5: `convex/projectAccess.test.ts` gains the unrelated-eligible-writer internal read case only if `reportAuthz.test.ts:248-316` does not already assert it (check first; cite the line if it does). `convex/users.test.ts` proves, against real rows via `t.run`, `getTeamRosterMemberOrNull` resolves a duplicate display name by id, rejects an anonymous auth record and a non-member id, and `api.users.listTeam` excludes anonymous records. `tests/teamRoster.test.ts` keeps only its two pure label cases.
- AC6: `tests/chatProposals.test.ts` and `tests/projectReviewAccess.test.ts` are deleted. `decisions.tsv` has one row per scenario in `orphan-test-map.md:30-47` and per `projectReviewAccess` describe block (`:69-181`) with `ported:<file>::<case>`, `covered:<file>:<line>`, or `retired:<reason>` (the `:777` unrelated-writer success and the `:88` `requireProjectCreator` case; the helper itself stays, inventory #13). No product code changes.

## Verification
- AC1-AC4 → `npx vitest run convex/chatProposalsApply.test.ts`; each case name in evidence next to its `orphan-test-map.md` row.
- AC5 → `npx vitest run convex/projectAccess.test.ts convex/users.test.ts tests/teamRoster.test.ts`; `rg -n 'getTeamRosterMemberOrNull' convex/users.test.ts`.
- AC6 → `! test -e` both files; `decisions.tsv` row count equals the scenario count; `git diff --stat convex/chatV2.ts convex/lib` is empty.
Refactor pin: the old bun suite at baseline (`bun test tests/chatProposals.test.ts`: 12 pass, 10 fail; `tests/projectReviewAccess.test.ts`: 10 pass) is recorded in evidence; every passing old case has a `ported` or `covered` row, every failing old case has a `ported` row except `:777` (`retired`).

## Implementation notes
- Endpoints: `listProposals` `chatV2.ts:166`, `applyProposal` `:415`, `markProposalApplied` `:561` (not the subject here), `updateProposalWording` `:624`, `rejectProposal` `:701`, `saveProposal` `:851` (internal; call with `t.mutation(internal.chatV2.saveProposal, …)` after seeding a live turn).
- Seeding: `convex/reportAuthz.test.ts` and `convex/preEditSnapshot.test.ts` already build project + report + proposal rows with roles; `convex/chatTurns.test.ts:740,1262,1342` build live and stopped turns. Reuse; if a helper is file-local, copy it into the new file rather than exporting from a test file.
- Permission rows: `convex/reportEditAccess.test.ts:155-236` proves the same helper on save and restore; mirror its actor set for `applyProposal`.
- `requireProjectCreator` (`convex/lib/auth.ts:66`): do not delete, do not test, do not repurpose as report-edit authorization (`orphan-test-map.md:20`).
- No changes to `convex/chatV2.ts`, `convex/lib/roleCapabilities.ts`, `convex/lib/auth.ts`, `convex/lib/teamRoster.ts`, `convex/schema.ts` or `convex/_generated/`. If a scenario cannot reach the real endpoint without one, record the exact blocker in `deferred` and leave the old case's row as `blocked:<why>`; do not build a fake db.
- The `tests/teamRoster.test.ts` edit: delete `:56-71` and the now-unused `MutationCtx`/`QueryCtx`/`Doc` imports.

## Edge cases
- `applyProposal` on a report whose content hash no longer matches the proposal's pinned hash: covered by the unique-target/legacy gate cases; assert no partial write.
- `rejectProposal` on an already-applied proposal: assert the current behaviour (read the handler first) and pin it.
- `saveProposal` with the same `toolCallId` but different content: pin the current behaviour (dedupe by id) explicitly.
- Concurrent apply of two proposals targeting the same paragraph: out of scope; note it in `deferred` if the seeding makes it cheap to add.
- Run twice: creating an existing file or deleting a missing one is a no-op for the predicates.

## QA output for this run

The configured QA tool allowlist permits the verification commands but denies Edit/Write to audit files. The factory engine itself persists the QA structured summary and checks as `.audit/<ticket>/qa-<loop>.md` (engine.mjs, QA stage). Return the complete truthful QA report through those structured fields; the engine-written file is the canonical QA output for this run. The orchestrator links it from root evidence after merge. Do not spend retries attempting manual evidence writes or require a human merely to append this report. This changes no runtime verification requirement or tool permission. Actual failures, missing evidence and unverified behavior must still be reported accurately.

Run each verification command exactly as listed before trying shell additions. Pipes, redirects, an appended echo, or a redundant rm command can make an otherwise allowed command fail the QA tool check. Use the tool result or engine gates file for the exit status. Bare npm ci already replaces an existing node_modules directory. Run dependency installation before, and never concurrently with, tests or builds in that worktree.

Baseline count correction: the four rows of the internal-access test.each plus six standalone cases total ten passing projectReviewAccess cases, not six. Root reran the unchanged file on 2026-09-05; project-access-pin-count.log in the plan directory records 10 pass/0 fail. Together, 84 original pure-suite cases (83 retained plus the one retired snapshot case), 22 proposal cases and 10 access cases reconcile the original 116-case Bun baseline. Keep scenario mapping based on behavior and include every parameterized actor.
