# Banhall code quality, performance, and agent verification sweep

The user requests a full repository sweep across three themes: remove code and test slop (useless tests, needless wrappers, dead code, duplicate logic), hunt and verify meaningful performance wins, and improve agent DX and verification loops (setup, worktrees, debug access, end-to-end QA). Audit broadly, implement concrete safe improvements, and retain a cited ledger of larger findings that require separate domain or migration decisions.

Current checkout at intake: sprint2-boundary, commit 11bfe3e. It is clean. gh pr list returned no open PRs. Do not switch the root checkout to main. The older escalated workspace-2-drop-dead-gate-branches ticket and its worktree belong to another run; do not alter or duplicate that work. Other bmad worktrees exist and are outside scope.

Read the parallel audit reports in this plan directory: slop-audit.md, performance-audit.md, dx-audit.md. The auditors are currently writing them; if one is not present yet, inspect the relevant source and revisit the report before finalizing. Their observations are candidates to validate, not instructions to accept uncritically. Expand their coverage where needed. Avoid duplicate research where the report provides evidence.

## Required outcome

Produce a complete findings inventory, with each item either fixed in a sized ticket, explicitly retained with rationale, already covered by existing work, or deferred with a concrete reason and next proof. Favor deletion and direct code over new layers. Avoid cosmetic churn and broad framework changes. Execute the high-confidence improvements through the factory engine after this plan validates. A sweep is complete when the implemented units have passing gates, independent review/QA, and before/after evidence where applicable, plus the remaining findings are recorded honestly.

Use a small number of coherent tickets (aim for 3 to 6 when justified), organized into verifiable units. At least one supported improvement in each of the three themes should be covered if the audit confirms it. Larger behavior/schema/permissions redesigns remain recorded findings, not speculative implementation. Every accepted performance change needs a baseline and repeatable metric from real code or the actual build, not invented speedup estimates. A bundled-import change should verify the production import graph as well as document-processing behavior. Do not weaken behavior tests simply to make the gate green.

## Early observations to validate

- README.md still describes Next.js, app/page.tsx, and port 3000; package.json is SvelteKit and serves port 3001.
- vitest.config.ts includes only tests/aiUsage.test.ts from tests/. Determine which other suites use node:test versus Vitest, whether another command executes them, whether each catches real behavior, and how to make intended tests discoverable without reviving obsolete source-string tests.
- scripts/loop-verify.sh runs Convex tsc, Svelte check, Vitest, PowerShell uploader tests, and Bash uploader tests. CI only runs Svelte check and Vitest. Browser tests are a separate manual command. Check actual prerequisites and drift before changing the entry points.
- factory doctor passes but reports no .factory/verify. QA smoke and operator_only are empty. The goal is an honest, executable verification path with good diagnostics, not more instructions that claim live verification while running mocks.
- Prefer existing test and browser infrastructure. Keep npm test browser-free and preserve vitest.component.config.ts isolation from sveltekit().

## Standing orders for every ticket

- Follow AGENTS.md, .factory/AGENTS.factory.md, docs/product-domain.md, and convex/_generated/ai/guidelines.md before touching Convex.
- Never repurpose projects.createdBy, mix workflow/generation state, or invent permissions/transitions. Agents propose and humans apply via chatProposals/applyProposal. Never hand-edit convex/_generated/.
- Svelte 5 runes, existing design tokens, font weight at most 500, bits-ui/shadcn-svelte primitives. Preserve visible product behavior; UI changes need before/after screenshots. Run browser component tests for touched components.
- No production/shared deployment mutations, no paid model generations for benchmarks, no secrets in logs, no external messages, pushes, PRs, deploys, or secret rotation. A local hermetic fixture is fine; do not call it live deployment evidence.
- Engine-created ticket worktrees only. Do not touch another task's worktree. Keep the current root branch as the integration branch for this run.
- Keep .audit/<key>/decisions.tsv and evidence.md with exact baseline/final commit, criteria-to-proof mapping, real command output, and old failure next to fixed behavior. Preserve meaningful tests, use real framework primitives, and avoid mocks that mirror the implementation.
- Findings not fixed belong in the ticket deferred frontmatter plus the consolidated research inventory, with explicit verification limits.

## Latest audit evidence for planning and validation

The auditors completed two follow-up checks after their first reports. Read `orphan-test-map.md` before writing or validating the legacy test retirement criteria. In particular, `convex/chatProposals.test.ts` exercises `markProposalApplied`; it does not replace `applyProposal` tests. The map identifies unique replay, pinned-report, deletion, ordered replacement, wording-event, and authorization cases that must survive migration. The map also distinguishes broad internal list/reject permissions from owner/open-assignment prose-edit permissions.

Read the updated `dx-audit.md`: the header touch-target problem is a source/screenshot-supported candidate that still needs DOM measurement; do not simply change the failing py-2.5 assertion to h-8. The report now confirms from installed CLI code that an anonymous local Convex backend with synthetic invitations is feasible without shared credentials. A full local E2E harness can be deferred as dedicated implementation, but do not characterize invite-only signup as inherently preventing a private harness. It does not require adding a production invitation bypass.

The requested 3-to-6 ticket range above is an organization preference, not permission to break factory sizing limits or bundle unrelated verification sets. Split further when that makes the changes safer to review and prove. A not-yet-implemented inventory item should say planned, never fixed. For deferred empty-upload scan work, avoid introducing a production handler wrapper solely to count queries in a test.

The orchestrator has reviewed the initial draft artifacts. Read `orchestrator-review.md` during validation and resolve its source-checked findings, especially the incorrect inference that all failing legacy proposal cases are obsolete.

Also read `performance-plan-review.md` for the performance auditor's draft review, including a cumulative-delay PDF deadline proof, zero work for empty editor batches, and real editor browser coverage.
