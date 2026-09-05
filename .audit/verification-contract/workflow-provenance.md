# Workflow provenance

BMAD build was entered once with the exact own-worktree renderer command:

```sh
uv run --no-cache "/Users/johnnynguyen/Documents/Repos/Banhall-bmad-verification-contract/_bmad/scripts/render_skill.py" --project-root "/Users/johnnynguyen/Documents/Repos/Banhall-bmad-verification-contract" --skill "/Users/johnnynguyen/Documents/Repos/Banhall-bmad-verification-contract/.agents/skills/bmad-build"
```

It printed the own-root snapshot `_bmad/render/bmad-build/banhall-bmad-verification-contract-bb20229a2568/e7bbccdaed9501750452/workflow.md`. The coordinator read the workflow and each applicable step sequentially. The ignored26 installed runtime/config files had already been seeded by root into this private checkout. This invocation did not render into the original Banhall checkout.

Standalone spec: `_bmad-output/implementation-artifacts/spec-verification-contract-reconciliation.md`, baseline `dd787d4287bcdf970aa3bcb25f0781dc765e030c`. Existing user authorization explicitly covered the replacement gate contract, narrow repair, tests, fresh review and private commit without another planning/patch checkpoint. Frozen intent remained unchanged. No sprint story key applies; no native/factory loop or ledger mutation was performed.

Implementation used the required context-free Astra6 medium handoff. Four fresh BMAD code-review layers then ran at Astra6 medium: blind hunter, edge hunter, verification gap and acceptance auditor. Due to the shared agent limit, the initial parallel edge spawn failed, then every layer completed in a bounded wave. This was a scheduling constraint, not an omitted layer. Findings were collected before source reactions, independently triaged, and automatic patches were returned together to the context-preserving implementer. Raw layer summaries and all dispositions are retained in `review-*.md` / `review-edge.json`.

The code-review customization resolver succeeded using the private checkout's installed `_bmad/scripts/resolve_customization.py`. Its four-layer workflow had no activation prepend/append/on-complete hooks; persistent project-context glob matched no files. Applicable existing AGENTS and factory instructions were read for constraints, while explicit current user/parent BMAD isolation and shipping scope governed this task. Factory source receipts were historical evidence only.
