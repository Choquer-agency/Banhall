# Evidence errata

Files under `.audit/` are records of what ran. We don't rewrite them after the fact. Corrections live here.

## DW-112 review effort

The review headers in `.audit/DW-112/additional-review/` (`blind`, `edge`, `intent`, `verification`, `lead`) show `reasoning effort: xhigh`. The reviewer policy in AGENTS.md requires `medium`. The DW-112 batch deviated from that policy. The findings still stand, but the effort recorded in those headers is not the policy setting. Later reviews in the PD generation stack ran at `medium`.

## Local-only validation scripts

`.audit/pd-sweep-validation/run-phase.sh`, `run-b.sh` and `test-hardening/run-mutation.sh` hardcode worktree and scratch paths from the machine that ran them. `run-phase.sh` also runs `git reset --hard` and `git checkout --detach` in that worktree. They were one-off tools, and the committed `.raw.log` files next to them are the evidence. Don't run them from a normal checkout. To reproduce a result, read the command recorded in the log header and run it in a disposable worktree.

## Links in review reports

`.audit/DW-112/additional-review/lead.md` links to `/Users/.../.bmad-loop/runs/.../worktrees/dw-brief-derivation-concurrency/...`. That path was the reviewing agent's worktree at run time and doesn't exist in a fresh checkout. Some linked files, like `full-review.diff`, are gitignored on purpose. Use the committed counterparts in the same folder instead, for example `core-review.diff`.
