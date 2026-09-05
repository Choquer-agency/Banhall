"""Check this invocation's actual terminal artifact and retained verification."""
from datetime import datetime, timezone
import hashlib
import json
import re
from pathlib import Path
import subprocess
import sys
AUDIT = Path(__file__).resolve().parent
ROOT = AUDIT.parents[1]
sys.path.insert(0, str(ROOT / '.audit/DW-92-native-fresh'))
from source_snapshot import snapshot

def require(ok, message):
    if not ok:
        raise SystemExit(message)

def sha(data):
    return hashlib.sha256(data).hexdigest()

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)

entry = json.loads((AUDIT / 'entry.json').read_text())
for path, digest in entry['protected'].items():
    require(sha((ROOT / path).read_bytes()) == digest, 'Protected bytes changed: ' + path)
    if 'deferred-work' in path or 'sprint-status.yaml' in path:
        require(sha(git('show', ':' + path)) == digest, 'Protected index changed: ' + path)
protected = ['src', 'convex/_generated', 'convex/learning.ts', 'convex/ai/learning.ts', 'convex/brain.ts', '_bmad-output/specs/spec-ai-engine-sprint-2-boundary/lanes/qa/stories/8-blocking-qa-policy.md']
require(not git('diff', '--name-only', '86a43d9d500ceab34245744d223d4453eba7b667', '--', *protected).strip(), 'Protected product paths changed')
require(not git('ls-files', '--others', '--', *protected).strip(), 'Protected untracked additions')
spec = (ROOT / '_bmad-output/implementation-artifacts/spec-dw-92-blocking-qa-native-followup.md').read_text()
old = (AUDIT / 'entry-spec.md').read_text()
def contract(text):
    return text.split('<intent-contract>', 1)[1].split('</intent-contract>', 1)[0]
require(contract(old) == contract(spec), 'Intent changed')
require(spec.count('\n## Auto Run Result\n') == 1, 'Terminal marker missing or duplicated')
require("status: 'done'" in spec.split('---', 2)[1], 'Spec not done')
result = spec.split('\n## Auto Run Result\n')[1]
fields = re.split(r'(?m)^(Status|Files changed|Review|Verification|Residual risks):', result)
values = dict(zip(fields[1::2], fields[2::2]))
for field in ['Status', 'Files changed', 'Review', 'Verification', 'Residual risks']:
    require(field in values and values[field].strip(), 'Empty/missing terminal field ' + field)
require(values['Status'].strip().splitlines()[0] == 'done', 'Invalid terminal status')
manifest = json.loads((AUDIT / 'final-manifest.json').read_text())['manifest']
require(manifest in result, 'Terminal result does not identify current manifest')
records = json.loads((AUDIT / manifest).read_text())
expected = [['bash', 'scripts/loop-verify.sh'], ['npx', 'vitest', 'run', 'convex/ai/qaChecks.test.ts', 'convex/projects.test.ts', 'convex/qaBlocking.test.ts']]
require([r['command'] for r in records] == expected, 'Wrong commands')
current = snapshot()
previous = datetime.fromisoformat(entry['time'])
for r in records:
    start, end = datetime.fromisoformat(r['started']), datetime.fromisoformat(r['ended'])
    require(previous <= start <= end <= datetime.now(timezone.utc), 'Invalid execution interval')
    previous = end
    require(r['revision'] == r['before']['revision'] == entry['revision'], 'Wrong invocation revision')
    require(r['exit_code'] == 0 and r['before'] == r['after'], 'Gate failed or inputs changed')
    require(r['after']['files'] == current['files'], 'Current source differs')
    require(r['environment_before'] == r['environment_after'], 'Tool/environment identity changed')
    require(r['sha256'] == sha((AUDIT / r['log']).read_bytes()), 'Raw log changed')
for color, exit_code in [('red', 1), ('green', 0)]:
    repair = json.loads((AUDIT / 'repair' / ('ancestry-' + color + '.json')).read_text())
    require(repair['exit_code'] == exit_code and repair['before'] == repair['after'], 'Invalid repair run')
    require(repair['revision'] == entry['revision'], 'Repair revision mismatch')
    require(sha((AUDIT / 'repair' / repair['log']).read_bytes()) == repair['sha256'], 'Repair log changed')
    for path, digest in repair['after'].items():
        require(sha((AUDIT / 'repair' / (color + '-' + Path(path).name + '.txt')).read_bytes()) == digest, 'Repair snapshot changed')
        if color == 'green':
            require(sha((ROOT / path).read_bytes()) == digest, 'Repaired source changed')
        elif path == 'convex/lib/tiptapReport.ts':
            require(sha(git('show', entry['revision'] + ':' + path)) == digest, 'Red extractor differs from entry')
print(json.dumps({'entry_revision': entry['revision'], 'current_revision': git('rev-parse', 'HEAD').decode().strip(), 'protected_bytes_and_index_unchanged': True, 'protected_product_paths_unchanged': True, 'current_gates_and_logs_verified': True, 'terminal_result_valid': True, 'manifest': manifest}, indent=2))
