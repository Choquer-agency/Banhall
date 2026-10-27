# Release eval - Tessrow adaptive deburring cell

Semantic case: **Corrected then withdrawn Feedback** (CAP-13: "corrected-then-withdrawn Feedback"). Also checks: a Feedback instruction on Subsection 1 is respected in Subsection 9 (CAP-4).

Run 2026-10-27 on `local` at commit `08a53a18`, acting as chat-live-1793085355051@example.test. Project `k97ejzefxr9mn1apfdzktjk8s58h2nvp`, generation `k57apb3yjyh34rb45e09xywh8n8h3t08`.

## What this fixture tests

On Company / Context the writer gives two Feedback instructions. The first (call the tool the compliant spindle, never the floating head) stays active, and its Revised Seed replaces the original. The second (call the pilot cell the Kestrel line) is a correction the writer withdraws before approving. The withdrawn instruction must never be sent again or reach the plan or the report; the active one must reach Subsection 9's Decision Set and be respected there (the CAP-4 harness case).

## Judgment (reviewing manager)

Read the plan and the drafted Sections below, then answer each question and give one verdict. Every fixture must be judged pass before release.

1. Nothing in the Seeds after the withdrawal, the plan or the report calls the pilot cell the Kestrel line.
   - Answer: 
2. Subsection 9's Seeds and Section 244 call the tool the compliant spindle, as the active Feedback asked.
   - Answer: 
3. The experiments in Section 244 match the sources (burr heights, forces, cycle times, reject rates) despite the renamed tool.
   - Answer: 
4. Does every drafted Section read as a finished PD in plain language, with no Subsection titles used as headings?
   - Answer: 

- Verdict (pass or fail): 
- Judged by: 
- Date: 
- Notes: 

## Automatic checks

6 passed, 7 failed. A heuristic check is a hint for the judge, not a verdict.

| Check | Result | Evidence |
| --- | --- | --- |
| The scripted session finished without an error | fail | hypothesis: three retries failed |
| Sign-off led to a created report through the existing creation path | fail | generation awaiting_input; report missing |
| All three Sections were drafted | fail | no report |
| The Compliance Note lists every Seed Selection as covered or not | fail | no signed-off Summary |
| Every plan item is recorded as covered (conflicts aside) | fail | all coverage rows applied |
| The model Self-check ran on every Section | pass | no Self-check failure recorded |
| Every Locked Rule held (CRA line and word limits) | pass | no Locked Rule breach recorded |
| The Compliance Note lists every Skip as honoured or not | pass | no Skips |
| Failed Seed Batches and why (informational) | info | prior_year_status prefetch: GENERATION_TERMINATED; hypothesis prefetch: INVALID_OUTPUT, answer 1: 1 of 3 valid, needed 3 (BULLET_TOO_LONG x2, INVALID_BATCH_SIZE x0, INSUFFICIENT_TAG_DIVERSITY x0), answer 2: 2 of 3 valid, needed 3 (BULLET_TOO_LONG x1, INVALID_BATCH_SIZE x0); hypothesis retry: INVALID_OUTPUT, answer 1: 1 of 3 valid, needed 3 (BULLET_TOO_LONG x2, INVALID_BATCH_SIZE x0, INSUFFICIENT_TAG_DIVERSITY x0), answer 2: 2 of 3 valid, needed 3 (BULLET_TOO_LONG x1, INVALID_BATCH_SIZE x0); hypothesis retry: INVALID_OUTPUT, answer 1: 1 of 3 valid, needed 3 (BULLET_TOO_LONG x2, INVALID_BATCH_SIZE x0, INSUFFICIENT_TAG_DIVERSITY x0), answer 2: 2 of 3 valid, needed 3 (BULLET_TOO_LONG x1, INVALID_BATCH_SIZE x0); hypothesis retry: INVALID_OUTPUT, answer 1: 0 of 1 valid, needed 3 (BULLET_TOO_LONG x1, INVALID_BATCH_SIZE x0, INSUFFICIENT_TAG_DIVERSITY x0), answer 2: 1 of 3 valid, needed 3 (BULLET_TOO_LONG x2, INVALID_BATCH_SIZE x0, INSUFFICIENT_TAG_DIVERSITY x0) |
| Line 246 LEAVE OUT and Rule B rows, their repairs, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | no LEAVE OUT or Rule B row in Line 246 |
| Line 244 Rule C row (its work answers a Line 242 uncertainty or a signed-off item), its repair, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | no Rule C row in Line 244 |
| Report text that names a source, per Line, and the Self-check's row (informational; the Self-check's own detector) | info | no report |
| Results stated against their targets, Lines 244 and 246 (informational; self-reported by the checking model) | info | 244: no row; 246: no row |
| Figures and details stated as the sources give them, per Line (informational; self-reported by the checking model) | info | 242: no row; 244: no row; 246: no row |
| Self-check requests per Line and their times (informational; the last is the check of the final text when a repair was used) | info | 242: none; 244: none; 246: none |
| Seed-stage requests (informational; notice at 40, never refused) | info | 20 metered calls (18 Batch, 2 Feedback), 21 reserved; notice not shown; 3 Retry |
| The correcting Feedback was withdrawn and the other stayed active | pass | withdrawn request: withdrawn; kept request: active |
| No Batch dispatched after the withdrawal carried the withdrawn instruction | pass | 10 later Batch(es); 0 carried it |
| "Kestrel" is absent from later Seeds, the plan and the drafted Sections | pass | 0 later Seed(s), 0 plan item(s); report: absent |
| The active Feedback on Subsection 1 is in Subsection 9's Decision Set | fail | 0 context row(s) across 0 Subsection 9 Batch(es) |
| Heuristic: Subsection 9 Seeds say "compliant spindle", not "floating head" | fail | 0 of 0 Seed(s) use the requested term; 0 use the replaced one |

