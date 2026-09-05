# Verification contract reconciliation

Read-only assessment, 2026-09-05. Integration reviewed at `dd787d4287bcdf970aa3bcb25f0781dc765e030c`; original source at `5ec93e594eda60c28da2cfdbf27fb668fd55eb3d`. No gate, loop, source, index, ledger or original-checkout mutation was performed for this assessment. This report is the only write.

## Decision

The newly replaced user AGENTS instructions explicitly require the unified preflight/discovery/build/uploader gate, optional `VERIFY_COMPONENT=1` browser execution, and two CI jobs. This removes the earlier uncertainty about whether a discovery rule supplied only to this child applied to the root task. Integration still contains the old script/workflow and lacks the discovery script and `.nvmrc`; previous passing component/unit/build receipts do not by themselves satisfy the newly requested command contract.

Use a bounded BMAD build in a new isolated checkout from the current integration revision. Transplant only these four files from original `5ec93e594eda60c28da2cfdbf27fb668fd55eb3d`, then make the narrowly reviewed archive compatibility adjustment described below:

| File | SHA-256 at both original source and verified isolated worker |
| --- | --- |
| `scripts/loop-verify.sh` | `d2b9372a57f879779177c6ca20033c4e42aae8dc85a2a28b280bc7e6fdc42cc8` |
| `scripts/check-test-discovery.mjs` | `20ffde37d17d354e08f1d4596282060c304fa4c863e4b133770ebd4362e47512` |
| `.github/workflows/ci.yml` | `c57242059b66b492bb844b3ee7263bba14829c8299de85d6a4f327295d0c4693` |
| `.nvmrc` | `68ca3fba3b7e864770cb61aeb306d4bd4354b68ab4dd38450860c5d823e42a53` |

Update the verification/prerequisite paragraphs in integration AGENTS and README to describe the actual result, preserving all existing product/native-ledger policies. Do not replace whole documentation files merely because they were part of the original infrastructure ticket. No package, lockfile, canonical Vitest configuration, product code, schema or generated files are needed for this transplant. The discovery script uses Node builtins and the already installed Vitest CLI.

## Provenance and excluded changes

The four candidate files are byte-identical between original `5ec93e5` and verified worker `125c6cd47e8b1068f39889855d2029a502e5a856`, branch `factory/dx-1-one-verify-entry`, isolated at `/Users/johnnynguyen/Documents/Repos/Banhall/.factory/worktrees/dx-1-one-verify-entry`, baseline `1336befc57345ab6a65a31f66cdaf47182315ce4`. This historical factory execution is evidence only; no factory workflow is requested or invoked here.

Relevant original commits:

- `ad9952ff1ba107bfbf97955863d4dfcdf774a530` introduced the guard together with Bun/dependency/tsconfig cleanup. Only the guard is required here.
- `b9e09bc407d835c004b6dcf2ebaa3dc51261892e` introduced the unified entry point, CI, Node pin and documentation, but also changed `.factory/factory.toml` and multiple broader documents.
- `ab56b84364b43d00df1232a49ad36c526280e9f5` refined the script install hint.
- `db6568b038a1b1169092091710bb9e5122668a31` moved dependency installation after prerequisite checks and corrected README/environment setup prose.
- `5583a2589e4421c2bc73cf9e5c4371fd7f062f07` is the original integration merge receipt.
- Current original tip `5ec93e594eda60c28da2cfdbf27fb668fd55eb3d` changes six factory planning/ticket files only. It must not be merged wholesale into completion.

Package/lock/config comparison also shows substantial unrelated dependency divergence between the branches. Importing entire commits or the original branch would broaden scope unnecessarily. Documentation in the original ticket includes unrelated removed-component references; preserve completion's current learning and UI documentation.

## Necessary compatibility adjustment

