"""Bind accepted batches and historical source dispositions to committed proof.

This checks receipt structure and ancestry, not the semantic truth of a review.
The human-readable parent triage and independent historical audits remain required.
"""
from pathlib import Path
import datetime, gzip, hashlib, json, re, subprocess, sys

root = Path(__file__).resolve().parents[3]
base = root / '.audit/branch-consolidation'
target = subprocess.check_output(['git', 'rev-parse', sys.argv[1] + '^{commit}'], cwd=root, text=True).strip()
state_path = Path(sys.argv[2]) if len(sys.argv) > 2 else base / 'state.json'
state = json.loads(state_path.read_text())
rounds = {'B2': 'B2-r1', 'B13': 'B13-r2', 'B5': 'B5-r1'}
expected = {'B1', 'B12', 'B2', 'B13', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10', 'B11'}
accepted = {row['id']: row['commit'] for row in state['accepted_batches']}
assert set(accepted) == expected and len(state['accepted_batches']) == 13

def committed(sha, path):
    return subprocess.check_output(['git', 'show', f'{sha}:{path}'], cwd=root)

def ancestor(sha):
    r = subprocess.run(['git', 'merge-base', '--is-ancestor', sha, target], cwd=root)
    assert r.returncode in (0, 1)
    return r.returncode == 0

def identity(sha, path):
    data = committed(sha, path)
    return {'path': path, 'sha256': hashlib.sha256(data).hexdigest()}

rows = []
for batch, sha in accepted.items():
    assert ancestor(sha), (batch, sha)
    directory = f'.audit/branch-consolidation/{rounds.get(batch, batch)}'
    paths = subprocess.check_output(['git', 'ls-tree', '-r', '--name-only', sha, '_bmad-output/implementation-artifacts'], cwd=root, text=True).splitlines()
    specs = [p for p in paths if Path(p).name.startswith(f'spec-branch-{batch.lower()}-')]
    assert len(specs) == 1, (batch, specs)
    spec = committed(sha, specs[0]).decode()
    assert re.search(r'^status: (.+)$', spec, re.M).group(1).strip("\"'") == 'done'
    assert '## Suggested Review Order' in spec
    exits = json.loads(committed(sha, directory + '/review-exits.json'))
    assert len(exits) == 3 and all(r.get('exit_code', r.get('exit')) == 0 for r in exits)
    row = {'batch': batch, 'acceptedCommit': sha, 'ancestorOfTarget': True, 'reviewRound': rounds.get(batch, batch),
           'spec': identity(sha, specs[0]), 'evidence': identity(sha, directory + '/evidence.md'),
           'triage': identity(sha, directory + '/review-triage.md'),
           'reviewExits': identity(sha, directory + '/review-exits.json'),
           'archiveManifest': identity(sha, directory + '/archive-manifest.json')}
    if batch == 'B9':
        row['validation'] = 'Documentation/configuration-only exception: parsed TOML, copy fixtures and byte preservation; subsequent B10/B11 combined runtime gates cover unchanged source.'
        row['focusedProof'] = identity(sha, directory + '/parent-patch-checks.json')
    else:
        gate = json.loads(committed(sha, directory + '/gate/result.json'))
        assert gate['exit_code'] == 0, batch
        if batch == 'B1':
            resolution_path = directory + '/gate/capture-resolution.json'
            resolution = json.loads(committed(sha, resolution_path))
            assert not resolution['unresolved_changed_paths']
            exception = resolution['unexpected_capture_resolution']
            assert gate['unexpected_changed_paths'] == [exception['path']]
            assert hashlib.sha256(committed(sha, exception['path'])).hexdigest() == exception['restored_sha256']
            row['reviewedGuardException'] = identity(sha, resolution_path)
        elif batch == 'B5':
            exception = json.loads(committed(sha, directory + '/gate/acceptance.json'))
            assert exception['accepted'] is True and exception['source_after_restoration_matches_staged_candidate'] is True
            assert gate['unexpected_changed_paths'] == [exception['reviewed_exception']]
            row['reviewedGuardException'] = identity(sha, directory + '/gate/acceptance.json')
        else:
            assert not gate['unexpected_changed_paths'], batch
        log = gzip.decompress(committed(sha, directory + '/gate/gate.log.gz'))
        assert hashlib.sha256(log).hexdigest() == gate['log_sha256']
        row['gate'] = identity(sha, directory + '/gate/result.json')
        row['runtime'] = gate.get('runtime', 'Recorded in batch evidence/runtime receipts')
        row['testTotals'] = re.findall(r'^\s*Tests\s+(.+)$', log.decode(), re.M)
    rows.append(row)

mapping_path = base / 'recovery-audit/final-admission-mapping-snapshot.json'
mapping = json.loads(mapping_path.read_text())
mapped = []
for source in mapping['sourceDispositionMappings']:
    source = dict(source)
    source['acceptedMappings'] = {b: accepted[b] for b in source['requiredBatches']}
    source['pendingBatches'] = []
    mapped.append(source)
assert len(mapped) == 26
plan_path = base / 'ancestry-plan.json'
plan = json.loads(plan_path.read_text())
parents = [{'id': p['id'], 'tip': p['tip'], 'prerequisites': {b: accepted[b] for b in p['contentPrerequisites']}} for p in plan['plannedParents']]
assert len(parents) == 20
result = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'target': target,
          'stateInput': {'path': str(state_path), 'sha256': hashlib.sha256(state_path.read_bytes()).hexdigest()},
          'historicalMappingInputSha256': hashlib.sha256(mapping_path.read_bytes()).hexdigest(),
          'ancestryPlanSha256': hashlib.sha256(plan_path.read_bytes()).hexdigest(),
          'acceptedBatches': rows, 'historicalSourceDispositions': mapped, 'plannedParents': parents,
          'openFollowups': state['open_followups'], 'uncommittedExclusion': 'Cownose14 files and other external dirty worktrees are preserved; branch-tip ancestry never includes uncommitted bytes.',
          'limits': 'Committed proof identities and completed review/gate receipts supplement parent semantic acceptance; historical ledger classifications remain unchanged. No ancestry or remote merge is asserted by this checker.'}
(base / 'finalization/content-admission.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'target': target, 'acceptedBatches': len(rows), 'sourceDispositions': len(mapped), 'historicalParentsWithSatisfiedContentPrerequisites': len(parents)}))
