# DW-112 evidence

Baseline revision: `d73df4bb9277886ca97e7b8e59caea618baf051d`

Reviewed implementation commit: `09e35062ed132d65403d19f9b9af61675ffcaee6`

Reviewed source binding:

- `convex/generations.ts`: SHA-256 `63d00ebe932128988c573880fddab59ffac6df14be5a70e5b26fdc862355a5ab`
- `convex/ai/brief.test.ts`: SHA-256 `977e079635553a2493a857625a5bf6e3c92b2503632114cc0679dfa09b03b6ba`
- Review input: SHA-256 `83f94ebfffe6f8d5e0553391d00ff75dc810ee70b7fd6e936feefd4e6f2162c1`

## Acceptance evidence

- Concurrent first publication: `convex/ai/brief.test.ts:959`; baseline failure and fixed success are in `failing-control.log` and `parent-focused.log`.
- Existing latest same-key adoption before stale fence or candidate processing: `convex/ai/brief.test.ts:1040`; baseline failure and fixed success are in the same receipts.
- Different-key stale project baseline still returns `null` and writes nothing: `convex/ai/brief.test.ts:1488`; the focused suite ran this test and passed.

## Command receipts

- `failing-control.log`: complete focused-suite failure against baseline production source blob `b86b8f1`; exactly 2 new tests failed and 36 passed.
- `focused-green.log`: child summary receipt, source-bound, 38/38 passed.
- `full-gate.log`: child 37-line command/source-bound summary, not raw command output.
- `parent-focused.log`: complete parent stdout/stderr for `npm test -- convex/ai/brief.test.ts`, with `ACTUAL_EXIT_CODE=0`.
- `parent-convex-tsc.log`: complete parent stdout/stderr for `npx tsc --noEmit -p convex/tsconfig.json`, with `ACTUAL_EXIT_CODE=0`.
- `parent-full-gate.raw.log`: complete parent stdout/stderr for `bash scripts/loop-verify.sh`, 568 lines with `ACTUAL_EXIT_CODE=0`; preserves the existing PowerShell conditional skip.
- `parent-integrity.log`: changed-source and ledger hashes plus `git diff --check`, with `ACTUAL_EXIT_CODE=0`.
- `reviewer-inputs-and-outputs.sha256`: complete prompt, prompt component, shared diff input, final review, and raw reviewer output hashes.
- `reviewer-input-validation-authoritative.log`: exact source/test diff comparison against the implementation commit, frozen intent hash, preserved review-time spec snapshot, nonempty prompt assertions, and full hash verification; `ACTUAL_EXIT_CODE=0`.
- `reviewer-input-validation.log`: superseded exploratory whole-diff comparison. It reports a byte mismatch but incorrectly recorded exit 0 because the shell continued after `cmp`; it is not an acceptance receipt.
- `reviewer-input-validation-final.log`: superseded parser attempt that correctly recorded `ACTUAL_EXIT_CODE=1`; it is not an acceptance receipt.
- `review-triage.md`: per-finding rationale for all eleven rejected review notes.
- `trail-review.md`: first independent trail review, which identified the missing per-finding rejection rationale.
- `trail-review-followup.md`: follow-up independent trail review after the rationale repair; result `No flags.`
- `trail-review-hashes.sha256`: prompt, result, and raw-output hashes for both trail reviews.

## Review receipt

Four independent Codex CLIs ran concurrently with `CODEX_HOME=/Users/johnnynguyen/.codex`, `BMAD_LOOP_TASK_ID` unset, model `gpt-6-astra`, and reasoning effort `xhigh`. Each raw log records the model, effort, session id, and `ACTUAL_EXIT_CODE=0`. The edge-case result was `[]`; the verification-gap result was `No verification gaps found.` The blind-hunter and intent-alignment outputs were independently traced during parent triage.

Each `review-*.prompt` now preserves the complete byte sequence supplied to its reviewer: the original `review-*.header`, the nonempty 19,731-byte `review-input.diff`, and any reviewer-specific `review-*.suffix`. All four complete prompts contain three `diff --git` sections and match the original composed-input hashes recorded before review launch. The raw reviewer logs independently echo those same diff sections.

The authoritative binding compares the production and test chunks separately against explicit `git -C` diffs from baseline `d73df4bb9277886ca97e7b8e59caea618baf051d` to implementation commit `09e35062ed132d65403d19f9b9af61675ffcaee6`. Both are byte-identical. The frozen bundle intent is 1,265 bytes with SHA-256 `2568b035295020a2d2248298da67be764bf5d050b4e81f983519b2dc3e9366a9`.

The reviewed spec snapshot remains embedded unchanged in `review-input.diff` with SHA-256 `8b503fd04c7601fcd203edb9ec6d0af606e42e0732289ac353743cd55b817ca7` and status `in-review`. Its product-contract portion matches the finalized spec after normalizing status. The later differences are lifecycle metadata only: status `done`, review triage, and Auto Run Result. The original reviewed input and hash were not rewritten.

An independent Astra xhigh audit-trail review initially flagged the absence of individual rejection rationale. `review-triage.md` repaired that evidence gap without changing the reviewed source. The follow-up review reconstructed the composed reviewer prompts, checked their nonempty shared diff input and hashes, reviewed every triage disposition, and returned `No flags.`

## Preservation

`_bmad-output/implementation-artifacts/deferred-work.md` remained SHA-256 `56546750658069904780a1c17f2021ed07e91f6c1c4117980e7ccf56daa15e68` and Git blob `2a52f7bd250f121ad4efbc96417b9749b0cef8d0`. No ledger resolution bytes were authored.

## Bounded additional completion, 2026-09-14

The reviewed narration repair and fresh passing gate bind to source commit `81a165e6e4fa35f9b59c86118c7aa2c886666e47`. The full acceptance mapping, exact command receipts, review triage, installation-hook provenance, and preservation evidence are in `additional-review/evidence.md`. This pass changes only the derived narration; the original implementation and historical evidence remain intact.
