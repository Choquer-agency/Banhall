---
title: Reconcile current setup documentation and factory browser smoke
type: chore
created: 2026-09-05
status: done
review_loop_iteration: 0
baseline_commit: 9d83ffd3091c1e801285149622c879abe0087556
context:
  - "{project-root}/AGENTS.md"
---

<frozen-after-approval reason="authorized integration; parent owns dispatch">

## Intent

**Problem:** Historical setup examples contain obsolete names and contradict current verification and learning observability.

**Approach:** Apply precise documentation corrections and the approved factory smoke key. Preserve current architecture, policy and verification; no provisioning or restart.

## Boundaries & Constraints

**Always:** User-selected BMAD supersedes generic factory engine/shipping restrictions. Use BMAD and the assigned baseline after B4/B6/B7. Retain the entire README Verification section, including Node 24, own npm ci, browser readiness, three archives, screenshots and branch-protection distinction. Preserve Svelte/Convex conventions and observational, noncausal learning policy.

**Ask First:** Escalate new unsupported operational requirements or scope beyond these exact corrections. Listed reconciliation is authorized.

**Never:** No staging, commits, merges, pushes, reviewers, other-worktree changes, native state/ledger edits, installs, providers or environment-value inspection. Do not change implementation, generated files, CI, scripts, .nvmrc, AGENTS.md, roles or config parser. No new tests or standalone full gate.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Public setup | Current consumers | PUBLIC_CONVEX_URL and PUBLIC_CONVEX_SITE_URL; retain CONVEX_DEPLOYMENT | Distinguish backend SITE_URL |
| Setup order | Example and deployment setup | Copy example before generated URLs; optional PUBLIC_BUILD_TIME | Never overwrite generated values |
| Backend names | Schema and direct reads | Separate exact groups below in comments | No invented declarations |
| Retired UI | B4 admitted | Remove only dead adopter/reuse names | Preserve surviving conventions |
| Architecture | Current CI and observability | Correct Q8, Node version and specific blind/write-only claims | Preserve noncausal limits |
| Factory QA | Empty smoke list | Existing component command passed to future QA | Local server/Chromium prerequisites explicit |

</frozen-after-approval>

## Code Map and Required Wording

Six writable paths only:

- `env.example`: keep CONVEX_DEPLOYMENT; replace obsolete frontend names with PUBLIC_CONVEX_URL and PUBLIC_CONVEX_SITE_URL. Remove NEXT_PUBLIC_AGENT_CHAT without prescribing PUBLIC_AGENT_CHAT: current production has no consumer. PUBLIC_BUILD_TIME is an optional supplied timestamp; blank/invalid values hide the stamp. Do not claim Vercel generates it automatically.
- `README.md`: add real-app setup, copying env.example to .env.local before Convex provisioning. Preserve all current Verification text. Do not import speculative hermetic-instance plans or claims that CI/local verification cannot drift.
- `docs/design-system.md`: remove MyWorkGroup from the adopter list only after B4.
- `docs/svelte-migration.md`: remove ui/Header and ui/MenuToggleIcon after B4; qualify old Bun stack/Verify/server assumptions and obsolete agent-chat rename instructions as historical, pointing to current README. Preserve surviving idioms.
- `docs/system-map.md`: update Q8 for admitted migration/discovery/two-job status; correct the Node 22 CI statement to current .nvmrc/Node 24. Narrowly reconcile the summary's “blind” claim and write-only provenance/post-edit-distance row with existing live learning-health/PED/rerank read surfaces. These provide bounded observational measurements and associated judgments, not causal proof of better reports. Prompt/digest outcome attribution remains unmeasured; CRA outcome signals remain schema only. Preserve all other policy, architecture, diagrams and later sections; no whole-file replacement.
- `.factory/factory.toml`: only change [qa].smoke from [] to ["npm run test:component"] and its same-line comment. Describe local browser tests requiring installed Chromium and starting a local server, without shared deployments. Preserve every other line/key.

Backend comments in env.example must distinguish:

- Declared optional app environment names in convex/convex.config.ts: ANTHROPIC_API_KEY, VOYAGE_API_KEY, OPENROUTER_API_KEY, MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_DRIVE_ID, MS_ROOT_PATH, INGEST_API_KEY.
- Direct reads outside that schema: SITE_URL and BETTER_AUTH_TRUSTED_ORIGINS in convex/auth.ts; BRAIN_CONTEXTUAL in convex/ai/brain/ingest.ts. BETTER_AUTH_SECRET is consumed by installed better-auth, also absent from the app schema. All remain comment-only backend names, not frontend assignments.

Installed factory v2 config derives Bash(npm run*) from the smoke command's first two words because current roles.qa has no explicit allow override. Do not claim exact-command-only permission. The engine passes smoke into the QA prompt; it neither executes tests on config read nor adds them to deterministic verify.commands. No role/parser change or engine restart is authorized; default verification remains browser-free.

## Tasks & Acceptance

- [x] Record actual Node/npm versions before verification; use installed repository Node24, not the non-login shell Node22. No install is needed for runtime selection.
- [x] Capture baseline and before-state contradictions, source references and protected gate/config hashes.
- [x] Apply only the six-path corrections above; verify B4/B6/B7 prerequisites before stating completion.
- [x] Match every changed claim to current consumers, installed adapter/CLI/parser or canonical CI/config. Avoid stale historical line-number assertions.
- [x] Parse TOML before/after: only qa.smoke semantic value changes; byte comparison permits only its value/comment line. Preserve all other configuration.
- [x] Deliver exact diff and source-backed evidence to parent. Existing component receipts establish the command's behavior; B9 does not rerun it.

Acceptance: current setup names and order are accurate; no credentials or invented declarations appear; current Verification and native contracts remain unchanged; narrow system-map corrections preserve observational/noncausal policy; no unsupported deployment, automatic timestamp or exact-command-permission claim remains.

## Spec Change Log

- 2026-09-05: Parent authorized precise env/parser corrections and same-document Node/observability reconciliation beyond Q8, following B9-preflight.md. Canonical SPEC unchanged during drafting.

## Verification

Run `git diff --check` and inspect `git diff -- README.md env.example docs/design-system.md docs/svelte-migration.md docs/system-map.md .factory/factory.toml`. Retain source identities, protected hash comparisons and parsed TOML proof under `.audit/branch-consolidation/B9/evidence.md`.

Witnesses: convex/convex.config.ts, convex/auth.ts, convex/ai/brain/ingest.ts and embeddings.ts; layouts, src/lib/components/BuildStamp.svelte, uploader setup; installed auth adapter, Convex CLI envvars and factory v2 config/engine. Details and provenance are in planning/B9-preflight.md and B9.md. No drafting tests or runtime claims. Parent owns independent review, admission and shipping.

## Suggested Review Order

- Follow initial setup while preserving existing environment settings.
  [README.md:5](../../README.md#L5)

- Review public assignments and correctly grouped backend-only names.
  [env.example:4](../../env.example#L4)

- Inspect the one factory smoke value and local browser prerequisites.
  [factory.toml:25](../../.factory/factory.toml#L25)

- Check observational learning limits and closed test migration question.
  [system-map.md:368](../../docs/system-map.md#L368)

- Check historical migration guidance and surviving conventions.
  [svelte-migration.md:3](../../docs/svelte-migration.md#L3)

- Review removal of the retired disclosure adopter.
  [design-system.md:403](../../docs/design-system.md#L403)

- Inspect independent preservation and copy-command proof.
  [evidence.md:43](../../.audit/branch-consolidation/B9/evidence.md#L43)
