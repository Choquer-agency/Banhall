1. **Medium — `convex/generations.ts:2709`: progressing rows can block stale recovery.**  
   The reaper selects the oldest 100 running generations before checking `lastProgressAt`. If those 100 remain active, a stale generation at position 101 is never examined until an earlier row leaves the selection. Subsequent cron runs revisit the same page. Neither orphan sweep rescues it because its generation remains running. This breaks the stated recovery window under that load.  
   **Suggested fix:** paginate the existing recovery scan with bounded continuation transactions, preserving the single recovery owner. Add a regression with 100 older, progressing generations followed by one stalled generation.

2. **Low — `convex/orderedChainRecovery.test.ts:152`: progress stamps are not independently verified.**  
   Creation and first claim happen at `startedAt`; subsequent completion and claim happen at identical timestamps. Removing any one of the three stamping sites individually would leave these tests passing. The “compare” fixture also creates only one candidate, leaving shared-progress behavior untested.  
   **Suggested fix:** separate creation, claim and completion times and verify each through real mutations. Cover two candidates, plus equality at the cutoff and immediately after it.

Other review conclusions:

- **Authorization:** the guards match `738331e`. All located Brief readers are authenticated public functions or internal functions/helpers. Firm-wide internal visibility matches the domain contract; project membership restrictions are not required.
- **Prompt filtering:** both `renderBriefForGeneration` and `loadBriefCheck` exclude removed entries, including guidance passed to Self-check and final consistency.
- **Recovery:** creation, successful claim and completion stamp progress. Equality with the cutoff remains live, consistent with strict `< cutoff` stale selection. Legacy fallback and iterative handling remain intact. Finalization uses the last completion stamp; it does not stamp independently.
- **OCC/schema:** the field is additive. The claim patch introduces shared-generation contention between candidates, but transactional fencing protects against duplicate claims and lost updates. No correctness hazard identified.
- **Evidence:** raw before logs show meaningful auth, filtering and premature-reaping failures; recovery tests invoke real mutations. After logs report 35 targeted recovery tests and 2,218 full-suite tests passing. I inspected these records without rerunning tests.
- **Merge-up:** retain the later stack’s latest-version Brief response and bounded readers alongside these fixes. Its claim-read budget explanation needs updating for the extra generation patch: its conservative estimate becomes 15 MiB instead of 14 MiB, still below its documented 16 MiB limit. No incompatible contract change identified.

ACCEPT_WITH_FIXES