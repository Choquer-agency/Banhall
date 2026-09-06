# Final reconciliation preflight

Snapshot: accepted integration HEAD `0d481e2b76390e0eff3208d91f1f47d83b173474`; baseline `cc6b706c3b43f971d944cb703a4174eabf3134d9`. Read-only preparation, no fetch, tests, old semantic re-audit, source/ref/index or canonical changes.

## Current admission boundary

B1/B12/B2/B13 are accepted at the snapshot. B3–B11 remain pending for this checklist; their planning and source dispositions are not implementation/review/runtime acceptance. In particular B11 must integrate the corrected revocation-requested/confirmed/failed labels before the archive ancestry is admitted. B8 includes the independently recovered DOM-order and destination-icon assertions. Later parent receipts must explicitly close each required batch; do not alter historical ledgers to pretend their initial pending descriptions were final admission.

The verified recovery ledger covers 63 original commits and 589 path/blob identities; its root verification records 53 superseded, nine patch-equivalent and one integration-required disposition. The factory verification covers the exact 124-commit union and 519 path records. Those prove audit coverage, not that pending useful source units have landed.

The original plan covers 81 captured refs (68 unique tips), with 20 maximal historical parents. Its old integration snapshot/prerequisite statuses are historical. Keep it unchanged and attach final admission evidence. All captured ref values still equal initial-refs.json in this preflight. Revalidate immediately before reconciliation; moved refs require separate treatment of their newly introduced work, never silently replace captured SHAs.

Cownose's captured commit is represented by ancestry; its uncommitted work is excluded from that commit and remains untouched. Preserve the existing worktree audit/evidence and report the exclusion. Do not stash, clean, reset, checkout, commit, or claim those uncommitted bytes were integrated. Preserve all branches/worktrees; no force-push/deletion.

## Parent sequence

1. Admit remaining useful B3–B11 source units with their actual allowed-path diffs, source hashes, BMAD reviews/triage, native disposition where applicable and required receipts. Preserve rejected/earlier rounds as history. Freeze the accepted source tip and tree before ancestry reconciliation.
2. Capture current refs and run the graph check below. At this stage missing historical ancestors are expected, not permission to omit source units. Record drift separately; an expected origin/main move still needs a fresh-main comparison.
3. Root performs the authorized ancestry reconciliation using the approved historical parents only after content acceptance. An ancestry-only merge records prior history; it does not integrate a single missing source hunk. Capture before/after commit and tree IDs. Tree-preserving reconciliation must leave the accepted source tree identical. Never import old source/config/native ledgers wholesale.
4. Re-run the graph check with the reconciled integration tip as target: all captured SHAs, all 20 planned tips and the accepted source tip must be ancestors. Preserve current integration as the first-parent lineage. Capture the reconciliation commits and their parent lists.
5. Parent performs final source/evidence admission and exact final-candidate gates. Bind both hosted CI jobs to the actual PR head; old diagnostic/Linux runs and focused batch passes are not final PR proof. Any resulting source change invalidates an earlier exact-tree claim until rechecked.
6. Use a normal PR merge preserving ancestry, not squash/rebase. After parent refreshes origin/main, run the same graph check on origin/main using the final reconciled PR head as the required integration argument. Verify PR merge SHA, parent list and both successful job identities independently. If main acquired concurrent changes, review the resulting merge tree and actual CI evidence; do not assert exact tree equality automatically.

## Executable read-only graph proof

Run from the consolidation checkout after setting the two positional arguments to actual captured immutable SHAs/ref. First argument is the target (reconciled integration or fresh origin/main); second is the accepted pre-reconciliation source tip for step 4, or final reconciled PR head for step 6. The script reports drift without confusing moved refs with missing captured commits; any drift requires parent disposition. Nonzero exit means missing graph coverage or an unresolved target.

