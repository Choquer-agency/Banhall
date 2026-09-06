---
title: 'Keep canonical browser captures out of historical evidence'
type: 'bugfix'
created: '2026-09-06'
status: done
review_loop_iteration: 0
baseline_commit: 31ca9c3ba0b22e24da853ae763592d87bd71cc85
context: ['{project-root}/AGENTS.md', '/Users/johnnynguyen/.agents/skills/typescript-best-practices/SKILL.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Passing canonical browser verification rewrites tracked historical screenshots, requiring manual restoration and making a successful check dirty the checkout. The quality-pass baseline passed but changed eight historical PNGs.

**Approach:** Redirect the two existing historical screenshot writers to the already ignored `.vitest-attachments` convention, preserving every capture and assertion. Update the directly relevant AGENTS instruction so contributors can find fresh outputs without restoring history.

## Boundaries & Constraints

**Always:** Work only in the owned quality-pass checkout. Preserve all 14 filenames across 13 screenshot call sites, including the two parameterized Retry outputs, screenshot options, test cases and assertions. Preserve historical artifact bytes, unrelated working changes, dependencies and all product semantics. Reuse existing screenshot APIs and ignored paths. Parent owns final review, acceptance and shipping.

**Ask First:** Escalate a demonstrated requirement outside these three files or a failing gate that requires product/configuration changes; do not expand this repair silently. Routine path choices and the authorized hygiene verification need no additional approval.

**Never:** Add a helper, gate wrapper, screenshot-restoration stage, new test scaffold, CI upload change, ignore rule, timeout, retry or skipped capture. Do not edit historical evidence, native/factory state or ledgers, other checkouts, package files or canonical browser configuration. No staging, commits, push or merge by the implementer.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Chat capture | Existing optimistic/retry/fix cases | Eight fresh named PNGs under ignored root `.vitest-attachments`, preserving subdirectories | Existing screenshot errors still fail the test |
| Learning capture | Existing desktop/mobile/current/long-title cases | Six fresh named PNGs under the same ignored root | Preserve existing viewport/style/fullPage choices |
| Repeated verification | Outputs already exist | Refresh ignored outputs; tracked historical hashes stay identical | Never restore tracked bytes to conceal writes |
| Dirty candidate | Authorized edits or unrelated pre-existing changes | Before/after candidate hashes and status remain unchanged by gate | Report unexpected changes without reverting them |

</frozen-after-approval>

## Code Map

- `src/lib/components/chat/OptimisticSend.component.test.ts`: seven historical screenshot sites; retry template expands to two filenames.
- `src/routes/admin/learning/LearningHealth.component.test.ts`: six historical screenshot sites.
- `AGENTS.md`: replace the historical-restoration guidance and retain the new artifact instruction outside the generated context block so refreshes preserve it; keep native ledger finalization and all other instructions.
- Read-only reuse: `src/lib/components/chat/ChatFeedback.component.test.ts:51` already uses `../../../../.vitest-attachments/chat-feedback-sources.png`; `.gitignore` ignores `.vitest-attachments/` and `**/__screenshots__/`. RegenerateTurn captures already use ignored outputs.
- Read-only evidence: `.audit/quality-pass/baseline/result.json` records exit 0, 6,317 tracked paths and eight generated captures restored. This is baseline write evidence, not a clean direct-run proof. `.audit/quality-pass/verification-audit.md` inventories the full writer scope.
- Installed Vitest resolves custom screenshot paths relative to the test file before global screenshotDirectory. Changing configuration alone cannot redirect these writers.

## Tasks & Acceptance

**Execution:**
- [x] In the two writer files, replace only the historical `.audit` destination prefix with `.vitest-attachments`; retain the four-level relative prefix and story/fix subdirectories.
- [x] Update the one AGENTS bullet with ignored fresh output locations and the expectation that verification preserves tracked source/history.
- [x] Capture source fingerprints, status and all tracked hashes; run the direct canonical gate and retain the unchanged-byte comparison plus fresh-output inventory under `.audit/quality-pass/Q2/`.

**Acceptance Criteria:**
- Given existing tests and captures, when destinations change, then the implementation diff is confined to the three allowed files with assertions, selection, screenshot options and product behavior unchanged.
- Given captured candidate bytes/status, when the direct nine-step gate runs, then it passes and every tracked path and status remains unchanged without restoration.
- Given the 14 intended destinations, when the suite finishes, then all exist as fresh nonempty ignored PNGs and historical hashes are unchanged; eight baseline differing PNGs are not the total writer count.
- Given completed evidence, when root reviews, then test success, source preservation and capture production are independently supported.

## Spec Change Log

## Verification

- Read baseline result and bound log before editing; record its actual eight restored paths as the before condition.
- Before the gate, record `git status --porcelain=v1 -z`, a NUL-delimited `git ls-files -z` inventory and per-path hashes/types, including existing dirty bytes. Preserve symlink/missing-file distinctions. These are candidate working bytes, not simply HEAD. Hash capture destinations beforehand if they already exist and record run timing.
- Run `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh` directly with the owned installed dependencies. Retain actual exit and full log; do not invoke an older copy/restore wrapper. No extra install is authorized by this task.
- Compare all tracked hashes/types and status immediately afterward. Verify 14 fresh files by existence, size, modification time and hashes; use `git check-ignore` on their actual paths. Unchanged capture content can retain its hash, so use run timing as well.
- Run `git diff --check`; inspect the narrow source diff and original assertions. Do not add a test that mirrors path constants. Report any unexpected mutation without cleanup that could erase evidence or unrelated work.

## Suggested Review Order

- Keep fresh captures out of historical evidence.
  [OptimisticSend.component.test.ts:61](../../src/lib/components/chat/OptimisticSend.component.test.ts#L61)

- Apply the same destination convention to learning views.
  [LearningHealth.component.test.ts:102](../../src/routes/admin/learning/LearningHealth.component.test.ts#L102)

- Preserve contributor guidance across context refreshes.
  [AGENTS.md:45](../../AGENTS.md#L45)
