# Banhall AI architecture plan

**Status:** Active reference  
**Created:** 2026-08-17  
**Last updated:** 2026-08-17  
**Basis:** Repository audit, Claude Code Fable 5 review, Codex adversarial review, Pi test audit, Anthropic agent/context/tool guidance, OWASP LLM risks, NIST AI RMF Generative AI Profile, and Convex scheduling guidance.

## Executive summary

Banhall should remain a deterministic, Convex-based workflow system with narrowly scoped AI agents. It does **not** need a generic autonomous-agent framework or a supervisor swarm.

The target architecture is:

```text
Trusted, bounded context
→ evidence-readiness assessment
→ targeted clarification when materially necessary
→ visible drafting plan and human review
→ specialized drafting/research agents
→ deterministic validation and narrow proposals
→ human-authorized application
→ typed learning signals
→ candidate learning rules
→ evaluation and privacy review
→ explicit human publication
→ provenance, monitoring, and rollback
```

Core invariant:

> Agents may gather context, analyze, draft, evaluate, and propose learning. Agents may not independently activate firm-wide learning, change workflow authority, or treat abandoned content as approved knowledge.

---

## Current strengths to preserve

- Frozen generation inputs with hashes and truncation metadata.
- Specialized analyzer, section writer, QA, chronology, and research passes.
- Durable parallel research with independent providers and graceful partial failure.
- Narrow chat tools that create proposals instead of directly editing reports.
- Authorization rechecks and pre-edit snapshots when applying proposals.
- Governed Brain approval, revocation, retrieval, weighting, provenance, and audit controls.
- Personal writer instructions separated from firm-wide knowledge.
- Human selection of blind generation candidates.
- Provider usage instrumentation and bounded structured-output repair.
- Iterative section drafting with human approval between dependent sections.

Do not replace these with a more autonomous multi-agent system.

---

## Completed foundation — 2026-08-17

### Governed behavioral learning

Implemented an append-only publication layer for `learningDigests`:

- Automatic jobs create immutable candidates.
- Only administrators with `settings.configure` may publish global guidance.
- Administrators can explicitly disable guidance.
- Publishing an older candidate provides rollback.
- Publication history records actor, reason, timestamp, and previous selection.
- Personal digests cannot be published globally.
- The first post-deployment candidate freezes the previous production choice before insertion.
- Candidate freshness is separate from publication, preventing repeated distillation calls.
- Candidate saves are transactionally deduplicated by feedback cutoff.

Primary files:

- `convex/schema.ts`
- `convex/learning.ts`
- `convex/ai/learning.ts`
- `convex/learning.test.ts`
- `src/routes/admin/reviews/+page.svelte`
- `docs/product-domain.md`

### Learning prompt hardening

- Feedback and edit events are explicitly framed as untrusted data.
- Embedded directives must be ignored.
- Generated rules are normalized, stripped of control characters, limited to 300 characters, and capped at ten rules.

### Brain late-completion fence

- Only approved Brain sources are eligible for embedding.
- Embedding completion rechecks the source state.
- Late vectors are deleted when the source was revoked or removed while embedding was in flight.

Primary files:

- `convex/brain.ts`
- `convex/ai/brain/rag.ts`

### Verification completed

- 37 Convex test files passed.
- 342 tests passed.
- Convex TypeScript check passed.
- Svelte check passed with zero errors and zero warnings.
- Svelte autofixer reported no issues.
- Targeted diff whitespace check passed.

---

## Roadmap

## Phase 1 — Finish Brain reconciliation and revocation guarantees

**Priority:** P0  
**Goal:** Make “revoke” operationally equivalent to verified removal, including transient failures and historical inconsistencies.

### Work

1. Add a version or content hash to every embedding job.
2. Include expected source status and version in job completion handling.
3. Reject and delete stale completions.
4. Replace at-most-once deletion-only behavior with a durable reconciliation path.
5. Delete by stable RAG key where possible so all replaced versions are removed.
6. Clear or mark `ragEntryId` only after confirmed deletion.
7. Record completed erasure separately from revocation intent.
8. Add a bounded reconciliation sweep for:
   - approved sources missing vectors;
   - revoked sources still carrying vector references;
   - orphan vectors with missing source rows;
   - failed or stale embedding jobs.
9. Add operational visibility for pending, failed, and completed reconciliation.

### Required tests

