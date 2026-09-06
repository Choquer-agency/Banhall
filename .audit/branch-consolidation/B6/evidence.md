# B6 focused implementation evidence

Baseline: `309570c60c9ad96d02ad234bdc028c34ddf80390` (matches spec).
Runtime: Node v24.19.0, npm 11.17.0. Login shell, installed dependencies; no installs.
Initial working tree: only the user-provided untracked spec.

## Baseline SHA-256

- `tests/chatProposals.test.ts`: `f365e055c14d2a889887f4d567c15b3bde47b0f3725b6a2dd0d64680c3bb9df8`
- `convex/projectAccess.test.ts`: `4e75c2a64ea1b6c4e2e43a8a85370a0a24b3229561f7d9c36789579f4d8783e4`
- `convex/users.test.ts`: `28ed85d3e238215a2a1125628f487aba89d3acd173abb3374d77ab7489778066`
- `tests/teamRoster.test.ts`: `4c9b41a4ec3640d7b211eb03c48a886f334a947fc976590df70e97dd21232033`
- `tests/projectReviewAccess.test.ts`: `067a6a0678e95a8c79439bdfc9400ecdb93ab019331d7c421d58b68f76d26e58`
- `convex/chatProposals.test.ts`: `5eab1305eb9c76fe262395c091d75fb332b84991381a68c5db8a18fa3210e386`
- `convex/reportAuthz.test.ts`: `2fb2e31685acb835d97c8ad755f2e04f7d0e42bee46422df17cb680370c851cb`
- `convex/reportEditDistance.test.ts`: `f3f1f35a3b0478d7c635b1539041f889fe261952820816f47a271841ae2a1b64`
- `convex/snapshots.test.ts`: `3f4055a4ea471b2c5fc5b2e3ce792ba4f37b34e6a5df17e5a96334f78ce2cc16`
- `convex/qaBlocking.test.ts`: `b7928f1e2f7f698e25b4404a1f9bd020dde06f549d1689ced7374e64696fea6b`
- `tests/reportEdits.test.ts`: `f7132db4e886bbd4bc9e7b09743ece219f5e9d233d2f710e7b2784feedbd70d7`
- `tests/snapshots.test.ts`: `e993f1d4978c9029ac3e35e3c45a8dc758c6738e6758f98dfb1a1eec91e981ac`
- `vitest.config.ts`: `46f1a8f3856809d72340bcba349bb2712dc6591c1c73494ffe7db18b845ec951`

## Baseline named cases

