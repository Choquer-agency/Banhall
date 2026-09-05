# Root independent DX observations

Observed 2026-09-05 09:57 UTC while implementation was still active. These are review inputs, not a verdict on the eventual head. Recheck current source and independently triage.

## AC1: cold bootstrap precedes preflight

Root and independent audit_dx both inspected the draft scripts/loop-verify.sh:13-16. It runs npm ci before the numbered preflight, node/npm/pwsh checks, supported-Node condition and public defaults. An empty checkout with npm missing exits127 under top-level set-e without the required named tool/install hint; missing pwsh is discovered only after installation. This defeats the cold-checkout fast-failure purpose of AC1 and the README's step1 guarantee. The missing-PowerShell artifact runs with dependencies installed, so its success alone would not cover this ordering.

Proposed correction within existing scope: bootstrap inside preflight, after tool/Node checks and public defaults, before resolving Chromium. Propagate npm-ci failure explicitly (`npm ci --no-audit --no-fund || return $?`, or equivalent). `step` calls the function in a `||` list, which disables errexit within it; merely moving the install and relying on set-e can mask a failed installation behind the function's final return0. Root's final owned external clone will inject a distinct npm-ci failure before actual installation and require numbered preflight to preserve that code without subsequent steps.

## README setup order consideration

The draft Running the real app paragraph says npx convex dev writes deployment configuration, then says to copy env.example to .env.local. That order can overwrite freshly written values. Prefer creating the local template first, then configuring the intended deployment and retaining CLI-written values, or say to merge only missing names into an existing file. This is a documentation check; root did not run a deployment command.

## Initial decision-row timestamps

The six initial decisions.tsv rows use 2026-09-05T00:00:00Z through00:00:05Z, while the factory record shows their creation at09:55:01UTC. The decisions themselves describe observed planning, but those timestamps are placeholders rather than event times. Preserve append-only history and append a correction that identifies the affected rows and actual recording interval. Later evidence should use actual timestamps and resolvable output paths, not a claimed exit code as its evidence pointer.

## Final draft evidence attribution

At implementation head0adb9fa, evidence.md and the appended decisions say the cold run bootstrapped317 packages. Raw gate-cold-clone.log:7 says455 packages;317 came from counting node_modules directory entries and is not npm's package count. The excerpt labelled first20 lines is a filtered selection, not the raw first20 lines. Also the global statement that every gate ran atab56b84 excludes the cold run: its factory tool records show cloning b9e09bc at10:03:26, running at10:03:32 and deleting that owned clone after capture, before890ca1a andab56b84 existed. Preserve the actual cold run's revision and distinguish later runs. Root found the version-boundary shell snippet in the actual tool record, so that claim is supported as arithmetic testing, not alternate Node runtime testing. Later TSV03:10:*Z rows were appended at10:14:20UTC; clarify their clock labels along with the initial rows.