- Revoke before embedding starts.
- Revoke during embedding.
- Embedding completes before revoke.
- Embedding completes after revoke.
- Source is permanently removed while embedding is in flight.
- Delete action fails transiently and later reconciliation succeeds.
- Re-embedding replaces an older version without leaving it retrievable.
- Revoked or missing source rows are never returned by retrieval.

### Exit criteria

- A revoked source cannot be returned after the governance mutation commits and the bounded read-time fence runs.
- Reconciliation eventually removes every stale/orphan entry.
- Admin audit distinguishes requested revocation from confirmed erasure.

---

## Phase 2 — Trusted context and prompt-injection isolation

**Priority:** P0  
**Goal:** Treat all project documents, reports, research, feedback, and agent messages as untrusted data rather than policy.

### Work

1. Create one trusted-context module shared by chat, generation, and research.
2. Define explicit context classes:
   - system policy;
   - project evidence;
   - canonical report state;
   - approved Brain exemplars;
   - personal writer preferences;
   - firm-wide published learning;
   - external research.
3. Keep client-authored content out of the policy/system block where provider APIs allow it.
4. Add clear data delimiters and provenance labels.
5. Select project documents by relevance instead of loading every document.
6. Enforce per-source and total context budgets.
7. Preserve canonical revision identifiers for report text.
8. Treat agent-to-agent messages as untrusted unless validated against a typed contract.
9. Add a bounded Brain retrieval authorization fence after vector search.

### Suggested module interface

```text
buildTrustedContext(request)
→ policy
→ evidence blocks with source ids and trust labels
→ token/truncation report
→ canonical revision
→ warnings/degraded state
```

### Required tests

- Instructions embedded in uploaded documents.
- Instructions embedded in report text.
- Instructions embedded in research results.
- Instructions embedded in feedback comments.
- Agent-to-agent poisoning.
- Cross-project and cross-user leakage.
- Brain search requested implicitly versus explicitly.
- Context-budget truncation preserves the most relevant evidence.

### Exit criteria

- No untrusted document is granted policy authority by message placement.
- Context selection is bounded, explainable, and provenance-aware.
- Injection attempts cannot gain additional tool authority.

---

## Phase 3 — Evidence readiness, clarification, and plan review

**Priority:** P1  
**Goal:** Improve report quality by resolving material evidence gaps before expensive drafting.

### Work

1. Add a structured evidence-readiness assessment after input freezing.
2. Classify gaps as:
   - safe to draft with an explicit `[GAP]`;
   - resolvable from existing project evidence;
   - requiring one targeted consultant question;
   - blocking a defensible claim.
3. Rank questions by expected impact and ask only the highest-value unresolved question at a time.
4. Produce a visible section evidence map:
   - proposed technological uncertainty;
   - evidence assigned to sections 242, 244, and 246;
   - chronology and experiments;
   - assumptions;
   - unresolved gaps;
   - prohibited or unsupported claims.
5. Let the consultant approve or revise the plan.
6. Draft only after approval or an explicit “continue with gaps” decision.
7. Keep mandatory clarification risk-based rather than requiring questions for every project.

### Suggested domain-aware tools

- `assess_evidence_readiness`
- `find_project_evidence`
- `rank_missing_information`
- `prepare_section_plan`
- `confirm_drafting_plan`
- `propose_report_edit`

Avoid generic CRUD tools.

### Exit criteria

- Material eligibility, uncertainty, chronology, and outcome gaps pause drafting.
- Consultants can see what evidence supports each planned section.
- Low-risk, well-grounded work remains fast.

---

## Phase 4 — Learning-signal ledger and exact provenance

**Priority:** P1  
**Goal:** Make every learning candidate traceable to typed, authorized, privacy-aware signals.

### Work

1. Add an append-only typed learning-signal ledger.
2. Initially support:
   - `section_edit`;
   - `proposal_wording_edit`;
   - `qa_vote`;
   - `qa_severity_override`;
   - `candidate_score`;
   - `candidate_selected`;
   - `research_rating`;
   - explicit human correction.
3. Record:
   - actor and scope;
   - project/report/branch/revision;
   - event type;
   - timestamp;
   - consent/eligibility flags;
   - de-identification status;
   - retention class;
   - content hash or exact source reference.
4. Do not copy abandoned report prose into global learning candidates.
5. Keep production outcomes as signals only until exact branch, revision, promotion, and outcome relationships exist.
6. Require diversity thresholds for firm-wide rules across multiple writers and projects.
7. Record exact signal ids on every candidate.
8. Record the selected learning version on every generation.

### Exit criteria