At original source, `scripts/check-test-discovery.mjs:15` enumerates every tracked `*.test.ts`; lines 20–30 collect both actual canonical Vitest listings; lines 37–39 fail for any tracked path absent from both. Completion intentionally retains three historical source snapshots outside both runners:

- `.audit/integration-code-review-9da55be/qa-structural-boundary-input/convex/ai/qaChecks.test.ts`
- `.audit/integration-code-review-9da55be/qa-structural-boundary-input/convex/lib/tiptapReport.test.ts`
- `.audit/integration-code-review-9da55be/qa-structural-boundary-input/convex/qaBlocking.test.ts`

An unchanged transplant will flag these archive copies. Add an explicit documented exclusion for exactly these known archive paths while preserving archive bytes and canonical runner discovery. Avoid blanket exclusions capable of hiding new product tests. Demonstrate that a genuinely undiscovered tracked test still fails; do not weaken the guard simply to obtain green output. This adaptation is new work requiring BMAD review and runtime verification; the original review cannot pre-approve it.

Root's existing `.audit/integration-final-20260905/final-gates/test-discovery-receipt.json` records actual unchanged canonical listings at `569158a2b31ad0a7bf8ff1ba1e63a8634cc6f54c`: 217 tracked test files, 214 runnable (154 unit/backend plus 60 component), exactly the three archive copies excluded, zero orphans. That receipt establishes the compatibility issue and existing coverage, not execution of the new unified gate on the new result.

## Preconditions and evidence limits

The transplanted script checks `node`, `npm`, and `pwsh` before dependency installation; Node arithmetic accepts 22.12+ in major 22 or major 24+, and `.nvmrc` pins 24. Historical runtime proof used Node 24.19.0, not every accepted version. Missing tools fail at numbered preflight with install hints. Empty worktree-owned `node_modules` triggers `npm ci`; tool checks occur first and install failure propagates. Public Convex URL placeholders are supplied only when unset, without printing configured values. No deployment or credential is required. Optional Chromium execution checks the installed Playwright executable and supplies its install command when missing.

The eight default steps are preflight, Convex typecheck, Svelte check, unit tests, actual two-config discovery, production build, PowerShell uploader and Bash uploader. `VERIFY_COMPONENT=1` adds the ninth component-suite step. Each failure names the step and propagates its exit code. Existing uploader and component config files need no port.

Historical retained evidence is under `/Users/johnnynguyen/Documents/Repos/Banhall/.audit/dx-1-one-verify-entry/`, not committed in `5ec93e5`. `qa-3.md` reports test-verified status; `gate-default-fix3.log` and `gate-component-fix3.log` end with exit 0. That source context passed 1,516 unit tests/140 files, discovery of 191 files, and 292 browser tests/51 files. `preflight-run-kUyv9Z/report.json` identifies worker `125c6cd`, confirms unchanged script hash, cleaned fixtures and three passing actual probes: missing PowerShell exits 1 at preflight; missing Chromium exits 1 at preflight; injected Convex typecheck exits 37 with no later step. Retained cold-checkout evidence additionally covers missing tools before installation, install exit propagation, and browser-free execution. These receipts support the infrastructure's provenance, not completion's different product/dependency graph.

The workflow declares two independent non-optional jobs named `Verification gate` and `Component suite (browser)`, uses Node from `.nvmrc`, and installs Chromium only in the component job. PowerShell depends on the GitHub Ubuntu runner image. Historical static image verification is not a fresh hosted run. Declaring jobs does not enforce branch protection; root reports no protection/rules currently. Existing GitHub green checks on the old PR revision cannot establish the updated workflow's success.

Recommended next action: isolated BMAD port of the four files plus narrowly scoped documentation and archive guard adaptation; fresh review; run the unified default gate and optional browser gate against that exact result, including a negative discovery control; integrate only the verified private repair, then obtain fresh GitHub checks. Root retains all shipping and Vercel decisions. No broader factory planning or product changes are justified by this reconciliation.
