# Preflight and failure-propagation evidence runner

Run from the DX-1 worktree after the default gate has installed its local dependencies:

```sh
node .factory/plans/20260904-code-quality-sweep/verify-gate-preflight.mjs
```

This audit artifact invokes the actual `scripts/loop-verify.sh` in the current directory. It supplies no replacement gate or fake success output. It is expected to fail against the old gate, which has no numbered preflight.

Two independent child runs isolate missing PowerShell and missing Chromium. The first copies executable resolution from the caller's PATH into owned symlinks except `pwsh`, with browser verification off. Each original PATH directory gets its own fixture directory in the same order, avoiding collisions between names differing only by case across directories. The second keeps the caller's PATH and sets `VERIFY_COMPONENT=1` plus a nonexistent owned `PLAYWRIGHT_BROWSERS_PATH`. Neither changes the caller's environment, installed tools or shared browser cache. Child processes receive public URL placeholders; no deployment is needed.

Each missing-tool run must exit 1 with a `[1/N] preflight` banner, identify the missing tool and provide an install hint. Any later numbered step or typecheck output fails that probe.

A third run keeps real Node, npm, PowerShell and installed dependencies, with browser verification off. An owned PATH entry shadows only `npx` with a small Node fault-injection executable. It records the invocation and returns **37** only for the first exact `npx tsc -p convex/tsconfig.json --noEmit` call from this checkout; any different or repeated invocation returns **97** and fails verification. The compiler is deliberately not executed in this probe. The actual gate must print preflight step 1 and the Convex typecheck as step 2, name that step in its failure diagnostic, return 37, and start no subsequent step. The shim prints no fake gate diagnostic; its invocation record is retained in the report before fixture cleanup.

These checks use the gate's required step/output contract; they do not trace operating-system process execution. Source-order review must support the absence-of-later-work claim. The script captures actual stdout, stderr, exit, duration, source SHA-256 and git commit in a unique `.audit/dx-1-one-verify-entry/preflight-run-*/` directory.

Each child owns a POSIX process group. A 15-second timeout or interrupt sends TERM to the group, then KILL after 500ms; a final deadline prevents inherited output pipes from hanging the runner. Normal completion also kills any surviving group members. `finally` removes only that run's fixture directory, retaining evidence. A timeout, interruption, cleanup error, changed gate source, missing host prerequisite or incomplete set of three probes cannot pass.

Pair this command in ticket `verify` with `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh`. The normal engine gate covers default execution; that explicit command covers the optional success branch; this runner covers missing-tool failures and propagation of a later command's distinct failure code. This narrow path also gives factory QA a specific command permission. It is evidence tooling for this ticket, not a new permanent test framework.

For final cold-bootstrap proof, use an owned disposable checkout outside the live repository, with no local dependencies. Run the default gate with an owned nonexistent `PLAYWRIGHT_BROWSERS_PATH`, `VERIFY_COMPONENT` unset and both public URL variables unset in that child environment. Require actual dependency bootstrap, newly created local dependencies, placeholder-origin messages and no browser step. The optional success run must show the final component-suite step and its actual passing file/test counts; exit 0 alone does not establish that it ran. Review the actual Node predicate against 22.11, 22.12, 23 and 24; do not claim those Node versions were executed when final runtime validation used only Node 24.

Initial validation: the runner and generated injection executable pass syntax checks. Twenty-one pure assertion-structure cases cover missing-tool diagnostics and hints, distinct status propagation, missing/repeated/unexpected invocation records, missing failure diagnostics, subsequent steps, timeout and cleanup errors. Neither the gate nor injection executable was executed. A read-only host PATH inventory found 34 entries, 2,059 executable entries and no current case-fold collisions. Prior independent source review inspected group cleanup and fixture scope; the added third probe still requires review and runtime validation against DX-1. No runtime preflight or propagation result is claimed here.
