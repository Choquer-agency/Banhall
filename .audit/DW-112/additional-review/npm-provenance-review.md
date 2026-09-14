# Supplemental npm provenance review

Independent reviewer: `gpt-6-astra`, reasoning `xhigh`, native collaboration task `/root/npm_provenance_review`.

Item 10 is resolved by supplied evidence; no remaining installation-provenance blocker. Retain it as an informational correction to the earlier verification record. Reinstallation is not warranted solely because worker-local npm stdout is unavailable.

The receipt's eight events exactly match frozen `journal.jsonl` lines 273 through 280. Consecutive lines 273 through 275 bind this worktree's opening to the successful blocking `npm-bootstrap` hook (`pre_worktree_setup`, `rc: 0`), then its native development session.

The tracked hook uses `set -eu`, unconditionally executes `npm ci --include=dev --no-audit --no-fund` at line 57, and declares `blocking = true` and `fail_closed = true`. Its bytes and both dependency files match the receipt at baseline `d73df4bb9277886ca97e7b8e59caea618baf051d`, reviewed commit `0b34a249bac1a7c7e618308ee0416c4826214ccd`, current HEAD `612a948c803525f025f44eb05bad205d5d83c8aa`, and the current working tree, with clean status for those three paths. Ancestry checks passed, and no commits changed those paths across either interval.

| Artifact | SHA-256 |
| --- | --- |
| npm-bootstrap-provenance.json | 17c652f7bf2befa067b49b114956bf6defde25a13744fb460b437e6ec0dcf2cb |
| Frozen journal.jsonl | 09df7cbeb0c4e8e9b78e04a47088437037493f82b860a141faea2749822e90ec |
| plugin.toml | 20fb58d4717b0377b3cc47ee3fc7f5074b48e3f6943472dd39c7d521972c687a |
| package.json | 4ecfc408dfb48e141b7d25c43201135a8707c671ee1491c780d00ec4b58a15e6 |
| package-lock.json | 787b73fb54942d099fa96a6b93770c2a630a163b7f6dcee5b480bed911e91dc4 |
| Reviewed blind.md | f2f480bb3bdcde4b432aa792b0f263b8cbe60de10fc707dfd3c0cdf16a954fd4 |

Limitation: this establishes historical installation through native hook provenance, not recovered raw npm stdout or a new installation-integrity test. It does not establish overall native run acceptance. The reviewer changed no files and performed no installation, tests, builds, or shipping actions.

This is a faithful parent-recorded account of the returned supplemental review. The original supervisor receipt is retained byte-for-byte in `npm-bootstrap-provenance.json`; the parent's independently executed hash and sequence checks are in `npm-provenance-binding.json`.
