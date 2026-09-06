# Final ancestry reconciliation plan

Captured baseline `cc6b706c3b43f971d944cb703a4174eabf3134d9`; current `codex/branch-consolidation` at `b2d5db5b63c0a70bce20d86df56e11ffbe89fad9`.

All 81 captured refs reduce to 68 distinct tips. 58 refs are already ancestors of current integration. The remaining 23 refs (22 distinct tips) require **20 additional maximal historical parents**. Two dominated tips need no separate parent: captured remote sprint2-boundary is covered by local sprint2-boundary, and provisional QA ledger is covered by rearmed QA spec.

Captured ref drift: 0. No fetch or mutation was performed.

B1 and B12 are accepted and committed. B2 is in implementation/parent review; B3–B11 remain pending. Finish and review all useful source changes before historical ancestry recording. B8 includes the Button44px, navigation-order and per-destination icon assertions; B9 includes the explicit QA browser smoke setting; B11 retains the requested/confirmed/failed-attempt erasure distinction. Detailed source commits, files and evidence are in the JSON.

A tree-preserving ancestry merge does not implement content. After the source units and exact combined gate pass, record historical ancestry while retaining the accepted integration tree, verify all81 captured SHAs, and use a normal PR merge commit with required CI. Squashing or rebasing would lose the historical ancestry parents. Preserve every branch/worktree and uncommitted cownose work; no deletion, reset or force-push.

| Parent | Captured tip ref | SHA | Content prerequisites | Newly covered refs |
| --- | --- | --- | --- | ---: |
| A01 | `refs/heads/archive/bmad-loop-sprint1b` | `842cdf5160cd405de19b8643ad9295bcd4049e95` | B11 | 1 |
| A02 | `refs/heads/codex/bmad-dw96-fix` | `091ec5a22f57ae3f566d6b70c56c3a61069763fc` | Recorded equivalent/superseded content; global prerequisites | 1 |
| A03 | `refs/heads/codex/bmad-dw97-fix` | `5df0d2c4ae9677a891cd8ca19f2669da40fc4311` | Recorded equivalent/superseded content; global prerequisites | 1 |
| A04 | `refs/heads/codex/bmad-dw98-fix` | `4e0bdf5d45d7f5d555227783c69d01e29bfbec43` | Recorded equivalent/superseded content; global prerequisites | 1 |
| A05 | `refs/heads/codex/bmad-dw99-fix` | `9aa4c32d5407dd02e15bf0532587a099343bf70d` | Recorded equivalent/superseded content; global prerequisites | 1 |
| A06 | `refs/heads/codex/bmad-feedback-read-fix` | `f42c7f3322cf2d48a0bcd45597ddde14f084e888` | Recorded equivalent/superseded content; global prerequisites | 1 |
| A07 | `refs/heads/codex/bmad-linux-pointer-diagnostic`, `refs/remotes/origin/codex/bmad-linux-pointer-diagnostic` | `84dab21fc3f2e635f0ead01a7c671dfc279fa644` | Recorded equivalent/superseded content; global prerequisites | 2 |
| A08 | `refs/heads/codex/bmad-published-status-fix` | `4555939ad846c638e291b06fd74e9ff3b637f881` | Recorded equivalent/superseded content; global prerequisites | 1 |
| A09 | `refs/heads/codex/bmad-verification-fix` | `4c26f2fb345247139963457ef7d770677b82fb45` | Recorded equivalent/superseded content; global prerequisites | 1 |
| A10 | `refs/heads/codex/preserve-learning4-approved-resolution-20260904` | `784102690e5921cdf84bd2eb948711e2991cb53d` | Recorded equivalent/superseded content; global prerequisites | 1 |
| A11 | `refs/heads/codex/preserve-learning5-codegen-recovery-20260904` | `44b702478781d278d8f7626285d55ec9dbb4a5cf` | Recorded equivalent/superseded content; global prerequisites | 1 |
| A12 | `refs/heads/codex/preserve-learning8-approved-resolution-20260905` | `53a2dbd3176bb1d976fcc41de9c960ece49021f5` | Recorded equivalent/superseded content; global prerequisites | 1 |
| A13 | `refs/heads/codex/preserve-ped-malformed-review-20260904` | `ff001c3371b9519af01cd25529d991f8762f3e01` | Recorded equivalent/superseded content; global prerequisites | 1 |
| A14 | `refs/heads/codex/preserve-ped-native-final-review-20260904` | `2d393923482b2bfda4ab4b78219c535249bd4f98` | Recorded equivalent/superseded content; global prerequisites | 1 |
| A15 | `refs/heads/codex/preserve-qa-native-final-review-20260904` | `81612bf7af8938cbe98f63bc3f452dc6bf3e5002` | Recorded equivalent/superseded content; global prerequisites | 1 |
| A16 | `refs/heads/codex/preserve-qa-rearmed-spec-20260904` | `172a05eca5e177bf409bc3f2abec43118b899eee` | Recorded equivalent/superseded content; global prerequisites | 2 |
| A17 | `refs/heads/codex/preserve-research-phone-review-20260904` | `625352b58c6d9e9dca61371329e2cdf28b112103` | Recorded equivalent/superseded content; global prerequisites | 1 |
| A18 | `refs/heads/codex/preserve-snapshot-ownership-review-20260904` | `ab65d107b2fec003021cd451fc0ebc0e1cc2d9cc` | Recorded equivalent/superseded content; global prerequisites | 1 |
| A19 | `refs/heads/factory/workspace-2-drop-dead-gate-branches` | `c2211d0e198a78b65ffbb18bd441d17bfe79f4fc` | B10 | 1 |
| A20 | `refs/heads/sprint2-boundary` | `5ec93e594eda60c28da2cfdbf27fb668fd55eb3d` | B1, B12, B2, B3, B4, B5, B6, B7, B8, B9 | 2 |

The JSON enumerates every captured ref covered by each planned tip, overlapping coverage, the primary coverage assignment, input hashes, prerequisites, and drift. These are proposed historical parents, not executed merges.
