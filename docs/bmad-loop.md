# BMAD story loop (bmad-loop)

Deterministic orchestrator: [bmad-code-org/bmad-loop](https://github.com/bmad-code-org/bmad-loop)
(v0.11.1, installed 2026-09-01 via `uv tool`). Python drives pick → dev → verify →
review → commit; LLMs only do the creative work in fresh tmux sessions.

Model split for this repo:

| Stage | Who | Why |
|---|---|---|
| PRD, spec, story breakdown, spec checkpoints | Claude Fable 5.1, interactive (`/bmad-spec`, `/bmad-create-prd`, …) | plans and approves tickets |
| Dev pass (`bmad-build-auto` plan + implement + inline review) | Claude Opus 5, `--effort medium` (was Codex `gpt-5.6-sol` until 2026-09-02; rate limits) | implements |
| Review pass (fresh-context `bmad-build-auto` on the done spec), sweep triage | Claude Fable 5.1 (`claude-fable-5-1`) | verifies |

`[review].trigger = "always"`, so every story gets the Fable review, and every
story in `stories.yaml` carries `spec_checkpoint: true`, so the run pauses after
planning for a human/Fable approval before Codex writes code.

## Pieces

| Piece | Where |
|---|---|
| Policy (per machine, gitignored) | `.bmad-loop/policy.toml`; template committed as `.bmad-loop/policy.example.toml` |
| Hook relay | `.bmad-loop/bmad_loop_hook.py`, registered in `.claude/settings.json` (committed) and `.codex/hooks.json` (gitignored, absolute path) |
| Verify gate | `scripts/loop-verify.sh` = convex tsc + `npm run check` + `npm test` |
| Skills for Codex | `.agents/skills/bmad-*` are symlinks to `.claude/skills/bmad-*` (Codex reads `.agents/`) |
| Spec kernel + companions | `_bmad-output/specs/spec-<slug>/SPEC.md`, `touchpoints.md`, `.memlog.md` |
| Story list (execution order) | `_bmad-output/specs/spec-<slug>/stories.yaml` |
| Per-story spec + result | `_bmad-output/specs/spec-<slug>/stories/<id>-*.md` (written by build-auto) |
| Run state, journal, ATTENTION | `.bmad-loop/runs/<run-id>/` (gitignored) |

## Spec folders

| Folder | State |
|---|---|
| `spec-ai-engine-sprint-1` | Stories 1–8, 13 shipped on `main` (`e3391ea`, `4ea1bb9`). Its `RETROSPECTIVE.md` describes the parallel run on branch `bmad-loop`, which is reference only (conflicts with `main` in 20 files). |
| `spec-ai-engine-sprint-1b` | Current loop target: the four still-open stories 9–12 (CAP-8, CAP-9a, CAP-9b, CAP-10). |
| `spec-ai-engine-sprint-2-boundary`, `spec-ai-engine-sprint-2-learn-chat` | Drafted on `bmad-loop` against pre-`4ea1bb9` code; reconcile against `main` before running (2A story 6 is already done by `requireReportEditAccess`). |

## Per-machine setup (once)

```bash
uv tool install "bmad-loop[tui] @ git+https://github.com/bmad-code-org/bmad-loop.git@v0.11.1"
cd Banhall
bmad-loop init --cli claude --cli codex     # hooks + skills; skips existing skill dirs
cp .bmad-loop/policy.example.toml .bmad-loop/policy.toml
codex     # accept workspace trust, then Hooks → "t" (trust all); /quit
claude    # accept trust; /exit
bmad-loop validate --spec _bmad-output/specs/spec-ai-engine-sprint-1b
```

## Run an epic

The tree must be clean (commit or stash first). Runs edit the checkout in
place (`[scm] isolation = "none"`); worktree isolation is off because a fresh
worktree has no `node_modules` and the verify gate would fail.

```bash
bmad-loop run --dry-run --spec _bmad-output/specs/spec-ai-engine-sprint-1b   # schedule only
bmad-loop run --spec _bmad-output/specs/spec-ai-engine-sprint-1b             # go
bmad-loop tui                                                                # watch; p = review a checkpoint, a = attach
bmad-loop status; bmad-loop resume <run-id>; bmad-loop resolve <run-id>
```

To run in a side checkout instead of this one: `git worktree add ../Banhall-loop -b loop/<slug> main`,
symlink `node_modules`, copy `.env.local`, `npx svelte-kit sync`, then re-run the
per-machine steps there (`.codex/hooks.json` embeds an absolute path).

## Gotchas

- `bmad-build-auto` renders through `uv run _bmad/scripts/render_skill.py`; `_bmad/render/` is gitignored.
- Codex trust and hook trust are per path; a new worktree needs the interactive first run again.
- Codex writes hook trust to `~/.codex/config.toml` only on a clean exit. After pressing `t`, quit with
  Ctrl-C twice and confirm `grep 'Banhall/.codex/hooks.json' ~/.codex/config.toml` shows `session_start`
  and `stop` entries. Untrusted hooks never fire, the events dir under `~/.local/state/bmad-loop/` stays
  empty, and every session waits out the 10-minute stall grace before the engine rescues it from disk.
- Engine stuck on a session that visibly finished: pipe a Stop payload through the relay with the
  session's `BMAD_LOOP_RUN_DIR`, `BMAD_LOOP_TASK_ID`, and `BMAD_LOOP_EVENTS_DIR` set (see `ps eww` on the
  CLI process); the engine picks it up within seconds.
- `npm run check` needs `PUBLIC_CONVEX_URL`; the verify script defaults it to a placeholder.
- Component tests (`npm run test:component`) are not in the verify gate; run them by hand before merging UI stories.
- The old Claude-Workflow orchestrator (`.claude/workflows/bmad-story-loop.js`) is superseded by this tool.
- Story hints (`invoke_dev_with`) must name symbols that exist; touchpoints must point at vitest-run files (see sprint 1 retrospective).
- The engine squashes every commit made after a dev session launched into that story's single
  commit, and the remote then rejects the push as non-fast-forward if one of those commits was
  already pushed. Commit and push only while the run is paused at a checkpoint or stopped;
  during a session, park edits outside the tree (scratchpad patch or `git stash push <file>`).
- Codex can block its own turn end with a modal (update prompt, "approaching rate limits, switch
  model?"). No Stop hook fires until it is dismissed. Answer it in the agent pane, then inject
  the Stop event by hand if the engine is still waiting.
