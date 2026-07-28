# PSOS-26 — roleCapabilities module: presets + server helpers

## Work control

- **Status:** `done`
- **Phase:** P6
- **Current owner:** Pi coding agent
- **Started:** 2026-07-28
- **Completed:** 2026-07-28
- **Source plan:** [`../../../futur-board-ticket-breakdown-psos.md`](../../../futur-board-ticket-breakdown-psos.md)
- **Progress note:** Complete and released. Shared declarative presets, grouped matrix export, and fail-closed server helper are live. No call-site migration, visibility change, custom permissions, or storable Financial role. Claude Code/Fable planning verdict PLAN READY and adversarial review verdict SHIP. The release also adds a reviewed real-time compatibility overlay so historical email-based consultant labels display current account names without rewriting stored audit snapshots.

> Work this ticket independently. Do not start implementation until every dependency below is complete or explicitly waived in this file. Only one PSOS ticket should normally be `in_progress` at a time.

## Execution checklist

### 1. Prepare

- [x] Re-read this ticket, its dependencies, and linked existing BNH work.
- [x] Inspect the current implementation and record affected files before editing.
- [x] Confirm unresolved decisions and assumptions; document any approved waiver.
- [x] Define the smallest safe rollout slice and rollback path.

### 2. Implement

- [x] Complete backend/schema/domain work in scope.
- [x] Complete frontend/UX work in scope.
- [x] Add loading, empty, failure, permission-denied, and conflict states where relevant.
- [x] Add audit, authorization, OCC/idempotency, and migration handling where relevant.
- [x] Keep unrelated behavior and files unchanged.

### 3. Verify acceptance criteria

- [x] Work through every acceptance criterion below individually and attach evidence in the work log.
- [x] Add or update unit, integration, and regression coverage required by this ticket.
- [x] Verify keyboard, screen-reader labeling, touch targets, responsive layout, and reduced motion for UI work.

### 4. Validate and close

- [x] Run targeted tests for the changed area.
- [x] Run `npm run check`.
- [x] Run the Convex TypeScript check.
- [x] Run `npm run test`.
- [x] Run `npm run build`.
- [x] Run formatting/lint commands if present and `git diff --check`.
- [x] Review the final diff for unrelated changes, unsafe migration behavior, and leaked secrets.
- [x] Update this file to `done`, record evidence, and update [`../README.md`](../README.md).

## Ticket specification

**Priority**: P1.
**Problem**: Authorization is scattered creator/admin checks; capabilities must be
centralized and declarative before hardening every function.
**Context**: New `convex/roleCapabilities.ts`; roles on `users`; capability matrix from
PSOS-01; the temporary helper from PSOS-09/12 gets replaced here (call sites unchanged).
**In scope**: Capability enum (e.g. `project.transferOwnership`, `project.setStage`,
`workItem.completeOthers`, `branch.promote`, `outcome.recordDelivery`,
`financial.read`, `financial.write`, `roles.manage`, `pipeline.view` …); presets
Consultant/Manager/Admin/Financial as data; helpers `requireCapability(ctx, cap,
scope?)` and `hasCapability` for UI hints; typed permission errors; export matrix for
tests + UI (PSOS-29).
**Explicit guardrail**: capability rollout must NOT change project visibility —
visibility remains as-is pending PSOS-30 decision.
**Acceptance criteria**:
- [x] Single source of truth: presets defined once and ready for call-site migration in PSOS-27.
- [x] Helper resolves role→capability in O(1) with no database scan beyond the indexed user row.
- [x] Matrix test: table-driven role×capability expectations, all four roles.
- [x] No custom-permission builder shipped (non-goal).
**Dependencies**: PSOS-01. **Rollout**: land helpers, then migrate call sites (PSOS-27).

## Decision and assumption log

