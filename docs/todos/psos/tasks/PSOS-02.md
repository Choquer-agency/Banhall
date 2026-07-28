# PSOS-02 — Remove demo auto-login; normalize credentials; @banhall.com guidance

## Work control

- **Status:** `done`
- **Phase:** P1
- **Current owner:** Pi coding agent
- **Started:** 2026-07-24
- **Completed:** 2026-07-24
- **Source plan:** [`../../../futur-board-ticket-breakdown-psos.md`](../../../futur-board-ticket-breakdown-psos.md)
- **Progress note:** Demo auto-login removed, sign-out/login rendering stabilized, canonical email handling enforced end-to-end, collision-safe migration tooling added, Claude review resolved, and the development deployment verified clean.

> Work this ticket independently. Do not start implementation until every dependency below is complete or explicitly waived in this file. Only one PSOS ticket should normally be `in_progress` at a time.

## Execution checklist

### 1. Prepare

- [x] Run and record the required Claude Code/Fable high-reasoning planning pass before the remaining implementation.
- [x] Re-read this ticket, its dependencies, and linked existing BNH work.
- [x] Inspect the current implementation and record affected files before editing.
- [x] Confirm unresolved decisions and assumptions; document any approved waiver.
- [x] Define the smallest safe rollout slice and rollback path.

Urgent slice affected files: `src/routes/login/+page.svelte`, `src/lib/components/ui/UserMenu.svelte`, `src/routes/+page.svelte`, and stale demo-seed guidance in `convex/seed.ts`. The initial fix intentionally removes auto-login unconditionally rather than retaining an environment allowlist, because background session refresh was replacing authenticated users with the demo account. Rollback is limited to these authentication UI changes; no schema or production data migration is included in this slice.

### 2. Implement

- [x] Complete backend/schema/domain work in scope.
- [x] Complete frontend/UX work in scope for demo auto-login removal and stable sign-out/login rendering.
- [x] Add loading, empty, failure, permission-denied, and conflict states where relevant. *(Login retains checking, signing-in, invalid-credential, and normal form states.)*
- [x] Add audit, authorization, OCC/idempotency, and migration handling where relevant. *(No authorization/data mutation was added in this urgent slice; remaining email backfill is explicitly not claimed complete.)*
- [x] Keep unrelated behavior and files unchanged.

### 3. Verify acceptance criteria

- [x] Work through every acceptance criterion below individually and attach evidence in the work log.
- [x] Add or update unit, integration, and regression coverage required by this ticket.
- [x] Verify keyboard, screen-reader labeling, touch targets, responsive layout, and reduced motion for UI work. *(Stable shell retains existing accessible form controls; progress state uses polite live status; no new motion remains.)*

### 4. Validate and close

- [x] Run and record a fresh Claude Code/Fable post-implementation review; resolve or explicitly disposition every finding.
- [x] Run targeted tests for the changed area.
- [x] Run `npm run check`.
- [x] Run the Convex TypeScript check.
- [x] Run `npm run test`.
- [x] Run `npm run build`.
- [x] Run formatting/lint commands if present and `git diff --check`.
- [x] Review the final diff for unrelated changes, unsafe migration behavior, and leaked secrets.
- [x] Update this file to `done`, record evidence, and update [`../README.md`](../README.md).

## Ticket specification

**Priority**: P1 (security-adjacent).
**Problem**: Demo auto-login still fires in environments where real accounts are expected;
whitespace/case in credentials causes avoidable login failures; onboarding guidance for
`@banhall.com` accounts is inconsistent.
**Context**: Auth in `convex/auth.ts`, `convex/auth.config.ts`, login UI at
`src/routes/login`, signup at `src/routes/signup`, invites in `convex/invites.ts`.
Related board work: BNH-13 (account migration) — coordinate, don't duplicate its
env/key migration items.
**In scope**: Environment-gated removal/disable of auto-login (explicit allowlist env
var, default off); trim + lowercase-email normalization on login/signup/invite-accept
(server-side, plus input hygiene client-side; never normalize passwords beyond trim
decision — document choice); standardized copy telling users to use their
`@banhall.com` account, incl. invite emails and login error states.
**Out of scope**: Role changes (PSOS-27+), new providers.
**UX**: Login shows plain-language errors ("Check your @banhall.com email address"),
no stack traces; demo path invisible in production builds.
**Technical notes**: gate via Convex env var checked server-side, not build flag alone;
normalize in `convex/auth.ts` + `convex/invites.ts` accept path; update `by_email`
lookups to use normalized form; one-off backfill to normalize existing `users.email` /
`invites.email` (batched, idempotent).
**Acceptance criteria**:
- [x] Given any environment, when app loads, then no auto-login occurs and no demo
      credentials ship in the frontend bundle. *(The approved implementation removes auto-login entirely; an environment-gating test is therefore intentionally superseded.)*
- [x] Given `" User@Banhall.com "` at login/signup/invite, then it matches the stored
      normalized account.
- [x] Development-deployment report shows zero mixed-case/whitespace emails and zero collisions; migration tooling reports collisions without auto-merging and dry-run verified zero required writes.
- [x] Tests: normalization unit tests, invite/signup-gate integration, migration dry-run/idempotence/pagination/collision tests, and internal role-lookup normalization. *(The repository has no browser component-test harness; login behavior was validated through Svelte checks, SSR/live-page inspection, bundle grep, and manual-flow requirements.)*
**Rollout**: Backfill before enabling normalized lookup (widen-migrate-narrow).
**Risks**: normalization collisions between existing accounts → manual resolution list.

