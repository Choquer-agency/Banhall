# Preflight evidence runner

Run from the DX-1 worktree after the default gate has installed its local dependencies:

```sh
node .factory/plans/20260904-code-quality-sweep/verify-gate-preflight.mjs
```

This audit artifact invokes the actual `scripts/loop-verify.sh` in the current directory. It supplies no replacement gate, shell wrapper, fake success output or production test. It is expected to fail against the old gate, which has no numbered preflight.

Two independent child runs isolate missing PowerShell and missing Chromium. The first copies executable resolution from the caller's PATH into owned symlinks except `pwsh`, with browser verification off. Each original PATH directory gets its own fixture directory in the same order, avoiding collisions between names differing only by case across directories. The second keeps the caller's PATH and sets `VERIFY_COMPONENT=1` plus a nonexistent owned `PLAYWRIGHT_BROWSERS_PATH`. Neither changes the caller's environment, installed tools or shared browser cache. Child processes receive public URL placeholders; no deployment is needed.

Each run must exit 1 with a `[1/N] preflight` banner, identify the missing tool and provide an install hint. Any later numbered step or typecheck output fails the probe. This checks the gate's required step/output contract; it does not trace operating-system process execution. The script captures the actual stdout, stderr, exit, duration, source SHA-256 and git commit in a unique `.audit/dx-1-one-verify-entry/preflight-run-*/` directory.

Each child owns a POSIX process group. A 15-second timeout or interrupt sends TERM to the group, then KILL after 500ms; a final deadline prevents inherited output pipes from hanging the runner. Normal completion also kills any surviving group members. `finally` removes only that run's fixture directory, retaining evidence. A timeout, interruption, cleanup error, changed gate source, missing host prerequisite or incomplete pair of probes cannot pass.

Pair this command in ticket `verify` with `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh`. The normal engine gate covers default execution; that explicit command covers the optional success branch; this runner covers the early-failure branches. This narrow path also gives factory QA a specific command permission. It is evidence tooling for this ticket, not a new permanent test framework.

Initial validation: `node --check` passes. Eleven pure assertion-structure checks cover diagnostic variants, wrong install hints, later steps/typecheck output, wrong exit status, timeout and cleanup errors; none invokes the gate. A read-only host PATH inventory found 34 entries, 2,059 executable entries and no current case-fold collisions. Independent source review inspected group cleanup and fixture scope. Real probes must wait for the DX-1 implementation; no runtime preflight result is claimed here.
