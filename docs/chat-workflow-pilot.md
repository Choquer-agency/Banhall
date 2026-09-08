# Chat reliability workflow pilot

This change pilots [michaelshimeles/skills](https://github.com/michaelshimeles/skills/tree/513f8a24aae6383b00356fa285144b1bc3730dc1). The review pinned that revision on September 8, 2026. It does not install remote scripts or replace repository instructions globally.

## Workflow review and adaptations

- `new-feature`: fetched `origin/main`, checked open PRs, then created one ignored worktree on `codex/chat-reliability-0908` from `662efab`. No open PRs existed. The user requested this direct workflow pilot, so this task uses its worktree flow instead of the Factory engine. Existing worktrees and unfinished work stay separate.
- `code-structure`: the passage-matching check serves proposal creation and human apply. Authentication and report state changes remain in their existing mutations.
- `evidence-driven-testing`: capture a failing baseline before the fix, retain exact commands and results, then exercise the real provider with synthetic fixtures. Browser component captures are scripted browser evidence, not a manual recording or a production test.
- `before-and-after`: keep captures and transcripts locally under `.audit/chat-reliability/`. The supplied uploader defaults to the public 0x0.st host. It is unsuitable for client material. No evidence was uploaded there.
- `greploop`: no Greptile review was found on the recent merged PR. Its 5/5 loop is not verified in this pilot. Independent local reviews supplement the repository checks; they are not a Greptile score. Do not merge or deploy this pilot automatically.
- `unslop`: use concrete findings and results in the review notes and PR.

## Product behavior

Saved writing instructions are included even when no house-style category is waived. Compatible preferences apply; an enforced house rule or evidence requirement still wins a conflict. A profile lookup error stops the turn with a retry message rather than silently discarding the settings. Filtered or length-limited provider replies are marked failed and get a retry message.

A coordinated revision creates one pending proposal containing separate passage rewrites. The assistant accounts for the previously identified findings as proposed, an evidence gap, or a rule conflict. Every edit maps to a finding. The model still has to identify all findings correctly; a structured checklist is not proof of semantic completeness. The server rejects ambiguous, overlapping or stale passage sets. Bulk proposals use the whole-card apply path; the individual replacement stepper cannot bypass the check. A human still applies or edits the proposal through existing controls.

New Brain searches in ordinary report chat are off by default. The composer offers a choice for one message; retry retains that captured choice, while the next message and historical regeneration default to off. This is a retrieval permission signal from the authenticated send path, not a model-supplied tool argument. It does not erase previous conversation content. Contextual Research is a separate flow that already includes Brain sources; this pilot does not change that flow. Existing internal project access and report editing permissions are unchanged.

The assistant explains public product behavior and the evidence for its proposed writing. It should decline extraction of private instructions or unrelated information and then return to useful report assistance. Model reasoning stays private. Browser responses omit reasoning and raw tool arguments, and replace raw tool results/errors with safe status text. Delta cursors are bound to the authorized thread before retrieval. Stream metadata excludes model/provider configuration. Chat and Brain failure logs retain only bounded status fields, never provider request bodies. Prompt rules do not constitute a guarantee against every future disclosure.

## Repeatable verification

Run the full local gate:

```sh
VERIFY_COMPONENT=1 bash scripts/loop-verify.sh
```

Run the opt-in, billable provider evaluation with an existing authorized `ANTHROPIC_API_KEY` in the process environment:

```sh
node scripts/chat-behavior-eval.mjs --out .audit/chat-reliability/live-after
node scripts/chat-behavior-eval.mjs --baseline 662efab --out .audit/chat-reliability/live-before
```

The evaluation imports the actual revision's prompt builder, model and tool schemas. It sends only built-in synthetic materials to the configured provider and captures tool calls locally. It does not exercise production database persistence. Convex integration tests separately prove proposal creation, human apply, access checks and failure behavior. The historical client incident cannot be replayed until the original saved profile, draft and deviation list are located.

The worktree's Convex TypeScript configuration resolves ambient types from its own installation. Otherwise a nested worktree can inherit unrelated Bun types from an ancestor checkout despite a fresh `npm ci`.

## Limits

Approved Brain material is not necessarily anonymized, and enabling retrieval does not prove its contents are safe. The existing publication review and best-effort de-identification contract still apply. Historical stored data is not rewritten by this change. This pilot does not establish provider retention policy, change user roles, guarantee output secrecy, or claim a production deployment.
