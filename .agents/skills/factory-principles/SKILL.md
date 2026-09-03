---
name: factory-principles
description: The engineering principles every factory role applies. Read once per session; name the principle behind each recorded decision (decisions.tsv `why`, review claims, plan rationale). One line each; the rule is the whole skill.
---

# factory-principles

Cite a principle only when it changed a decision. A citation with no decision behind it is noise.

## Core
1. **Laziness protocol.** Bias to deletion and the smallest change that solves the problem.
2. **Foundational thinking.** Get the data structures right first; downstream code becomes obvious.
3. **Redesign from first principles.** Integrate a new requirement as if it had been there from day one, not bolted on.
4. **Subtract before you add.** Remove dead weight, redundant validators and stubs first, then build on the simpler base.
5. **Minimize reader load.** Count layers between question and answer and hidden state in the reader's head; collapse one-caller wrappers; shrink mutable scope.
6. **Outcome-oriented execution.** Converge on the target architecture; no throwaway compatibility states.
7. **Experience first.** User delight over implementation convenience; fewer polished features over more rough ones.
8. **Exhaust the design space.** A novel decision gets 2–3 competing candidates compared side by side before committing.
9. **Build the lever.** Build the tool that does or proves it (codemod, script, generator, gate); the tool is the artifact a reviewer reruns.

## Architecture
10. **Model the domain.** Encode the domain in a structure (state machine, typed model, table, reducer, boundary) instead of scattered conditionals.
11. **Boundary discipline.** Guards at system boundaries (CLI, config, network, external APIs); trust internal types; keep business logic pure.
12. **Type system discipline.** Make illegal states unrepresentable; brand semantic primitives; parse external data at boundaries; never lie to the compiler.
13. **Make operations idempotent.** Converge to the same end state regardless of crashes, retries or partial prior runs.
14. **Migrate callers, then delete legacy APIs.** Same wave. No compatibility layers left behind.
15. **Separate before serializing shared state.** Eliminate the sharing first; a lock is the last resort, and only when one shared writer is a real invariant.

## Verification
16. **Prove it works.** Verify against the real artifact (run the feature, read the actual value, inspect the diff), not a proxy, a self-report, or "it compiles". Verdicts are `live-verified`, `test-verified`, `typecheck-only`, `unproven`. Inconclusive is not a pass.
17. **Fix root causes.** Reproduce first; ask why until the mechanism is in hand; no guard clauses that silence the symptom.
18. **Sequence work into verifiable units.** Small units that each end in a check; verify each before the next; order delivery so the sequence proves itself to a reviewer.
19. **Confidence ladder.** 1 you said so · 2 you pointed at `file:line` · 3 you walked the failure and it doesn't reach · 4 you ran it and it fails loud if wrong · 5 you reproduced it in the running app. Below 4, say "unproven". Never round up.

## Delegation
20. **Guard the context window.** Route bulk to subagents; keep summaries in the main thread.
21. **Never block on the human.** Proceed, present the result, let the human course-correct; reserve confirmation for irreversible actions (force-push, deploy, data deletion, customer messages).
22. **Safe means a verdict from an agent that did not write the code.** CI green is an input to a verdict, not a verdict. A new head SHA voids the old verdict.

## Meta
23. **Encode lessons in structure.** A recurring correction becomes a lint, gate, metadata flag, runtime check or script, not more prose.
24. **State the exit condition as a checkable predicate before the first iteration.** A duration is not a finish condition. A plateau is not a stop. Never relax the predicate to declare victory.
25. **Write it clean the first time.** Short declarative sentences, no filler, no AI vocabulary, no long dashes. Name who the work is for and what changes for them, then what the next maintainer inherits.
