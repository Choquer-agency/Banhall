# Report chat live browser test (opt-in, billable)

`node scripts/chat-live/run.mjs --project <projectId>` drives the real report chat in a headless Chromium against the app on localhost, backed by an isolated local Convex backend. It never writes to the source deployment.

## What it does
1. **Snapshot.** It reads a snapshot of the source deployment, which is the one this checkout's `.env.local` points at, with `npx convex export`. A `prod:` source is refused unless you pass `--allow-prod-source`. You can pass your own snapshot with `--snapshot <zip>`.
2. **Worktree.** It creates a temporary git worktree.
3. **Import and push.** It starts a local backend on `--base`, imports the snapshot, then pushes `--target`. Starting on a base commit avoids table-number clashes when the target adds tables the snapshot does not have.
4. **Keys and auth.** It copies `ANTHROPIC_API_KEY` and `OPENROUTER_API_KEY` from the source without printing them. It sets local auth values (`SITE_URL`, a random `BETTER_AUTH_SECRET`, trusted origins) and empties the imported auth signing keys, which were encrypted with the source's secret.
5. **Restart.** It restarts the local backend, because a local backend's Node actions (web search, PDF page counts) only see environment values that were set before they first ran. It then makes one real web search through the Node action and stops if the key did not arrive.
6. **Test account.** It creates a throwaway admin account through the app's own invite and sign-up path.
7. **App.** It starts the app on `--port` (default 5180, never 3001).
8. **Scenarios.** It runs the browser scenarios in `scenarios.mjs` and writes a JSON report.
9. **Cleanup.** It always stops everything and deletes the worktree and every copy of the snapshot, screenshots and credentials. With `--keep-artifacts` it keeps the screenshots and report and prints where they are. They contain client data, so delete them when you are done.

## Options
- `--project <id>` (required): a project from the snapshot with a report to work on.
- `--target <ref>`: the code to test. Default `HEAD`.
- `--base <ref>`: the code to import under. Default: the merge base of the target and `origin/main`.
- `--snapshot <zip>`: use this snapshot instead of exporting one.
- `--port <n>`: the app port. Default 5180.
- `--only <a,b>`: run only these scenarios (names in `scenarios.mjs`).
- `--keep-artifacts`: keep the screenshots and report.
- `--team`, `--convex-project`: the Convex team and project for the local deployment. Defaults `conquerthecrowns` and `banhall-e2e`.

## Cost and privacy
- A full run makes real model calls: the deviation job alone is a few dollars.
- It copies client data into a private temp folder (mode 700) and deletes it at the end.
- Run it only with the owner's approval for the data it copies.
