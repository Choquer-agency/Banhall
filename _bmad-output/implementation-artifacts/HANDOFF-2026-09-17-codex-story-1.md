# Handoff to Codex — Step-by-step seeds, story 1

Date: 2026-09-17. From: the Claude Code session that planned the feature and shipped story 0. Read this file top to bottom before doing anything.

## Where things are

- Repository: `/Users/johnnynguyen/Documents/Repos/Banhall` (GitHub `Choquer-agency/Banhall`). Default branch `main`.
- Planning branch `plan/step-by-step-seeds` (pushed): PRD, spine, spec, stories, domain amendment.
- Story 0 branch `feat/seeds-0-registry` (pushed, PR open against the planning branch): registry + barrier-fenced project erasure. Story 1 must build on it.
- Contract, in priority order:
  1. `_bmad-output/specs/spec-step-by-step-seeds/SPEC.md` (+ `glossary.md`, `state-machine.md`, `build-sequence.md`)
  2. `_bmad-output/planning-artifacts/architecture/architecture-Banhall-2026-09-16-step-by-step-seeds/ARCHITECTURE-SPINE.md` — ADs 31–45; story 1 owns AD-31 (reservation write), AD-32, AD-33, AD-40
  3. `_bmad-output/specs/spec-step-by-step-seeds/stories.yaml` — story `"1"`, including its `invoke_dev_with` note
  4. Owner decisions: `_bmad-output/planning-artifacts/prds/prd-Banhall-2026-09-16/DECISIONS-2026-09-17.md`
  5. Project rules: `AGENTS.md`, `convex/_generated/ai/guidelines.md`
- Story 0 spec (finished, with review order): `_bmad-output/specs/spec-step-by-step-seeds/stories/0-project-scoped-table-registry-and-erasure-guard.md`. Its registry (`convex/lib/projectScopedTables.ts`) is where story 1 registers the eleven seed tables.

## Story 1 in one paragraph

Widen-only schema and vocabulary work, no behaviour change for existing generations: create `shared/pdSubsections.ts` (13 roles with stable `roleId`s mapped one-to-one to the natural-language content roles in `convex/ai/prompts.ts:296/405/511` and `convex/ai/qaChecks.ts`, and make those builders import the list); add `generations.gatedWorkflow` written at reservation and `convex/lib/gatedWorkflow.ts` `resolveGatedWorkflow` (absent on an `iterative` generation resolves to `sections`); add the eleven seed tables and generation fields exactly as spine AD-33 lists them (all new fields optional), register them in the story-0 registry with disposition `delete`. Tests: `shared` bijection/order test, `convex/lib/gatedWorkflow.test.ts` (the four cases in AD-40), `convex/projectErasure.test.ts` extended so the seed tables are listed and purged.

## How to work

1. Isolate: create a worktree from the story-0 branch, e.g. `git worktree add ../Banhall-seeds-1 -b feat/seeds-1-vocabulary feat/seeds-0-registry`, then `npm ci` there. Run every command from that worktree.
2. Sweep the target code first (prompts.ts role lists, qaChecks.ts, schema.ts generations table, generations.ts reserveGeneration, projectScopedTables.ts) before writing; the plan was made against `main` at e5f2476 plus story 0.
3. Follow the story's `invoke_dev_with` and the spine ADs verbatim; where the spine and the code disagree, the spine's Conflicts and Deferred sections say what was decided. Do not change anything inside the PRD or spine; if a decision is missing, record the question in the story spec and stop.
4. Gate: `bash scripts/loop-verify.sh` must be green (it runs Convex typecheck, `npm run check`, `npm test`, discovery guard, build, uploader harnesses). Story 1 touches no `src/lib/components`, so the browser suite is not required.
5. Review: run the three bmad-build review layers (blind hunter, edge-case hunter, verification gap) as independent gpt-6-astra reviews at medium effort against the diff since the story's baseline commit, then triage: patch what is trivially fixable, record deferrals in the story spec (not in `_bmad-output/implementation-artifacts/deferred-work.md`, which the native orchestrator owns).
6. Write the story spec at `_bmad-output/specs/spec-step-by-step-seeds/stories/1-<slug>.md` in the same shape as story 0 (frontmatter with status and baseline_commit, frozen intent block, Code Map, tasks and acceptance, verification, suggested review order).
7. Commit locally with a conventional message ending in the attribution line your tool uses; push the branch and open a PR against `feat/seeds-0-registry` only when the gate is green. Never push to `main`; never merge.

## Known traps

- `convex/ai/*` files are `"use node"`; mutations never live there.
- `promptVersion` is a hash of the prompt program: changing prompt text (even to import the role list) moves it and `convex/ai/promptScaffolds.test.ts` asserts scaffolds verbatim; update the tests deliberately.
- Every new table carries `projectId` and `generationId` and must be in the registry or `projectErasure.test.ts` fails.
- Existing `iterative` generations without `gatedWorkflow` must keep working; the resolver returns `sections` for them.
- Seed tables are dark in story 1: no mutation writes them yet.

## Stories after this one

Story 2 (seed pipeline) depends on story 1 and needs the owner's spec checkpoint before implementation; stories 3 and 4 have both checkpoints. See `stories.yaml`.
