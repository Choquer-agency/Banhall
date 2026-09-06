# Q6 root review disposition

All three fresh Astra 6 medium reviewers completed before findings were read. Findings are numbered in returned order. Review fixes are verified in post-review-evidence.md and root-acceptance.json; final combined gate remains a shipping prerequisite.

| Lens / finding | Severity | Category | Decision and evidence |
| --- | --- | --- | --- |
| Blind 1: nonempty base | low | reject | Uses existing resolve convention and empty-base test boundary. No deployment-base change; nonempty-base integration is outside this navigation repair. |
| Blind 2: authenticated destination | low | reject | Existing Settings routes and permissions unchanged. Menu role coverage proves requests only, not authenticated route access. |
| Blind 3: avatar sign-out | medium | patch | Actual menu activation now verifies auth, outbox-clear and login navigation boundaries. |
| Blind 4: pending sign-out | medium | patch | Deferred auth and repeated activation prove one auth call and disabled pending item. |
| Blind 5: keyboard paths | low | patch | Existing cases now use Enter/Space/ArrowDown and traverse actual items. |
| Blind 6: Escape/focus | low | patch | Escape restores trigger focus without effects before reopening and selecting. |
| Blind 7: theme expansion | low | reject | Existing semantic menu styles reused; theme matrix redesign is outside scope. Light theme is the verified capture condition. |
| Blind 8: capture assertion | low | patch | Explicitly classify screenshots as manually reviewed artifacts, not automated golden comparisons. Root viewed retained images. |
| Blind 9: identity mismatch | low | patch | New Account Writer after capture matches identity/theme/dimensions. Scale differs from original failure capture, explicitly disclosed; no pixel-equivalence claim. |
| Blind 10: spec status | low | patch | Root corrected in-review status and now completes tasks/review links on acceptance. Dispatch helper fixes future review bookkeeping. |
| Blind 11: final evidence | medium | patch | Three reviews completed; final combined gate is required after Q8 before push/merge. Focused acceptance does not imply that gate already passed. |
| Edge 1: rejected navigation | medium | patch | Inline catch shows existing error toast. Actual menu rejection fails without catch and passes with it; successful retry remains covered. Baseline proves missing feedback, not a separately observed global rejection event. |

Verification-gap reviewer returned no gaps. No intent_gap, bad_spec or deferred new scope. Post-review patch is narrow and reverified; BMAD does not require another three-review loop for patch disposition.