- Every published rule can be traced to exact source signals.
- Removing an ineligible signal identifies affected candidates and generations.
- Firm-wide learning cannot be based on one writer or one project unless explicitly approved as an exception.

---

## Phase 5 — Evaluator and privacy/adversarial agents in shadow mode

**Priority:** P1  
**Goal:** Use specialized agents to review learning without giving them activation authority.

### Roles

1. **Candidate extractor**
   - proposes recurring patterns;
   - cites supporting signal ids;
   - reports disagreement and counterexamples.

2. **Quality evaluator**
   - checks recurrence, specificity, actionability, and conflict with CRA rules;
   - compares against known-good historical cases.

3. **Privacy/adversarial reviewer**
   - checks client identifiers, confidential facts, prompt injection, poisoning, cross-user leakage, and excessive scope.

4. **Human administrator**
   - is the only actor allowed to publish firm-wide guidance.

### Rules

- Agents produce candidates and evaluations only.
- Shadow-mode outputs have no runtime effect.
- Agent-to-agent payloads use typed schemas and contain no implicit authority.
- Conflicting evaluator results are shown, not silently averaged away.

### Exit criteria

- Candidate extraction can run safely with zero production influence.
- Privacy and poisoning failures block publication.
- Admins see evidence, counterevidence, and evaluator rationale before publication.

---

## Phase 6 — Personal memory before broader global learning

**Priority:** P1/P2  
**Goal:** Deliver useful personalization with a smaller blast radius.

### Work

1. Keep explicit writer profiles as the initial personal-memory mechanism.
2. Add writer-scoped candidate rules derived only from that writer’s eligible signals.
3. Require writer approval before activating personal candidates.
4. Provide enable, disable, edit, and delete controls.
5. Never publish a personal digest globally.
6. Ensure personal memory cannot override:
   - CRA structural requirements;
   - deterministic scoring;
   - evidence requirements;
   - length constraints;
   - firm-wide safety rules.
7. Add export and deletion support for personal memory.

### Exit criteria

- Personal preferences are transparent and user-controlled.
- No personal signal leaks to another writer.
- Global prompts remain unchanged by personal learning.

---

## Phase 7 — Evaluation and regression harness

**Priority:** P1  
**Goal:** Measure whether changes improve reports without weakening grounding, privacy, or safety.

### Build a frozen case bank

Start with 30–50 de-identified historical cases containing:

- transcript and eligible documents;
- known material gaps;
- expected evidence boundaries;
- prohibited claims;
- expert scoring rubric;
- expected and forbidden tool classes;
- approved final revision where legally and operationally eligible.

### Compare configurations

- baseline;
- clarification and plan review;
- Brain enabled versus disabled;
- published learning enabled versus disabled;
- personal memory enabled versus disabled;
- provider/model changes;
- retrieval/reranking changes.

### Metrics

Do not optimize only for edit distance.

Track:

- professional quality score;
- evidence grounding and unsupported-claim rate;
- CRA structure and terminology compliance;
- chronology consistency;
- human correction effort;
- post-edit distance;
- candidate selection rate;
- retrieval usefulness and source diversity;
- prompt-injection success rate;
- cross-client leakage rate;
- tool-choice correctness;
- latency, tokens, and cost;
- provider/reranker degraded-mode rate.

### Test infrastructure cleanup

- Ensure the default test command discovers intended root/shared tests or provide explicit documented projects.
- Add live/model behavioral evaluations separately from deterministic state tests.
- Keep deterministic mutation and authorization tests as the fast gate.

### Exit criteria

- Prompt, provider, Brain, and learning changes receive regression results before production publication.
- Safety and leakage metrics are release blockers.
- Historical quality improvement is statistically and professionally meaningful.

---

## Phase 8 — Provider privacy and operational policy

**Priority:** P1/P2  
**Goal:** Make provider privacy and fallback behavior auditable from the application and deployment configuration.

### Work

1. Establish a provider-policy module.
2. Document and enforce where supported:
   - allowed providers;
   - retention and training policy;
   - zero-data-retention requirements;
   - fallback routing;
   - region restrictions;
   - capabilities allowed per data class.
3. Verify OpenRouter and downstream provider account settings.
4. Surface effective privacy/readiness status to administrators.
5. Record provider policy/version with usage events.
6. Add spend limits, rate monitoring, and degradation alerts.
7. Track reranker fallback as an operational quality metric.

### Exit criteria

- The repository/deployment can demonstrate the effective privacy posture.
- Sensitive context cannot silently route to an unapproved provider.
- Provider fallback is explicit and observable.

---

