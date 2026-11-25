# Operations: Monitoring, Alerting, and Backups

Operational runbook for running Banhall in staging and production. Covers error tracking, Convex Log Stream alerting, cron heartbeats, and scheduled database/file-storage backups.

## 1. Deployment Ordering

Always deploy Convex before promoting the Vercel frontend (automated in `.github/workflows/deploy.yml`).

- Schema changes must follow widen-first, narrow-later discipline so in-flight frontend sessions continue reading and writing cleanly during rollout.
- Never share `CONVEX_DEPLOY_KEY` between `staging` and `production` GitHub Environments.
- Keep `AUTH_PROXY_SECRET` synchronized between Vercel and Convex per environment (`docs/release-checklist.md` step 5).

## 2. Error Tracking and Alerting

### Browser and SvelteKit Server Errors (Sentry)

Configure Sentry for the Vercel frontend deployment:

- Set `PUBLIC_SENTRY_DSN` and `SENTRY_AUTH_TOKEN` per environment (`staging` and `production`).
- Tag events with `release` (Git SHA) and `environment`.
- Scrub report text, client company names, and transcript excerpts in `beforeSend` so confidential SR&ED client content never leaves Banhall for third-party error telemetry.
- Alert on:
  - Any unhandled exception spike (`> 5` events in 5 minutes).
  - Any `AUTH_PROXY_SECRET` or Better Auth session cookie failure.
  - Any DOCX export failure (`exportReportDocx`).

### Convex Backend Log Streams

Enable Convex Log Streams in the Convex dashboard for production (Datadog, Axiom, or webhook sink):

- Alert on uncaught exceptions (`status: "failure"`) in mutations, queries, and actions, excluding expected typed `ConvexError` domain refusals (`NOT_AUTHORIZED`, `INVALID_INPUT`, `STALE_REVISION`, `RATE_LIMITED`).
- Alert on `ANTHROPIC_TRANSPORT` or OpenRouter 5xx / timeout rates exceeding 5% over 15 minutes.
- Alert on `rateLimiter` exhaustion spikes (potential abuse or stuck client retry loop).
- Alert on `projectErasure` or `deleteClient` continuation failures.

## 3. Cron Heartbeats

Monitor the following recurring jobs in Convex Schedules / Log Streams:

| Cron job | Cadence | Expected behavior | Alert if silent for |
| --- | --- | --- | --- |
| `recover stale chat turns` | Every 2 min | Cleans stalled queued/running chat turns | > 15 min |
| `resume stalled project copies` | Every 1 min | Resumes stalled project copy leases | > 15 min |
| `resume stalled company file moves` | Every 5 min | Completes stalled company merge transfers | > 30 min |
| `recover stale report generations` | Every 10 min | Fails stalled generation jobs | > 30 min |
| `recover stale financial uploads` | Every 10 min | Fails stuck financial extraction runs | > 30 min |
| `recover stale transcript fact runs` | Every 10 min | Fails stuck transcript fact extraction runs | > 30 min |
| `refresh model catalog` | Daily 08:45 UTC | Syncs OpenRouter catalog and flags expiring models | > 26 hours |
| `release unreferenced files` | Daily | Cleans abandoned uploads outside retention window | > 26 hours |

Note: `resume stalled My work backfills` was retired on 2026-11-21 after backfill completion; manual admin resume remains available via `myWorkBackfill.resume`.

## 4. Scheduled Backups and Restore Drill

### Automated Daily Export

Run a scheduled off-platform backup job (GitHub Actions scheduled workflow or cloud cron) targeting the production deployment with a read/export deploy key:

```bash
DATE="$(date -u +%Y-%m-%d)"
OUT="banhall-prod-${DATE}.zip"
npx convex export --include-file-storage --path "${OUT}"
chmod 600 "${OUT}"
# Upload ${OUT} to encrypted object storage (S3 / R2 with server-side KMS encryption and 30-day retention)
rm -f "${OUT}"
```

Retention policy:
- Daily snapshots retained for 30 days.
- Weekly (Sunday) snapshots retained for 12 weeks.
- Pre-release manual snapshot retained for 30 days (`docs/release-checklist.md` step 4).

### Quarterly Restore Drill

Once per quarter, restore the latest production snapshot into an isolated scratch/staging Convex deployment:

```bash
npx convex import --replace-all banhall-prod-YYYY-MM-DD.zip
```

Verify after restore:
1. Row counts match expected production magnitudes for `projects`, `reports`, `clients`, `companyFiles`, and `productionOutcomes`.
2. Opening a sample project loads its report body (`reportBodies`) and attached company/project files from file storage.
3. Delete or wipe the scratch deployment after verification so production client data does not linger outside production.
