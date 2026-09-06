# B1 implementation evidence

Baseline commit: `cc6b706c3b43f971d944cb703a4174eabf3134d9`. Implementation is uncommitted and ready for parent review.

The full spec and its sole frontmatter context file, `AGENTS.md`, were read before edits, along with factory rules and the audited parser patches. The explicit implementation-worker scope takes precedence over generic factory isolation/shipping and BMAD parent dispatch/review steps. No native state or deferred ledger was modified.

## Actual commands and outcomes

All commands ran in the designated Banhall-branch-consolidation checkout using its existing dependencies. No dependency changes or installation were performed.

| Command | Source identity | Exit | Observation |
| --- | --- | --- | --- |
| `npx vitest run src/lib/parseDocument.test.ts` | `baseline.sha256` | 1 | 4 failed, 15 passed. Pending timer counts were 7, 1, 2, 5 rather than 0. |
| `npx vitest run src/lib/parseDocument.test.ts` | `final.sha256` | 0 | All 19 tests passed. |
| `npx vitest run src/lib/parseDocument.test.ts --testNamePattern '^PDF parse deadline keeps one cumulative 60s budget across the load and every page$' --expect.requireAssertions` | `eager-control.sha256` | 1 | Page 2 had already been called at 20 seconds, failing the intended phase assertion. |
| Same filtered command after restoring lazy fixture | `final.sha256` | 0 | 1 passed, 18 deliberately filtered out. |
| `git diff --check` | final diff | 0 | No whitespace defects. |
| `shasum -a 256 -c .audit/branch-consolidation/B1/final.sha256` | final source and tests | 0 | Both files OK after restoring the control. |
| `git diff --name-only` | final working tree | 0 | Only `src/lib/parseDocument.ts` and `src/lib/parseDocument.test.ts`. |

Raw output is in `baseline.log`, `final.log`, `eager-control.log`, `sequential-final.log`, and `diff-check.log`; corresponding `.exit` files retain exit statuses. `scope.log` retains the final tracked-file list. `baseline-test.patch`, `eager-control.patch`, and `final.patch` permit reconstruction of the tested variants from the baseline. SHA256 manifests identify exact source bytes. The baseline parser hash was checked against `git show cc6b706c3b43f971d944cb703a4174eabf3134d9:src/lib/parseDocument.ts`.

## Acceptance mapping

- Fulfillment: successful three-page parse asserts exact text, one destroy call, and zero timers. Baseline failed with 7 timers; final passes.
- Rejection: document load, getPage, and later getTextContent cases assert the identical original error, one destroy call, and zero timers. Baseline failed with 1, 2, and 5 timers; final passes.
- Expiration: never-loading document returns existing empty-text behavior with no marker and zero timers. Sequential page timeout returns exact partial text plus page-2 marker, exercising the existing ParseTimeout handling. Both execute in the passing full suite.
- Sequential budget: lazy text callback starts at 20 seconds; page 2 begins at 40 seconds; parse remains pending at 59,999 ms and returns at 60,000 ms. The eager control fails specifically at the 20-second page-2 assertion. Control bytes were restored and hashes verified.
- Scope: production change is the exact f82f2b0a9c44b9f5475d6d5c31418ab368bd3c4c timer patch. Parser tests integrate both audited commits, including d381a689e74f0d30cd712134735eb58207835f00 sequential proof. One redundant `as Promise<never>` cast was omitted. Existing main tests remain; no editor hunk was imported.

## Remaining work and limits

Parent-owned independent BMAD review, `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh`, commits, and merge admission remain pending. No final acceptance or merge is claimed. These tests run the real parser with only the pdfjs boundary mocked; they do not prove a real PDF in Chromium. Audit artifacts live under the repository's ignored `.audit` directory and remain available for parent inspection.

## Parent evidence completion

Root independently checked the complete porcelain status, including nonignored untracked files: the two parser files and the new B1 specification are the only entries. See `root-scope.txt`. Ignored B1 audit evidence is explicitly retained, reviewed and will be committed in compressed form with hash mappings at batch closeout. The separate parent and auditor files are audit-only and are covered by the consolidation manifest.

Root owns this new checkout and installed601 locked packages with npm ci before implementation. See `root-installation-provenance.json` and the actual nine-step passing baseline receipt in `../local-baseline/result.json`. This resolves the implementation worker's dependency-provenance limitation.

## Final parent acceptance

B1 passed all nine canonical steps, 1,976 unit tests and 463 browser tests. See gate/result.json and gate/capture-resolution.json for the extra historical desktop screenshot that was preserved and restored. Root verified the final two source hashes against review-patch-result.json, reviewed all three layer outputs, applied two proof patches and triaged each finding. The pre-existing expired-entry hole is registered as DW-100 for B12. The raw production eager mutant failed the intended phase assertion; the restored parser suite passed all 19 cases. Raw logs and patches are retained losslessly through archive-manifest.json mappings when compressed for durable admission.
