# Sprint 2 capability completion inventory

Read-only snapshot, 2026-09-04. Integration inspected at `86a43d9d500ceab34245744d223d4453eba7b667`; no tests, controllers, workers, lifecycle transitions, commits, or shipping actions were run by this inventory. All paths below are relative to the named checkout. Native state can advance after this snapshot.

## Progress

Of 19 capability requirements across the two canonical SPECs, **11 have native done records and integrated accepted commits**, **one was already delivered on main**, **two have preserved implementation but lack native final acceptance**, **one is blocked on an unanswered intent decision**, and **four remain unimplemented in the inspected native artifacts**. Thus 12/19 have historical completion evidence, not 19/19. This is an artifact acceptance inventory, not fresh verification of each acceptance criterion. The epic manifests are remaining-work queues: they omit completed capabilities, and learning story IDs differ from capability IDs.

Every accepted commit listed below, preserved PED commit `b5643de`, prior-delivered authorization commit `4ea1bb9`, and known main `14d3d1795d9f861257ac122f7183449b248a369a` was verified as an ancestor of integration `86a43d9` using `git merge-base --is-ancestor`. This proves preservation in integration, not publication to main.

## All 19 requirements

| Epic / capability | Story | Requirement | Native/artifact status at snapshot | Integrated evidence | Remaining acceptance gate |
| --- | --- | --- | --- | --- | --- |
| Boundary CAP-1 | 1 | Shared pre-edit snapshot writer | Native done; spec done | `e42312b` | Fresh final integrated ordinary gates |
| Boundary CAP-2 | 2 | Trusted context module | Native done; spec done | `23317ce` | Fresh final integrated ordinary gates |
| Boundary CAP-3 | 3 | Uploader-role document trust | Native done; spec done | `a4e326d` | Fresh final integrated ordinary gates |
| Boundary CAP-4 | 4 | Chat evidence outside policy | Native done; spec done | `997b632` | Fresh final integrated ordinary gates |
| Boundary CAP-5 | 5 | Injection boundary tests | Native done; spec done | `c40da52` | Fresh final integrated ordinary gates |
| Boundary CAP-6 | removed 6 | Prose edit authorization | Already shipped before Sprint 2; no new story | `4ea1bb9`, reconciliation memlog | Preserve existing authorization and tests |
| Boundary CAP-7 | 7 | Revision-pinned review decisions | Native done; spec done | `2e4bff1` | Integrated gate, including browser if UI touched |
| Boundary CAP-8 | 8 | Non-waivable blocking QA | Historic native deferred; DW-92 open; fresh sweep not accepted | Preserved QA and repairs, including `f1a61c4`, `df97838`, `c94860f`, `8330ad2`, `828cc5a` | Genuine native follow-up review/finalization and engine acceptance; final ordinary gates |
| Boundary CAP-9 | 9 | Review artifact revision/hash | Fresh native done after historic escalation | `076b304`, integrated via `84d23a4` | Fresh final integrated ordinary gates |
| Boundary CAP-10 | 10 | Analyzer once and prompt caching | Fresh native done after historic escalations | `f9389a4`, integrated via `8829894` | Fresh final integrated ordinary gates |
| Boundary CAP-11 | 11 | Chat spend and queue limits | Fresh native done after historic escalations | `c20934e`, integrated via `aa4232b` | Fresh final integrated ordinary gates |
| Learning CAP-1 | 2 | De-identification and privacy publication | Native done; spec done; later privacy repairs preserved | `44f3eed`; later `453a4c5`, `ae1c59b` | Fresh integrated privacy regressions; preserve recorded contract |
| Learning CAP-2 | 3 | Persist milestone post-edit distance | Spec says done; historic native deferred; DW-93 open | `b5643de`, subsequent `3e575b7`, `5de0e9a` | Fresh flat native follow-up with actual new baseline, review, ordinary gates, evidence commit and native acceptance |
| Learning CAP-3 | 8 | Admin learning-health page | Manifest queued; no implementation/acceptance found | None identified | Implement queries/tests and UI; browser component gate; native review/acceptance |
| Learning CAP-4 | 4 | Digest diversity and provenance | Current native escalated on intent gap, no acceptance | None identified | Human mixed-stream decision, then implement backend and admin UI; browser gate and native acceptance |
| Learning CAP-5 | 6 | Regenerate/retry turns | Manifest queued; no implementation/acceptance found | None identified | Implement keyboard-accessible control and originating-prompt resend; browser component test and native acceptance |
| Learning CAP-6 | 7 | Optimistic user bubble | Manifest queued; no implementation/acceptance found | None identified | Implement request-ID reconciliation, error and retry; browser component gate and native acceptance |
| Learning CAP-7 | 5 | Brain source chips and answer feedback | Manifest queued; no implementation/acceptance found | None identified | Implement source chips, reused FeedbackBar, vote persistence/distiller stream; backend/browser gates and native acceptance |
| Learning CAP-8 | 1 | Orchestration seam tests | Native done; spec done | `8aa8be3` | Fresh final integrated ordinary gates |

## Native evidence and historic failures

Original checkout `/Users/johnnynguyen/Documents/Repos/Banhall` was inspected read-only. Early native done evidence is retained in `.bmad-loop/backups/astra-medium-20260904-120028/{boundary,learn-chat}/state.json`. These record six accepted boundary stories (1–5 and 7) and two accepted learning stories (1–2). The corresponding accepted commits are integrated ancestors.

