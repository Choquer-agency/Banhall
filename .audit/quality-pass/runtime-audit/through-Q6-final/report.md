# Q6 final archive and private gate review

Exact commit `73b0b0fe75d16e248ea794b73289574c1530aedb`: all **56 archive records** pass stored/original SHA-256 and decoded byte lengths. Root acceptance source hashes match committed bytes. All13 previously qualified directory-symlink targets/hashes also match Q6 committed Git blobs. This supplements immutable link preservation; it does not manufacture a missing worker before/after observation.

The earlier audit saw index drift during concurrent parent staging. That later comparison does not contradict root-acceptance.json's earlier pre-staging unchanged-index observation. No unexpected source/index mutation is established by that timing difference.

Private run_gate.py review: snapshots tracked plus nonignored untracked paths before AND after, compares the union (therefore catches new/deleted paths), records symlink targets before following files, hashes regular-file bytes/sizes, preserves missing-path states, compares NUL-delimited staged entries, and exits nonzero for gate failure, content/path difference or index difference. Both source manifests and index hashes are persisted. All restoration/copy-back code has been removed; generated_captures_restored is always an empty receipt field. The actual strengthened final run is still pending; static source review is not its execution proof.

Limits: ignored fresh outputs are deliberately outside the path comparison; file permission-only changes, transient writes restored by some external actor between snapshots, and HEAD/ref changes are not fully captured by this content/index guard (HEAD is recorded only afterward). Filenames are decoded as UTF-8; arbitrary non-UTF8 Git paths would fail rather than silently pass. This is the existing private operational checker, not a new CI command or full filesystem integrity guarantee. No broader wrapper expansion is recommended for the stated content/index preservation scope.

No archive/source/link mismatch found. Q7 source was not reviewed or claimed accepted. No tests/builds, source changes, installs, ledger edits or other-worktree mutations occurred. Earlier audit records remain intact.
