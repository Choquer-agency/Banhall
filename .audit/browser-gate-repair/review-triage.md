# BMAD step04 independent review and triage

Candidate a76fa6e4ac9d2249526c1f0fffa417a44d081760, baseline717c75897cc04256c008a2ed42747df66f6fc6b5. Three fresh independent reviewers ran as GPT-6 Astra medium using the fully substituted prompts saved here. Launches were bounded by the available collaboration slots; root collected all three before triage. Edge and verification layers reported no findings. Blind findings were evaluated individually; no intent gap or bad spec was found.

| Finding | Severity | Category | Required patch |
| --- | --- | --- | --- |
|1. Standalone drawer does not prove pointer-specific integrated sizing|medium|patch|Assert actual coarse/fine media then real WorkspaceChrome drawer44/28px geometry; report unsupported API if necessary.|
|2. Rail transition blacklist accepts unrelated properties|low|patch|Use exact sanctioned property allowlist.|
|3. Initial motion preference is environment dependent|medium|patch|Set no-preference before assertions, set reduce, restore in finally.|
|4. Existing group with absent layout not exercised|low|patch|Preserve group while adding only default layout.|
|5. Repeated and encoded query values not exercised|low|patch|Verify getAll values without serialization assumptions.|
|6. Both presentation flags missing from access matrix|medium|patch|Admin bothflags allowed; nonadmin bothflags denied.|
|7. Drawer keyboard expansion not exercised|medium|patch|Expand/collapse with keyboard and assert destinations.|
|8. Active nested confirmation focus not exercised|medium|patch|Assert initial containment and Tab/Shift+Tab cycling.|
|9. Numeric z-index alone does not prove effective stacking|medium|patch|Use real modal control hit-tests and underlying drawer exclusion.|
|10. Affirmative sign-out path not exercised|medium|patch|Use narrow auth mock to prove one call and successful navigation.|

These are bounded verification improvements exposed by the test repair; none is evidence of a production defect. Root sent all patches in one message to the original fresh implementation agent. No new policy, production behavior, or native state changes were authorized by this triage. Final patch verification is recorded in evidence.md.
