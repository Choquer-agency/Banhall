# Native post-review verification audit

Installed bmad-loop 0.11.1 enforces the configured command after a converged review, and a nonzero result blocks acceptance. It does not persist successful post-review subprocess results. The absent post-review `verify-command-result` records are an instrumentation difference, not evidence that this gate was skipped. For these two historical runs, there is no independent retained native post-review stdout/exit receipt to replay or inspect; execution is supported by the inspected mandatory control-flow path and matching native results, not directly witnessed by a subprocess receipt. Do not claim that all native gate commands were journalled.

Scope: phone acceptance `f34bd79ccff35019c5cf5460d8845a0240c19978` and malformed-PED acceptance `b3d36d2992aaf2d8c3b975a47f749d184b6eb543` in run `20260904-162523-6e72`. Read installed source, live task/journal artifacts and retained verify inventory. No broad tests, engine changes, lifecycle writes, patches, worktree edits or pushes. Only this report and `native-postreview-verification-receipt.json` were written. Package version, source hashes, selected state/events and the bounded probe are retained in that receipt.

## Mandatory execution path

Source root: `/Users/johnnynguyen/.local/share/uv/tools/bmad-loop/lib/python3.13/site-packages/bmad_loop/`.

- `engine.py:2760` advances to REVIEW_VERIFY immediately after the reviewer session, before deciding convergence. Merely observing this phase does not prove a command ran.
- `engine.py:2870` journals review-result. At `engine.py:2880`, status done with no follow-up (or a damped follow-up) calls `_verify_review(task)`. Only `outcome.ok` sets clean and exits toward commit. Final commit is at `engine.py:3000`.
- The actual sweep override at `sweep.py:1868` invokes `verify.verify_review_bundle` at line 1879. It does not use the dev-result recorder.
- `verify.py:4250` validates the terminal spec and closed bundle entries. The successful artifact checks return `_verify_review_commands(policy, paths)` at line 4287. `_verify_review_commands` calls `verify_commands_outcome` with the repository root at line 4137.
- `verify.py:4099` immediately runs `run_verify_commands` and classifies its results. `verify.py:4035` actually invokes `subprocess.run` with the policy command, repository cwd, captured stdout/stderr and a bounded timeout. This is fresh execution, with no cached pass or skip branch.

The run policy snapshot contains exactly `bash scripts/loop-verify.sh`, with stream capture 256 KB. Live journal lines 153 and 168 record done review results without follow-up damping, and task state has the expected accepted commit for each. Those observations identify the mandatory converged branch above. They support native gate completion under the installed implementation. They do not independently prove the historical process binary/source could never have differed, or recover the discarded command output. Elapsed time was not used as proof.

## Where results go

For dev (and applicable repair) verification, `engine.py:4644` calls `_verify_commands_with_results`: execute at 4657, journal results at 4658, classify at 4659. `_journal_verify_command_results` at 4719 writes stdout/stderr streams and appends the structured event at 4795. Its own documentation explicitly scopes correlation to dev or repair passes.

The post-review path instead calls `verify_commands_outcome` directly. The captured `CommandResult` list lives only in memory and is reduced to `VerifyOutcome`. On success, the outcome has no retained stdout or return-code fields, and no recorder is called. On failure, the reason includes the command, nonzero return code and bounded output tail, which the engine records in `review-verify-failed`.

Actual run inventory matches this implementation: phone has `verify-dw-research-phone-redaction-boundary-dev-1-1-0.stdout.log` and its stderr companion; malformed PED has equivalent `verify-dw-ped-malformed-content-rejection-dev-1-1-0` files. There are no review-stage native stream files. Journal lines 148 and 163 are the dev command results, both exit 0. Lines 153 to 154 and 168 to 169 contain review-result followed by story-done, with no post-review command receipt. Review-worker logs and committed `.audit/DW-88/followup/verification.log` / `.audit/DW-48-DW-66/followup-full-gate.log` are separate reviewer evidence; they must not be relabelled as the subsequent native command's stdout.

## Failure behavior and bounded probe

`verify.py:4079` checks environment faults; `verify.py:4090` classifies every nonzero result as an unsuccessful fixable outcome. Timeout is converted to return code -1 at `verify.py:4060`, also unsuccessful. `engine.py:2892` records review-verify-failed, escalates nonretryable failures and otherwise repairs/reviews or ultimately defers. A failed gate does not set clean and cannot take the ordinary acceptance branch. The exhaustion-rescue path also calls `_verify_review` and requires success.

Using the installed interpreter with `-B`, I invoked the real `_verify_review_commands` helper twice with separate ephemeral policies containing only harmless shell commands, without modifying the actual engine or policy:

- `exit 0` returned `VerifyOutcome(ok=True, fixable=False)`.
- `exit 7` returned `VerifyOutcome(ok=False, reason='verify command failed (rc=7): exit 7\n', fixable=True)`.

This is a bounded direct test of actual command execution and nonzero classification, not a replay of either historical project's gate and not a simulated native acceptance. Source inspection establishes how that failure is routed away from commit.

## Assessment

No gate-bypass defect found. There is a real historical observability limitation: successful post-review native stdout/exit evidence is discarded by the installed package, despite equivalent dev evidence being retained. That limitation prevents a stronger receipt-based historical assertion. It does not justify changing application code, altering native state or declaring either story failed. Final integration verification can provide a fresh exact-tree receipt, but should be reported separately from these native historical passes.
