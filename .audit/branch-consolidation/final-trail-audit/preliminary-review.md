# Preliminary cross-model decision-trail review

Reviewer: GPT-5.6 Sol, independent from the GPT-6 Astra implementation and review workers.

Scope: canonical `.audit/branch-consolidation/decisions.tsv` rows 2–32 against only the active user-task transcript slice recorded in `transcript-scope.json`, plus the evidence paths named by those rows. This pass is preliminary: B11, final source admission, ancestry recording, PR/CI, and the normal merge remain pending.

## Attention

1. **HIGH — the Cownose ownership boundary is absent from the canonical trail.** Transcript lines 11569 and 11598 record the unanswered ownership question and the 14 uncommitted paths. `.audit/branch-consolidation/worktree-audit/findings.md` identifies 13 tracked modifications plus one untracked component test and explicitly says to coordinate the owner before disposition. `state.json` still says `cownose_ownership: awaiting user reply; audit complete, no dependent integration`. No decision row records that these paths were excluded. Before handback, append a row whose result remains `open` unless the user answers; the final merge claim must say that “all branches” excludes these uncommitted bytes pending ownership, or wait for disposition.

2. **MEDIUM — row 2’s evidence proves the ref capture, but not the private checkout it also claims.** `.audit/branch-consolidation/initial-refs.json` establishes the 81-ref snapshot. The checkout, baseline, branch, and private runtime copy are instead recorded in `.audit/branch-consolidation/setup.json`. Because the log is append-only, add a correcting/supplemental row or include both pointers in a later final-scope row.

3. **MEDIUM — row 7 points to structural verification for a semantic disposition.** `.audit/branch-consolidation/recovery-audit/root-verification.json` proves 63 commits, 589 path identities, and explicitly limits itself to structural/source-identity verification. The decision text says the archive disposition was corrected “after independent source review”; the direct evidence is `.audit/branch-consolidation/recovery-independent-review.md`, while the current structural receipt also says B11 remains required. Add the semantic review pointer when logging B11/final recovery closure. Do not let row 7 alone support ancestry admission.

4. **MEDIUM — row 28 omits the artifact that proves its numeric result.** The script and commit are reproducible inputs, but the asserted `14 manifests and 890 records` lives in `.audit/branch-consolidation/recovery-audit/committed-archives-control.json` and its receipt. The transcript reports that control at line 15000. Cite the result artifact in the final rerun row, and keep “final candidate rerun remains required” open until the immutable final candidate passes.

5. **MEDIUM — the final factory-history replay is currently an unresolved gate, not a completed claim.** Canonical row 15 honestly records the earlier B4 draft correction. The current final replay reportedly fails on a stale `planning/B4.md` SHA comparison while recovery verification still passes 63 commits/589 identities. Preserve the failure and append its exact result pointer once the independent auditor finishes. Do not summarize the 124-commit factory audit as replay-green until the verifier either passes unchanged evidence or documents why the stale pointer is historical and safely superseded.

6. **MEDIUM — dynamic shipping facts need fresh rows and fresh evidence.** Row 13 proves that `main` was `cc6b706…`, merge commits were allowed, and no PR was open at 00:23 UTC. Transcript line 12743 correctly says nothing had been pushed or merged at that checkpoint. These facts can drift. Before ancestry recording and again before merge, record fresh captured-ref drift, remote `main`, PR state, both required CI job results, and resulting `main` ancestry. The newly observed lack of GitHub branch protection also deserves an explicit process decision: manually require both CI jobs before the normal merge, without claiming protection is configured.

7. **LOW — the runtime audit needs one final extension row.** Row 25 is truthful as a point-in-time checkpoint of 44 sessions through B5. Transcript line 15594 and `.audit/branch-consolidation/worker-runtime-audit/conclusion-through-B10.md` extend that count to 64 and explicitly exclude B11. Append a final immutable checkpoint after B11, preserving the limitations about CLI-header identity and prior rederived attempts.

## Corrections already documented and not re-flagged

The trail properly records the B13 overlap/highlight rederivations (rows 14 and 17), the B4 draft-target correction (row 15), the maintained Underline control added after review (row 22), the Node 22 to Node 24 runtime correction (row 20), the regenerated screenshot investigation and restoration (row 23), and the B10 partial-router fixture correction without claiming live destination routing (row 31). Rows 19 and 27 also keep DW-103, DW-104, and DW-105 open rather than presenting inherited findings as resolved.

No completed row claims B11, ancestry recording, a pushed PR, CI, or merge success. Preserve that boundary in the final trail.
