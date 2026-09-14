**Accept one low-severity patch: replace the unconditional “ready for drafting” message with wording that reports stage completion.** No publication-logic repair, intent amendment, or spec loopback is warranted. No files were changed and no tests or workflows were run.

The review used the supplied Step 4 classification rules, current source, frozen intent, all four fresh layers, and the prior triage’s actual rationale.

| Category | High | Medium | Low | Total |
|---|---:|---:|---:|---:|
| intent_gap | 0 | 0 | 0 | 0 |
| bad_spec | 0 | 0 | 0 | 0 |
| patch | 0 | 0 | 1 | 1 |
| defer | 0 | 0 | 0 | 0 |
| reject | 0 | 0 | 13 | 13 |
| **Total** | **0** | **0** | **14** | **14** |

Fourteen claim/action units result from separating B2’s documentation and authority-policy requests, B7’s hash and stage-wiring concerns, and B8’s payload and orphan-row assertions. B1–B10 identify the ordered bullets in `blind.md`; V1 identifies the sole verification finding. Edge returned `[]`. The intent observations are reconciled below, without counting them as additional defects.

**Finding-by-finding triage**

| Identity | Severity / route | Evidence and rationale |
|---|---|---|
| **B1: validate generation/project relationship** | Low / reject | The lookup constrains both project and hash. Production stage arguments originate together from `getGenerationInput`, which loads the generation’s project. The proposed failure requires a malformed internal call; no reachable caller supplying mismatched IDs was established. Adding another guard and negative test is optional hardening. See `convex/generations.ts:854`, `:1663`, `:1951`; `convex/ai/pipeline.ts:584`. |
| **B2a: reconcile `MAX(version)` documentation** | Low / reject | The legacy comment describes the monotonic-version invariant; the extracted helper explicitly describes the implemented latest-stored selection. Writer edits fence the latest row and append N+1. Clearer legacy wording is optional, but no current valid-state discrepancy requiring repair was established. See `convex/generations.ts:1663`, `:1678`; `convex/briefs.ts:186`, `:299`. |
| **B2b: define/test authority when creation and version order disagree** | Low / reject | Frozen intent expressly selects the latest stored same-key version and preserves writer/version semantics. A historical duplicate-v1 policy or migration is not established by a hypothetical history. No affected stored history was supplied. This is independently rejected, rather than inherited from B2a or the prior review. |
| **B3: adopt before baseline traversal, or recover after traversal failure** | Low / reject | Baseline reads can fail before persistence. That is an existing fail-open preparation path. The frozen matrix starts its adoption guarantee when persistence begins; it does not require bypassing all preceding preparation failures. No new baseline-read failure mechanism was introduced. See `convex/ai/brief.ts:306`, `:387`, `:692`. |
| **B4: competing writer Storylines need precedence documentation/testing** | Low / reject | Writer Storylines are deliberately excluded from the key, and existing early reuse already precedes writer-candidate processing. The frozen DW-112 contract unconditionally makes same-key authority take precedence over candidates. A different writer-candidate precedence would conflict with that captured rule. An `origin: "writer"` permutation is optional verification. See `convex/lib/briefInputsHash.ts:17`; `convex/ai/brief.ts:452`, `:468`, `:589`. |
| **B5: replay after writer edit must preserve the earlier generation reference** | Low / reject | Each persistence invocation adopts the authority visible at that invocation. A post-drafting replay path requiring different semantics was not established. Existing reuse stamping is also unconditional, while writer edits themselves preserve the original generation reference. Defining new lifetime immutability would change the explicit latest-version contract. See `convex/generations.ts:1694`, `:1951`; `convex/briefs.test.ts:287`. |
| **B6: require production transaction-conflict evidence** | Low / reject | The installed harness serializes top-level transactions. The test nevertheless exercises synchronized callers through the registered mutation, satisfying the frozen `convex-test` scheduling requirement. The preserved failing control demonstrates that this schedule caught the original defect. Production overlapping snapshots and retries remain an acknowledged limitation, not a newly required stage. See `node_modules/convex-test/dist/index.js:1388`; `.audit/DW-112/failing-control.log`. |
| **B7a: require independently frozen, multi-source hash coverage** | Low / reject | The new fixtures deliberately hold the publication key constant. The unchanged hash tests establish less than independently frozen multi-source identity, and this review does not claim otherwise. No concrete changed-path key mismatch was established. The proposed broader verification remains optional for this same-key publication repair. See `convex/ai/brief.test.ts:959`; `convex/lib/briefInputsHash.test.ts:86`. |
| **B7b: require concurrent full-stage adoption coverage** | Low / reject | Current source connects derivation to `publishDerivedBrief` and then the real persistence mutation. Existing pipeline tests exercise that wiring; the new regressions exercise its publication race boundary. No bypassing caller or missing adoption site was identified. See `convex/ai/brief.ts:591`; `convex/ai/brief.test.ts:214`, `:926`. |
| **B8a: assert winning-payload consistency in the race** | Low / reject | The winning insertion uses one invocation’s arguments; adoption returns before payload writes. Ordinary derivation tests inspect payload/citations, while adoption regressions compare complete parent/child snapshots. Another race-specific payload assertion is optional, without an established uncovered payload-selection failure. See `convex/generations.ts:1951`, `:2045`; `convex/ai/brief.test.ts:214`, `:1040`. |
| **B8b: assert no orphan project entries** | Low / reject | Every insertion uses the newly inserted parent ID; the losing branch inserts nothing. Complete-table snapshots in the adoption regressions protect against extra rows. No orphan-producing path was identified. See `convex/generations.ts:2057`; `convex/ai/brief.test.ts:1089`, `:1206`. |
| **B9: readiness narration overstates oversized-Brief availability** | **Low / patch** | **Supported.** Persistence intentionally accepts oversized Briefs, while both drafting readers omit them. The existing 600-row regression demonstrates successful publication followed by `{ rendered: "", brief: null }`. The new literal still announces drafting readiness. This is a misleading progress message, without a publication/data-loss consequence. See [narration][narration], [omission guard][omission], and [oversized-publication regression][oversize]. |
| **B10: installation provenance requires binding or reinstalling** | Low / reject | The installation receipt remains absent, as previously disclosed. Current source/dependency inputs match the post-repair verification, and the supervisor expressly authorizes its reuse. This supports saved-run applicability, not fresh-install reproducibility. Preserve the limitation; a new installation is not required by this additional review. See [verification reuse][reuse]. |
| **V1: add an independent expected narration assertion** | Low / reject | The shared-helper assertion does not independently protect the literal’s meaning; that observation is accurate. The proposed new test protects reversible, low-impact copy and conflicts with the applicable instruction against such tests. Existing wiring verification remains useful for outcome recording. Fix B9’s wording and inspect it directly. See `convex/ai/briefPipelineWiring.test.ts:321`, `:361`. |

