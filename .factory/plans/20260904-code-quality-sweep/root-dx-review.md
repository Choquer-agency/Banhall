# Root independent DX observations

Observed 2026-09-05 09:57 UTC while implementation was still active. These are review inputs, not a verdict on the eventual head. Recheck current source and independently triage.

## AC1: cold bootstrap precedes preflight

Root and independent audit_dx both inspected the draft scripts/loop-verify.sh:13-16. It runs npm ci before the numbered preflight, node/npm/pwsh checks, supported-Node condition and public defaults. An empty checkout with npm missing exits127 under top-level set-e without the required named tool/install hint; missing pwsh is discovered only after installation. This defeats the cold-checkout fast-failure purpose of AC1 and the README's step1 guarantee. The missing-PowerShell artifact runs with dependencies installed, so its success alone would not cover this ordering.

Proposed correction within existing scope: bootstrap inside preflight, after tool/Node checks and public defaults, before resolving Chromium. Propagate npm-ci failure explicitly (`npm ci --no-audit --no-fund || return $?`, or equivalent). `step` calls the function in a `||` list, which disables errexit within it; merely moving the install and relying on set-e can mask a failed installation behind the function's final return0. Root's final owned external clone will inject a distinct npm-ci failure before actual installation and require numbered preflight to preserve that code without subsequent steps.

## README setup order consideration

The draft Running the real app paragraph says npx convex dev writes deployment configuration, then says to copy env.example to .env.local. That order can overwrite freshly written values. Prefer creating the local template first, then configuring the intended deployment and retaining CLI-written values, or say to merge only missing names into an existing file. This is a documentation check; root did not run a deployment command.

## Initial decision-row timestamps

The six initial decisions.tsv rows use 2026-09-05T00:00:00Z through00:00:05Z, while the factory record shows their creation at09:55:01UTC. The decisions themselves describe observed planning, but those timestamps are placeholders rather than event times. Preserve append-only history and append a correction that identifies the affected rows and actual recording interval. Later evidence should use actual timestamps and resolvable output paths, not a claimed exit code as its evidence pointer.
