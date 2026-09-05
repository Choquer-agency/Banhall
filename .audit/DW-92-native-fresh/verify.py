"""Execute ordinary gates with unique immutable logs and before/after input hashes."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
from uuid import uuid4
from source_snapshot import snapshot

AUDIT = Path(__file__).resolve().parent
ROOT = AUDIT.parents[1]
run = AUDIT / ('verification-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid4().hex[:8])
run.mkdir()
records = []
for filename, command in [
    ('ordinary.log', ['bash', 'scripts/loop-verify.sh']),
    ('focused.log', ['npx', 'vitest', 'run', 'convex/ai/qaChecks.test.ts', 'convex/projects.test.ts', 'convex/qaBlocking.test.ts']),
]:
    before = snapshot()
    record = {'command': command, 'cwd': str(ROOT), 'revision': before['revision'],
              'started': datetime.now(timezone.utc).isoformat(), 'log': str((run / filename).relative_to(AUDIT)),
              'before': before}
    print('RUN ' + ' '.join(command), flush=True)
    with (run / filename).open('xb') as log:
        result = subprocess.run(command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
    after = snapshot()
    record.update(exit_code=result.returncode, ended=datetime.now(timezone.utc).isoformat(),
                  sha256=hashlib.sha256((run / filename).read_bytes()).hexdigest(), after=after,
                  source_stable=before == after)
    records.append(record)
    (run / 'commands.json').write_text(json.dumps(records, indent=2) + '\n')
    print('EXIT ' + str(result.returncode) + '; source stable: ' + str(before == after), flush=True)
    if result.returncode or before != after:
        raise SystemExit(result.returncode or 'Runtime inputs changed during gate')
(AUDIT / 'latest-verification.json').write_text(json.dumps({'manifest': str((run / 'commands.json').relative_to(AUDIT))}, indent=2) + '\n')
print('MANIFEST ' + str(run / 'commands.json'), flush=True)