```text
tests/chatProposals.test.ts
  test.each(["manager", "admin"] as const)("allows an internal %s to query proposals", async (role) => {
  test("allows an unrelated authenticated writer to query proposals", async () => {
  test("rejects an anonymous proposal reader", async () => {
  test("rejects a target copied from an unapplied candidate", async () => {
  test("stores tool association and enforces uniqueness for a valid edit", async () => {
  test.each(["completed", "aborted"] as const)("refuses proposal creation after a turn becomes %s", async (status) => {
  test("deduplicates repeated tool execution", async () => {
  test("updates candidate wording without changing the canonical target", async () => {
  test("refuses to change replacement targets", async () => {
  test("apply updates the pinned report and complete audit tuple", async () => { await applyAndAssert(); });
  test("a researched V2 edit keeps its evidence session on the version checkpoint", async () => {
  test.each([
  test("a missing target becomes stale and cannot be retried", async () => {
  test("applying an already-applied proposal is idempotent", async () => {
  test("apply preserves deletion-only replacement behavior", async () => {
  test("apply preserves ordered replacement-list behavior", async () => {
  test("apply denies an unrelated authenticated writer without changing proposal or audit state", async () => {
  test("apply allows the writer who owns the project and preserves revision audit integrity", async () => {
  test("an anonymous caller cannot apply a proposal", async () => {
  test("an internal manager can reject a proposal", async () => {
  test("an unrelated authenticated writer can reject a proposal", async () => {
  test("an anonymous caller cannot reject a proposal", async () => {
convex/projectAccess.test.ts
  it("grants internal access to an eligible writer, with or without a token", async () => {
  it.each([
  it("grants client_review to an unauthenticated caller with the matching token on a shared report", async () => {
  it("denies the wrong token", async () => {
  it("denies a matching token while no report is shared", async () => {
  it("treats an authenticated but unmapped identity like an unauthenticated caller", async () => {
  it("denies every caller on a missing project", async () => {
convex/users.test.ts
  it("fails closed for unauthenticated, anonymous, and roleless identities", async () => {
  it("is a flag-manager-managed profile flag, not a role or capability", async () => {
tests/teamRoster.test.ts
  test("uses a stable trimmed display-label fallback", () => {
  test("prefers firstName/lastName over the legacy single name", () => {
  test("excludes anonymous auth records from the selectable roster", async () => {
  test("resolves duplicate names by users-table ID and rejects non-members", async () => {
tests/projectReviewAccess.test.ts
  test.each([
  test("keeps creator-only actions restricted to the owner", async () => {
  test("denies anonymous internal access", async () => {
  test("denies access when the project is missing", async () => {
  test("denies anonymous callers without a valid pinned client token", async () => {
  test("allows an anonymous client only through the matching pinned token", async () => {
  test("prefers authenticated internal access over a supplied client token", async () => {
convex/chatProposals.test.ts
  it("applies the stepped document with a pre_chat_edit snapshot and one revision bump", async () => {
  it("rejects a second call with the same expectedRevisionNumber and changes nothing", async () => {
  it("replays an already-applied proposal as a no-op without writing", async () => {
  it("rejects a caller without an internal role before any write", async () => {
  it("rejects content that is not a JSON editor document and writes nothing", async () => {
  it("rejects a proposal that is no longer pending, with nothing written", async () => {
convex/reportAuthz.test.ts
  it("rejects every actor the nullable helper refuses, with typed codes", async () => {
  it("returns the same project and user for every internal role", async () => {
  it("preserves NOT_FOUND for an eligible actor and a missing project", async () => {
  it("rejects an ineligible actor before it can probe project existence", async () => {
  it("rejects ineligible actors and writes nothing", async () => {
  it("still lets an eligible owner and elevated roles save", async () => {
  it("keeps existing validation ahead of the tightened gate", async () => {
  it("rejects ineligible actors and writes nothing", async () => {
  it("still applies for an eligible owner, with the snapshot and revision bump", async () => {
  it("still applies for an elevated actor who is not the project owner", async () => {
  it("rejects ineligible actors on inherited queries", async () => {
  it("rejects ineligible actors on inherited actions", async () => {
  it("still serves eligible actors on the inherited read paths", async () => {
  it("still copies project content for an eligible actor", async () => {
convex/reportEditDistance.test.ts
  it("records a real candidate-selection row through selectReportCandidate", async () => {
  it("records ped > 0 at a milestone snapshot on edited content", async () => {
  it("uses the real baseline, not a later ghost 'generated' snapshot", async () => {
  it("agrees with the read-time reports.postEditDistance query", async () => {
  it("writes a row via the scheduled mutation with the project owner as writer", async () => {
  it("does not duplicate a repeat publish with no edit in between", async () => {
  it("records a second publish once the report has been edited again", async () => {
  it("records both a milestone and a publish on the same revision", async () => {
  it("leaves writerUserId unset on an ownerless legacy project", async () => {
    it.each(cases)(
    it.each([
  it("writes nothing and still completes every trigger", async () => {
  it("recordAtPublish is a no-op when the report is gone", async () => {
  it("denies authenticated callers without internal eligibility", async () => {
  it("excludes another project's readings from an authorized report series", async () => {
  it("returns null without internal access and rows oldest-first with it", async () => {
  it("breaks a computedAt tie on insertion order", async () => {
  it("returns null for a missing report", async () => {
  it("caps at the newest readings, dropping the oldest", async () => {
  it("is readable by an admin, a manager, and the writer themselves", async () => {
  it("rejects another writer, an anonymous admin, and an unauthenticated caller", async () => {
  it("rejects an invalid sinceDays before reading anything", async () => {
  it("authenticates before it validates sinceDays", async () => {
  it("windows by sinceDays", async () => {
  it("returns nothing for a writer whose project is ownerless", async () => {
  it("caps at the newest readings, dropping the oldest", async () => {
convex/snapshots.test.ts
  it("writes the set onto a manual snapshot and skips an exact duplicate", async () => {
  it("takes a fresh checkpoint when only the stored set differs", async () => {
  it("carries the set back onto the report on restore", async () => {
  it.each([
  it("refuses a restore fenced to an older revision", async () => {
  it("refuses a restore onto a report in another project", async () => {
  it("refuses a restore from a snapshot that no longer exists", async () => {
convex/qaBlocking.test.ts
  test("human content save persists because findings and rejects publish atomically", async () => {
  test.each(["why_how_why_intact", "uncertainties_distinguished"])("explicit %s failure persists and blocks both boundaries", async (key) => {
  test("house-style findings and false verbiage do not block client review", async () => {
  test.each(["qa-manager", "qa-admin"])("%s cannot waive findings by reclassifying QA feedback", async (subject) => {
  test("human correction preserves history without carrying old failure to new content", async () => {
  test("QA input uses current content and late completion cannot relabel the old revision", async () => {
  test("legacy rows without QA, revision or hash still get the deterministic gate", async () => {
  test("foreign report identity and stale content hash cannot affect current readiness", async () => {
  test("same-revision QA retries are deduplicated and a passing score is not a waiver", async () => {
  test("frozen style waivers remove advisory rows but never the because blocker", async () => {
  test("legacy unpinned QA cannot create current methodology findings", async () => {
  test("publish authorization still precedes QA validation", async () => {
  test("single-candidate completion persists both deterministic and methodology failures", async () => {
  test("body prose resembling a section heading cannot hide a failure", async () => {
  test("no-op save carries exact-content methodology to the new revision", async () => {
  test("restoring byte-identical historical content carries its methodology failure", async () => {
  test("identical advisory messages in different sections retain distinct retry identities", async () => {
  test.each(["single", "iterative"] as const)("empty current %s report has no QA input", async candidateMode => {
  test.each(["applyProposal", "markProposalApplied", "acceptEdit", "restoreSnapshot"] as const)("%s persists findings on the exact resulting revision", async path => {
  test("project copy persists deterministic findings for the destination report", async () => {
  test.each(["punctuated", "renamed", "removed", "nested"])("%s uncertainty headings retain blocking prose", async variant => {
  test("legacy whitespace-only blank lines separate unrelated explanations", async () => {
test("legacy heading-like body sentences cannot hide uncertainty", async () => {
test.each(["legacy label", "rich heading", "split code block"])("%s retains substantive uncertainty at both gates", async variant => {
test("punctuated legacy work headings keep work prose outside the uncertainty gate", async () => {
test("selecting a candidate rejects invalid stored scorecards as blocking evidence", async () => {
test("legacy punctuated cross-references do not move following uncertainty into work", async () => {
  test.each(["block containers", "inline containers"])("deep %s retain uncertainty on save and at both gates", async variant => {
  test("unpunctuated legacy cross-references preserve uncertainty at both gates and on save", async () => {
  test.each(["legacy", "rich text"])("late uncertainty heading cannot hide earlier renamed section in %s", async variant => {
  test("rich-text whitespace-only blank lines cannot borrow an unrelated explanation", async () => {
  test.each(["legacy", "rich text"])("late first uncertainty heading preserves preceding %s failure", async format => {
  test.each(["missing because", "split marker", "split because"])("branching inline wrapper preserves marker and because (%s)", async variant => {
test("generated title remains excluded when valid substantive preamble precedes late 242", async () => {
test.each([false, true])("leading H1 section boundary retains its uncertainty body (blank prefix: %s)", async blankPrefix => {
test.each(["readiness", "save", "publish"])("blank prefix before generated title does not block %s", async boundary => {
test.each(["paragraph", "heading", "codeBlock", "blockquote", "listItem"])("nested %s blocks inside inline wrapper cannot borrow because", async type => {
test.each(["bulletList", "orderedList", "table"])("nested %s container cannot supply an unrelated because", async type => {
  test.each(["block entry", "block exit", "wrapped siblings", "horizontal rule", "wrapped horizontal rule"])(
  test.each([false, true])("actual token splits preserve detection in one nested block (because: %s)", async valid => {
tests/reportEdits.test.ts
  test("capitalizes a lowercase replacement when the match was capitalized", () => {
  test("leaves an already-capitalized replacement untouched (ACuity regression)", () => {
  test("lowercase match keeps the replacement as written", () => {
  test("capitalized replacement after a capitalized match keeps its own casing", () => {
  test("replaces a full paragraph without mangling the first word", () => {
  test.each([
  test.each([
  test("retains inline joining, nested blocks, and horizontal rules", () => {
tests/snapshots.test.ts
  test("keeps permanent rows and the newest pre-restore checkpoint outside the recovery cap", () => {
  test("deduplicates defaults and appends only a distinct R5-or-later option", () => {
  test("starts later milestones at R5 and supports arbitrary later numbers", () => {
  test("recomputes the hash and restores lineage only from matching provenance", async () => {
```

