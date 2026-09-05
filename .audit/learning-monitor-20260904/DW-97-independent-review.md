# DW-97 independent review, 2026-09-05

Result: **one medium patch finding remains**. The bounded follow-up review has been performed, but this is not clean acceptance or ledger closure. No product, spec, policy, native state or ledger was changed; no commit, push or merge was made.

## Scope and method

Owned checkout: `/Users/johnnynguyen/Documents/Repos/Banhall-bmad-dw97-review`, branch `codex/bmad-dw97-review`, target `74f8789d582c7b3ea4b66f2d70624811d269186f`. Reviewed story 6 accepted `438edf107a85d443480a3027fe8d19e0f9195106` against baseline `1fd71dcfc63e9c7a7ba083ae646ff1ad8486c4c5`. Read the complete story `_bmad-output/specs/spec-ai-engine-sprint-2-learn-chat/stories/6-regenerate-and-retry-assistant-turns.md`, its three prior review triages, accepted `.audit/story-6/evidence.md`, product/test diff and relevant unchanged backend contracts.

Applied BMAD code-review plus applicable TypeScript/Convex and Svelte conventions. All four layers ran and returned: blind hunter, edge-case hunter, verification gap, acceptance audit. Resource limit prevented a third new reviewer thread: blind and edge were independent fresh contexts, then those same reviewers performed acceptance and verification respectively with prior knowledge disclosed. Thus this is four layers with **two independent reviewer contexts**, not four fresh reviewers. No layer failed. The authorized read-only scope replaces skill step 4 story/status/ledger edits and patch prompts with audit action items. `workflow.on_complete` resolved empty.

## Retained finding 1: active research tracking is discarded too early

**Medium; patch; no new product decision required.** `src/lib/components/chat/AgentChatPanel.svelte:415-416` clears `pendingResearchId` whenever its session first appears in the list, regardless of active status. The direct session query at lines 368-372 requires that ID. `regenerationBusy` at lines 952-958 subsequently considers only the newest visible session statuses once the ID is gone.

Concrete path:

1. Start research A through the existing composer and receive its ID.
2. A appears in `research:listSessions` as researching/reviewing. The effect clears its tracking ID.
3. Twenty newer sessions subsequently displace still-active A; those visible sessions are all terminal.
4. A is no longer listed, the direct lookup cannot activate, and publication/research guards release. A historical Regenerate action can send while A is still active.

This is reachable through the shared report feed: `convex/research.ts:107-118` restricts active runs per writer/report, while `:172-176` returns newest 20 for the whole report. It does not establish a report-wide single-run invariant. The narrow cap/concurrency trigger limits impact; the consequence is a tolerable violation of the approved busy guard and unnecessary concurrent generation, not a privacy or report-mutation finding.

The story Busy matrix at line 41 requires regeneration disabled during research, and the third-pass triage at line 133 explicitly addresses displaced research observation. This finding is a remaining hole in that behavior, rather than a proposed product expansion.

Required repair: retain the locally submitted session identity until known terminal or missing status, including after first visible publication; preserve conservative loading/stale/error behavior and direct observation after displacement. Add a real-panel browser regression that first publishes A as active, subsequently replaces the list with 20 terminal summaries, asserts Regenerate stays disabled, then establishes A terminal through its direct query and asserts recovery. No backend change is shown necessary by this review.

All four layer claims merge into this one claim/action. Triage: decision-needed 0, patch 1 (medium), defer 0, dismiss 0; three duplicate observations merged. No patch made.

## Evidence and coverage limits

Existing `RegenerateLimits.component.test.ts:60-76` covers research that is already absent when the capped list first publishes, with completed/failed/canceled/missing recovery. `RegenerateTurn.component.test.ts:200-231` covers normal publication and terminal transition. Neither combines first active visibility with later displacement, so the passing existing suite does not disprove this finding. The source trace is sufficient to adjudicate it; no redundant test install/run was made.

Verified by `git diff --name-only 587a7561d8bbc3d37bb2bfc30dc3216313ff5007 74f8789d582c7b3ea4b66f2d70624811d269186f`: retained gate revision and review target differ only in `.audit/story-6/evidence.md` and `_bmad-output/implementation-artifacts/deferred-work.md`. Executable source and tests are identical. Retained `.audit/story-6/third-review-components-final.log:681-682` reports 396 tests/58 files; `third-review-unit-final.log:9-10` reports 1911/149; `third-review-check-final.log:8` reports 0 errors/0 warnings. Accepted `evidence.md:129-131` records all exit 0 and exact reviewed revision. These are reused accepted receipts, not fresh executions by this reviewer, and do not prove live provider behavior or later combined integration.

No additional confirmed defect was found in exact stored-text/same-thread replay, current context exclusion, draft preservation, explicit offscreen Retry return, queued/running/aborted eligibility, Stop routing, terminal guard release or bounded pending lookup. Relevant real-panel fixtures include `RegenerateTurn.component.test.ts:326-355` terminal/Stop/draft-send recovery, `:357-395` off-page navigation, `:397-433` delayed rejection; `RegenerateLimits.component.test.ts:31-49` walks two capped windows before exact-ID terminal release; `:51-58` guards missing timing outside a full window. Missing or unavailable metadata remains conservatively blocking as documented. No live-provider or end-to-end deployment claim is made.

Own durable artifacts: `review.diff`, `source-evidence.md` (numbered exact-target excerpts), `source-identity.json`, `layers.json`, `triage.json`, and this report in `/Users/johnnynguyen/Documents/Repos/Banhall-bmad-dw97-review/.audit/DW-97-independent-review`. Parent retains repair authorization, integration and DW-97 ledger ownership.
