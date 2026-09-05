# Execution review findings

## Open: PERF1-PROOF-1, sequential PDF fixture timing

Independent source review by audit_performance and root at worktree commit 77825a2 found `src/lib/parseDocument.test.ts:225-246` creates both `after(20_000, ...)` promises before parsing begins. Thus document load and page text delays run concurrently, and page 2 starts at t=20s, despite the comment and ticket AC2(a) claiming t=40s. The test still catches restarting the per-call deadline, and no production timer or search defect was found. Correct the fixture by starting the page text timer lazily when getTextContent is called, or explicitly resolve deferred page text at t=40s; assert the phase timing and keep the 59,999/60,000 boundary and zero-timer checks. Preserve the real baseline-failure/head-pass evidence. This finding remains open until the corrected actual fixture is run and recorded. The factory review/QA for perf-1 is still pending; if it does not catch and fix this, schedule a narrow follow-up before declaring the sweep complete.

## Resolved locally: QA evidence write and deferred metadata preservation

QA could not append its report under its tool allowlist. The engine saved the full structured result as root `.audit/perf-1-parser-timers-editor-index/qa-0.md`; the orchestrator appended a reference and limits to root evidence, so no user action is needed. This running engine retained the integration copy of the ticket and discarded the implementer's four `deferred` entries. Restored those entries from actual commit 77825a2 into the canonical done ticket. Their planned resolutions (UI failures, duplicate Underline) remain pending respective tickets. Preserve source-side deferred entries at subsequent merges as needed. At 07:14 UTC, the on-disk external engine.mjs:168 already contains explicit deferred preservation, so the observed behavior is a limitation of this active run, not a confirmed defect in the current on-disk version. No external factory engine changes were made in this sweep.

## Applied to pending tickets: engine-persisted QA report

For tickets not yet started, added run-specific QA output guidance: return the full report through the structured fields the engine already persists, instead of repeatedly attempting audit-file writes denied by the existing tool allowlist. No permissions or verification requirements changed. Active perf-2 was excluded because its worktree and scope were already loaded. Root will link canonical QA outputs into evidence after each merge.

## Corrected pending DX scope: dependency consumes SITE URL at build time

Slop-1's initial build with only PUBLIC_CONVEX_URL failed with MISSING_EXPORT PUBLIC_CONVEX_SITE_URL at `node_modules/@mmailaender/convex-better-auth-svelte/dist/sveltekit/index.js:3`. Root confirmed installed adapter 0.8.2 imports both public URLs; hooks.server.ts, +layout.server.ts and api/auth/[...all]/+server.ts import that adapter. The earlier source-only review correctly rejected the authClient comment as a reader but missed this dependency consumer. Updated pending dx-1 AC3/AC4 to document both URL placeholders for production-build verification and cite both adapter and uploader setup. Typecheck still needs only PUBLIC_CONVEX_URL.

## Pending DX closure of deleted-component guidance

Restored slop-1's deferred entry from 84ca337: `docs/svelte-migration.md:77` says to reuse ui/MenuToggleIcon and ui/Header, now deleted. Added removal of only those two names to pending dx-1. Its historical note will cover the entire old Verify section (Bun commands, shared server, no Convex edits, no commits), not just the dev-server bullet. No new implementation file or criterion. Read-only GitHub checks also found main reports Branch not protected and repository rulesets list is empty; no external branch rule was changed.

## Corrected: QA commands belong in the explicit engine verify list

Slop-2 QA returned typecheck-only after passing the shared gate, 8 unit cases and 33 browser cases because clean installation, production build and the direct underline proof were not executable under its tool allowlist. Stopped run 20260905-055642-10-tickets during its first fix retry, preserving the worktree and its test-title clarification. Added the three already-approved commands to canonical slop-2 verify and the already-required build command to pending slop-3 verify. The restarted engine executes these independently; its current code also derives scoped QA commands from ticket verify. No new wrapper, permanent test or broad tool permission was added. Root npm ci and direct underline proof exited 0 at the slop-2 source, but its first independent build overlapped the retry installer and failed on missing node_modules/@sveltejs/kit/package.json. That run is invalidated as a verification attempt, not classified as a source regression. Keep root-build.log as the record; rely on the subsequent serialized engine build for a valid result.