## Fake assertion mapping established before deletion

Replacement proof passed: 68 tests across the six specified suites, exit 0, before removing either fake roster case or the fake access file. First attempt exposed a test expectation error (`listTeam` returns `id`, not `_id`); corrected the test to the existing endpoint contract, no product changes.

| Deleted expanded case | Persisted replacement and assertions |
| --- | --- |
| internal owner writer | reportAuthz: `returns the same project and user for every internal role`: both helper results equal, correct project/user; writer role comes from persisted owner fixture. |
| internal non-owner writer | projectAccess: `gives an unrelated writer matching nullable, throwing, and token access`: exact helper equality, owner/creator distinct from actor, project/user/role, all three token variants. |
| internal manager | reportAuthz: same internal-role parity case, manager identity and complete equality. |
| internal admin | reportAuthz: same internal-role parity case, admin identity and complete equality. |
| creator-only actions restricted to owner | Explicit retirement of callerless `requireProjectCreator` test. Before deletion `git grep -n 'requireProjectCreator('` found definition at convex/lib/auth.ts:67 and only calls in this fake test at :89/:98. Helper/product policy unchanged. |
| anonymous internal denial | reportAuthz: `rejects every actor the nullable helper refuses, with typed codes`: null plus NOT_AUTHENTICATED; projectAccess no-identity denial. projectAccess `denies the wrong token` also preserves exact typed error/message and null assertions. |
| missing project | reportAuthz: `preserves NOT_FOUND for an eligible actor and a missing project`: null plus typed NOT_FOUND; projectAccess: `denies every caller on a missing project`. That projectAccess case also preserves exact typed error/message and null assertions. |
| anonymous without valid pinned client token | projectAccess: `denies the wrong token` (wrong and absent token); `denies a matching token while no report is shared`; `denies every caller on a missing project`. |
| anonymous matching pinned token | projectAccess: `grants client_review to an unauthenticated caller with the matching token on a shared report`: kind, project and sharedReportId, no user. |
| internal access preferred over token | new unrelated-writer parity case after publish: internal grant including project/user/role for correct, wrong and absent token. Existing eligible writer case retained. |
| roster excludes anonymous | users: `resolves duplicate names by persisted user IDs and excludes present anonymous and deleted users`: prove anonymous row exists, direct membership true/false/null, exact listTeamRoster rows and authenticated listTeam exclusion. |
| roster duplicate names resolved by ID | same real users case: distinct IDs, exact full rows from lookup, anonymous/deleted null; authenticated listTeam has both duplicate-name IDs and no excluded IDs. |

