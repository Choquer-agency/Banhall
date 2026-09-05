# Fresh four-layer review triage

All four layers completed, in capacity-limited waves: blind hunter, edge hunter, verification-gap, acceptance auditor. One initial concurrent edge spawn failed at the shared agent limit; that layer then ran successfully. Acceptance found no AC/intent violations and independently checked all33 evidence inventory hashes. No decision-needed or bad-spec finding remains. BMAD build owns automatic patches; native deferred-work ledger remains untouched.

| ID | Source | Claim | Severity / disposition | Resolution required |
| --- | --- | --- | --- | --- |
| 1 | blind + edge | Chromium regular executable does not identify actual headless-shell availability | medium / patch | Reproduce distinct cache states and check actual supported headless launch in preflight, retaining installer hint and exact gate semantics |
| 2 | blind + edge | Git quoted/newline paths mismatch actual Vitest paths | medium / patch | NUL-delimited Git enumeration; actual Unicode/quoted-path discovered fixture proves before-fail/after-pass, existing orphan negative remains |
| 3 | blind | New mandatory Git prerequisite absent from early diagnostic | low / patch | Add Git preflight and setup guidance with missing-Git runtime control |
| 4 | blind | Non-1 VERIFY_COMPONENT silently disables browser | low / dismiss | Documented contract explicitly selects browser only with1; alternate truthy syntax is not promised |
| 5 | blind | Nonempty node_modules not proof of ownership/freshness | low / patch (documentation) | Explicitly document installing this checkout's lockfile with npm ci after dependency changes; do not expand existing bootstrap into dependency management |
| 6 | blind | Linux browser setup may need system dependencies | low / patch | Document --with-deps option already used by CI |
| 7 | blind | Default browser-free gate not freshly proved with absent cache | low / patch (evidence) | Run actual default gate against empty browser cache; preserve complete exit/count evidence |
| 8 | blind | Existing screenshot tests rewrite historical files without contributor guidance | low / patch (documentation) | Explain checking generated screenshot diffs and restoring only unchanged historical outputs; no screenshot-source changes |
| 9 | blind | Immutable helper misses executable modes and object types | low / patch (evidence) | Check actual object type and executable mode plus existing content comparison |
| 10 | blind | Baseline-only immutable helper misses extra source additions | low / patch (evidence) | Inventory new nonignored files against exact authorized additions, with explicit own-audit accounting |
| 11 | blind | Renamed CI checks need branch-protection mapping | low / dismiss (root-owned already handled) | Parent independently found no protection/rules; handoff names both jobs and requires new GitHub acceptance, with no claim YAML enforces merging |
| 12 | verification-gap | Orphan negative control not part of every routine gate | low / dismiss | This bounded transplant requires actual retained failure control, supplied and reproducible. Adding a recursive meta-gate or new CI architecture is not required to establish current behavior; mutations of the guard require rerunning its documented control |

The source fixes preserve every canonical runner/config/API. Freeze remains unchanged; no new product or user policy decision is needed. Upstream byte identity applies to the starting transplant; final hashes must identify reviewed mechanics after patches.
