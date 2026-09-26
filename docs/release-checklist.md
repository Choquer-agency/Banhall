# Production release checklist

The steps to put a release into production, in order. Each step has its command and how to check it worked. Do them one at a time, and stop at the first check that fails.

Written 2026-09-25 from audit 2026-09-25 (a4 section 3d: sweep items I-7, fixb P3-13, fixe P3-13 and fable2 P3-2). There is no production Convex deployment yet (`docs/system-map.md`), so the first release also creates it. Replace `<prod>` below with the production deployment name, and run every `npx convex` command with the production deploy key:

```bash
export CONVEX_DEPLOY_KEY=<production deploy key>
```

Without the key, `npx convex` talks to your development deployment. Check which one it targets before each run.

## Before the deploy

### 1. Install from the lockfile

```bash
git checkout <release commit>
npm ci
```

**Check:** `npm ci` ends without errors and `git status` is clean. Never use `npm install` for a release: it can change `package-lock.json`. `vercel.json` sets `"installCommand": "npm ci"` (security wave 1), so the Vercel build installs from the lockfile too.

### 2. Run the full gate

```bash
bash scripts/loop-verify.sh
VERIFY_COMPONENT=1 bash scripts/loop-verify.sh
```

**Check:** both runs end green. The second also runs the browser component tests (install Chromium once with `npx playwright install chromium`).

### 3. Back up production and scan it for bare placeholders

Since 2026-09-25, a model answer that echoes a bare id such as `CLIENT_1` or `PERSON_2` is restored into the current project's names (`docs/product-domain.md`, "Bare placeholders"). A bare id already stored in old data would then turn into a real name the next time it passes through a model. Find those before deploying.

There is no scan function yet, so use a full export, which is also the pre-deploy backup:

```bash
npx convex export --path banhall-before-release.zip
mkdir banhall-before-release && unzip -q banhall-before-release.zip -d banhall-before-release
grep -rEl '(^|[^[:alnum:]_[])(CLIENT|PERSON)_[0-9]+' banhall-before-release
```

This reads every table, including the Brain chunks the `rag` component stores. The ones that matter are `reports`, `brainSources` and the Brain chunks, `generationArtifacts` and `transcriptFactRuns`.

**Check:** `grep` prints nothing. The pattern skips bracketed tokens such as `[CLIENT_1]`, which the restore already handles. On a hit, open the file, find the row, and replace each bare id with the real name or remove it, by hand in the Convex dashboard, before you deploy. Keep the export zip until the release is signed off.

### 4. Set the environment variables

On the Convex deployment (dashboard, Settings, Environment Variables, or `npx convex env set NAME value`):

| Name | Production value |
| --- | --- |
| `BETTER_AUTH_COOKIE_PREFIX` | **Unset.** A value renames the sign-in cookies and signs everyone out. |
| `ANTHROPIC_TRANSPORT` | Unset or `direct`, until the owner finishes the OpenRouter account steps under owner decision 30 in `docs/product-domain.md`. |
| `ANTHROPIC_API_KEY` | Set. Chat always uses it, whatever the transport. |
| `OPENROUTER_API_KEY` | Set (OpenAI and Google models, research, the model catalog). |
| `OPENROUTER_ANTHROPIC_API_KEY` | Only when `ANTHROPIC_TRANSPORT=openrouter`. |
| `VOYAGE_API_KEY` | Set (Brain search). |
| `SITE_URL` | The production app URL. |
| `BETTER_AUTH_SECRET` | Set, and never the development value. |
| `BETTER_AUTH_TRUSTED_ORIGINS` | Only for origins beyond the built-in `https://banhall.vercel.app`. |
| `AUTH_PROXY_SECRET` | Set, at least 32 characters, the same value as on Vercel. Set it on Vercel first (below), then here. |
| `BRAIN_CONTEXTUAL`, `AA_API_KEY`, `MS_*`, `INGEST_API_KEY` | Only if the feature is used. |

On Vercel (Project, Settings, Environment Variables, Production):

| Name | Production value |
| --- | --- |
| `PUBLIC_CONVEX_URL` | The production deployment URL (`https://<prod>.convex.cloud`). |
| `PUBLIC_CONVEX_SITE_URL` | `https://<prod>.convex.site`. |
| `BETTER_AUTH_COOKIE_PREFIX` | **Unset**, the same as on Convex. |
| `AUTH_PROXY_SECRET` | Set, at least 32 characters (for example `openssl rand -base64 48`). The app sends it with each sign-in so Convex can trust the browser's address. |

`AUTH_PROXY_SECRET` goes on the app first, then on Convex, with the same value. Until both have it, every sign-in shares one limit per auth path (10 email sign-ins a minute for the whole firm), and a production Convex deployment without it logs an error on every auth request that starts "AUTH_PROXY_SECRET is not set" (or "is shorter than 32 characters"). Local development (a localhost `SITE_URL`) needs no secret.

