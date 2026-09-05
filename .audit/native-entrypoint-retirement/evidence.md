# Native entrypoint retirement repair

Baseline 9da55bece5948da12129720dd2330a3032c985bf contained both retired wrappers. `before.json` records their actual existence and no active tracked callers. Historical deletion 7a164054c5e9fe85ee1ab41bf105d9e286bb81fb was present in ancestry; the current combined tree had restored the obsolete parallel launcher. A scan of non-merge deletions from origin/main to the baseline found this was the only revived source file outside audit and BMAD artifacts.

Removed both unused repository lifecycle wrappers. `after.json` records that neither exists, no active tracked callers remain, and native commands plus the bootstrap/verification hook remain available. Four local native CLI help commands succeeded. No native run, policy, state or integration source was modified by these read-only probes.

Reproduce after final integration: `python3 .audit/native-entrypoint-retirement/verify.py`. A newly merged revision must pass again; the helper worktree result alone does not establish that a later merge preserved the deletions.

No product behavior changed and product tests cannot exercise absent scripts. Required product, component and build gates remain due on the final integration revision. Independent review of this repair is the next BMAD workflow step. No push or main promotion has occurred.


Review patches completed. Final evidence is `final-local-source-check.json` and `reviewed-verifier-probes.json` (11 probes) using the final verifier SHA recorded in both. Earlier `reviewed-after.json` was a real failed intermediate check because existing tracked skill aliases were initially refused; it remains preserved. Local aliases to inspected tracked files/directories now pass, while unknown targets and aliases into excluded historical artifacts fail. `history.py` reproduces the immutable history scan as `history-replay.json`. The original script was reintroduced by merge 021f0b4cb9b58e310c9acbbaa60f6fa9227b418e.

All three review layers completed and triage is recorded in `triage.md`. No main/integration merge or push has occurred. The repair awaits the active sweep's end before integration and a new final source check.
