# DW-92 supplied-spec native review

Review entry: `2e5e4b3c3932ba8ce151fffff33d713d49116bd6`. Workflow baseline remains `86a43d9d500ceab34245744d223d4453eba7b667`. Four independent layers reviewed `review.diff` and `untracked.txt`: blind hunter, edge-case hunter, verification-gap reviewer, intent-alignment auditor. The fourth launched after a slot became free; all four were launched before parent triage. Historical implementation and repairs are included in the retained diff and preceding committed inspection evidence.

## Independent finding evaluation

| ID / layer | Finding | Triage and resolution |
| --- | --- | --- |
| B1 blind | A leading substantive H1 is indistinguishable from generated title | Reject, medium. The accepted title-exclusion contract explicitly tests uncertainty-like generated title text. Inferring a narrower title identity would change that established behavior without supporting metadata. Actual H1 section labels remain covered. |
| B2 blind / E1 edge | Empty paragraph before title creates false blocker | Patch, high. Ignore empty preceding blocks when identifying the leading title; reproduce through registered boundaries. |
| B3 blind | Inherited inline context merges list/table block content into preceding uncertainty | Patch, high. Preserve supported list/table block-container separation, with registered red/green coverage. |
| B4 blind | Positive split-marker fixture can pass with lost marker | Reject, medium. The adjacent missing-because fixture already splits the same marker and requires persisted blocking rows plus both gates. Mutation proof establishes the combined coverage without duplicating a fixture. |
| B5 blind / intent | Prior ledger equality describes open bytes, not present native close | Patch, low. Retain current invocation hash and native close/session-start events; verify working and index hashes against this snapshot before commit. Ledger content remains untouched. |
| B6 blind | Prior final checker rejects current native close | Patch, low. Retain historical checker and add invocation-specific checker separating protected product files from proven native ledger bytes. |
| B7 blind | Runtime snapshot includes worktree .git pointer | Reject, low. This checker intentionally validates this invocation's local runtime environment, not portable reproduction in another clone. No cross-clone equivalence is claimed. |
| B8 blind | Shell/tool provenance absent | Patch, low. Record actual tool versions and hashes of a safe gate-control environment allowlist. No environment secrets are retained. |
| B9 blind | Final checker accepts arbitrary two successful commands | Patch, medium. New checker requires the exact ordinary and focused command vectors in order. |
| B10 blind | Latest checker does not revalidate every older artifact | Reject, low. Older evidence is explicitly historical and anchored by prior commits. Current integrity claims are limited to current command logs, source identity, protected paths, terminal result and ledger equality. |
| B11 blind / intent | Current spec lacks terminal marker while prior audit claims completion | Patch, low. Preserve historical evidence, explain the native review transition and emit a unique current Auto Run Result after actual verification. |
| V1 verification | Explicit blocks inside inherited inline context lack regression fence | Patch, medium. Registered nested-paragraph fixture asserts exact findings, readiness and atomic publish rejection; separator mutation proves sensitivity. |
| V2 follow-up verification | A matching older gate could satisfy the new checker | Patch, low. Require command start times after the native review-session start and recorded revisions equal this invocation revision. |

Counts: intent_gap 0; bad_spec 0; patch 9 (high 2, medium 2, low 5); defer 0; reject 4 (high 0, medium 2, low 2). Follow-up recommendation true because high findings exist; medium/low score 11.

The intent auditor found compatible readings: bounded substantive QA repairs, fresh native recovery on the existing flat spec, current-reference atomic enforcement, and worker completion distinct from subsequent orchestrator acceptance. No product-policy expansion was identified. Native acceptance is never inferred from ledger closure or historical tests.
