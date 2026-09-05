# CAP-2 story 3 recovery evidence

Verified code commit: `3e575b7c68a80ef560b746be78e1b016e1dda750`.
Recovery starting commit: `62fec81c424a99b76402d5f05577983512d7e0c5`.
Story baseline: `740008e1369faaf6eab001f95efeb10a9e52d1e5`.

| Acceptance | Evidence |
| --- | --- |
| Candidate selection records PED 0 | convex/reportEditDistance.test.ts:163; ped-tests.log |
| Edited milestone records current revision and nonzero PED | convex/reportEditDistance.test.ts:226; ped-tests.log |
| Publish scheduler records owner-attributed row | convex/reportEditDistance.test.ts:300; ped-tests.log |
| Missing baseline preserves successful triggers without a reading | convex/reportEditDistance.test.ts:383; ped-tests.log |
| Query and stored PED agree, preserving eight keys and first baseline | convex/reportEditDistance.test.ts:244 and :269; ped-tests.log |
| Query isolates each report's rows | convex/reportEditDistance.test.ts:438; ped-tests.log |
| Unchanged mathematical edge behavior | convex/lib/editDistance.test.ts:7; ped-tests.log |
| Svelte and backend types | check.log: zero errors/warnings; backend-types.log: exit 0 |
| Complete automated suite | full-suite-final.log: 126 files, 1,290 tests passed |
| Real generated API verification | codegen.log: npx convex codegen, exit 0; generated api.d.ts in verified code commit |

## Commands and outcomes

- `npm ci`: exit 0; installed from the unchanged lockfile.
- `npx convex codegen`: earlier attempts failed project access; the final authorized invocation completed real regeneration and TypeScript checking, exit 0. Credentials were read only by the CLI from ignored local configuration and were not printed or committed. The normal codegen CLI performs analysis and local generation without completing a deployment; see installed Convex `src/cli/lib/components.ts` runCodegen, which calls startComponentsPushAndCodegen and does not call the deployment completion path. The retained CLI output is redacted.
- `npx tsc -p convex/tsconfig.json --noEmit`: exit 0 with no diagnostics.
- `PUBLIC_CONVEX_URL=http://localhost npm run check`: exit 0, zero errors and warnings.
- `npx vitest run convex/lib/editDistance.test.ts convex/reportEditDistance.test.ts`: exit 0, 35 passed. An initial new fixture omitted a required shareToken; corrected before this successful run.
- `npm test`: 1,289 passed, one unrelated source scan timed out at five seconds; retained in full-suite-first.log.
- `npx vitest run src/lib/components/ui/formControlContract.test.ts --testTimeout=30000`: exit 0, three passed; source-contract-recheck.log.
- `npm test -- --testTimeout=30000`: exit 0, all 1,290 passed; full-suite-final.log. No test configuration edit was needed.
- `git diff --check`: exit 0.

Four independent review layers completed. Follow-up review recommendation score is 6 (one medium and three low patches). Existing deferred entries were preserved byte-for-byte. The old hand-edit/codegen-omission deferral remains historical text; successful regeneration supersedes that historical claim.
