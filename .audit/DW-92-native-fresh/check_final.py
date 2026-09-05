"""Check retained proof against current files without writing native-owned data."""
import hashlib
import json
from pathlib import Path
import subprocess
from source_snapshot import snapshot

AUDIT = Path(__file__).resolve().parent
ROOT = AUDIT.parents[1]
SPEC = '_bmad-output/implementation-artifacts/spec-dw-92-blocking-qa-native-followup.md'

def require(ok, message):
    if not ok:
        raise SystemExit(message)

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

start = json.loads((AUDIT / 'start.json').read_text())
base = start['revision']
protected = json.loads((AUDIT / 'preservation-entry.json').read_text())['protected_paths']
require(not git('diff', '--name-only', base, '--', *protected).strip(), 'Protected tracked file changed')
require(not git('ls-files', '--others', '--', *protected).strip(), 'Untracked protected file exists')
ledger = ROOT / '_bmad-output/implementation-artifacts/deferred-work.md'
require(sha(ledger) == start['ledger_sha256'], 'Ledger differs from invocation snapshot; investigate native provenance')
old_spec = git('show', base + ':' + SPEC).decode()
spec = (ROOT / SPEC).read_text()
def contract(text):
    return text.split('<intent-contract>', 1)[1].split('</intent-contract>', 1)[0]
require(contract(old_spec) == contract(spec), 'Frozen follow-up contract changed')
latest = json.loads((AUDIT / 'latest-verification.json').read_text())
commands = json.loads((AUDIT / latest['manifest']).read_text())
require(len(commands) == 2, 'Incomplete verification manifest')
current = snapshot()
for record in commands:
    require(record['exit_code'] == 0, 'Gate failed')
    require(record['sha256'] == sha(AUDIT / record['log']), 'Command output changed')
    require(record['before'] == record['after'] and record['source_stable'], 'Runtime inputs changed during gate')
    require(record['after']['files'] == current['files'], 'Runtime inputs differ from verified hashes')
    require(record['before']['revision'] == record['revision'], 'Source revision mismatched')
require(spec.count('\n## Auto Run Result\n') == 1, 'Missing or duplicate terminal marker')
require("status: 'done'" in spec.split('---', 2)[1], 'Spec is not done')
result = spec.split('\n## Auto Run Result\n')[1]
for field in ['Status: done', 'Files changed:', 'Review:', 'Verification:', 'Residual risks:']:
    require(field in result, 'Missing result field: ' + field)
print(json.dumps({'baseline': base, 'head': git('rev-parse', 'HEAD').decode().strip(), 'source_unchanged': True, 'protected_paths_unchanged': True, 'ledger_matches_invocation': True, 'frozen_contract_preserved': True, 'raw_logs_match': True, 'terminal_result_valid': True}, indent=2))
