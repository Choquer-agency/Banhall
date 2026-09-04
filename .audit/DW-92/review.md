# DW-92 fresh native review

Review model: gpt-6-astra, medium reasoning, all four BMAD layers. Three available child slots required the intent layer to start after the verification reviewer returned; all layers completed in the active parent turn before triage.

Review inputs: the full diff from frozen repair baseline `0dd0d6bd98c28e54107ae10fe06a90fd83c6dab2` to entry `137d77f87db77d8296f5e759ebfa7e2a55709c25`, plus the QA implementation diff from original baseline `f122b086d745acc40b4decca26b9aaafc7257f6a`. Exact diff hashes are in `provenance.json`; ignored scratch `.diff` files are reproducible from Git and are not delivery artifacts. Independent integrated stories are not changes authored by this follow-up.

## Layer results and triage

Blind hunter returned ten findings. Edge-case hunter independently returned the unpunctuated cross-reference finding; it is deduplicated with the same blind-hunter claim. Verification-gap reviewer returned no gaps. Intent auditor found no confirmed intent gap under the complete frozen contract's exact-evidence backend reading.

| Finding | Route | Reason or repair |
|---|---|---|
| Unpunctuated legacy cross-reference changes section | high patch | Require an established plaintext section label, with or without terminal punctuation. |
| Late section 242 appendix hides earlier renamed uncertainty | high patch | Suppress preamble only when the first recognized section is 242. |
| Rich-text whitespace-only blank lines merge unrelated explanation | high patch | Normalize blank lines while preserving soft wraps during extraction. |
| Because substring accepted as explanation | reject | Unchanged historical detector semantics; the contract explicitly reuses that detector and excludes a new linguistic classifier. |
| Abbreviation splits an explained uncertainty | reject | Same pre-existing sentence-detector boundary, not a regression introduced by this extraction repair. |
| Multiple uncertainties share one explanation | reject | Existing frozen deferral already records this exact limitation; preserved verbatim. |
| Copy does not inherit another report's methodology rows | reject | Contract pins evidence to report ID and explicitly excludes other-report findings. Copy must persist deterministic findings, which it does. |
| Large document could exceed write limits | reject | No concrete failing size or supported-path reproduction was supplied; speculative volume concern does not establish a defect in this follow-up. |
| No public findings-detail rail | reject | Contract's required surface is persistence/readiness/publish and expressly prohibits QA rail/component changes. |
| Displayed scorecard lacks a revision freshness indicator | reject | Display changes are outside the frozen backend enforcement surface; stored blockers already use exact identity. |

Totals: intent_gap 0, bad_spec 0, patch 3 (high 3, medium 0, low 0), defer 0, reject 7. Follow-up review recommended: true because high findings were patched; medium/low weighted score 0. No ledger was modified and no existing story deferral changed.

## Runtime proof and repair inspection

Four new registered mutation/query regression cases reproduced missing `QA_BLOCKING` against the unchanged entry product source. `before.log`: exit 1, four failures. After the extractor repair, `after.log`: exit 0, 81 tests across three files. The tests assert readiness, atomic publish rejection, and persisted exact-report/revision/hash findings after a save.

The edge-case reviewer separately inspected the final uncommitted extractor/test diff and returned: "No actionable issues found." Existing title-preamble, marked-text, soft-wrap, known-label punctuation, nested-container, and section-isolation tests remained green.

Intent interpretation remains exact-content evidence: changed bytes trigger deterministic reevaluation without requiring new AI assessment; byte-identical content in the same report cannot waive known methodology failures. No semantic correction detector or fresh-AI-pass requirement was introduced.
