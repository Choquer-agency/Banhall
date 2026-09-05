"""Read-only finalization checks; run after staging the reviewed artifacts."""
from pathlib import Path
import hashlib
import json
import subprocess

root = Path(__file__).resolve().parents[3]
def git(*args):
    return subprocess.check_output(['git', *args], cwd=root)
def require(value, message):
    if not value:
        raise SystemExit('FAIL ' + message)

snapshot = json.loads((root / '.audit/DW-93/review-current/invocation.json').read_text())
for path, digest in snapshot['protected'].items():
    data = (root / path).read_bytes()
    require(hashlib.sha256(data).hexdigest() == digest, 'invocation bytes: ' + path)
    require(git('show', ':' + path) == data, 'protected index: ' + path)
print('PASS current invocation protected bytes and index')
spec = '_bmad-output/implementation-artifacts/spec-dw-93-persisted-ped-native-followup.md'
text = (root / spec).read_text()
require("status: 'done'" in text.split('---')[1], 'terminal frontmatter')
require('## Auto Run Result\n\nStatus: done' in text, 'terminal result')
require(git('show', ':' + spec) == (root / spec).read_bytes(), 'terminal index')
paths = git('diff', '--cached', '--name-only', '-z').decode().split('\0')
paths = [p for p in paths if p]
require(spec in paths, 'spec staged')
for path in paths:
    require(path == spec or path.startswith('.audit/DW-93/'), 'unexpected staged path: ' + path)
    require(git('show', ':' + path) == (root / path).read_bytes(), 'staged mismatch: ' + path)
subprocess.run(['git', 'diff', '--cached', '--check'], cwd=root, check=True)
subprocess.run(['git', 'diff', '--check'], cwd=root, check=True)
print('PASS terminal spec, staged allowlist, staged equality, and whitespace')
print('Invocation revision: ' + snapshot['head'])
print('Staged files: ' + str(len(paths)))
