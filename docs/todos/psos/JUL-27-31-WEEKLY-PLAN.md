# PSOS weekly plan — July 27–31, 2026

## Source and planning standard

This plan is derived from the July 27 meeting transcript supplied directly by the product team. Transcript statements are treated as direct evidence; sequencing and ticket boundaries are planning interpretations reviewed by Claude Code/Fable 5 and Opus 5.

The one-active-ticket rule remains in force. Discovery and documentation may be timeboxed around the active implementation ticket, but two implementation tickets must not be `in_progress` simultaneously without an explicit queue exception.

## Weekly outcomes

By Friday, July 31:

1. finish or explicitly disposition PSOS-04 release QA;
2. complete PSOS-08 ownership/stage backfill if validation and rollout evidence are safe;
3. obtain an approved decision for project grouping, numbering, and Primary-instance semantics in PSOS-37;
4. leave PSOS-38 implementation-ready or explicitly dependency-blocked;
5. capture source-analysis workflow requirements in PSOS-39 without beginning a generic assistant clone;
6. continue writer testing support and alert triage.

## Committed delivery work

### 1. Close the outstanding upload-receipt release gate

- [ ] Reconcile PSOS-04’s `in_review` state with its shipped commits and production behavior.
- [ ] Repeat any missing production receipt/retry/replace evidence.
- [ ] Mark `done` or record a concrete blocker/revisit trigger; do not leave indefinite release metadata.

### 2. Start the dependency-ordered backend task: PSOS-08

- [ ] Activate PSOS-08 only after PSOS-04 disposition.
- [ ] Run the mandatory Claude Code/Fable planning pass.
- [ ] Implement bounded, resumable ownership/stage backfill.
- [ ] Match writer by unique email or exact normalized name; preserve legacy writer snapshots.
- [ ] Use creator fallback conservatively and queue ambiguous ownership for review.
- [ ] Backfill `drafting` only when a selected/current report exists; otherwise `intake`; never infer `delivered` from export alone.
- [ ] Verify idempotency, event uniqueness, batching, counts, dry-run/rollout, and rollback.
- [ ] Run Fable post-implementation review, full validation, backend-first deployment, and signed-in smoke before closure.

## Meeting-directed decision work

### 3. PSOS-37 — logical project grouping and numbering

- [ ] Choose historical project-row grouping, branch migration, or the recommended hybrid.
- [ ] Approve **Primary instance** as display-only or define another non-conflicting term.
- [ ] Resolve project-number scope and accounting lifecycle.
- [ ] Resolve test-instance delivery/outcome guardrails.
- [ ] Amend `docs/product-domain.md` using its formal amendment process.
- [ ] Update PSOS-38 with approved storage and dependencies.

No PSOS-38 code starts until these decisions are approved.

### 4. PSOS-39 — source-analysis discovery, timeboxed

- [ ] Describe the document-selection, question, summary/chronology, editing, approval, and downstream-use journey.
- [ ] Define exact-revision provenance and private-source citation behavior.
- [ ] Define limits, cost, failure, cancellation, and stale-analysis states.
- [ ] Propose implementation slices and dependencies.

Timebox: half day. This must not displace PSOS-08 or become a broad assistant rebuild.

## Operational work

- [ ] Monitor alerts and fix release-blocking regressions through normal alert policy.
- [ ] Support Emily, Tracy, Larry, and other invited writers as they test real work.
- [ ] Preserve direct feedback paths and record reproducible bugs separately from feature requests.
- [ ] Review AI usage/cost for linear single-generation cases; escalate only unexpected amplification or runaway retries.

## Deferred and backlog

### Generic assistant baseline mode

- **Decision:** deferred.
- **Reason:** the API experience and cost cannot be assumed to match ChatGPT/Claude consumer products; the meeting explicitly back-burnered it.
- **Revisit trigger:** explicit product request plus a small parity/cost experiment with acceptance criteria.

### Client repository, historical inheritance, company chat, analytics

- Captured in PSOS-40.
- No implementation this week.
- Depends on clients/claim periods, exact revision outcomes, and visibility decisions.

### PSOS-38 grouping implementation

- No implementation until PSOS-37 approves semantics.
- Production dashboard grouping should normally wait for PSOS-11 indexed pagination; no client-side post-pagination grouping shortcut.

## Suggested day-by-day sequence

| Day | Primary work | Evidence/output |
|---|---|---|
| Mon Jul 27 | Meeting, upload/reliability review, PSOS release train context | Transcript and direction captured |
| Tue Jul 28 | Close current release/documentation work; create PSOS-37–40 and weekly plan | Queue reflects meeting without duplicate scope |
| Wed Jul 29 | PSOS-08 plan and implementation | Backfill/matcher tests and development dry-run counts |
| Thu Jul 30 | PSOS-08 validation/review; PSOS-37 product decision session | Fable findings resolved; draft domain amendment |
| Fri Jul 31 | PSOS-08 rollout/closure if safe; approve PSOS-37; timebox PSOS-39 | Clean release evidence; PSOS-38 ready or accurately blocked |

## Success guardrails

- One implementation ticket active at a time.
- No new grouping, number, or Primary field before PSOS-37 approval.
- No second branch/finality/outcome architecture.
- No automatic fuzzy client or project grouping.
- No broad visibility changes.
- No generic CRM card-grid redesign; report/document work remains the product center.
- No claims that the censored mode name has been recovered; use **Project source analysis** until approved.
