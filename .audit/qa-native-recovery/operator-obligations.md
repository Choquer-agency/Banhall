### DW-<next>: Complete blocking QA policy review and verification
origin: operator recovery of native run 20260904-121607-3217, 2026-09-04
location: _bmad-output/specs/spec-ai-engine-sprint-2-boundary/lanes/qa/stories/8-blocking-qa-policy.md
severity: medium
reason: Story8 remains in-review after its prior native run exhausted harvest attempts while full verification was held. Resume a real BMAD follow-up review using this existing spec as the result spec, preserving its frozen contract, baseline and prior review history. Independently inspect the historical QA implementation from original implementation baseline f122b086d745acc40b4decca26b9aaafc7257f6a as well as subsequent repairs; run the required standard gates on current code and commit genuine fresh verification evidence before native acceptance. Existing ignored .audit evidence must be explicitly staged if used as the review artifact. Do not erase the prior deferred run or infer completion from an old green gate.
status: open

### DW-<next>: Complete persisted post-edit-distance native follow-up
origin: operator recovery of native run 20260904-065146-9a65, 2026-09-04
location: _bmad-output/specs/spec-ai-engine-sprint-2-learn-chat/stories/3-persist-post-edit-distance-at-milestones.md
severity: medium
reason: The implementation and real Convex codegen are preserved, but the prior run deferred story3 because its claimed historical baseline740008e1369faaf6eab001f95efeb10a9e52d1e5 differed from that run's recorded baseline. Adopt the existing story spec for a fresh BMAD follow-up review, retain the historical frozen contract and baseline, independently assess the full implementation and run the ordinary required gates without test-timeout CLI overrides. Commit genuine fresh review/verification evidence before native acceptance. Keep old run history deferred. This finalization obligation is separate from the generated-API omission entry and cannot be closed merely because codegen later succeeded.
status: open
