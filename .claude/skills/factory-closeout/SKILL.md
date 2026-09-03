---
name: factory-closeout
description: After the factory engine merged tickets into the integration branch — push the branch, open or update the PR with the evidence files in the body, and summarize what is still parked. Human-invoked only; agents never push. Use when the user says "close out", "open the PR", "ship the branch".
---

# factory-closeout

Run `factory closeout [--ticket <key>] [--dry-run]`. Then:

1. Show the PR URL.
2. Summarize the evidence file(s) included: which checks passed, which were skipped and why, which criteria are under "Not proven".
3. List anything still parked: tickets with status `escalated` or `proposed` (`factory tickets`), open `YOU` lines from `factory status`, `deferred:` entries added by these tickets.
4. If `external_review.provider` is set, remind that the external reviewer already ran locally; the PR is for humans.

Never merge the PR. Never force-push. Never deploy.
