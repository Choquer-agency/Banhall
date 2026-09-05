"""Read-only comparison of frozen artifacts and supported generated provenance."""
from pathlib import Path
import hashlib
import json
import subprocess
import textwrap

root = Path(__file__).resolve().parents[2]
snapshot = json.loads((root / '.audit/DW-93/preservation-snapshot.json').read_text())

def require(condition, message):
    if not condition:
        raise SystemExit(f'FAIL {message}')

def git(*args):
    return subprocess.check_output(['git', *args], cwd=root)

for item in snapshot['files']:
    data = (root / item['path']).read_bytes()
    require(hashlib.sha256(data).hexdigest() == item['sha256'], f"SHA-256 mismatch: {item['path']}")
    require(git('hash-object', item['path']).decode().strip() == item['git_blob'], f"Git blob mismatch: {item['path']}")
    require(item['matches_baseline'] is True, f"Snapshot does not attest baseline equality: {item['path']}")
    require(data == git('show', f"{snapshot['baseline_revision']}:{item['path']}"), f"Baseline bytes differ: {item['path']}")
    print(f"PRESERVED {item['sha256']} {item['path']}")

codegen_revision = '3e575b7c68a80ef560b746be78e1b016e1dda750'
receipt_revision = '5de0e9a389022afc4ee21f740fe6fdd0755fa9b8'
original_revision = '740008e1369faaf6eab001f95efeb10a9e52d1e5'
for revision in (codegen_revision, receipt_revision, original_revision):
    subprocess.run(['git', 'merge-base', '--is-ancestor', revision, snapshot['baseline_revision']], cwd=root, check=True)
    print(f'ANCESTOR {revision} -> {snapshot["baseline_revision"]}')
api = (root / 'convex/_generated/api.d.ts').read_bytes()
require(api == git('show', f'{codegen_revision}:convex/_generated/api.d.ts'), 'Generated API differs from supported-codegen artifact')
require(b'import type * as reportEditDistance from "../reportEditDistance.js";' in api, 'PED module import missing')
require(b'reportEditDistance: typeof reportEditDistance;' in api, 'PED module registration missing')
require((root / '.audit/CAP-2-story-3/codegen.log').read_bytes() == git('show', f'{receipt_revision}:.audit/CAP-2-story-3/codegen.log'), 'Codegen receipt differs from preserved revision')
print(f'API EXACT supported-codegen artifact {codegen_revision}; receipt {receipt_revision}')

old = git('show', f'{original_revision}:convex/reports.ts').decode()
current = (root / 'convex/reports.ts').read_text()
helper = (root / 'convex/lib/editDistance.ts').read_text()
helpers = old[old.index('/** Lowercased word multiset'):old.index('/**\n * Post-edit distance')]
require(helpers in helper, 'Original formula helpers changed')
old_math = textwrap.dedent(old[old.index('    const draftBag'):old.index('    return {\n      /** 0 = untouched draft')]).strip()
new_math = textwrap.dedent(helper[helper.index('  const draftBag'):helper.index('  return {\n    ped:')]).strip()
require(old_math == new_math, 'Original formula calculation changed')
start = 'export const postEditDistance = query({'
require(old[old.index(start):old.index('    const draftText')] == current[current.index(start):current.index('    const result = computeEditDistance')], 'Original query argument/auth/baseline prefix changed')
print('FORMULA EXACT original helper and calculation statements; original query arguments/auth/baseline unchanged')
print('PASS all preservation and provenance comparisons')
