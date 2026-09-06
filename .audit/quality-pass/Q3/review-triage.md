# Q3 independent review disposition

All three fresh Astra6 medium review workers completed successfully. Root inspected production diff and strengthened tests. Edge returned [] and gap returned no findings. Blind findings are individually resolved below; required minimum finding count is not itself proof of a defect.

| Finding | Disposition | Evidence or scope reason |
|---|---|---|
| 1 Realistic running row | patch | Running row without terminal fields plus legacy row in same fixture. |
| 2 Exact timestamp | patch | Frozen copy time, distinct from source times, checked on rows and events. |
| 3 Array-order assumptions | patch | Source IDs and unique preserved creator metadata identify copies. |
| 4 Destination creator | patch | Explicit project IDs; source/destination creators differ and remain unchanged. |
| 5 Source document ID | patch | Each source review identifies exact original document; copied ID and content verified. |
| 6 Real retry source | patch | Selected source explicitly running; copy has duplication-specific failure before retry. |
| 7 Multiple PD documents | patch | Two distinguishable PD bodies and filenames; actual retry remapping checked. |
| 8 Running destination | partial patch / qualify | Second real retry proves existing latest-running guard without side effects. A running row predating a later content copy is not covered; existing guard checks latest row only and UI duplication creates a fresh project. This unit does not broaden retry policy. |
| 9 Independently discriminating access | reject / qualify | Firm-wide internal access does not provide source-only/destination-only roles. Actual roleless denial is verified, not invented permissions. |
| 10 Partial-write rollback | reject / qualify | Actual auth rejection occurs before writes; no artificial failure is added just to test transaction machinery. Copy remains one mutation by inspection; no experimental partial-rollback claim. |
| 11 Transcript sets | patch | Two nonempty ordered rows per project included in unchanged snapshot. |
| 12 Durable evidence | patch | Exact logs, preserved pre-review test bytes, hashes and archive manifest admitted with commit. |

Acceptance: original actual regression4failed/85passed; initial repair89passed and full8-step gate2044unit passed. After test-only review strengthening,89focused tests, Convex types and diff pass; production unchanged after the full gate. No component source changed. Root will run the final combined browser gate after remaining units. No live AI provider or existing-row backfill claim.
