# Fresh pointer context candidate

Baseline: `8e022cf6eb8e737a00dff818c337ca01fd354414`, branch `codex/bmad-browser-pointer`.

The prior hosted failure remains preserved in `github-pointer-ci-failure.log` and `baseline.json`. The coordinator owns the second failed hosted revision and Linux probe 33987464839 at diagnostic a4732b26; their exact artifacts have been requested, not fabricated. Local passes do not establish Linux behavior.

- Canonical command: `node node_modules/vitest/vitest.mjs list --config vitest.component.config.ts --filesOnly --json`. Raw output is `context-file-list.raw.log`; parsed JSON is `context-file-list.json`. Actual selections: 62 project-file executions, 61 unique files, 60 ordinary files selected once, new pointer suite once in each declared fine/coarse instance. Only the new pointer suite has multiplicity two.
- Focused command: `node node_modules/vitest/vitest.mjs run --config vitest.component.config.ts src/lib/components/workspace/WorkspaceChrome.component.test.ts src/lib/components/workspace/WorkspaceChromePointer.component.test.ts`. Actual result: 3 files passed, 8 tests passed. Exact output: `context-focused.log`. The ordinary suite retains six tests; each pointer instance executes one case.
- Pointer case checks actual declared and opposite media, at least two rows, exact 28/44 pixel heights, visible open drawer control and disconnected drawer after close. No CDP emulation/restoration remains.
- `git diff --check` passed. Source SHA-256 identities are in `context-source-hashes.json`.

Pending coordinator-owned Linux candidate validation, disk capacity confirmation, final optional unified gate, independent review and private commit. Product files, dependencies, gate script and historical archives have not been edited by this implementation.