## Phase 9 — Authorization and domain-interface hardening

**Priority:** P1/P2

### Work

1. Centralize report-edit capability checks.
2. Reconcile `requireInternalProjectAccess` with the stronger nullable access helper.
3. Ensure final downstream mutations, not just the agent/tool layer, enforce write authority.
4. Distinguish project visibility from report-edit permission.
5. Make proposal lifecycle state evidence-backed:
   - proposal created;
   - proposal accepted;
   - exact revision applied;
   - stale or rejected.
6. Validate optional report/project relationships on Brain feedback submissions.
7. Keep ownership, workflow, branch, promotion, delivery, and outcomes deterministic.

### Exit criteria

- Every consequential write is authorized at the final mutation boundary.
- Audit records identify the exact resulting revision or transition.

---

## Explicit non-goals

Do not:

- introduce a generic autonomous supervisor agent;
- give models broad database CRUD tools;
- let an agent activate learning;
- automatically ingest high-scoring or abandoned report content;
- merge personal preferences, project evidence, and firm-wide knowledge;
- infer production outcomes from export or generation events;
- permit research or document text to grant tool authority;
- optimize only for model preference or post-edit distance;
- add a new agent/memory framework unless Convex can no longer support a concrete requirement.

---

## Recommended implementation order

1. Brain durable reconciliation and read-time governance fence.
2. Trusted-context module and prompt-injection tests.
3. Evidence readiness, clarification, and visible plan approval.
4. Typed learning-signal ledger and exact generation provenance.
5. Shadow extractor/evaluator/privacy agents.
6. Writer-approved personal learning.
7. Frozen historical evaluation harness.
8. Provider privacy enforcement and monitoring.
9. Authorization/interface cleanup.
10. Only then consider broader firm-wide learning automation, while retaining human publication.

---

## Key source files

### Product contracts

- `docs/product-domain.md`
- `docs/the-brain.md`

### Learning

- `convex/learning.ts`
- `convex/ai/learning.ts`
- `convex/learning.test.ts`
- `convex/writerProfiles.ts`
- `convex/schema.ts`
- `src/routes/admin/reviews/+page.svelte`

### Brain

- `convex/brain.ts`
- `convex/ai/brain/ingest.ts`
- `convex/ai/brain/rag.ts`
- `convex/ai/brain/retrieve.ts`
- `convex/ai/brainRetrieval.ts`

### Generation and context

- `convex/generations.ts`
- `convex/ai/pipeline.ts`
- `convex/ai/iterative.ts`
- `convex/ai/analyzerAgent.ts`
- `convex/ai/postQa.ts`

### Chat and tools

- `convex/ai/chatAgentV2.ts`
- `convex/chatV2.ts`

### Research

- `convex/ai/research/workflow.ts`
- `convex/ai/research/actions.ts`

### Provider and observability

- `convex/ai/instrument.ts`
- `convex/ai/openrouter.ts`
- `convex/lib/providerConfig.ts`

---

## Authoritative references

- Anthropic, *Building Effective Agents*: https://www.anthropic.com/engineering/building-effective-agents
- Anthropic, *Effective Context Engineering for AI Agents*: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Anthropic, *Writing Tools for Agents*: https://www.anthropic.com/engineering/writing-tools-for-agents
- OWASP, *LLM01 Prompt Injection*: https://genai.owasp.org/llmrisk/llm01-prompt-injection/
- OWASP, *LLM06 Excessive Agency*: https://genai.owasp.org/llmrisk/llm062025-excessive-agency/
- NIST AI 600-1, *AI RMF Generative AI Profile*: https://doi.org/10.6028/NIST.AI.600-1
- Convex scheduled functions: https://docs.convex.dev/scheduling/scheduled-functions

---

## Quick reference checklist

When changing Banhall AI behavior, verify:

- [ ] Context is bounded, relevant, and trust-labelled.
- [ ] Client/report/research content is treated as untrusted data.
- [ ] The model has only the minimum necessary tools.
- [ ] Consequential writes require deterministic authorization and human approval.
- [ ] Learning creates candidates, not automatic production changes.
- [ ] The change records exact prompt, Brain, learning, provider, and source provenance.
- [ ] There is a disable or rollback path.
- [ ] Personal, project, and firm-wide context remain isolated.
- [ ] Abandoned report content is excluded.
- [ ] Prompt-injection and cross-user leakage tests exist.
- [ ] A frozen evaluation set is run before publishing behavioral changes.
- [ ] Provider retention and routing policy is known and auditable.
