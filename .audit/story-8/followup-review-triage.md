# Story 8 follow-up review dispositions

Reviewed baseline: `64ee37c8d7498318232f6367b55c7f638e8b830e`.
Reviewed entry revision: `abc2d23ed38b7e2c4558bd3a8a6d120967f6c102`.

All four independent review layers completed in this invocation. Three reviewers launched together; the fourth launched when a slot became available, before parent triage. Review content was the complete baseline-to-working-tree diff, including existing audit artifacts. The entry story was already done, with its Auto Run Result removed in the invocation working tree; this invocation therefore ran the required fresh review. No deferred-work ledger was edited, reopened, rewritten or staged.

## Accepted patches

| Finding | Severity | Required action |
|---|---|---|
| Cached admin data keeps subscription active during access loading, staleness or error | medium | Require settled access before metrics subscription and presentation; exercise transitions and recovery on the actual mounted route |
| Capped judgment selection order is not explained | low | Describe oldest-created candidate/report/review selection and per-join/shared limits |
| Daily table lacks explicit keyboard scroll access | low | Named focusable daily readings region and executed vertical keyboard scroll |
| Non-midnight chart boundaries lack positional coverage | low | Verify first/last-day x positions and boundary segments |
| Narrow source table keyboard scroll is not exercised | low | Execute horizontal keyboard scroll on the mounted page |
| Browser byte-budget fixture is internally unrealistic | low | Use the actual byte limit/headroom and a valid initial reservation |
| Earlier evidence statements read as unfinished current work | low | Mark implementation/review-stage notes as historical and point to completed acceptance |
| Evidence links target uncommitted raw logs | low | Link committed compressed artifacts and document decompression |
| Chart values can flatten without failing tests | low | Assert actual SVG heights for 0%, intermediate and 100% samples |

## Rejected observations

- Low: reserve some generation byte budget for judgment joins. The approved bounded observational contract permits partial results and requires accurate disclosure, which the enforced-limit query and per-source completeness flags provide. Changing population prioritization is an optimization preference without a demonstrated violation.
- Low: test concurrent idempotency submissions. The indexed read and insert share a Convex mutation transaction; sequential duplicate suppression already exercises the application behavior. No custom concurrency mechanism or demonstrated defect needs another framework-level test.
- Low: test a throwing UUID generator. UUID creation is already inside the same try/catch as persistence. Actual retrieval preservation under rejected persistence is covered for every outcome; no production trigger or uncovered policy behavior was established for the installed runtime's UUID API.
- Low: merge malformed source IDs with valid historical entry identities. The contract permits stable distinct identities and explicitly prohibits inventing joins. The current raw-source identity preserves uncertainty and the historical-ID tests prove it does not crash; merging would infer identity without evidence.
- Low: impose a telemetry write timeout. The contract authorizes prospective storage, isolates write failures and specifies unchanged returned results/retries/billing. No latency threshold or stuck-write behavior was demonstrated, and a new timeout policy is not required by the approved intent.
- Low: accept and format an observation timestamp above JavaScript's date maximum. The internal mutation has no public input path; its sole production caller obtains observedAt from Date.now(). The proposed trigger is not reachable through that caller, while public query bounds already reject unsupported dates.

The intent auditor found no definite contract divergence. Daily PED aggregation, generation-start cohorts with current associated judgments, and local complementary browser/backend/retrieval evidence remain explicitly described. Deployed browser-to-provider behavior and latency are not claimed.

Counts: intent_gap 0; bad_spec 0; patch 9 (high 0, medium 1, low 8); defer 0; reject 6 (high 0, medium 0, low 6). Follow-up score: 3 × 1 + 8 = 11; recommendation true. Completion evidence is recorded in evidence.md after the patches and verification finish.
