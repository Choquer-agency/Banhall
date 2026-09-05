"""Validate this review's commands, protected paths, terminal result and native ledger."""
from datetime import datetime
import hashlib
import json
from pathlib import Path
import subprocess
import sys
AUDIT = Path(__file__).resolve().parent
ROOT = AUDIT.parents[1]
sys.path.insert(0, str(ROOT / '.audit/DW-92-native-fresh'))
from source_snapshot import snapshot

def require(condition, message):
    if not condition:
        raise SystemExit(message)

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)

def sha(data):
    return hashlib.sha256(data).hexdigest()

entry = json.loads((AUDIT / 'entry.json').read_text())
protected = json.loads((ROOT / '.audit/DW-92-native-fresh/preservation-entry.json').read_text())['protected_paths']
ledger = '_bmad-output/implementation-artifacts/deferred-work.md'
protected.remove(ledger)
protected.append('_bmad-output/implementation-artifacts/sprint-status.yaml')
require(not git('diff', '--name-only', entry['revision'], '--', *protected).strip(), 'Protected tracked changes')
require(not git('ls-files', '--others', '--', *protected).strip(), 'Protected untracked additions')
ledger_hash = sha((ROOT / ledger).read_bytes())
require(ledger_hash == entry['ledger_sha256'], 'Ledger changed since invocation')
require(sha(git('show', ':' + ledger)) == ledger_hash, 'Staged ledger differs from invocation')
provenance = json.loads((AUDIT / 'native-provenance.json').read_text())
require(any(e.get('kind') == 'sweep-bundle-closed' and e.get('dw_ids') == ['DW-92'] for e in provenance['events']), 'Native close provenance missing')
review_start = max(e['ts'] for e in provenance['events'] if e.get('kind') == 'session-start' and e.get('role') == 'review')
old = (AUDIT / 'entry-spec.md').read_text()
spec = (ROOT / '_bmad-output/implementation-artifacts/spec-dw-92-blocking-qa-native-followup.md').read_text()
def contract(text):
    return text.split('<intent-contract>', 1)[1].split('</intent-contract>', 1)[0]
require(contract(old) == contract(spec), 'Frozen contract changed')
require(spec.count('\n## Auto Run Result\n') == 1, 'Missing or duplicate terminal result')
require("status: 'done'" in spec.split('---', 2)[1], 'Spec not done')
for field in ['Status: done', 'Files changed:', 'Review:', 'Verification:', 'Residual risks:']:
    require(field in spec.split('\n## Auto Run Result\n')[1], 'Missing result field: ' + field)
manifest_path = json.loads((AUDIT / 'final-manifest.json').read_text())['manifest']
records = json.loads((ROOT / manifest_path).read_text())
expected = [['bash', 'scripts/loop-verify.sh'], ['npx', 'vitest', 'run', 'convex/ai/qaChecks.test.ts', 'convex/projects.test.ts', 'convex/qaBlocking.test.ts']]
require([r['command'] for r in records] == expected, 'Required command identities differ')
current = snapshot()
for record in records:
    require(datetime.fromisoformat(record['started']).timestamp() >= review_start, 'Gate predates review invocation')
    require(record['revision'] == record['before']['revision'] == entry['revision'], 'Gate revision differs from invocation')
    require(record['exit_code'] == 0, 'Gate failed')
    require(record['before'] == record['after'] and record['source_stable'], 'Source changed during gate')
    require(record['after']['files'] == current['files'], 'Current runtime inputs differ')
    require(record['sha256'] == sha((ROOT / '.audit/DW-92-native-fresh' / record['log']).read_bytes()), 'Raw log hash differs')
for record in json.loads((AUDIT / 'edge-repair-commands.json').read_text()):
    require(record['sha256'] == sha((AUDIT / record['log']).read_bytes()), 'Regression log hash differs')
print(json.dumps({'revision': git('rev-parse', 'HEAD').decode().strip(), 'entry_revision': entry['revision'], 'ledger_working_and_index_sha256': ledger_hash, 'ledger_matches_native_invocation': True, 'protected_unchanged': True, 'commands_and_logs_verified': True, 'runtime_inputs_verified': True, 'terminal_result_valid': True}, indent=2))
