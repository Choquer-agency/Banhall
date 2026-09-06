# Q5 independent review disposition

Three fresh Astra6 medium reviewers completed successfully. Edge returned [] and gap returned no findings. Root reviewed the two-line production change, strengthened existing tests, replayed the actual old source, and verified final captures.

| Blind finding | Disposition | Evidence / scope |
|---|---|---|
| 1 Full gate outstanding | qualify | Focused component7/7 and Svelte checks pass for this isolated key change. The final combined canonical gate remains required before shipping, as assigned to root. |
| 2 Spec tracking | patch | Root marks tasks complete/done after review acceptance and appends review order. |
| 3 Exact unchanged-set reorder | patch | Existing mounted-update test now explicitly checks first/second then second/first with unchanged row objects. |
| 4 Loading/null transitions | patch | Same mounted test cycles populated→undefined/null→populated, checking no stale table/text. |
| 5 generationId switch | reject | Query subscription/arguments are unchanged. This unit changes identity within a returned stateless row list; a broader subscription test does not target this defect. |
| 6 Hidden text | patch | Distinct-collision rows each receive actual browser visibility assertions; retained captures independently show both collision fixtures. |
| 7 Identical distinct objects | patch | Repopulation uses two independently allocated value-identical objects. |
| 8 Matching collision capture | patch | distinct-collision-after.png now matches the baseline distinct-label reproduction; root viewed it. |
| 9 Log hashes | patch | Root replay result binds exact logs; archive manifest binds all baseline/fixed logs and exit receipts as well as images/source. |
| 10 Broader baseline evidence | patch | Root checked3148 existing non-audit paths against Q4 verified bytes plus accepted Q4 test hashes. Only intended Q5 source differs; dependencies/config/query stub match. |
| 11 Exact baseline test bytes | patch | Root reran final test bytes against known old production source, then restored only the saved owned candidate and ran repaired source. Same test SHA,3failed/4passed old,7passed repaired. |

Root replay is a deliberate regression probe, not the canonical no-restoration gate: it temporarily substitutes only the owned Q5 source and restores the exact saved candidate in finally. No other writer was active. root-review-check.py guards exact source/test hashes; logs/checksums and root-broad-baseline-check.json retain the proof. No additional test case was added; seven cases strengthened.

Acceptance: production remains the index key plus explanatory comment; all other expressions unchanged. Repaired7 browser tests, Svelte checks and diff check pass. Final combined full gate remains before shipping.