**Check:**

```bash
npx convex env list
```

`BETTER_AUTH_COOKIE_PREFIX` is not listed, `ANTHROPIC_TRANSPORT` is missing or `direct`, and `AUTH_PROXY_SECRET` is listed. On Vercel, the Production environment has no `BETTER_AUTH_COOKIE_PREFIX` and has `AUTH_PROXY_SECRET` with the same value as Convex. Never paste the value into a ticket or a log.

## The deploy

### 5. Deploy the Convex functions and schema

```bash
npx convex deploy
```

**Check:** the command ends with the deployed URL and no schema errors. In the dashboard, Functions lists `transcripts:backfillTranscriptStructure` and the four backfills of step 6.

### 6. Run the phase 4 backfills

Each is idempotent, reschedules itself until done, and can run in any order. Try each with a dry run first:

```bash
npx convex run generations:backfillGenerationOutputs '{"dryRun": true}'
npx convex run generations:backfillGenerationOutputs '{}'
npx convex run generations:backfillGenerationProgress '{}'
npx convex run generations:backfillSectionRunData '{}'
npx convex run transcriptDigests:backfillStructuredData '{}'
```

The command prints only the first page; later pages run as scheduled functions. If a page fails, run the same function again with the `continueCursor` it printed and a smaller `pageSize`.

**Check:** in the dashboard, Schedules shows no pending run of these four functions, and the last log line of each returned `isDone: true`. Then spot-check the data: every `generations` row has `outputsInArtifactsAt`; no `generations` row has a non-empty `progressLog` without `progressLogCopiedAt`. Open one old report and one new one: the progress lines, the QA panel, the chronology and the section scores all show.

### 7. Rebuild transcript structure for parser v7

Run it right after the deploy, before anyone starts a Step by step draft. It makes no model call.

```bash
npx convex run transcripts:backfillTranscriptStructure '{}'
```

**Check:** Schedules shows no pending `transcripts:backfillTranscriptStructure` run, and every transcript that is not archived and not empty has `parserVersion` `"7"` and no `structureBuildId`. Archived transcripts keep their old version on purpose. It is safe to run again.

### 8. Deploy the app

Merge to `main` (Vercel's git integration builds it) or promote the preview in Vercel.

**Check:** the Vercel production deployment is Ready, and the build stamp in the app shows this release's build time.

### 9. Refresh the model catalog

Sign in as an admin, open `/admin/models` and click **Refresh now**. This retires models removed from the list (Fable 5.1) before the daily 08:45 UTC refresh would.

**Check:** the panel reads "{n} models, last refreshed {today}", and the Fable 5.1 row shows `retired`.

## After the deploy

### 10. Smoke checks

Sign in on the production URL, then:

1. **Sign-in survives:** reload the page; you stay signed in. An existing session from before the release still works (the cookie names did not change).
2. **Home and a project:** Home lists projects; open one; the report, its version history and the QA panel load.
3. **Edit and export:** type a word into a report and save. In Filing readiness the claim record is still there (not "no claim-level provenance record"), and after a manager approves the changed claims and re-attests, Export DOCX works.
4. **A short draft:** on a test project with one short transcript, start a Single draft. It reaches "completed" and writes a report.
5. **Step by step:** on a test project, start Step by step; the first Seeds appear, and the Summary sign-off opens.
6. **Chat:** ask the report chat one question; it answers.
7. **Admin pages:** `/admin/models` loads with today's refresh, and `/admin/learning` shows Learning health.
8. **Crons:** in the dashboard, Schedules, Cron Jobs lists "recover stale report generations", "recover stale PD reviews", "recover stale post-QA passes" (every 10 minutes), "recover stale chat turns" (every 2 minutes), "reconcile stalled oversight rebuilds", "resume stalled My work backfills" (every 5 minutes), and the daily "refresh QA calibration digest", "refresh draft style digest", "refresh model catalog", "release unreferenced files" and "prune old error reports".
9. **Logs:** the Convex logs show no new errors in the first 15 minutes. In particular, after the sign-in in item 1 there is no error starting "AUTH_PROXY_SECRET"; if there is one, the secret is missing or too short on Convex (step 4). A different value on Vercel is not logged, so copy both from the same source.

**Check:** every item passes. If one fails, roll back (below).

## Rolling back

- **App:** in Vercel, promote the previous production deployment.
- **Convex functions:** check out the previous release commit, run `npm ci`, then `npx convex deploy`. The phase 4 schema only widened, so older code still reads the data, but generations created after the release show no progress log or QA scorecard under the older code (`docs/product-domain.md`, "2026-09-25 (second)", Rollback).
- **Transport:** if `ANTHROPIC_TRANSPORT` was switched to `openrouter`, set it back to `direct`.
- **Data:** restore from the step 3 export only as a last resort, with `npx convex import --replace-all banhall-before-release.zip`; it drops everything written since the export.
