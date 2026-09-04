---
key: workspace-1-gate-on-for-everyone
status: done
kind: feature
deps: []
touches: [convex, src]
risky: [rights]
verify: [npx vitest run convex/workspaceRollout.test.ts src/routes/admin/adminWorkspaceRoutes.test.ts]
done_when: ["! rg -q 'masterEnabled|setMasterSwitch|setUserAccess|listEnabledAccess|listRolloutEvents|getAdminState' convex/workspaceRollout.ts", test ! -f src/lib/components/admin/WorkspaceRolloutCard.svelte, test ! -f src/lib/components/admin/WorkspaceRolloutCard.component.test.ts, "! rg -q 'WorkspaceRolloutCard' src/", npx vitest run convex/workspaceRollout.test.ts]
title: "Preview workspace available to every internal role; rollout master switch, allowlist functions, admin card and its component test deleted"
plan: 20260903-client-sync
updated: "2026-09-04T08:36:38.786Z"
run: 20260904-082407-workspace-1-gate-on-for-
branch: factory/workspace-1-gate-on-for-everyone
escalation: provider quota exhausted on every fallback (codex gpt-5.6-sol); retry later with  factory run --ticket workspace-1-gate-on-for-everyone
ui: false
merged: 68412a2
verdict: test-verified
evidence: .audit/workspace-1-gate-on-for-everyone/evidence.md
deferred: ["8 pre-existing component-test failures in Button/WorkspaceChrome/WorkspaceHeader/WorkspaceRail/workspaceRoutes; identical failure set at baseline de540f8, outside this ticket's scope"]
---
## Intent
Writers are still on the old UI while Michael reproduces their bugs in the new one (meeting 2026-08-26, 13:00 and 17:21). After this ticket every authenticated user holding `project.readInternal` gets `available: true` from `workspaceRollout.getAccess`, with no master switch and no per-user allowlist. Role-based permissions inside the workspace do not change. The maintainer inherits a four-line gate and no admin rollout card. Tables stay. The domain amendment that supersedes the 2026-08-06 fail-closed rollout clause rides with `workspace-2` so this ticket stays inside the two-package sizing limit.

## Acceptance
- AC1: Given a signed-in user with stored role `writer` (displayed as "Consultant", `shared/roles.ts:1-10`; there is no separate consultant role), `manager` or `admin`, when they call `getAccess`, then the result is `{ available: true }`.
- AC2: Given an unauthenticated, anonymous or roleless caller, when they call `getAccess`, then it throws exactly as today (`/authentication/i`, `/internal role/i`).
- AC3: Given `/admin/users`, when it renders, then there is no workspace rollout card and no import of it; `adminWorkspaceRoutes.test.ts` still passes unchanged.
- AC4: `convex/workspaceRollout.ts` exports only `getAccess`; `convex/schema.ts` is untouched.
- AC5: `src/lib/components/admin/WorkspaceRolloutCard.component.test.ts` is deleted with the card (it imports the card at `:3`; left behind it breaks `svelte-check` in the gate).

## Verification
- AC1 → `convex/workspaceRollout.test.ts`: one `it` per stored role using the existing `setup()` identities (`admin`, `writer`, `manager`, `:11-34`); assert `available === true`. No new identity is needed.
- AC2 → keep `convex/workspaceRollout.test.ts:316-321` verbatim.
- AC3 → `npx vitest run src/routes/admin/adminWorkspaceRoutes.test.ts`; `rg -n WorkspaceRolloutCard src/` empty.
- AC4 → `rg -n "^export" convex/workspaceRollout.ts` shows one export; `git diff --stat convex/schema.ts` empty.
- AC5 → `test ! -f` predicate in `done_when`; `npm run check`.

## Implementation notes
- `convex/workspaceRollout.ts:177-190`: handler becomes `await requireCapability(ctx, "project.readInternal"); return { available: true };`. Delete `:36-67` helpers and every export after `getAccess` (`:197-457`). Keep the file header comment updated to say exposure-only and on for everyone.
- Delete `src/lib/components/admin/WorkspaceRolloutCard.svelte` and `src/lib/components/admin/WorkspaceRolloutCard.component.test.ts`; remove the import at `src/routes/admin/users/+page.svelte:10` and the mount plus its comment at `:764-765`. The admin shell must stay `convex-svelte`-free per `adminWorkspaceRoutes.test.ts:23-25`; removing the card only helps.
- Rewrite `convex/workspaceRollout.test.ts` (currently 422 lines about the dual gate: `:70-110`, `:188-233`, `:245-314`, `:323-421`). Drop the master-switch, duplicate-row, OCC and admin read-model suites entirely; they test deleted code. Keep `:316-321`. Check `setup()` for seeded `appSettings`/access rows and delete that seeding; drop the unused `MASTER_KEY` constant at `:8`.
- `WorkspaceGate.svelte`, `workspaceExperience.ts` and `docs/product-domain.md` are NOT touched here (next ticket). The `{ available }` wire shape stays.
- Do not delete tables, indexes or the `workspace.dashboard.v1.enabled` row. Do not add a feature flag.

## Edge cases
- Rows in `workspaceDashboardAccess` with `enabled: false`: ignored; user still gets the workspace.
- Master row absent or malformed: irrelevant; nothing reads it.
- Roleless user who was previously allowlisted: still denied by `requireCapability` (permission boundary unchanged).
- Admin bypass at old `:184`: subsumed; no special case remains.
