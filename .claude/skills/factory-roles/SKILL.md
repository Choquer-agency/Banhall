---
name: factory-roles
description: "Show or change which CLI and model plays orchestrator, planner, implementer (per ticket kind), reviewer, lead, QA and verifier, including fallback chains, review panels and parallelism. Edits .factory/roles.toml and runs `factory doctor`. Use when the user says \"use codex for review\", \"put the planner on opus\", \"use sonnet for chores\", \"cheap model for intake\", \"add a fallback\", \"run two tickets at once\", or asks who runs what."
---

# factory-roles

1. Run `factory roles` (or `node <package>/bin/factory.mjs roles`) and show the resolved table: role · cli · model · knobs · fallback · per-kind overrides · panel.
2. If the user asked for a change, edit only the keys involved in `.factory/roles.toml`:
   - Valid `cli`: `claude`, `codex`, `shell` (with `cmd = "... {prompt} ..."`). Keep model strings as the user gave them.
   - `[orchestrator]` (intake routing, `factory go`): `cli`, `model`, `effort`/`reasoning`. Unset = the planner's. A fast model is fine; it reads tickets and classifies, it does not design.
   - `[implementer.kinds.<kind>]` where kind is `feature | bug | refactor | perf | chore`: overrides cli/model/effort for tickets of that kind. Fallback and permissions inherit from `[implementer]` unless set.
   - `fallback = [{ cli, model, effort|reasoning }]` is tried in order on a usage/rate limit.
   - `[reviewer].panel = [{...}, {...}]` for 2+ model families; `[lead]` judges the panel (defaults to the planner).
   - `[orchestrator].max_parallel` for tickets driven at once.
3. Run `factory doctor`. Show its output.
4. Say out loud when relevant:
   - The reviewer should be a different model family than the implementer; the engine does not enforce it.
   - The QA role runs with a hard tool allowlist (`allow = [...]`); add commands there, do not widen permission mode.
   - The planner, orchestrator and reviewer are read-only outside `.factory/` by construction.
   - `max_parallel > 1` only helps when tickets declare disjoint `touches`.
