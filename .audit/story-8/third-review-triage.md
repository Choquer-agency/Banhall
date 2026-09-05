# Story 8 third review dispositions

Baseline: `64ee37c8d7498318232f6367b55c7f638e8b830e`.
Entry revision: `e7f58d017eac1f5d232a8df1c72233d5e2bb3cb6`.

All four independent review layers ran in this invocation. The first three launched together and the fourth launched when a slot became available, before triage. Each read the complete baseline-to-working-tree diff. Entry state contained only the caller's removal of the story's previous Auto Run Result. The done story routes to fresh review; the existing implementation remains in place. No ledger content or status was changed.

## Accepted patches

All nine findings are low severity. They improve precision and regression coverage without changing the measurement contract.

| Finding | Action and evidence |
|---|---|
| Entry-based identity is described as unrecorded | Distinguish missing source ID from available historical entry identity in the actual page |
| Wholly unattributed rows do not explain their score association locally | Explicitly describe generation-associated judgments without an identified source |
| Source usage counts lack a local loaded-evidence label | Label source table columns Loaded generations and Loaded passages |
| Byte-budget value includes authorization reservation | Describe estimated budget consumed and its authorization allowance |
| Long unbroken source titles lack narrow-layout proof | Wrap long source titles and exercise long title/ID fixture on the actual page |
| Mixed populations lack a shared-budget regression | Enforced-limit query loads generation, source, candidate, report and review bodies together; later review evidence is incomplete |
| Wrong-table source IDs lack a regression | Real query rejects unrelated project metadata and preserves historical source title |
| Capped candidate cohort ordering is not observable in uniform-score tests | Distinct oldest/newest scores establish oldest-created mean; reversing actual query order makes the new assertion fail |
| System map incompletely describes the new reader | Add terminal retrieval to outcome storage to metrics query edges and correct contradictory write-only narrative |

## Rejected observations

- Low: small positive rerank rates render zero. At the actual 2,000-outcome cap, the smallest positive rate is 1/2,000. Executed JavaScript `((1 / 2000) * 100).toFixed(1)` returns `0.1`, not zero. The suggested smaller positive cohort is unreachable under this query cap.
- Low: add pagination or a narrower date selector. The intent explicitly requests 30/90-day bounded populations with honest truncation, which are implemented. A new exploration interaction is not necessary to satisfy that contract.
- Low: add rejection tests for arbitrary internal telemetry inputs. The sole production caller supplies a UUID, Date.now(), and an internal call-site label. The requested malformed inputs have no exposed caller; real persistence failures already exercise every terminal result's preservation. No uncovered user behavior was demonstrated.
- Low: hoist repeated per-generation score reductions. With 2,000 total passages and bounded joins, this is a small implementation preference without an observed correctness or performance failure.
- Low: supporting text-xs classes violate type roles. `docs/design-system.md` explicitly permits supporting text-xs/text-sm. Page headings and content use the required semantic type roles.

The edge-case reviewer returned no findings. The intent auditor describes the implemented observational reading without a definite measurement or missing-data mismatch. Current associated judgments and daily aggregation are expressly labelled; complementary local backend/retrieval/browser evidence does not claim a deployed browser-to-provider journey or unchanged telemetry latency.

Counts: intent_gap 0; bad_spec 0; patch 9 (high 0, medium 0, low 9); defer 0; reject 5 (high 0, medium 0, low 5). Follow-up score: 9; recommendation true. Existing deferred-work ledger entries remain unchanged.