Both pure label cases and every fallback assertion stay verbatim. No production callers, helpers, schema, API, runner, native state, staging, commits, remotes, installs or other worktrees changed.

## Acceptance and preservation map

| Matrix / requirement | Current named proof |
| --- | --- |
| Reader roles | Existing proposal access parameterization: manager/admin, unrelated writer, anonymous reader. |
| Open assignment | `an open revision assignment lets a non-owner writer apply with the complete audit tuple`: real full-schema workItem, shared original audit assertions preserved. |
| Closed assignment | `a completed revision assignment denies a fresh pending proposal without writes`: separate fixture, actual open-to-completed patch, pending proposal, NOT_AUTHORIZED, full state equality. |
| Creator attribution | `creator attribution grants no prose entitlement without ownership or assignment`: distinct owner and creator, empty workItems, typed denial, full state equality. |
| Wording | `updates candidate wording without changing the canonical target`: editor/count and event project/report/user/proposal IDs plus original/new text; full report/latest/snapshot equality. Existing target-change denial retained. |
| Rejection | New manager applied-then-rejected test: successful apply, INVALID_INPUT and full state equality. Existing manager/unrelated rejection retained; anonymous rejection now compares full state. |
| Queued creation | `a queued sendMessage turn saves its association and rejects absent targets without writes`: registered agent component, fake timers/key, real returned IDs, persisted queued status and sender, target denial, saved association, original ID and wording on both replays, one card for the queued thread, report/audit unchanged, turn stays queued. Finally restores timers/env; jobs never advanced. |
| Running / stopped creation | Existing valid running save, invalid target and completed/aborted stop-fence parameterization retained. No absent-matching-prompt rejection claimed. |
| Replay | Existing `deduplicates repeated tool execution` now checks changed wording returns same ID/result, one matching row and complete state equality, while retaining identical-args replay. |
| Access and roster | Detailed deletion map above, with actual helper contexts and authenticated endpoint. |
| Ordered replacements | Existing case now compares exact serialized resulting document, count 2, revision 8. |
| Pinned / latest / evidence | Shared apply assertions retain full latest equality, hash/revision/provenance and snapshot sourceTranscriptIds; research-session ID/count case retained unchanged. |
| Ambiguity | All four existing rows retained: unique flag and legacy research session, each in separate paragraphs and same paragraph, full state equality. |
| Stale / deletion / anonymous apply | Existing named cases and assertions retained; state helper additionally includes project and all workItems. |
| Atomic markProposalApplied | Entire separate convex/chatProposals.test.ts byte-identical to baseline, all six tests included in focused run. |
| Edit / snapshot preservation | All three requested preservation suites pass; tests/reportEdits.test.ts and tests/snapshots.test.ts additionally byte-identical. |
| Scope / runner | Exactly five tracked test paths changed; no runner changes. Edge assignment for both real proposal suites, node assignment for pure roster preserved byte-for-byte in vitest.config.ts. |

