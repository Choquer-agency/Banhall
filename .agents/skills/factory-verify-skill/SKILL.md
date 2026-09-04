---
name: factory-verify-skill
description: "Verifier role. Generates (mode=create) or maintains (mode=maintain) the project's verification skill at .factory/verify/: Launch / Doctor / Drive / Evidence / Cleanup sections, helper scripts, and a feature map, then proves it by running it once end to end. QA uses it to reach live-verified without touching shared deployments. Runs from `factory verify-skill`."
---

# factory-verify-skill

Arguments: `mode=create|maintain target=.factory/verify config=.factory/factory.toml operator_only='<cmd && cmd>'`.

The skill you write is for the next agent, not a human: read cold, mid-task, by a QA session that has never seen the app and can run only the scripts you leave. It must be hermetic: its own instance, its own disposable data, no shared deployment, nothing in `operator_only`.

## mode=create
1. **Interview the repo.** Surface (web / CLI / TUI / desktop / API / mobile / library; pick the primary). Run (documented dev command, ports, env, seed, auth). Drive (existing harnesses first: Playwright, Cypress, expect, PTY, curl, a debug port; otherwise browser automation for web, tmux/PTY for CLI/TUI, HTTP for services). Observe (screenshots, transcripts, bodies, logs, exit codes, DB state). Isolate (a disposable data dir per `$RUN_ID`; refuse to double-drive a shared instance). A broken checkout is fixed or reported first.
2. **Write `target/SKILL.md`** with frontmatter `name: verify-<app>` and a description, then exactly these sections:
   - **Launch**: the exact command, readiness signal, teardown. Short-lived CLI: build once, each drive in its own PTY.
   - **Doctor**: one read-only check that answers "is this instance worth driving?" (`target/scripts/doctor.sh`, exit 0/1).
   - **Drive**: real selectors and commands; ARIA roles / data attributes / prompt strings / routes over coordinates or generated class names. Never set internal state, call hidden methods, write storage or inject DOM to create a state.
   - **Evidence**: exercise the real user path; capture the action and the resulting state, not only the final screen; verify side effects (files, rows, messages) with a read-only second view; app identity visible in every screenshot; CLI proof is command + stdout + stderr + exit code. Mocks only where a production boundary already isolates the external system. A dry-run or test mode is verified by observing what it skips, not by trusting its name.
   - **Cleanup**: kill what you started, never by process name; remove instances and scratch state, never the evidence.
   - **Helpers**: `target/scripts/{launch,doctor,drive,cleanup}.sh` (or `.mjs`), executable, invocation shown in the section that uses them. Scripts take `--out <dir>` and write evidence there.
3. **Feature map**: `target/features/README.md` (baseline preconditions, driving conventions, proof reporting rules) plus one file per top feature (3–5, from routes / commands / menus / docs) with exactly these H2s: `Sub-features`, `How to get to it (user POV)`, `Driving it with <harness>`, `Gotchas`. Each sub-feature: user action + exact command + observable result. The map is the repo's maintained verification source.
4. **Prove it.** Run your own instructions once end to end: launch, doctor, drive ONE mapped feature, capture evidence to `target/evidence/proof-<date>/`, cleanup. After cleanup confirm the evidence still exists. Fix what fails and rerun cleanup after every failed iteration. Never executed = draft, not a deliverable.
5. Add `target/evidence/` to `.gitignore` if not already ignored; commit the rest under `target/`.

## mode=maintain
The unit of rigor is the feature, not every sentence. Never edit product code: a behavior the map describes that the app no longer does is doc drift (fix the map) or a product regression (report it, keep it out of the map).
1. Index hygiene: every feature file is listed in `features/README.md` and vice versa.
2. Source wave: for each feature file, confirm its entry points still exist in the code (`rg` the routes/commands/selectors). Note likely drift with a concrete source path.
3. Live pass, required even when source looks clean: launch, doctor, drive each feature whose entry points changed since the last proof (all of them if unknown), capture evidence, cleanup, confirm evidence survived. Doctor before the first drive and after any failed drive; a wedged instance is relaunched, not hoped at.
4. Triage: doc drift → fix; harness gap → fix and re-drive; product gap → list under `## Product regressions` in `target/MAINTENANCE.md`, not in the map.
5. Outcome: `proven` (map and harness hold, corrections made and re-driven), `draft` (could not finish the live pass; say what blocked), `blocked` (a proven fix could not be made safely).

## Result
JSON matching `verify-skill-result.json`: `status: proven | draft | blocked`, `skill_path`, `features`, `proven_feature`, `evidence_path`, `summary` (what a QA session can now prove live, and what still needs an operator).

## Rules
- Nothing in `operator_only` runs, ever. If the app cannot be driven hermetically at all, return `blocked` and say precisely which dependency (credential, shared service) prevents it and how a fixture would remove it.
- Never record secrets, tokens, customer data or payment details in evidence.