Fresh lane states are under original checkout `.bmad-loop/lanes/spec-ai-engine-sprint-2-boundary-{schema,pipeline,chatspend}/.bmad-loop/runs/`: schema `20260904-121620-6b94` story9 done; pipeline `20260904-121631-a914` story10 done; chatspend `20260904-121647-f30f` story11 done. Their journals end in `stories-validated` and `run-complete`; chatspend also explicitly records `unit-merged`. Their earlier escalated state backups under `.bmad-loop/backups/completion-20260904/` remain historical failures and are not rewritten by later acceptance.

QA's original lane run `20260904-121607-3217` remains deferred with no accepted commit. Integration's ledger DW-92 explains exhausted harvest attempts and subsequent recovery. Integration run `20260904-145336-4d56` remains an unsuccessful historic recovery (ledger reports crash due to outside-worktree result binding); its stale state phase is not current acceptance. Active sweep `20260904-162523-6e72` reports triage done, `dw-blocking-qa-native-followup` dev-running, and no commit_sha. Its latest recorded review session result is blocked because finalization retained a dirty orchestrator-owned ledger. That result reports fresh ordinary verification (1,732 tests, both type checks, PowerShell 50/50, Bash 18/18), focused 147 tests, and explicit Convex TypeScript success. These are worker-reported retained evidence, not commands run by this inventory, and do not equal native final acceptance. Do not mutate native state or the ledger to manufacture acceptance.

PED's backup `.bmad-loop/backups/completion-20260904/learnchat-baseline/state.json` records story3 deferred: claimed baseline `740008e1369f` differs from orchestrator baseline `62fec81c424a`. DW-93 is still open despite the nested story saying done and subsequent codegen being preserved. Use the flat follow-up result location recorded in DW-93's recovery note; preserve old history and baseline context.

## Unanswered decision

`/Users/johnnynguyen/Documents/Repos/Banhall-bmad-learn-chat/.bmad-loop/runs/20260904-133944-0158/state.json` records story4 escalated, no accepted commit, and an explicit intent gap: when one drafting stream passes the two-writer/two-project requirement and another fails, should generation stop entirely, or omit the failing stream and use qualifying inputs? Both readings produce different behavior. No decision is recorded. Do not choose, restart, or implement this decision-dependent story without the answer.

## Required completion route

The bmad-help skill and resolved catalog identify Build (`bmad-build`, BD) as the required implementation phase; ad hoc Code Review is optional and does not replace Build acceptance. Native sweep triage is automation-only. Continue the authorized native completion work for DW-92 and DW-93 without erasing failed history, resolve learning story4 intent, then complete learning stories5–8 through their normal implementation/review path. All UI work needs `npm run test:component` in a real browser in addition to backend tests. Repo ordinary checks are `npm test` and `PUBLIC_CONVEX_URL=... npm run check`; the active native policy uses `bash scripts/loop-verify.sh`. Final integrated verification must occur after all required changes, followed by the separately authorized commit/push/main integration process. This inventory makes no shipping claim.

Sources: both `_bmad-output/specs/spec-ai-engine-sprint-2-{boundary,learn-chat}/SPEC.md`, current `stories.yaml`, existing nested story specs, boundary `.memlog.md`, native states/journals above, integration `_bmad-output/implementation-artifacts/deferred-work.md` DW-92/DW-93, integration git ancestry/log, `.factory/AGENTS.factory.md`, `_bmad/_config/bmad-help.csv`, and merged config from the read-only resolver.

## Later verified acceptance checkpoint

QA follow-up DW-92 is now native done at accepted commit `bdf5d0e34cdd23dd17f74baf5be5f6d2ca32096d`, merged into integration at `02bbedad0a9c14a8482f5af0f83ebb17b0bdb736`. `qa-native-acceptance.json` retains the actual story-done and unit-merged events, both native review results, and committed gate summaries:1772 full tests,173 focused tests, both type checks, uploader50/50 and18/18. The committed extractor hash matches the additional structural audit snapshot. Current completion evidence is therefore **13/19**. The older snapshot/table above is retained as history.

Native policy honored one extra review round, then damped the final self-recommendation and refiled it as DW-94. No unresolved product finding was manufactured as done; all reported in-scope patches were implemented and verified. The new advisory follow-up remains visible and must be considered by final integrated review. PED DW-93 has started next; learning4 still requires the unanswered mixed-stream decision. This checkpoint does not claim main shipping or final combined verification.

## Later PED checkpoint

Native run `20260904-162523-6e72` accepted persisted PED follow-up `DW-93` as `b984822a8aeb70b7eb48a5d617ed18846392b1d2` and merged it into integration `1cd1eb50f343007b3060c72d6ccbfaf5e0b72f35`. Actual `story-done` and `unit-merged` events and ancestor check are recorded in `ped-native-acceptance.json`. Verified completion is now **14 of 19**. Learning story 4 still requires the unanswered digest diversity decision; stories 5–8 remain queued. Native advisory DW-95 preserves the extra-review recommendation; it is being audited separately. This update does not rewrite the earlier snapshot or historical deferred runs.