## Decision and assumption log

| Date | Decision or assumption | Reason | Approved by |
|---|---|---|---|
| 2026-07-24 | Remove demo auto-login entirely instead of retaining an environment-gated browser path. | The embedded automatic sign-in can replace a real account after auth/session refresh and ships reusable demo credentials in the client bundle. Explicit demo sign-in remains possible using normal credentials. | User request |
| 2026-07-24 | Use client-side `goto` after sign-out and keep the login split shell mounted through auth resolution. | Avoids a full document reload and repeated entrance animations that caused the left brand field and login page to flash. | User request |
| 2026-07-24 | Do not alter password whitespace. Normalize only the submitted email in this urgent slice. | Passwords are opaque credentials; trimming them could change valid account behavior. | Security-safe default |

## Work log and evidence

| Date | Change/evidence | Result |
|---|---|---|
| — | Ticket created from the PSOS master plan. | Ready |
| 2026-07-24 | Removed automatic `demo@banhall.ca` sign-in, hard-coded demo password, sessionStorage sign-out marker, and stale auto-login comments. | `/login` now always requires explicit credentials when unauthenticated; background auth changes cannot trigger demo login. |
| 2026-07-24 | Changed sign-out from `window.location.href` to awaited client-side navigation after `authClient.signOut()`. | Avoids full app teardown/reload during sign-out. |
| 2026-07-24 | Kept the complete login split shell mounted during session checking/sign-in and removed mount entrance animations. | Left brand field remains stable; only the form column switches between progress and credentials. |
| 2026-07-24 | Normalized submitted email with `trim().toLowerCase()` and changed visible account guidance to `@banhall.com`. | Handles pasted whitespace/case at the login boundary without altering passwords. |
| 2026-07-24 | Claude Code/Fable high-reasoning pre-implementation plan (`sa-14`). | Confirmed normalization gaps in `auth.ts`, `invites.ts`, and `users.ts`; recommended a shared helper, collision-safe internal report/backfill, invite index, focused tests, and four urgent-slice hardening fixes. Plan accepted with implementation kept additive and uncommitted. |
| 2026-07-24 | Searched the frontend for demo credentials/auto-login markers and fetched the live local `/login` SSR output. | No demo credential or auto-login code remains under `src`; live login output contains the explicit form and no demo credentials. |
| 2026-07-24 | Ran Svelte autofixer on all changed `.svelte` files. | No concrete issues remain; only the established advisory about auth redirect effects appears on the two route guards. |
| 2026-07-24 | Ran initial `npm run check`, Convex TypeScript, `npm run test`, `npm run build`, and `git diff --check`. | Initial urgent slice passed before the normalization expansion. |
| 2026-07-24 | Added `convex/lib/email.ts`, authoritative Better Auth sign-in/signup normalization, normalized app-user writes/lookups, bounded indexed invite checks, and `by_email_and_status`. | Browser and direct auth callers now use one canonical trim+lowercase address; passwords remain untouched. |
| 2026-07-24 | Added internal `emailMigration:report`, collision-safe paginated user migration, invite migration, dry-run support, scheduler continuation, and explicit 1,000-row safety bounds. | Unique users normalize; user collision groups remain untouched and reportable; invite history normalizes without deletion/merge. |
| 2026-07-24 | Added `email.test.ts`, `invites.test.ts`, and `emailMigration.test.ts`. | Full suite increased to 10 files / 95 passing tests; new coverage includes normalization, authorization, invite gate, dry-run, pagination, idempotence, collisions, and setRole lookup. |
| 2026-07-24 | Claude Code/Fable post-implementation review (`sa-15`). | No blocking code findings. Resolved returned-context middleware hardening and sign-out failure feedback; documented single-invocation live migration behavior. Development rollout ordering was verified by a clean report before any write. |
| 2026-07-24 | Ran `emailMigration:report` against the credential-configured development deployment. | 0 non-normalized users, 0 non-normalized invites, 0 user collisions, 0 duplicate pending invites, no truncation. |
| 2026-07-24 | Ran both migration dry-runs against development. | Users: 4 scanned/0 patches; invites: 2 scanned/0 patches; no collisions or invalid records. No live backfill was necessary. |
| 2026-07-24 | Final validation: codegen, `npm run check`, Convex TypeScript, `npm run test`, `npm run build`, and `git diff --check`. | 0 Svelte errors/warnings; Convex TypeScript passed; 10 files/95 tests passed; production build and diff check passed. |

## Completion record

- **Pull request/commit:** Not committed at user request.
- **Deployment:** `npx convex codegen` uploaded schema/functions to the credential-configured development deployment. No production deployment was performed. Development data report was clean; only dry-runs were executed because no backfill was needed.
- **Follow-up tickets:** BNH-13 remains responsible for any broader account migration/provider work. Future email-domain restriction would require a separate product decision; external invited addresses remain valid.
- **Known limitations accepted at closure:** Better Auth middleware normalization is covered through source review and server integration behavior rather than a browser automation suite, which this repository does not currently have. Production deployment/data remains unmodified and must repeat the report-first verification when authorized.
