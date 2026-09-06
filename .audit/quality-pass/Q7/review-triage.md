# Q7 root review disposition

Three fresh Astra6 medium reviewers completed before root read findings. Root then directed the narrow repair; final runtime evidence is post-review-evidence.md and post-review/after.json. Each finding has one severity and category.

| Finding | Severity | Category | Disposition |
| --- | --- | --- | --- |
| Blind1: discarded diagnostic | medium | patch | Root reconsidered initial rejection because the diff removed existing error logging. Final exhaustion logs once using the existing convention; recovered retry stays quiet. No new telemetry API. |
| Blind2: failed response transfer | medium | patch | Real abort-connected stream fails on pre-patch helper; finally abort now stops it before retry. |
| Blind3: backoff/Retry-After | low | reject | Immediate bounded retry is within approved behavior. Throttling policy/delay is a broader behavior decision, not a demonstrated regression here. |
| Blind4: caller cancellation | low | reject | Existing wizard has no cancellation contract. This repair bounds transport; route cancellation would require broader lifecycle changes. |
| Blind5: long retry progress | low | reject | Existing progress remains; near300second per-file transport ceiling is explicitly documented. Progress/cancellation redesign is outside this unit. |
| Blind6: abort-aware body | medium | patch | Real ReadableStream/Response connected to AbortSignal proves interruption of JSON body consumption. |
| Blind7: late success | medium | patch | Four POST/body and second-success/exhaustion cases prove late IDs cannot replace the observed result. |
| Blind8: combined clock | medium | patch | Controlled URL delays plus two120second transfers prove exhaustion at299998ms and timer cleanup. |
| Blind9: fallback document ID | medium | patch | Deferred text save returns distinct document-text-fallback; exact project/document review payload asserted. |
| Blind10: persisted attempt claim | medium | patch | Component boundary claims narrowed. Existing real uploadDocument backend test without storageId proves succeeded receipt/documentID separately; unchanged17test suite passed. No live end-to-end claim. |
| Blind11: review-start rejection | medium | patch | Saved-text warning remains truthful and single; existing error messages render, no failed-attempt call for saved text. Fixture bulk-dismiss failure preserved and resolved with sequential public dismissal, not production changes/error suppression. |
| Blind12: screenshot overwrite | medium | patch | Fresh capture routed to ignored .vitest-attachments; retained final screenshot copied once. All35 earlier Q7 artifacts preserved. |
| Blind13: execution bookkeeping | low | patch | Root now marks tasks and status done and adds verified review links. Final combined gate remains a shipping prerequisite. |
| Edge1: non-2xx streaming | medium | patch | Same claim/action as blind2; shared finally-abort fix and real stream regression. |

Verification-gap reviewer returned no gaps. No intent_gap, bad_spec or deferred new scope. Final53unit/20browser tests, Svelte checks and whitespace check pass. Earlier16-case baseline proved two actual wizard defects; expanded final test coverage is not mislabeled as the original baseline. Full branch acceptance still requires the final combined gate after Q8.

Root viewed raw before, initial after and final warning capture. Before/after viewports differ, so these prove visible warning behavior rather than pixel-equivalent layout. Root verified current four source hashes against post-review/after.json. Controller abort and final-only diagnostic are the only post-review production changes; page production stays unchanged.