**Bounded required repair**

Change only the derived narration at [briefRender.ts:51][narration] to:

> Generation Brief stage completed.

Preserve outcome kinds, publication behavior, overflow handling, and original review artifacts. No new test is required for this wording repair.

No patches were applied during this review. If root applies the accepted patch, this pass’s patched counts are **high 0, medium 0, low 1**, giving **`3 × 0 + 1 = 1`** and **`followup_review_recommended: false`**. Preserve the earlier pass’s score of five and its completed follow-up as historical facts.

The existing post-repair receipts remain valid for today’s unchanged source. After this literal changes, root must bind the existing spec verification requirements to the repaired bytes; the old receipt alone cannot certify that later source.

**Intent reconciliation**

- **Mutation versus complete stage:** The explicit approach and “persistence begins” matrix establish the mutation boundary. Generation references must reflect that transaction’s authority; preceding model/baseline failures retain their existing handling.
- **Concurrency proof:** Concurrent caller scheduling through real `convex-test` mutations is the stated threshold. Actual production conflict retries were not demonstrated.
- **Version authority:** Latest stored same-key authority is evaluated per invocation. Independent writer edits do not require retroactively changing earlier generations.
- **Ledger ownership:** Native closure provenance explains the cumulative ledger difference. Agent-authored ledger mutation remains prohibited. Native closure does not establish final acceptance.

**Independent audit-trail result**

The practical integrity checks passed:

