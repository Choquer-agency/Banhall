# Report chat live browser test (opt-in, billable)

`node scripts/chat-live/run.mjs --project <projectId>` drives the real report chat in a headless Chromium against the app on localhost, backed by an isolated local Convex backend. It never writes to the source deployment.

## What it does
1. **Snapshot.** It reads a snapshot of the source deployment, which is the one this checkout's `.env.local` points at, with `npx convex export`. Every Convex command it runs leaves out the Convex deployment values of your shell (such as `CONVEX_DEPLOYMENT` or a deploy key), so an exported value can neither change the source nor get around the production check. A `prod:` source is refused unless you pass `--allow-prod-source`. You can pass your own snapshot with `--snapshot <zip>`.
2. **Worktree.** It creates a temporary git worktree. For the same reason, the worktree's own local deployment is the only one its commands can reach. It also refuses a local backend that keeps its data outside the worktree, as older Convex CLIs did, because cleanup could not delete it.
3. **Import and push.** It starts a local backend on `--base`, imports the snapshot, then pushes `--target`. Starting on a base commit avoids table-number clashes when the target adds tables the snapshot does not have.
4. **Keys and auth.** It copies `ANTHROPIC_API_KEY` and `OPENROUTER_API_KEY` from the source without printing them. It sets local auth values (`SITE_URL`, a random `BETTER_AUTH_SECRET`, trusted origins) and empties the imported auth signing keys, which were encrypted with the source's secret.
5. **Restart.** It restarts the local backend, because a local backend's Node actions (web search, PDF page counts) only see environment values that were set before they first ran. It then makes one real web search through the Node action and stops if the key did not arrive.
6. **Test account.** It creates a throwaway admin account through the app's own invite and sign-up path.
7. **App.** It starts the app on `--port` (default 5180, never 3001).
8. **Scenarios.** It opens the report and the Assistant until the dev server has bundled what they need, so no scenario sees the dev-only 504 "Outdated Optimize Dep" error. It then runs the browser scenarios in `scenarios.mjs`, each in its own page and, where a reply is involved, its own conversation, and writes a JSON report. A console error fails a scenario.
9. **Serve (optional).** With `--serve` the app stays up after the scenarios so a person can try it. The test login, an admin, goes to `login.txt` in the private folder, never to the output. It stops on Ctrl-C or a SIGTERM, or by itself after `--serve-hours`, then cleans up.
10. **Cleanup.** It always stops everything and deletes the worktree and every copy of the snapshot, screenshots and credentials, including when the run fails or is interrupted (Ctrl-C). An interrupted or crashed run finishes deleting before it exits. If a deletion fails, it says which folder to delete by hand. Secrets never appear in its output: a failed key copy reports only which key failed. With `--keep-artifacts` it keeps the screenshots and report and prints where they are. They contain client data, so delete them when you are done.

## Options
- `--project <id>` (required): a project from the snapshot with a report to work on.
- `--target <ref>`: the code to test. Default `HEAD`.
- `--base <ref>`: the code to import under. Default: the merge base of the target and `origin/main`.
- `--snapshot <zip>`: use this snapshot instead of exporting one.
- `--port <n>`: the app port. Default 5180.
- `--only <a,b>`: run only these scenarios (names in `scenarios.mjs`).
- `--keep-artifacts`: keep the screenshots and report.
- `--serve`: keep the app running after the scenarios for a person to try (see step 9).
- `--serve-hours <n>`: stop serving after this many hours. Default 4, at most 24.
- `--skip-scenarios`: run no scenarios; useful with `--serve`.
- `--team`, `--convex-project`: the Convex team and project for the local deployment. Defaults `conquerthecrowns` and `banhall-e2e`.

## Cost and privacy
- A full run makes real model calls: the deviation job alone is a few dollars.
- It copies client data into a private temp folder (mode 700) and deletes it at the end.
- Run it only with the owner's approval for the data it copies.