```sh
python3 - TARGET_REF REQUIRED_INTEGRATION_SHA <<'PYPROOF'
import json, subprocess, sys
from pathlib import Path
base = Path('.audit/branch-consolidation')
captured = json.loads((base/'initial-refs.json').read_text())
plan = json.loads((base/'ancestry-plan.json').read_text())
def git(*args):
    return subprocess.run(['git', *args], capture_output=True, text=True)
def resolve(ref):
    r = git('rev-parse', '--verify', ref+'^{commit}')
    if r.returncode: raise SystemExit('Cannot resolve '+ref)
    return r.stdout.strip()
target, required = map(resolve, sys.argv[1:3])
assert len(captured['refs']) == 81
assert len(plan['plannedParents']) == 20
missing, drift = [], []
for row in captured['refs']:
    r = git('rev-parse', '--verify', row['ref'])
    current = r.stdout.strip() if r.returncode == 0 else None
    if current != row['sha']:
        drift.append({'ref':row['ref'], 'captured':row['sha'], 'current':current})
    if git('merge-base', '--is-ancestor', row['sha'], target).returncode:
        missing.append({'ref':row['ref'], 'sha':row['sha']})
parents = [{'id':p['id'], 'sha':p['tip'],
            'ancestor':git('merge-base','--is-ancestor',p['tip'],target).returncode == 0}
           for p in plan['plannedParents']]
required_ok = git('merge-base','--is-ancestor',required,target).returncode == 0
baseline_ok = git('merge-base','--is-ancestor',captured['baseline'],target).returncode == 0
print(json.dumps({'target':target, 'requiredIntegration':required,
    'requiredIntegrationAncestor':required_ok, 'baselineAncestor':baseline_ok,
    'capturedCount':81, 'capturedMissing':missing, 'plannedParents':parents,
    'refDrift':drift}, indent=2))
sys.exit(bool(missing or not required_ok or not baseline_ok or
              any(not p['ancestor'] for p in parents)))
PYPROOF
```

For an ancestry-only step, use `git rev-parse ACCEPTED_SOURCE_SHA^{tree} RECONCILED_SHA^{tree}` and `git diff --exit-code ACCEPTED_SOURCE_SHA RECONCILED_SHA --`. Equal trees are required for that step only. Use `git log --format='%H %P %s' ACCEPTED_SOURCE_SHA..RECONCILED_SHA` and verify the first-parent chain returns to the accepted tip. No merge commands are executed or delegated by this checklist.

## Evidence packaging checks and observed limits

Inspected existing archive manifests B1, B12, B2, B2-r1, B13, B13-r1 and B13-r2: respectively 59, 53, 68, 102, 73, 68 and 102 entries (525 total). Every stored file exists, its stored SHA256 matches, gzip decoding reproduces its original SHA256, and each stored path is currently tracked. No omission found in those seven manifests. This does not claim every future evidence file is already packaged or that tracking alone proves presence in the final remote commit.

Before final staging/admission, parent must check:

- All later accepted batches and review rounds have manifests, with identity/gzip receipts and original-path provenance. Do not overwrite historical input hashes when new evidence supersedes them.
- initial-refs.json, ancestry-plan.json/md, verified recovery/full-history ledgers and verifier receipts, independent corrections, final batch dispositions, final source/tree manifest, PR/CI proof and final graph report are included in the final evidence set. The copied learning-resume receipt and its original-path/SHA provenance must remain durable; no sole reference to an ignored file in another worktree.
- Recheck every manifest from bytes actually committed in the final tip using `git show FINAL_SHA:PATH`, decode gzip and compare both stored/original hashes. `git ls-files --error-unmatch -- PATH` only proves index membership, not remote durability. Confirm newly written ignored audit files are explicitly packaged rather than assumed tracked.
- Reconcile raw log versus gzip paths in citations; preserve command exit codes, source identities and meaningful failures as well as passes. Re-run existing structural evidence verifiers against the final packaged artifacts, without rerunning historical runtime tests merely for packaging.
- Keep final gate source hashes and native ledger dispositions bound to the accepted final tree; document excluded cownose uncommitted state. Do not represent a graph-only result as proof of all uncommitted work or content acceptance.

This checklist adds no admission or merge claim. Root owns all implementation, shell mutations, final gates and shipping.
