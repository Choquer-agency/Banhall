---
title: 'Subsection vocabulary, workflow discriminator and seed tables'
type: 'feature'
created: '2026-09-18'
status: 'done'
baseline_commit: 'dafb4e8429b2df1c9c09a2a810acc775d574c5e8'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/HANDOFF-2026-09-17-codex-story-1.md'
  - '{project-root}/convex/_generated/ai/guidelines.md'
---

<frozen-after-approval reason="human-owned intent; changes require renegotiation">

## Intent

**Problem:** The seed feature needs stable subsection identities, an explicit workflow discriminator that preserves legacy generations, and project-scoped storage before its pipeline can be built.

**Approach:** Share the thirteen existing prompt and QA content roles through `PD_SUBSECTIONS`, record the gated workflow at reservation, provide the AD-40 resolver, and add the eleven AD-33 tables to the schema and erasure registry.

## Boundaries & Constraints

**Always:** Follow CAP-1/CAP-2 and AD-31 (reservation only), AD-32, AD-33 and AD-40. Widen existing records with optional fields. Preserve existing prompt content and legacy generation behavior. Every seed table carries project and generation ownership and is deleted with its project.

**Ask First:** A missing product decision must be recorded here before continuing. Do not amend the PRD or spine.

**Never:** Write seed rows from production mutations in this story; implement the seed pipeline, workspace or sign-off; backfill old generations; edit generated Convex files or the native deferred-work ledger; push to main or merge.

## I/O & Edge-Case Matrix

| Scenario | Expected behavior |
| --- | --- |
| Existing iterative row without discriminator, including awaiting input or completed | Resolver returns `sections` |
| Stored seeds discriminator before subsection initialization | Resolver returns `seeds` from the record |
| Non-gated generation without discriminator | Resolver does not infer a gated workflow |
| Prompt or QA builds a section's role instructions | Uses the shared roles in their canonical order |
| Project deletion with populated seed tables | All eleven tables are purged, unrelated project rows survive |
| Old stored generation without new fields | Remains schema-compatible |

</frozen-after-approval>

## Code Map

- `shared/pdSubsections.ts`: canonical role, section, order, kind, title and objective vocabulary.
- `convex/ai/prompts.ts`, `convex/ai/qaChecks.ts`: consume the vocabulary.
- `convex/lib/gatedWorkflow.ts`: runtime-free legacy resolver.
- `convex/generations.ts`: reservation discriminator.
- `convex/schema.ts`: eleven seed tables and optional generation fields.
- `convex/lib/projectScopedTables.ts`: delete dispositions and indexed project erasure.
- Shared vocabulary, workflow and project-erasure tests: contract coverage.

## Tasks & Acceptance

- [x] Establish the thirteen-role bijection and order in shared vocabulary and actual prompt/QA consumers.
- [x] Persist the workflow at reservation and verify legacy/default/stored resolution.
- [x] Add AD-33 tables, indexes and optional generation fields.
- [x] Register and prove populated seed-table erasure.
- [x] Pass the canonical gate and three independent Astra review layers.

## Verification

- Focused Vitest runs cover vocabulary consumers, resolver, reservation, schema and erasure.
- `bash scripts/loop-verify.sh` must pass before commit and publication.
- Independent `gpt-6-astra` medium reviews: blind hunter, edge-case hunter and verification gap, against the baseline above.
- No component files are in scope, so the optional browser suite is not required.

## Execution notes

The user-confirmed agent-tree workflow executes this handoff. The native BMAD launcher `_bmad/scripts/render_skill.py` is absent; this is not a native BMAD orchestrator run.

Compatibility interpretation reviewed independently by Astra medium: story 1 reserves iterative generations as `sections`, the workflow that still executes. AD-31 switches to `seeds` once the feature ships; writing `seeds` while executing the old pipeline would misclassify these rows when later guards deploy. A stored `seeds` reservation is covered independently by the resolver tests. Single and compare reservations have no gated workflow.

Widening means new fields on existing generations are optional. New tables use AD-33's required core fields and explicitly optional fields; required project ownership preserves indexed erasure. The new tables have no pre-existing rows to migrate.

## Suggested Review Order

1. Shared role vocabulary and its prompt/QA consumers.
2. Resolver, reservation write and compatibility tests.
3. Schema fields and indexes against AD-33.
4. Registry additions and populated erasure regression.
5. Verification evidence and independent review disposition.

## Verification results (2026-09-18)

`bash scripts/loop-verify.sh` passed all nine steps: Convex typecheck, Svelte checks (zero errors or warnings), 198 test files / 2,898 tests, discovery guard, production build, and both uploader harnesses. No dependencies or component files changed.

Three independent `gpt-6-astra` medium reviews completed against the baseline diff: blind hunter found no actionable findings, edge-case hunter returned an empty array, and verification-gap review found no gaps. An Astra medium review lead confirmed no actionable findings remain. The blind reviewer also verified that expanding the new prompt helpers reproduces both affected prompt files byte for byte. No deferrals were raised.

Local evidence remains in `.git-local-evidence/story1-verify.log`, the three `story1-*-review` reports, `story1-review-lead.md`, and `story1-review-manifest.json`. Every reviewed source and test hash matched after the full gate; only this factual completion record changed afterwards.

The schema stores `summaryVersions.readiness` as a boolean sign-off snapshot. Request dispatch metadata and feedback scoring fields belonging to later behavior slices remain for those slices; this story implements the AD-33 inventory and AD-39 event shape.