All eight read-only files listed in baseline hashes verified byte-identical with `git show <baseline>:<path>` comparison. Both retained roster label cases (including every fallback) verified verbatim against baseline. Evidence is under the repository-ignored .audit path and was not staged.

## Commands and exits

All commands used the installed login-shell Node v24.19.0 / npm 11.17.0. No artificial product failure was introduced.

### Baseline

`node node_modules/vitest/vitest.mjs run tests/chatProposals.test.ts convex/chatProposals.test.ts convex/reportAuthz.test.ts convex/projectAccess.test.ts convex/users.test.ts tests/teamRoster.test.ts --expect.requireAssertions`

Exit: 0.

```text

 RUN  v4.1.10 /Users/johnnynguyen/Documents/Repos/Banhall-branch-consolidation


 Test Files  6 passed (6)
      Tests  61 passed (61)
   Start at  18:56:06
   Duration  1.40s (transform 697ms, setup 0ms, import 695ms, tests 1.24s, environment 202ms)

```

### Initial replacement attempt

`node node_modules/vitest/vitest.mjs run tests/chatProposals.test.ts convex/chatProposals.test.ts convex/reportAuthz.test.ts convex/projectAccess.test.ts convex/users.test.ts tests/teamRoster.test.ts --expect.requireAssertions`

Exit: 1.