## Signed-off plan

### 1. Company / Context (Section 242, standard): approved

- (no selection in the signed-off plan)

### 2. Goal / Problem (Section 242, standard): approved

- (no selection in the signed-off plan)

### 3. Technological limitations (Section 242, standard): approved

- (no selection in the signed-off plan)

### 4. Technological objectives (Section 242, standard): approved

- (no selection in the signed-off plan)

### 5. Technological uncertainties (Section 242, standard): approved

- (no selection in the signed-off plan)

### 6. Previous-year status (Section 244, optional): skipped

- (no selection in the signed-off plan)

### 7. Work plan (Section 244, optional): approved

- (no selection in the signed-off plan)

### 8. Hypothesis (Section 244, standard): failed

- (no selection in the signed-off plan)

### 9. Experimentation / Iterations (Section 244, multiple): untouched

- (no selection in the signed-off plan)

### 10. Advancement to science / technology (Section 246, standard): untouched

- (no selection in the signed-off plan)

### 11. Specific technological advancements (Section 246, multiple): untouched

- (no selection in the signed-off plan)

### 12. Project status and next steps (Section 246, standard): untouched

- (no selection in the signed-off plan)

### 13. Overall company / project goal improvements (Section 246, standard): untouched

- (no selection in the signed-off plan)

## Drafted Sections

No report was created.

## Compliance Note

| Section | Instruction | Outcome | Tier | Merged items | Reason |
| --- | --- | --- | --- | --- | --- |

## Not checked by the Self-check

Labels (Storyline, Confidence Map, Glossary, instructions) and plan checks (items and Skips) the Self-check gave no verdict for, even after its one follow-up.

- No Compliance Note rows.

## Seed-stage numbers

- Requests: 20 metered (18 Batch, 2 Feedback); 21 reserved; notice at 40 not shown.
- Dispatch to validated result: median 6.2 s, p95 12.6 s over 13 Batch(es).
- Foreground dispatch to first render (script-observed): median 16.9 s, p95 16.9 s over 1.
- Sign-off to report created: n/a.
- Cost from aiUsage: $0.50 in all ($0.37 seed stage, $0.13 Brief, drafting and checks) over 25 calls on claude-haiku-5-5, claude-sonnet-5-5.

## Run log

```
2026-10-27T16:56:31.465Z created project k97ejzefxr9mn1apfdzktjk8s58h2nvp
2026-10-27T16:56:32.326Z marked as an evaluation project
2026-10-27T16:56:33.294Z added document deburring-test-memo.md
2026-10-27T16:56:35.078Z started Step by step generation k57apb3yjyh34rb45e09xywh8n8h3t08
2026-10-27T16:56:50.244Z seed stage open
2026-10-27T16:56:50.245Z Open Company / Context and wait for its Batch
2026-10-27T16:56:58.413Z Company / Context: select the first Seed
2026-10-27T16:57:01.099Z Company / Context: give Feedback on the selected Seed: "Call the deburring tool the compliant spindle, never the floating head, here and in every later step."
2026-10-27T16:57:09.437Z kept Feedback returned 1 Revised Seed(s)
2026-10-27T16:57:09.437Z Company / Context: select the first Revised Seed and untick the original
2026-10-27T16:57:13.979Z Company / Context: give Feedback on the next unselected Seed: "Call the pilot cell in Bay 4 the Kestrel line."
2026-10-27T16:57:22.397Z withdrawn Feedback returned 1 Revised Seed(s)
2026-10-27T16:57:22.398Z Company / Context: withdraw the "withdrawn" Feedback
2026-10-27T16:57:24.281Z Approve Company / Context
2026-10-27T16:57:26.996Z approved company_context
2026-10-27T16:57:26.997Z Open Goal / Problem and wait for its Batch
2026-10-27T16:57:32.310Z Goal / Problem: select the first Seed
2026-10-27T16:57:35.030Z Approve Goal / Problem
2026-10-27T16:57:37.668Z approved goal_problem
2026-10-27T16:57:37.668Z Open Technological limitations and wait for its Batch
2026-10-27T16:57:52.598Z Technological limitations: select the first Seed
2026-10-27T16:57:55.360Z Approve Technological limitations
2026-10-27T16:57:58.044Z approved passive_limitations
2026-10-27T16:57:58.045Z Open Technological objectives and wait for its Batch
2026-10-27T16:58:06.256Z Technological objectives: select the first Seed
2026-10-27T16:58:08.906Z Approve Technological objectives
2026-10-27T16:58:11.531Z approved technological_objective
2026-10-27T16:58:11.531Z Open Technological uncertainties and wait for its Batch
2026-10-27T16:58:19.932Z Technological uncertainties: select the first 2 Seeds
2026-10-27T16:58:24.304Z Approve Technological uncertainties
2026-10-27T16:58:27.034Z approved active_uncertainties
2026-10-27T16:58:27.034Z Skip Previous-year status
2026-10-27T16:58:28.987Z Open Work plan and wait for its Batch
2026-10-27T16:58:48.689Z Work plan: select the first Seed
2026-10-27T16:58:51.386Z Approve Work plan
2026-10-27T16:58:53.990Z approved workplan
2026-10-27T16:58:53.990Z Open Hypothesis and wait for its Batch
2026-10-27T16:59:03.562Z hypothesis: attempt failed, Retry 1
2026-10-27T16:59:14.032Z hypothesis: attempt failed, Retry 2
2026-10-27T16:59:27.366Z hypothesis: attempt failed, Retry 3
2026-10-27T16:59:43.611Z stopped: hypothesis: three retries failed
```
