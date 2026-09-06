# Q6 post-review repair and verification

Read the Q6 spec and completed blind, edge and verification-gap reviews. This pass changed only `UserMenu.svelte` and `UserMenu.component.test.ts`. Production change is exactly one inline Settings-navigation catch; comparison against preserved pre-review source confirmed rail and existing sign-out implementation are unchanged. No helper/wrapper, shared test API, route/theme expansion, staging, commit, install, full gate, ledger edit, other-checkout edit or nested review fanout.

## Preserved artifacts

- `pre-review-source.txt`: SHA-256 `03dd3e8dfeea8ffb7c35622f7404e011d31fc4bff6dc24c2e9dc39d33f234ed8`.
- `pre-review-test.txt`: SHA-256 `adf65641785984edbecb64927fc487b26d56abc36028edad94b7e39fe715d662`.
- Final UserMenu.svelte: `966f54bb9b6359f61282ca77d9944a904bd80931f07ee28bfb22712b13371111`.
- Final UserMenu.component.test.ts: `81bb62f0201797a01eb102c1e2767ae788b28ea6bdbdb94e13b3cc7c4620b597`.
- `post-review-sha256.txt` records source/test, baseline/final command logs, original before screenshot and new matching-identity capture. Pre-review files also have individual checksum files.

## Findings addressed

**Edge navigation rejection:** Settings now catches rejected goto inline and calls existing toast.error with “Settings could not open. Please try again.” Normal successful navigation is unchanged. The new real-menu test mocks only the navigation boundary, rejects once, verifies exact error notification/menu closure/no sign-out, then reopens and successfully selects Settings. `rejection-before-refined.log` demonstrates failure before production edit: expected notification was missing. This live baseline establishes missing feedback; it does not independently establish a browser-global unhandled-rejection event. The catch handles the rejected promise explicitly.

**Avatar sign-out and pending state:** One deferred-auth test selects actual avatar Sign out, verifies one auth call and closed menu, then reopens while pending. The real item is aria-disabled and a deliberately dispatched repeated click does not create a second auth call or navigation. Resolving auth triggers exactly one mocked outbox clear and the existing `/login` goto with `{ replaceState: true, invalidateAll: true }`; pending label/disabled state clears. Final test locally mocks destructive clearAllOutboxes, verifies zero calls before auth completion and one afterward. No logout, cookie or storage integration claim is made. Auth, navigation and destructive storage cleanup are boundaries, not live account operations.

**Keyboard behavior:** Existing writer/manager/admin keyboard cases now open via Enter, Space and ArrowDown respectively. Each traverses Settings → Sign out → Settings with ArrowDown/ArrowUp, uses Escape to close and restore trigger focus with no navigation/sign-out, then reopens and activates Settings with Enter. Existing pointer cases remain; no redundant role/theme suite added.

**Visual evidence:** Writer pointer case now captures `avatar-account-writer-after.png` with Account Writer, light tone/light menu and explicitly 333×720 viewport, matching the original before PNG dimensions. Both captures were visually inspected: current adds Settings above preserved Sign out with matching identity. The original failure capture has visibly smaller menu/text scaling than the new explicit-viewport capture; do not treat them as pixel-identical capture conditions or an automated visual regression comparison. The fixture-name mismatch is corrected, and both are real component screenshots. Existing `avatar-after.png` is historical and was not overwritten.

## Commands and results

1. Initial attempt at a test-local navigation mock recursively imported its own aliased module, preventing test execution. That run was interrupted (exit 130) and remains `rejection-before.log`; it is not defect evidence. The mock was corrected to Vitest importOriginal, without shared stub edits.
2. `PUBLIC_CONVEX_URL=https://placeholder.convex.cloud PUBLIC_CONVEX_SITE_URL=https://placeholder.convex.site npm run test:component -- src/lib/components/ui/UserMenu.component.test.ts -t 'reports rejected Settings'` before production catch: exit 1, 1 failed/9 skipped, missing toast assertion. See `rejection-before-refined.log`.
3. `PUBLIC_CONVEX_URL=https://placeholder.convex.cloud PUBLIC_CONVEX_SITE_URL=https://placeholder.convex.site npm run test:component -- src/lib/components/ui/UserMenu.component.test.ts src/lib/components/workspace/WorkspaceRail.component.test.ts` after final storage-boundary mock: exit 0, 2 files, **32 passed** (10 UserMenu plus 22 unchanged WorkspaceRail tests). See `post-review-component.log`.
4. Same public placeholders with `npm run check`: exit 0, **0 errors and 0 warnings**, after final edits. See `post-review-check.log`.
5. `git diff --check`: exit 0, no diagnostics. Exact-string source comparison confirmed inline catch is the only production difference from preserved pre-review bytes.

## Remaining qualifications and root ownership

Navigation is tested at the SvelteKit component boundary with the existing empty-base stub, not a nonempty deployment base, authenticated destination route or redirect. Other themes and backend role access were not broadened. Screenshot captures are review artifacts, not asserted golden images. Existing rail behavior is covered by its unchanged suite. Root owns mutable spec bookkeeping, final finding disposition and final combined gate. Earlier baseline/full-gate evidence does not itself establish acceptance after this repair.

## Raw capture provenance

Before image source: `.audit/quality-pass/Q6/avatar-before.png`, SHA-256 `3104e06fc21778739fbeadb4e0b0cadc052c3704c55fd292248ccb99f7a55533`, 333×720 pixels. After: `.audit/quality-pass/Q6/avatar-account-writer-after.png`, SHA-256 `5c6021e6090e297038cb6f5d2b341438c8a9920bdb59c4051036d135c869f463`, 333×720 pixels. These are raw captures; no resizing or image editing was performed.

The before production source is Git `bea7e2d218ea06743f94b2c5fd5e1755e5fd98e8:src/lib/components/ui/UserMenu.svelte`, verified SHA-256 `332ea3a6f48df9ed1a194509e167569da1d204000fc3b23707e7fd7108574ede`, matching baseline-source.sha256. Existing UserMenu classes/CSS remain unchanged apart from the added Settings item itself; this review patch changes only that item's rejection callback. Visual scale qualification above remains. Real navigation interactions and source diff, not pixel matching, are acceptance evidence.
