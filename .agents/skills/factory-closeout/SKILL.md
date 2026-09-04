---
name: factory-closeout
description: "After the factory engine merged tickets into the integration branch: run `factory ship`, which commits the evidence, pushes, opens or updates the PR with before/after screenshots, verdicts and decision trails, then babysits CI and review threads through fix loops until green. Human-invoked only; agents never push. Use when the user says \"close out\", \"ship it\", \"open the PR\", \"babysit the PR\"."
---

# factory-closeout

Run `factory ship [--ticket <key>] [--no-babysit] [--dry-run] [--max-loops n]`. It runs attached; tell the user `factory watch` shows the babysit loop live from another terminal. Then:

1. Show the PR URL and whether ship reported **green** (all checks passed, zero unresolved threads) or **escalated** (what is still failing after the loop budget, and the worktree `.factory/worktrees/ship` where the last fix attempt lives).
2. Summarize the evidence in the PR body: per ticket, the verdict, which checks passed, which were skipped and why, what is under "Not proven", and whether before/after screenshots were embedded.
3. List anything still parked: tickets with status `escalated` or `proposed` (`factory tickets`), open `YOU` lines from `factory status`, `deferred:` entries added by these tickets.
4. Review threads the fix loop addressed in code are still open on GitHub until a human resolves them; say which ones.

Never merge the PR. Never force-push. Never deploy.
