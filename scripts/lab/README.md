# Banhall lab

A private copy of the app on this machine that a coding agent (Claude Code, Codex) or a person in a terminal can drive. It starts empty: no client data is copied. Only the two AI keys are read from a cloud deployment, and they are never printed.

## Connect an agent

Through MCP:

```
claude mcp add banhall-lab -- node <repo>/scripts/lab/mcp.mjs
codex mcp add banhall-lab -- node <repo>/scripts/lab/mcp.mjs
```

Or through the terminal: `node scripts/lab/lab.mjs <command>`. The MCP tools run the same commands.

## Commands

| Command | What it does |
|---|---|
| `up [--target REF] [--port 5190] [--cap 10]` | Makes a worktree of this checkout, starts a blank local backend, copies the AI keys, makes three logins (admin, manager, writer) and serves the app. Takes a few minutes. |
| `status` | The URL, logins and passwords, the spend and the cap. |
| `down` | Stops everything and deletes the lab. |
| `cap <usd>` | Changes the spend cap. |
| `spend` | AI spend so far, by step and model. |
| `run <fn> [json] [--as role]` | Any Convex function, as one of the logins. Without `--as` it runs as the CLI, which can call internal functions. |
| `query "<code>"` | A read-only query, such as `return await ctx.db.query('projects').take(5)`. |
| `project --source FILE --title T [--client C]` | A new evaluation project from a text file. |
| `draft <projectId> [--mode single\|compare\|iterative] [--web-background on\|off]` | Starts a draft and waits for it. |
| `wait <projectId>` | Waits for the latest draft. |
| `report <projectId>` | The latest report text. |
| `chat <projectId> "<message>" [--as role]` | Sends a message to the Assistant and waits for the reply and its cards. |
| `export-check <projectId>` | Whether the report may be exported, and why not. When it may, this records an authorized export on the lab, as the app's Export does. |

## The Assistant test set

`node scripts/lab/assistant-suite.mjs` (MCP: `lab_assistant_suite`) makes a fictional project, drafts it once, then runs the report Assistant through the cases the firm raised: a template change and a one-sentence paragraph the writer may approve, a banned word asked about once, a bullet list refused, a paragraph added and two merged, a made-up figure refused, a house rule only a manager may approve, and export refused over a CRA limit. Each check reads what the app stored (the cards, their rules and the report). It writes a pass/fail report with every reply, and exits non-zero when a case fails. About $2 to $3 a run; `--only a,b` runs some cases.

## Rules it keeps

- **Local only.** Every command checks that it is talking to the local backend inside the lab folder.
- **Fictional data only.** Never paste client text into a lab project. Lab projects are named "Release eval - ..." and marked as evaluation projects, so they never feed learning, writer memory or the Brain.
- **Spend cap.** The default cap is $10. `draft`, `chat` and `run` with a function that starts model work refuse to start within 10 percent (at least $0.50) of the cap. While `draft` or `wait` watches a Step by step draft, it cancels the draft at that point. A Single or Compare draft cannot be stopped once started: it runs to the end, so leave room under the cap for one. `--no-wait` starts a draft without watching it. A Single draft costs about $0.50 to $1.20, a Compare pair about $1.25, and an Assistant message about $0.05 to $0.25.
- **Committed code only.** The lab runs the code committed at `--target`; uncommitted changes are not in it.
- **What it can't show.** The Brain is empty, so drafts get no Brain examples. Drafts may read slightly differently from the live app, where the Brain holds the firm's PDs.
