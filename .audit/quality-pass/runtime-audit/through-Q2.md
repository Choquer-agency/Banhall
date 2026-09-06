# Immutable runtime and archive audit through Q2

Verified Q1 `31ca9c3ba0b22e24da853ae763592d87bd71cc85` and Q2 `5f1998c9e486130e62569849a917ee1b79442791` using exact committed Git objects. Archive counts: 45 Q1 and 70 Q2; all stored hashes, decompressed/original hashes and byte lengths match. All **eight distinct CLI sessions** have actual Astra6 medium headers, correct checkout, matching dispatch arguments, exit0 and completed results.

All **14 committed PNGs** match retained-png-proof hashes. Direct gate log hash matches its receipt. Actual log totals: ['Test Files  154 passed (154)', 'Tests  2038 passed (2038)', 'Test Files  63 passed (63)', 'Tests  489 passed (489)']. All 9 numbered steps are present; receipt exit0. It records6366 tracked paths unchanged, unchanged status/index/inventory,14freshignoredPNGoutputs and restoration_performed=false. This is existing immutable runtime evidence; no tests were rerun.

Both screenshot-writer committed hashes exactly match the gate candidate. All final-source-hashes entries match committed bytes. AGENTS differs from its gate-time fingerprint because parent relocated unchanged guidance outside the managed block; final SPEC/evidence clarifications are post-gate documentation metadata. This is not an exact whole-commit gate claim. The private operational run_gate restoration policy is separate from canonical CI and does not establish a permanent tracked-write guard.

Findings: []. Earlier audits remain unchanged. Q3 and later units are not accepted by this report. No source, tests, dependencies, ledgers, external worktrees or refs were changed.
