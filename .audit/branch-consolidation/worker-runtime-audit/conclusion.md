# Independent completed worker runtime audit

Scope: only owned consolidation dispatch/exit receipts and CLI logs for B1, B12, B2/B2-r1, B13/B13-r1/B13-r2, B3, B4, B5/B5-r1. No source/test rereview, unrelated transcripts, process inspection, other worktrees or runtime execution. B6 is pending by parent instruction and excluded, irrespective of its later completion.

**Result:** 44 completed fresh CLI sessions verified: 11 implementation attempts and33 independent reviewer sessions, grouped into11 three-reviewer rounds across7 accepted batch families. All44 actual CLI headers identify `gpt-6-astra`, `reasoning effort: medium`, and `/Users/johnnynguyen/Documents/Repos/Banhall-branch-consolidation`. All44 have distinct session IDs, final exit0 receipts with completion timestamps and nonempty final-result files. No worker-level failure or model/checkout mismatch found.

| Batch family | Implementation attempts | Three-reviewer rounds | CLI reviewer sessions |
|---|---:|---:|---:|
|B1|1|1|3|
|B12|1|1|3|
|B2, B2-r1|2|2|6|
|B13, B13-r1, B13-r2|3|3|9|
|B3|1|1|3|
|B4|1|1|3|
|B5, B5-r1|2|2|6|
|Total|11|11|33|

These are completed execution counts, not eleven independently accepted versions. Earlier B2/B13/B5 versions were rederived after substantive review findings; an implementation process exiting0 does not mean its source passed final BMAD acceptance. The three CLI layers are blind/edge/gap. Parent-owned acceptance/triage is not a fourth fresh CLI worker and is not counted here. This audit does not retroactively prove a previously unavailable native collaboration fan-out succeeded; it verifies the actual recorded CLI replacement sessions.

## Receipt binding and exceptions

`receipts.json` records exact artifact paths, SHA-256, header fields/excerpts, session ID, completion, exit, result size and dispatch agreement for each worker. Every available argv explicitly requests Astra6/medium and matches its actual header. B1's three older reviewer exit receipts lack argv/standalone dispatch JSON; their actual headers plus per-layer exit/output and aggregate review-exits provide the model/checkout/completion evidence. Do not claim missing dispatch metadata was present.

B2-r1's implementation log and original dispatch were preserved under `B2-r1/initial-save-probe/`; its final exit/result remain at batch root. The argv result target and actual session header bind this preserved log to that implementation. It is one worker, not an additional probe implementation. Compressed copies and aggregate exit JSON are duplicate evidence, not additional workers. Reviews use read-only sandbox headers; B1 implementation uses workspace-write, other implementation sessions use the explicitly recorded write sandbox. No sandbox-policy conclusion beyond these recorded values is inferred.

## Failures inside logs versus worker outcomes

Expected red tests/control failures are nested tool outcomes, not failed CLI dispatches. Examples include B12's genuine unhandled-rejection baseline and B5-r1 baseline Underline regression expecting one registration but observing two. Their successful process completion includes reporting those failures and the subsequent outcome. Some nested nonzero commands are neither red tests nor fatal failures: rg no-match, missing optional skill lookup, absent pre-rederivation benchmark path, and git diff --no-index reporting a difference. Do not label every `exited1` line an intentional test failure.

B2-r1 also retained its earlier initial-save diagnostic failure; final process exit and result exist, and parent handled its acceptance separately. This audit does not reclassify or conceal such nested failures or rerun their tests.

Actual logs contain recurring skill-icon warnings, state-database fallback notices, and MCP initialization warnings during shutdown (including missing executable and a B4 OAuth metadata warning). These are recorded environment/tool warnings; they coexist with completed model sessions, final result files and exit0. They do not establish that every optional MCP connector worked, and they do not make these44 CLI workers failed fan-out runs. No authentication or MCP repair was attempted.

## Limits

This is a bounded independent runtime/identity audit, not source correctness, final gate, ledger closure or shipping approval. It reports the model actually named by CLI headers, not independent provider-side model attestation. It does not inspect other tasks or restart any native loop. Only this audit directory was written.
