---
name: factory-roles
description: Show or change which CLI and model plays orchestrator, planner, implementer, reviewer and QA, including fallback models and parallelism. Edits .factory/roles.toml and runs `factory doctor`. Use when the user says "use codex for review", "put the planner on opus", "add a fallback", "run two tickets at once", or asks who runs what.
---

# factory-roles

1. Print the current `.factory/roles.toml` as a table: role · cli · model · knobs · fallback.
2. If the user asked for a change, edit only the keys involved. Valid `cli` values: `claude`, `codex`, `shell` (with `cmd = "... {prompt} ..."`). Keep model strings as the user gave them. `fallback = [{ cli, model, effort|reasoning }]` is tried in order on a usage/rate limit.
3. Run `factory doctor` (or `node <package>/bin/factory.mjs doctor`). Show its output. If the engine is `bmad-loop`, also run `factory apply`.
4. Say out loud when relevant:
   - The reviewer should be a different model family than the implementer; the engine does not enforce it.
   - The QA role runs with a hard tool allowlist (`allow = [...]`); add commands there, do not widen permission mode.
   - The planner and reviewer are read-only outside `.factory/` by construction.
   - `max_parallel > 1` only helps when tickets declare disjoint `touches`.
