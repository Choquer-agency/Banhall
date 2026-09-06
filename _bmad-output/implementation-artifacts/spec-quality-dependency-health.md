---
title: 'Q8: Restore dependency security and peer health (DW104/105)'
type: 'chore'
created: '2026-09-05'
status: done
baseline_commit: e2cfb873b32586d1a620a75e1de61cc49d323eb3
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/convex/_generated/ai/guidelines.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Eleven package entries have advisories, and Better Auth lacks its required React peer. Builds succeeding under legacy peer handling do not resolve these findings.

**Approach:** Apply targeted security updates, align Tiptap, and satisfy peers without React adapters. Prove reproducibility and affected behavior.

## Boundaries & Constraints

**Always:** Work only in the assigned quality-pass checkout. Preserve `legacy-peer-deps=true`, Svelte/server authentication, application behavior, and domain policy. Root owns final canonical verification, dispatch baseline, and independent review. Do not attempt nested reviewer fan-out from the ephemeral implementation session.

**Ask First:** Return material API migrations or unavailable approved versions to root for a scope decision.

**Never:** Hand-edit lockfile package records, broadly refresh dependencies, use forced audit fixes, introduce peer exceptions, add React frontend code/React DOM, edit another worktree/native ledger, or commit/push/ship independently.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Session serialization | Valid session token and cookie options | Framework cookie serialize/parse roundtrip preserves value and attributes | Unexpected exception fails verification |
| Invalid cookie fields | Separately invalid name, path, domain | Actual resolved cookie serializer rejects each | Assert TypeError |
| Client bundle | Existing Svelte app plus compatibility React package | Emitted client modules contain no React runtime or adapter | Fail evidence check on occurrence |
| Existing consumers | Editor content, streamed markdown, SDK calls | Existing behavior and tests remain valid | Fix narrow compatibility defects or escalate |

</frozen-after-approval>

## Code Map

- `package.json`, `package-lock.json`, `.npmrc`: dependency ownership, generated resolution, unchanged peer setting; obsolete `.npmrc` explanatory comment may be corrected.
- `.audit/quality-pass/dependencies/report.md`, `parents.json`, `candidate-advisories.json`: investigated usage, incoming ranges, registry evidence; read before installation.
- `src/lib/tiptapConfig.ts`: direct core imports justify ownership.
- `src/lib/components/chat/primitives/MessageContent.svelte`: Streamdown markdown brings Mermaid/DOMPurify.
- `convex/ai/instrument.ts`, `providers.ts`: SDK message instrumentation.
- `vite.config.ts`: reuse through audit-only wrapper for module evidence.

## Tasks & Acceptance

**Execution:**
- [x] `package.json` -- use exact targets: React `19.2.8`, SDK `0.91.1`, Kit `2.70.3`; align every existing direct `@tiptap/*` plus newly direct `@tiptap/core` to `3.30.4`. Preserve unrelated ranges; persistent override `"@sveltejs/kit": { "cookie": "0.7.2" }`.
- [x] `package-lock.json` -- resolve through npm only. Target xmldom `0.8.15`, brace-expansion `5.0.9`, DOMPurify `3.4.13`, Mermaid `11.16.1`, nanoid `3.3.18`, PostCSS `8.5.23`, tar `7.5.21`. Avoid unrelated changes.
- [x] `.audit/quality-pass/Q8/` -- preserve read-only investigation inputs and capture before/after audit, exact changed-package table, install receipt, focused runtime checks and client module evidence. Use real dependencies in audit-only matrix assertions.

**Acceptance Criteria:**
- Given the updated manifest/lock, when installed cleanly, then audit reports zero advisory entries, the React peer is satisfied, and the editor graph is aligned.
- Given the resolved lockfile, when `npm ci` repeats, then bytes are preserved; every changed package has a dependency reason.

- [x] Review verification — add actual SDK structured-response tests, whole-peer/production-React checks, hostile rendering and document-consumer checks; preserve fixture failure evidence.
- [x] Verification setup — prebundle the demonstrated CommonJS browser export and document future dependency/cold-cache checks.

## Spec Change Log

## Design Notes

React is a production dependency because a development-only peer disappears under production omission. It has no dependencies. Kit latest still requests cookie `^0.6.0`; a Kit-scoped override avoids an unrelated prerelease migration.

For reproducible narrow resolution, edit the manifest, temporarily add exact overrides for the seven compatible transitive targets, and run `npm install --package-lock-only --ignore-scripts`. Remove temporary overrides, retaining only the Kit cookie override, then rerun that command. Confirm npm retains compatible selected versions and inspect the diff before `npm ci`. Unexpected reselection goes to root; temporary overrides must not survive acceptance.

## Verification

- `npm ci`; `npm audit --json`; `npm ls react @convex-dev/better-auth @tiptap/core @tiptap/pm` -- reproducible install, zero advisory entries, matching peer and aligned editor graph.
- Run unit suites for `tiptapConfig`, `docSearch`, `tiptapReport`, AI `instrument`, `providers`, and `pipeline.compare`; run relevant editor/chat browser suites and uploader harnesses. Read `.audit/quality-pass/plans/Q8-runtime-preflight.md`. Preserve and exercise the actual MessageContent Mermaid code fallback; heavy diagram rendering is opt-in and currently unused by this component. Exercise the upgraded Mermaid dependency separately in an audit-only opt-in fixture or direct runtime check, without enabling it in production. Do not claim an existing SVG feature or a proven exploit path.
- Resolve cookie from the installed Kit package location; exercise its real parse/serialize functions with session-shaped values, expected attributes and independently invalid name/path/domain inputs. Pair with available session integration coverage; mocked auth is insufficient.
- Perform an audit-only Vite wrapper build that reuses existing configuration and adds a `generateBundle` observer. Record client chunk module IDs and rendered lengths, excluding SSR output. Assert nonempty client evidence and no rendered React runtime/React adapter modules; save output hashes binding evidence to that build. Minified string search alone is insufficient; remove temporary configuration.
- Root runs the complete canonical gate after Q8 focused checks; implementation does not claim final verification ownership.

## Suggested Review Order

- Inspect targeted versions and aligned editor ownership.
  [package.json:21](../../package.json#L21)

- Keep the narrow Kit cookie compatibility override.
  [package.json:86](../../package.json#L86)

- Verify real SDK serialization, structured decoding and scheduled usage.
  [structured.sdk.test.ts:45](../../convex/ai/structured.sdk.test.ts#L45)

- Convert the real CommonJS browser dependency before tests load.
  [vitest.component.config.ts:61](../../vitest.component.config.ts#L61)

- Keep future dependency changes verifiable from a clean environment.
  [AGENTS.md:46](../../AGENTS.md#L46)
