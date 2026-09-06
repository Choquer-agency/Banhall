# Banhall quality pass

Pre-ship evidence snapshot: eight reviewed units accepted at `390eb452ab840f3e6a2a16711f61d3c6ddb90c38`. The complete local gate passed, and the native BMAD API closed DW-103, DW-104 and DW-105. GitHub checks, push and merge are pending at this snapshot. Their subsequent receipts live in the local ignored `shipping/` directory and are linked from the final handoff.

The earlier committed-branch consolidation is on main through [PR 3](https://github.com/Choquer-agency/Banhall/pull/3). This follow-up selectively adapts useful remaining changes and fixes verified defects. It is not a new exhaustive cleanup or performance benchmark of the entire repository.

## Accepted changes

- Q1: protect storage objects referenced by another document, brain source or ingestion item; delete only unreferenced bytes.
- Q2: put browser verification captures under ignored `.vitest-attachments` so the ordinary gate no longer overwrites tracked audit images.
- Q3: copy an in-progress review as an interrupted failure with a destination event and an explicit explanation, preserving the source review.
- Q4: keep review feedback visible beside the comparison view.
- Q5: render score rows even when criterion labels collide.
- Q6: make the avatar Settings action navigate and report a navigation failure.
- Q7: bound original-file upload attempts and response parsing while preserving truthful saved-text fallback and retry behavior.
- Q8: repair the required auth peer dependency, apply bounded dependency upgrades, and verify real SDK, cookie, rendering and document-library boundaries.

Each unit has a separate conventional commit, BMAD SPEC, fresh Astra 6 medium implementation session, and three independent Astra 6 medium review lenses with structured triage. See `closeout/state.json`, the unit folders and each SPEC's Suggested Review Order.

## Verification and isolation

`VERIFY_COMPONENT=1 bash scripts/loop-verify.sh` passed from an empty canonical browser optimizer cache on Node 24.19.0 and npm 11.17.0: 2,077 unit tests, 522 browser component tests, type checks, test-discovery guard, production build and both uploader harnesses. The root wrapper compared all 6,870 tracked and nonignored paths before and after, plus the index fingerprint. No unexpected content changes, new paths or index changes occurred, and no capture restoration ran. This is content and index evidence, not a claim about all filesystem metadata or transient writes. See `final-gate/` and `runtime-audit/final-gate-review/`.

The owned checkout is `Banhall-quality-pass`, branch `codex/quality-pass`, based on main `ed79a296039109fe1a2bf5dd867f9e5af22f2967`. The 39 other worktrees retain their heads, statuses and all 22 existing dirty files. Read `runtime-audit/external-full-supplement.md` for the initial coalesced-directory limitation and historical hash proof for its three children. `external-pre-closeout.json` is the latest pre-ship comparison. All 83 other observed local/remote branch tips are ancestors of main at the fresh pre-ship audit; their names do not represent unmerged committed work.

The full installed dependency tree is valid and the captured npm audit fell from 11 reported affected entries to zero. The isolated production-only install satisfies React/Better Auth, but a full `npm ls --omit=dev` still reports existing Svelte peer gaps because this repository declares Svelte as a dev dependency. The supported frontend deployment installs the full build tree. Do not infer that every source-only production installation is valid. See `Q8/post-review-dependencies/evidence.md`.

## Evidence and decision trail

`closeout/decisions.tsv` and `closeout/state.json` are immutable pre-ship snapshots. The local root `decisions.tsv` and `state.json` remain ignored and continue recording shipping actions so those updates do not dirty committed files. `trail-audit/` records the independent configured gpt-5.6-sol cross-model review; the prior attribution correction distinguishes configured model evidence from an unverified served-model identity.

Each unit and the closeout have an `archive-manifest.json` with original/stored paths, byte counts and SHA-256 hashes. Large text evidence is committed as deterministic gzip. Use `gzip -dc <stored-path>` to recover the original bytes and verify the original hash. Raw siblings may exist only locally. Q8 also retains the actual observed built-client chunk tar archive; its optimizer cache is excluded. Private transcript contents are excluded; scope and hash receipts identify the private audit input.

Per-unit source hashes describe that unit's accepted bytes. Later reviewed units can change the same file. Historical failed attempts, incomplete intermediate receipts and subsequent corrections are preserved. `review-supersessions.json` explicitly resolves Q4's stale review field and the Q5/Q6/Q8 pending combined-gate conditions. `review-classifications.tsv` supplies the missing initial severity/category fields for Q3-Q5. The exact plugin that rewrote an early Q8 observer output was not established; final post-order observer hashes match the retained output. Ordinary CI has no new permanent filesystem mutation guard; that comparison belongs to the root audit wrapper.

## Ledger and runtime limits

Native closure provenance is in `native-closure-preflight/invocation.json`, `closure.json` and `finalization.json` (some files are archived as gzip). The installed public `mark_done_many` API ran once, changed only the three target status/resolution pairs and preserved the other 102 entries and surrounding text. Working and staged ledger bytes match its captured output. The earlier plan and usage documents are historical preparation, not the final closure result.

The ledger now contains 25 done and 80 older open entries. Those 80 were not retriaged in this pass; an old open status is not a newly proven current defect. No completed loop or paused heartbeat was restarted.

Frontend GitHub/Vercel success does not deploy or prove Convex functions and schema. See `deployment-boundary.md`. No live AI-provider call, authenticated user session, production storage operation or backend deployment is claimed by this pass. SDK tests exercise the actual SDK through a stubbed HTTP boundary, cookie tests call the real APIs, and built-chat checks cover module loading rather than authenticated mounting. Q4's existing cramped phone header/chat layout remains outside this focused feedback fix. Earlier Vercel preview failures lacked accessible logs; their cause is unproven.
