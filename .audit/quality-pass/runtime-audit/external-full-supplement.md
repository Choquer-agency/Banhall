# External isolation supplemental checkpoint

Resolved the three privacy-contract child-byte comparison gaps using the explicitly authorized prior shipping snapshot, recorded at **2026-09-06T03:47:19.909991+00:00**. Its three stored child SHA-256 values and byte sizes exactly match the current files. This is historical pre-quality-pass evidence, not a retroactively invented fresh-baseline manifest.

The quality-pass initial baseline has no embedded capture timestamp; its filesystem mtime is **2026-09-06T03:58:03.436064+00:00**, reported only as mtime. It coalesced the directory and provided no child hashes. The earlier audit limitation remains accurate for that fresh baseline alone; the independently identified older snapshot supplies the missing comparison.

Captured a new complete `--untracked-files=all` manifest across **39 external worktrees**, from **2026-09-06T04:22:31.882158+00:00** through **2026-09-06T04:22:36.377317+00:00**. All HEADs match the quality-pass baseline. It records **22 dirty files**, with hashes, sizes, kinds and statuses; this is a sequential observation interval, not an atomic filesystem snapshot. The prior shipping snapshot had21 files and excluded its then-owned consolidation tree; the current external inventory additionally includes that tree. No other external paths were explored beyond the requested manifest and authorized historical snapshot.

All three privacy comparisons pass. See external-full-supplement.json for exact paths, hashes and provenance. No external bytes, records, indexes, refs, source, tests or installations changed; Git reads disabled optional locks. Owned quality-pass remains excluded.