```text
       |                    ^
     46|       expect.objectContaining({ _id: ids.first, name: "Sam Lee", role:…
     47|       expect.objectContaining({ _id: ids.second, name: "Sam Lee", role…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed | 5 passed (6)
      Tests  1 failed | 67 passed (68)
   Start at  18:58:18
   Duration  1.44s (transform 818ms, setup 0ms, import 700ms, tests 1.32s, environment 200ms)

```

### Replacement proof before fake deletion

`node node_modules/vitest/vitest.mjs run tests/chatProposals.test.ts convex/chatProposals.test.ts convex/reportAuthz.test.ts convex/projectAccess.test.ts convex/users.test.ts tests/teamRoster.test.ts --expect.requireAssertions`

Exit: 0.

```text

 RUN  v4.1.10 /Users/johnnynguyen/Documents/Repos/Banhall-branch-consolidation


 Test Files  6 passed (6)
      Tests  68 passed (68)
   Start at  18:58:40
   Duration  1.53s (transform 924ms, setup 0ms, import 711ms, tests 1.45s, environment 197ms)

```

### After fake deletion

`node node_modules/vitest/vitest.mjs run tests/chatProposals.test.ts convex/chatProposals.test.ts convex/reportAuthz.test.ts convex/projectAccess.test.ts convex/users.test.ts tests/teamRoster.test.ts --expect.requireAssertions`

Exit: 0.

```text

 RUN  v4.1.10 /Users/johnnynguyen/Documents/Repos/Banhall-branch-consolidation


 Test Files  6 passed (6)
      Tests  66 passed (66)
   Start at  18:59:24
   Duration  1.50s (transform 867ms, setup 0ms, import 717ms, tests 1.42s, environment 203ms)

```

### Final (includes preserved literal authorization error messages)

`node node_modules/vitest/vitest.mjs run tests/chatProposals.test.ts convex/chatProposals.test.ts convex/reportAuthz.test.ts convex/projectAccess.test.ts convex/users.test.ts tests/teamRoster.test.ts --expect.requireAssertions`

Exit: 0.

```text

 RUN  v4.1.10 /Users/johnnynguyen/Documents/Repos/Banhall-branch-consolidation


 Test Files  6 passed (6)
      Tests  66 passed (66)
   Start at  19:00:00
   Duration  1.42s (transform 790ms, setup 0ms, import 706ms, tests 1.28s, environment 203ms)

```

### Preservation

`node node_modules/vitest/vitest.mjs run convex/reportEditDistance.test.ts convex/snapshots.test.ts convex/qaBlocking.test.ts --expect.requireAssertions`

Exit: 0.

```text

 RUN  v4.1.10 /Users/johnnynguyen/Documents/Repos/Banhall-branch-consolidation


 Test Files  3 passed (3)
      Tests  140 passed (140)
   Start at  18:59:25
   Duration  1.04s (transform 710ms, setup 0ms, import 597ms, tests 908ms, environment 123ms)

```

### Convex typecheck after final changes

`node node_modules/typescript/bin/tsc --noEmit -p convex/tsconfig.json`

Exit: 0.

```text

```

`git diff --check`: exit 0.

## Final SHA-256

