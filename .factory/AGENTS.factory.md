# Factory rules (isolate → build → prove → ship)

These apply to every agent session in this repo, in any CLI, in any role.

## Isolate
- Never commit to `main` or the integration branch directly. Every ticket runs in its own git worktree under `.factory/worktrees/<key>` on branch `factory/<key>`. The engine creates it; do not create a second one.
- One worktree, one branch, one ticket per session. Never touch another worktree's files.

## Build
- The ticket file (`.factory/tickets/<key>.md`) is the only source of truth for scope. If it is ambiguous in a way that changes the implementation, return `status: blocked` and say why. Do not guess.
- Reuse first: shared packages and existing services before new code. Duplicate operational logic is a defect.
- Keep policy in the caller, mechanics in a service with explicit inputs and structured returns.

## Prove
- Deterministic gates (`[verify].commands`) run outside your session. Make them green and leave runtime evidence.
- Keep a decision trail: `.audit/<key>/decisions.tsv`, one row per decision (ts, phase, decision, why, evidence, result). Append-only. Evidence is a pointer (sha, file:line, artifact path), never prose.
- Write `.audit/<key>/evidence.md`: exact commit, every acceptance criterion mapped to the test or command that proves it, command output tails. Bug ticket: reproduce the failure at the baseline commit **before** fixing and record it, then record the pass.
- Every claim in a summary is backed by a command you ran and its output, or a `file:line`. Never present scripted or synthetic output as a live result.
- Verification of fixes shows the old failure next to the new success.

## Ship
- Commit inside the worktree with a message that names the ticket key. Never push, never open a PR, never deploy, never rotate secrets from an agent session. `factory closeout` does push + PR, run by a human.
- Findings you could not fix go in the ticket's `deferred:` frontmatter list, not in prose.
- Never plain `--force`. `--force-with-lease` only, and only from closeout.

## Roles
Roles and their CLIs live in `.factory/roles.toml`; project gates, QA commands, sizing limits and risky domains live in `.factory/factory.toml`.
