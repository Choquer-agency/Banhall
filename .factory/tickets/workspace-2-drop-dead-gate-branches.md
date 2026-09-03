---
key: workspace-2-drop-dead-gate-branches
status: todo
kind: refactor
deps: [workspace-1-gate-on-for-everyone]
touches: [src, docs]
risky: []
verify: [npx vitest run src/lib/dashboard/workspaceExperience.test.ts, npx vitest run --config vitest.component.config.ts --no-file-parallelism src/lib/workspace/WorkspaceGate.component.test.ts src/routes/workspaceRoutes.component.test.ts]
done_when: ["! rg -q 'localDevelopment' src/lib/dashboard/workspaceExperience.ts src/lib/workspace/WorkspaceGate.svelte", "! rg -q 'resolveWorkspaceExperience' src/", "! rg -q 'from \\\"\\\\$app/environment\\\"' src/lib/workspace/WorkspaceGate.svelte", "rg -q '2026-09-03' docs/product-domain.md", npx vitest run src/lib/dashboard/workspaceExperience.test.ts]
title: "Delete the dead localDevelopment branch and the callerless resolveWorkspaceExperience; retire \"not flagged\" cases from workspace tests; record the domain amendment"
plan: 20260903-client-sync
updated: "2026-09-03T21:17:39.899Z"
---
## Intent
With the gate on for everyone, the resolver's `localDevelopment` parameter (hardcoded `false` at the only call site since 2026-08-11), the `resolveWorkspaceExperience` function (no production caller; only its own test imports it, `src/lib/dashboard/workspaceExperience.test.ts:3`) and the browser tests that model a "not flagged" user describe states that cannot occur or code that nothing runs. The maintainer inherits one resolver, `resolveWorkspaceRouteState({ workspaceParam, access })`, plus `shouldQueryWorkspaceAccess`, the two `WorkspaceGate.svelte:36-37` actually uses, with tests that pin the states that remain: `current` by param, `loading`, `preview`, and `current` on error. The domain amendment for "on for everyone" is recorded here, right after the gate change merges.

## Acceptance
- AC1: `resolveWorkspaceExperience` is deleted from `src/lib/dashboard/workspaceExperience.ts` (`:22-31`) along with the doc-comment reference at `:39`; `resolveWorkspaceRouteState` takes `{ workspaceParam, access }` only; behaviour for `current` param, `loading`, `error` and `ready` is unchanged and pinned.
- AC2: `WorkspaceGate.svelte` no longer imports `dev` from `$app/environment` and passes no `localDevelopment`.
- AC3: `src/lib/dashboard/workspaceExperience.test.ts` drops the `resolveWorkspaceExperience` suite (`:8-36`), the localDevelopment cases (`:60`) and the agreement case (`:63-75`); the remaining `resolveWorkspaceRouteState` and `shouldQueryWorkspaceAccess` cases pass unchanged.
- AC4: Browser suites `WorkspaceGate.component.test.ts:100-204`, `workspaceRoutes.component.test.ts:58-64`, `:100-110`, `projectRoute.component.test.ts:54` no longer model an "internal user who is not flagged"; they keep the `?workspace=current`, loading, error and available cases and pass locally under `--no-file-parallelism`.
- AC5: `docs/product-domain.md` carries a dated 2026-09-03 amendment stating the preview workspace is on for every internal role, that `?workspace=current` remains the rollback surface, that the 2026-08-06 clause "the rollout gate (master switch AND per-user access, fail-closed) is reused unchanged" (`:763-766`) is superseded, that the 2026-08-11 admin short-circuit existed only in code comments and was never an amendment, and that the two rollout tables and the `appSettings` master row remain until a separate narrow decision.

## Verification
- AC1, AC3 → `npx vitest run src/lib/dashboard/workspaceExperience.test.ts`; `! rg -q 'resolveWorkspaceExperience' src/`.
- AC2 → `rg -n "environment|localDevelopment" src/lib/workspace/WorkspaceGate.svelte` empty; `npm run check`.
- AC4 → the component command in `verify`; record the pass count in evidence. Component tests are local-only; the gate proves AC1-AC3 and AC5.
- AC5 → `rg -n "2026-09-03" docs/product-domain.md`.
Behaviour pin: run `npx vitest run src/lib/dashboard/workspaceExperience.test.ts` before the change and keep every `resolveWorkspaceRouteState` case that does not pass `localDevelopment` byte-identical.

## Implementation notes
- `src/lib/dashboard/workspaceExperience.ts`: delete `resolveWorkspaceExperience` (`:22-31`); in `resolveWorkspaceRouteState` (`:46-56`) delete the `localDevelopment?: boolean` field and the `if (args.localDevelopment) return "preview";` line (`:52`). Update the doc comment (`:39` mentions the deleted function).
- `src/lib/workspace/WorkspaceGate.svelte:29` drop the import; `:77-80` drop the comment and the `localDevelopment: false` argument.
- Component tests: replace "available: false" fixtures with the `error` state where the test's purpose is the `current` fallback; delete cases whose only purpose was the allowlist.
- Amendment: follow `docs/product-domain.md:876-892` shape with fields Affected ticket/scope, Decision, Domain impact, Migration and compatibility, Authorization/test impact, Approval. Place it after the second 2026-09-01 block (`:1439` onward). Cite `:763-766` as superseded. Name `workspace-1` and this ticket as the affected scope.
- Do not touch `convex/`.

## Edge cases
- `access.status === "ready"` with `available: false` is still a valid input type (wire shape kept); the resolver keeps returning `current` for it. One unit case pins that so a future backend change fails loud.
- `?workspace=current` with an errored query: `current` (unchanged).