- `tests/chatProposals.test.ts`: `7c3f24320e882a0f409818c9508960d0d5f1d5fd512cc91380c4a9835eb8b7bb`
- `convex/projectAccess.test.ts`: `c618c62586c8015f6fd8855644daa695e1fea86f9db5c6f86141c3bf821f640e`
- `convex/users.test.ts`: `80e17db0ba7eda11f2fc437df73ca3ab70556989089b87b2cd8712e7e48f6c31`
- `tests/teamRoster.test.ts`: `3f56306a392790bf31c3ef926b15c68911c4009721e1e37610734a36495a19c9`
- `tests/projectReviewAccess.test.ts`: `deleted after mapping and replacement proof`
- `convex/chatProposals.test.ts`: `5eab1305eb9c76fe262395c091d75fb332b84991381a68c5db8a18fa3210e386`
- `convex/reportAuthz.test.ts`: `2fb2e31685acb835d97c8ad755f2e04f7d0e42bee46422df17cb680370c851cb`
- `convex/reportEditDistance.test.ts`: `f3f1f35a3b0478d7c635b1539041f889fe261952820816f47a271841ae2a1b64`
- `convex/snapshots.test.ts`: `3f4055a4ea471b2c5fc5b2e3ce792ba4f37b34e6a5df17e5a96334f78ce2cc16`
- `convex/qaBlocking.test.ts`: `b7928f1e2f7f698e25b4404a1f9bd020dde06f549d1689ced7374e64696fea6b`
- `tests/reportEdits.test.ts`: `f7132db4e886bbd4bc9e7b09743ece219f5e9d233d2f710e7b2784feedbd70d7`
- `tests/snapshots.test.ts`: `e993f1d4978c9029ac3e35e3c45a8dc758c6738e6758f98dfb1a1eec91e981ac`
- `vitest.config.ts`: `46f1a8f3856809d72340bcba349bb2712dc6591c1c73494ffe7db18b845ec951`

## Parent handoff and limits

Focused implementation complete. Parent still owns staging/discovery mapping, independent review, final `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh`, and shipping, per the spec. No review dispatch, stage, commit, install, remote, worktree or native-state mutation performed. The queued fixture intentionally does not execute provider jobs and therefore makes no live-provider behavior claim. Only the callerless creator-helper test is retired without a replacement; production policy was not changed.

## Additional Svelte/TypeScript verification

`npm run check`: exit 1 because PUBLIC_CONVEX_URL was unset (two static-public export errors in untouched Svelte files).

```text

> banhall-app@0.1.0 check
> svelte-kit sync && svelte-check --tsconfig ./tsconfig.json

Loading svelte-check in workspace: /Users/johnnynguyen/Documents/Repos/Banhall-branch-consolidation
Getting Svelte diagnostics...

/Users/johnnynguyen/Documents/Repos/Banhall-branch-consolidation/src/lib/components/project/ProjectWorkflowMenu.svelte:2:12
Error: Module '"$env/static/public"' has no exported member 'PUBLIC_CONVEX_URL'. (ts)
<script lang="ts">
  import { PUBLIC_CONVEX_URL } from "$env/static/public";
  import { Popover } from "bits-ui";

/Users/johnnynguyen/Documents/Repos/Banhall-branch-consolidation/src/routes/+layout.svelte:11:12
Error: Module '"$env/static/public"' has no exported member 'PUBLIC_CONVEX_URL'. (ts)
  import { beforeNavigate } from "$app/navigation";
  import { PUBLIC_CONVEX_URL } from "$env/static/public";
  import PageErrorBoundary from "$lib/components/errors/PageErrorBoundary.svelte";

====================================
svelte-check found 2 errors and 0 warnings in 2 files

```

Rerun with the same public placeholders defined by scripts/loop-verify.sh:61/67:

`PUBLIC_CONVEX_URL=https://placeholder.convex.cloud PUBLIC_CONVEX_SITE_URL=https://placeholder.convex.site npm run check`

Exit 0.

```text

> banhall-app@0.1.0 check
> svelte-kit sync && svelte-check --tsconfig ./tsconfig.json

Loading svelte-check in workspace: /Users/johnnynguyen/Documents/Repos/Banhall-branch-consolidation
Getting Svelte diagnostics...

svelte-check found 0 errors and 0 warnings

```

## Parent acceptance

Three fresh Astra6 medium reviews completed. Parent trivial assertion corrections, independent deletion mapping and closure are retained in review-triage.md and parent-deletion-audit.md. Final source hashes are parent-reviewed-source.json; original worker hashes above remain historical. Patched focused66/preservation140 and Convex typecheck passed. Full Node24 component-enabled gate passed all nine steps:2006 unit tests/153 files,478 browser tests/62 project files. No unexpected tracked changes. Gate result and full log retained under gate/. Ten old access cases and two fake roster cases are replaced/mapped or explicitly retired; seven new real cases explain net−5. No story_key, so sprint sync is a no-op. No native ledger change.
