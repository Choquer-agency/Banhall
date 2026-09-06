# B10 policy preservation baseline

Baseline established from commit `8511662cb8fd9748d02f413c633bf21b5cdec9ee`, not the concurrently changing working file. No final candidate assessment is claimed. Read the draft, canonical in-progress spec, planning/B10.md and B10-preflight.md; this audit is limited to the domain amendment.

## Exact authorized insertion

Historical `docs/product-domain.md` is byte-identical at `d0669fec95d4145b3be34a6f6b2b5e76db276cc7` and `76f9aca3c973a805a32cc5466cacd11d61ca080e` (SHA256 `87ca12a39dc31c45fbc4c4052628ce4071e17503ab9e2bdeab8f7209e2fe07b9`). Extract exactly source lines 1559–1613: heading “2026-09-03 (second) — The preview workspace is on for every internal role”, through its approval paragraph and separating blank line. Stop before `## Amendment process`. Insert before that heading in the current baseline, line 1721. Do not insert an older whole document or relocate any existing section.

The extracted 55-line section is in `policy-audit-historical-amendment.md`, SHA256 `1b9d8c27bedca13faf1253d6f7265d6392f3ae902482f16757b8e25a9b6ae885`. It records owner approval, authorized exposure rather than authorization, permanent dashboard compatibility, canonical projects/my-work URLs and params, current override precedence and skipped access subscription, query loading/error behavior, no schema/backfill, and retained rollout storage. Historical test-deletion statements describe those historical tickets; they are not permission to remove newer tests. No new policy is needed.

Planning allows obsolete line-anchor updates within the inserted section only. The historical references are `:763-766` (canonical-URLs gate clause) and `:226`, `:247` (schema rollout/removal boundary). Prefer stable section references if correcting them. Any such difference must be isolated in the amendment diff and manually verified as an anchor-only correction; strict comparison intentionally does not silently normalize prose. The existing canonical-URLs section is preserved, with the appended amendment specifying what it supersedes.

## Protected baseline

`policy-audit-baseline.md` is the exact baseline domain file, SHA256 `4f9597ef62e91f1ade0ad9700886cd7eb77412de925b1256276055d32d144fb8`. `policy-audit-manifest.json` records both source identities, insertion coordinates and per-section hashes. Whole-file-minus-insertion identity protects all existing prose, including human-apply/proposal and ownership policy, not only selected headings.

Explicit later protected sections start at baseline lines 1560 (recorded reviewer decision), 1605 (absolute blocking QA), 1615 (privacy at selected knowledge boundaries), and 1677 (digest diversity and provenance). Preserve every byte: reviewer decision/transition prerequisites; non-waivable blocking QA; human publication and privacy attestation; candidate immutability, producer/project attribution, exclusions and diversity; all other earlier human-apply and capability rules; and Amendment process itself. No substitution of the shorter historical file can satisfy this condition.

## Reproducible final comparison

From the consolidation checkout, run:

```sh
python3 .audit/branch-consolidation/B10/policy-audit-compare.py docs/product-domain.md
```

The script only reads files and prints JSON. It hashes the captured candidate, requires exactly one inserted heading and Amendment process heading, compares insertion to the historical receipt, removes precisely that insertion, and compares the remainder byte-for-byte to baseline. It emits both diffs and exits nonzero for any mismatch. Anchor-only differences need parent assessment even when existing policy bytes remain identical. Parent should redirect output to a new owned final receipt after the implementation is frozen; this baseline audit has not run it against unfinished source.

Only `policy-audit*` artifacts were written. No product/spec/test/index/ref changes, tests, gates or other-worktree inspection. Final preservation remains pending root's ready signal.
