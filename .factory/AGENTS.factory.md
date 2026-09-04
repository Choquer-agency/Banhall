# Factory rules (isolate → build → prove → ship)

These apply to every agent session in this repo, in any CLI, in any role.

## Isolate
- Never commit to `main` or the integration branch directly. Every ticket runs in its own git worktree under `.factory/worktrees/<key>` on branch `factory/<key>`. The engine creates it; do not create a second one.
- One worktree, one branch, one ticket per session. Never touch another worktree's files.
- Before implementing, the engine checks open PRs for files overlapping the ticket's `touches` (`[run].on_pr_overlap`). On overlap it warns or blocks; do not work around it.

## Build
- The ticket file (`.factory/tickets/<key>.md`) is the only source of truth for scope. If it is ambiguous in a way that changes the implementation, return `status: blocked` and say why. Do not guess.
- Reuse first: shared packages and existing services before new code. Duplicate operational logic is a defect.
- Keep policy in the caller, mechanics in a service with explicit inputs and structured returns.

## Prove
- Deterministic gates (`[verify].commands`) run outside your session. Make them green and leave runtime evidence.
- Keep a decision trail: `.audit/<key>/decisions.tsv`, one row per decision (ts, phase, decision, why, evidence, result). Append-only. Evidence is a pointer (sha, file:line, artifact path), never prose.
- Write `.audit/<key>/evidence.md`: exact commit, every acceptance criterion mapped to the test or command that proves it, command output tails. Bug ticket: reproduce the failure at the baseline commit **before** fixing and record it, then record the pass.
- Every claim in a summary is backed by a command you ran and its output, or a `file:line`. Never present scripted or synthetic output as a live result.
- Verification of fixes shows the old failure next to the new success. A ticket with `ui: true` shows it as `*before*.png` / `*after*.png` in `.audit/<key>/`; the PR embeds them.

## Ship
- Commit inside the worktree with a message that names the ticket key. Never push, never open a PR, never deploy, never rotate secrets from an agent session. `factory ship` does push + PR + babysit (CI and review threads fixed in a loop until green), run by a human.
- Findings you could not fix go in the ticket's `deferred:` frontmatter list, not in prose.
- Never plain `--force`. `--force-with-lease` only, and only from ship.

## Intake
- Anything coming in (idea, bug, question, brainstorm, issue, ticket key) goes through `factory go` or the `factory-mode` skill: questions get cited answers, bugs get a reproduction and one ticket, features get a plan. Nobody implements from chat.

## Roles
Roles and their CLIs live in `.factory/roles.toml` (orchestrator, planner, implementer with per-kind tiers, reviewer, lead, QA, verifier); project gates, QA commands, sizing limits, risky domains and ship policy live in `.factory/factory.toml`.