| Date | Decision or assumption | Reason | Approved by |
|---|---|---|---|
| 2026-07-28 | Keep capability data in `shared/capabilities.ts` and server enforcement in `convex/lib/roleCapabilities.ts`. | Provides one UI/test-safe source of truth without making a Convex function module or importing generated backend types into the frontend. | Claude Code/Fable plan |
| 2026-07-28 | Represent Financial in capability data only; do not widen stored user/invite roles until PSOS-28. | The role has no approved landing/navigation/auth rollout yet and must remain unassignable. | Approved product-domain contract |
| 2026-07-28 | Runtime scope levels are `none`, `own`, and `all`; planned cells deny. Object facts are caller-supplied and `own` without matching scope fails closed. | Avoids hidden database scans and prevents the capability layer from pretending it owns transition/readiness/business invariants. | Claude Code/Fable plan |
| 2026-07-28 | Preserve broad internal project visibility; `project.readInternal` remains allowed for current stored roles. | Product-domain decision D1 and PSOS-30 explicitly defer membership-based visibility. | Approved product-domain contract |

## Work log and evidence

| Date | Change/evidence | Result |
|---|---|---|
| — | Ticket created from the PSOS master plan. | Not started |
| 2026-07-28 | Claude Code/Fable 5 completed the required read-only planning pass. | PLAN READY; no blockers. PSOS-26 activated only after PSOS-07 deployed, preserving one active ticket. |
| 2026-07-28 | Added the shared capability vocabulary, four declarative presets, grouped matrix export, fail-closed server helper, and table-driven tests. | Current stored roles retain approved behavior; planned Financial cells remain visible but runtime-denied and unstorable. No function call sites or project visibility queries changed. |
| 2026-07-28 | Claude Code/Fable 5 completed the mandatory adversarial post-implementation review. | Verdict: **SHIP**, no blockers. Canonical error fields were protected from detail shadowing and denial metadata was renamed to `effectiveLevel` before rollout. |
| 2026-07-28 | Final validation completed. | 393/393 unit/integration tests, 38/38 browser-component tests, 10 focused capability tests, clean Svelte and Convex typechecks, successful production build, and clean diff check. |
| 2026-07-28 | Added the approved live compatibility overlay for legacy email-based consultant labels before release. | Internal project list/detail and admin QA review projections now resolve current First Last/name from the authoritative user ID or an unambiguous normalized email; raw stored snapshots remain unchanged. Duplicate legacy emails fail safely. |
| 2026-07-28 | Claude Code/Fable planned and twice reviewed the live-name overlay. | Initial review blocked `.unique()` on supported duplicate-email states; replaced with bounded ambiguity handling and authoritative-ID fallback. Final verdict: **SHIP**. Final gates rose to 397/397 unit/integration tests plus 38/38 component tests. |
| 2026-07-28 | Deployed backend-first, committed capability foundation as `48e8485`, then committed live name compatibility as `9e3d869`; both Vercel deployments succeeded. | Production remained behavior-compatible because capability call sites are intentionally unmigrated. |
| 2026-07-28 | Signed-in installed-Google-Chrome production smoke opened legacy project `k97ca2s9t3t1rzr3da92es8h2h8antkn`. | Raw stored writer is still `demo@banhall.ca`, while the product displayed **Demo Writer** with no email or malformed resources. |

## Completion record

- **Pull request/commit:** `48e8485` — `Add centralized role capability presets`; `9e3d869` — `Resolve legacy consultant emails to live names`
- **Deployment:** Convex deployed successfully to `https://energized-salamander-237.convex.cloud`; Vercel production deployments for both commits succeeded; smoke URL `https://banhall.vercel.app`.
- **Follow-up tickets:** PSOS-27 migrates function call sites and must preserve each operation’s transition/readiness/audit invariants. PSOS-28 makes Financial storable and activates its planned cells. PSOS-29 consumes the shared matrix. Analytics/Brain snapshot names remain provenance data unless separately approved for live display.
- **Known limitations accepted at closure:** Capability presets are dead enforcement code until PSOS-27 migrates call sites. Financial remains intentionally unassignable. Historical consultant names resolve live only on internal project/detail and QA review projections; raw stored snapshots are intentionally retained.
