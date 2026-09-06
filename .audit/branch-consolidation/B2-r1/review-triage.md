# B2 revision1 review disposition

All three fresh Astra6 medium layers completed before triage. Verification-gap returned no gaps; the actual-caller performance guard required by iteration1 is now present and independently mutated in both callers. Edge's two findings duplicate blind1/2 in claim and required action.

| Blind finding | Severity | BMAD category | Independent rationale/action |
| --- | --- | --- | --- |
| 1 Unicode expansion | high | defer | Actual installed-schema probe proves old and new helpers return wrong/lost ranges. Native DW-101 registered after loopback; separate B13 is scheduled before merge. |
| 2 hardBreak/other inline leaves | medium | defer | Actual supported hardBreak false concatenation proven; native DW-102 schedules B13. The broader custom-atom portion is rejected because neither installed schema has such a node. |
| 3 edit then search/cache | low | reject | Document-identity cache and replacement implementation are unchanged; extracted helper remains pure and receives the current document. No concrete introduced defect. |
| 4 replace active preview | low | reject | Existing reactive previewDiffs/effect logic is unchanged; the batching adapter consumes the new input each build. No demonstrated gap specific to this refactor. |
| 5 empty preview caller | low | reject | Existing preview filters blanks and bypasses lookup when empty; decoration builder bypasses batching for an empty list. Helper zero-walk coverage and current clearing pins support the unchanged behavior. |
| 6 casing comment | low | patch | Removed inaccurate claim that the thermal-stability preview fixture differs in casing. Actual find/case behavior remains separately tested. |
| 7 per-widget placement | low | reject | Widget construction and m.to placement are unchanged; golden ranges, distinct actual replacement texts and caller pair ordering cover the changed adapter. |
| 8 marked/list fixtures | low | reject | Traversal/position mapping is transferred unchanged. Actual heading/paragraph Editor fixture plus golden ranges covers this refactor; B13 separately exercises supported-schema boundary changes. |
| 9 zero empty haystack folds | low | patch | Added explicit zero-fold assertions alongside zero-walk assertions for both empty/allblank batches. |
| 10 length-based fold counter | low | patch | Added a fixture precondition that every normalized measured needle is shorter than the haystack, making the instrumentation's existing valid assumption executable. It is not advertised as a general profiler. |
| 11 duplicate needle memoization | low | reject | One index/fold per batch is the authorized performance contract. Further result caching is an independent optimization without a demonstrated requirement or defect. |
| 12 dense-match memory benchmark | low | reject | Additional allocation is visible in the batch design; no harmful memory behavior was demonstrated. Current measured fixtures and one-walk bounds validate the specified change. |
| 13 benchmark semantic signature | low | reject | Benchmark evidence expressly claims position equality; actual browser and golden unit assertions separately establish semantics. No broader equivalence is claimed from its hash alone. |
| 14 extracted import wiring | low | reject | Actual component execution and Svelte type checking exercise real imports. The synthetic benchmark is not the only acceptance test and its limitation is explicit. |
| 15 parser appendix separation | low | reject | The preserved benchmark appendix remains valid and is labeled synthetic. Future relocation should update its harness; unrelated tool restructuring is not needed for this integration. |

Root re-ran all12 helper tests after patches, then staged intended new files for canonical discovery/full gate. No intent or further bad-spec issue remains. DW-101/102 are visible pre-existing follow-ups, not claims that those semantics were fixed by this performance refactor.