- Compared all **7,306** tracked entry-manifest hashes. **7,304 matched**. The remaining differences are precisely the spec’s `done` → `in-review` substitution and two appended decision rows. The earlier decision bytes remain an exact prefix.
- Confirmed the entry spec was already `done` and lacked Auto Run Result. The preserved entry diff records its removal before this additional review.
- Verified all **56** local-completion artifact-manifest entries, including ignored historical raw captures. The older input manifest’s source/spec differences correspond to the accepted repairs and lifecycle changes; its historical audit bytes remain preserved.
- Confirmed all four fresh reviewers started before any completed. Their actual raw CLI headers show **`gpt-6-astra`, `xhigh`, read-only**. Prompt, raw-log, and result hashes match every receipt; echoed prompts and final output match the retained artifacts.
- Independently checked the earlier four layers, lead, and follow-up against their raw CLI headers and final output. The prior lead’s three-repair rationale and follow-up remain intact.
- Verified the full retained diff is **1,810,291 bytes**, contains **101 file sections**, and matches `changed-files.txt`. Every core section appears in it. Its executable source sections exactly match the current baseline-to-working-tree diff.
- Confirmed current source matches reviewed commit **`0b34a249bac1a7c7e618308ee0416c4826214ccd`**. Runtime, tests, package, lock, gate, and configuration paths are unchanged.
- Read the original post-repair captures: **39 focused tests**, Convex typecheck, and the **nine-step gate with 2,677 tests**, build, **93 PowerShell** and **47 Bash** checks passed. All six log/meta files match their committed blobs. The earlier native dev receipt was checked only as historical provenance.
- Verified native capture hashes against their original files and selected events against the frozen journal. Ledger working bytes, index, reviewed commit, and retained snapshot agree at **`349fb5701b4cfe83cb7463a611b1c443f37f9549437d25f474ba09fb348d2ec8`**. Recorded native `final_acceptance` remains **false**.

The principal exact SHA-256 bindings are:

| Artifact | SHA-256 |
|---|---|
| `convex/generations.ts` | `63d00ebe932128988c573880fddab59ffac6df14be5a70e5b26fdc862355a5ab` |
| `convex/ai/brief.ts` | `505727fdb8a83b8f177f22c44e7acc845aa6254fdf7cca9b69f0f9f9b6117e00` |
| `convex/lib/briefRender.ts` | `88389d3f5426cae240f41dc8bc8682740ae2855e91e9b53a347a0b5a35fb2428` |
| `convex/ai/brief.test.ts` | `71f8aafa934541d8a70add72829382a5c9a0aa74402df133a360137b2e0ca008` |
| Frozen `<intent-contract>` | `1578a91c88866f371d59a64c5837ee53e94b45c7fcf351db81e51e9cb1da40ad` |
| `core-review.diff` | `708a8a68d0a6e5fc4e4c8eaec7a17af5437332ba19f97242abc443e0b315c972` |
| `full-review.diff` | `df553a5a8da70d5d831c5a3e128863e62ed6e173f2e9f08d1384a8136aae8672` |
| Post-repair canonical log | `ef1e3740719e4814a972f6c3f853dc280fba086b02636131a787506ff82e8dc5` |
| Post-repair canonical `.meta` | `f6093eb46bf8de8b16e49ed5f9b3ec2c39e9d2b0f109b44eb875e02dcf89b378` |

The frozen intent also matches the original implementation commit. Fresh per-layer input/output hashes remain recorded unchanged in the [review artifact directory][artifacts].

`verification-reuse.md` is present; its optional JSON companion is absent. No active `.audit/agent-transcripts` source exists here. Root-action conclusions therefore rely on entry snapshots, retained command/source receipts, and resulting bytes; they do not establish an exhaustive history of transient actions.

[narration]: /Users/johnnynguyen/Documents/Repos/Banhall/.bmad-loop/runs/20260912-061909-feb3/worktrees/dw-brief-derivation-concurrency/convex/lib/briefRender.ts:51
[omission]: /Users/johnnynguyen/Documents/Repos/Banhall/.bmad-loop/runs/20260912-061909-feb3/worktrees/dw-brief-derivation-concurrency/convex/generations.ts:1637
[oversize]: /Users/johnnynguyen/Documents/Repos/Banhall/.bmad-loop/runs/20260912-061909-feb3/worktrees/dw-brief-derivation-concurrency/convex/ai/brief.test.ts:1800
[reuse]: /Users/johnnynguyen/Documents/Repos/Banhall/.bmad-loop/runs/20260912-061909-feb3/worktrees/dw-brief-derivation-concurrency/.audit/DW-112/additional-review/verification-reuse.md
[artifacts]: /Users/johnnynguyen/Documents/Repos/Banhall/.bmad-loop/runs/20260912-061909-feb3/worktrees/dw-brief-derivation-concurrency/.audit/DW-112/additional-review

## Attention

Reviewer: **gpt-6-astra, reasoning xhigh**, confirmed by this review’s actual CLI header.

- **New flag:** B9’s low-severity narration repair remains unapplied.
- **Historical limits:** installation provenance, production conflict-retry evidence, and browser-component coverage are not established by the reused gate.
- **Audit limit:** no active root agent-transcripts source; raw reviewer logs and expanded diffs remain locally retained, ignored artifacts.
- **No unexplained evidence-integrity discrepancy found. Native final acceptance remains orchestrator-owned.**