"""Retain invocation-bound commands, source identity, tools, intervals and raw logs."""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from uuid import uuid4
AUDIT = Path(__file__).resolve().parent
ROOT = AUDIT.parents[1]
sys.path.insert(0, str(ROOT / '.audit/DW-92-native-fresh'))
from source_snapshot import snapshot

def now():
    return datetime.now(timezone.utc).isoformat()

def environment():
    tools = {}
    for name in ['node', 'npm', 'npx', 'bash', 'pwsh']:
        path = shutil.which(name)
        tools[name] = {'path': path, 'sha256': hashlib.sha256(Path(path).read_bytes()).hexdigest() if path else None}
    lock = ROOT / 'node_modules/.package-lock.json'
    tools['versions'] = {name: subprocess.check_output(command, text=True).strip() for name, command in {'node': ['node', '--version'], 'npm': ['npm', '--version'], 'pwsh': ['pwsh', '--version'], 'bash': ['bash', '--version']}.items()}
    tools['control_environment_hashes'] = {name: hashlib.sha256(os.environ[name].encode()).hexdigest() if name in os.environ else None for name in ['PATH', 'NODE_OPTIONS', 'CI', 'PUBLIC_CONVEX_URL', 'VITEST_MAX_THREADS', 'VITEST_MIN_THREADS']}
    tools['installed_lock_sha256'] = hashlib.sha256(lock.read_bytes()).hexdigest() if lock.exists() else None
    return tools

run = AUDIT / ('verification-' + uuid4().hex[:8])
run.mkdir()
records = []
for filename, command in [
    ('ordinary.log', ['bash', 'scripts/loop-verify.sh']),
    ('focused.log', ['npx', 'vitest', 'run', 'convex/ai/qaChecks.test.ts', 'convex/projects.test.ts', 'convex/qaBlocking.test.ts']),
]:
    before = snapshot()
    record = {'command': command, 'cwd': str(ROOT), 'revision': before['revision'], 'started': now(), 'before': before, 'environment_before': environment(), 'log': str((run / filename).relative_to(AUDIT))}
    print('RUN ' + ' '.join(command), flush=True)
    with (run / filename).open('xb') as log:
        result = subprocess.run(command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
    record.update(exit_code=result.returncode, ended=now(), after=snapshot(), environment_after=environment(), sha256=hashlib.sha256((run / filename).read_bytes()).hexdigest())
    records.append(record)
    (run / 'commands.json').write_text(json.dumps(records, indent=2) + '\n')
    print('EXIT ' + str(result.returncode), flush=True)
    if result.returncode or record['before'] != record['after'] or record['environment_before'] != record['environment_after']:
        raise SystemExit('Gate failed or inputs changed')
(AUDIT / 'final-manifest.json').write_text(json.dumps({'manifest': str((run / 'commands.json').relative_to(AUDIT))}, indent=2) + '\n')
print(str(run / 'commands.json'))
