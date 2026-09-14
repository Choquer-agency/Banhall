# PD sweep validation (run 20260912-061909-feb3)

Validated head: `plan/pd-generation` at `e22a4b4`. Gate ran at `c1f6478`, which differs from `e22a4b4` only in `_bmad-output/implementation-artifacts/deferred-work.md` (see `gate-identity.txt`).

## Branch repair

The root checkout was switched to `main` at 10:33 while the sweep was live. At 10:46 the engine merged DW-121/DW-122 into local `main` (`ec2b6c7`) instead of `plan/pd-generation`. Nothing was pushed. Repair: merged `8b00e6a` into `plan/pd-generation` (`e22a4b4`) from a separate worktree, then `git reset --keep 6c4f50b` on `main`. `main` equals `origin/main`.

## Full gate

`bash scripts/loop-verify.sh` exit 0, 9/9 steps: 189 test files, 2683 tests, build, both uploader harnesses. Log: `full-gate-e22a4b4.raw.log`. Browser component suite not run; no bundle touched `src/lib/components`.

## Before/after per bundle

Before = baseline commit with the fix's test files overlaid. Logs carry HEAD and the command in their header.

| Bundle | DW | Baseline → fix | Before | After fix | At head | Discriminating (behavior-level) |
|---|---|---|---|---|---|---|
| brief-read-and-diff-integrity | 107, 118 | 7b0723b → 90215c0 | 29 fail / 29 pass | 58/58 | 61/61 | 29 (9) |
| brief-failure-observability | 109, 120 | 90215c0 → d73df4b | 12 fail / 35 pass | 47/47 | 50/50 | 12 (6) |
| brief-derivation-concurrency | 112 | d73df4b → f5f27ae | 3 fail / 36 pass | 39/39 | 39/39 | 3 (3) |
| brief-canonical-glossary | 113 | f5f27ae → 750842f | 2 fail / 37 pass | 39/39 | 39/39 | 2 (2) |
| brief-transcript-reconciliation | 114 | 750842f → 087c76b | 2 fail / 0 pass | 2/2 | 2/2 | 2 (2) |
| candidate-scoped-bounded-reads | 121, 122 | 087c76b → 8b00e6a | 3 fail / 1 pass | 4/4 | 4/4 | 3 (3) |

"Behavior-level" fails at baseline on a product assertion. The rest fail only because a function, argument or constant does not exist at baseline. Details and AC maps are in each bundle's `evidence.md`.

## Independent review of DW-107/DW-118

That bundle merged without an accepted review (review session stalled). Reviewer: `gpt-6-astra`, effort `medium`, read-only sandbox. `~/.codex2` returned a usage limit for Astra and the Sol fallback (retry 2026-09-19 03:54), so the review ran under the default Codex home. Verdict: ACCEPT_WITH_FIXES (`dw-107-118-review/result.md`). Both findings are already open ledger entries: DW-152 (high, byte-unbounded Brief consumer reads) and DW-153 (medium, publication not fenced on generation lifecycle). Worktree index hash and `git status --ignored` were unchanged after the review.

## Gaps found

1. DW-121/122: at baseline the guard rows sat past the old 30-row cap, so the before run could not show the guards. On the fixed source the existing test already catches removing both ownership checks, the missing-parent guard or the failed-run filter. The real gaps were each ownership check alone and duplicate `candidateId`. Closed by `a9b3068` (see `test-hardening/`).
2. DW-112: the fix rewrote DW-107 fixtures to unique `inputsHash` per call. Same-key writer-edit republish and retry-exhaustion races lost coverage (old tests against new source: 10 fail). Closed by `a9b3068`: 3 same-key tests, each failing under at least three source mutations.
3. DW-114: only the prompt-text assertions discriminate; the persistence half passes at baseline with the canned response. The `system` equality compares the constant with itself.
4. DW-107/118: AC3 (attempt-1 lockout red) is not reproducible, and 19 of 29 discriminating tests are API-shape only. The spec's `.audit/dw-brief-read-and-diff-integrity/` directory is absent from the tree.
5. DW-109/120: final review ran at `xhigh`, not the policy's `medium`. The cited hostile-error red log is absent from the tree.
