"""Read-only comparison of frozen artifacts and supported generated provenance."""
from pathlib import Path
import hashlib
import json
import subprocess
import textwrap
import sys
import argparse

parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
parser.add_argument("--staged", action="store_true")
args = parser.parse_args()

root = Path(__file__).resolve().parents[2]
snapshot = json.loads((root / '.audit/DW-93/preservation-snapshot.json').read_text())

def require(condition, message):
    if not condition:
        raise SystemExit(f'FAIL {message}')

def git(*args):
    return subprocess.check_output(['git', *args], cwd=root)

LEDGER = '_bmad-output/implementation-artifacts/deferred-work.md'
STORY = '_bmad-output/specs/spec-ai-engine-sprint-2-learn-chat/stories/3-persist-post-edit-distance-at-milestones.md'
REQUIRED_PATHS = {LEDGER, STORY, 'convex/_generated/api.d.ts',
                  '.audit/CAP-2-story-3/codegen.log', '.audit/CAP-2-story-3/evidence.md'}
paths = [item['path'] for item in snapshot['files']]
require(len(paths) == len(REQUIRED_PATHS) and set(paths) == REQUIRED_PATHS, 'Protected inventory mismatch')
provenance = json.loads((root / '.audit/DW-93/native-dispatch-provenance.json').read_text())
require(snapshot['baseline_revision'] == provenance['native_task_snapshot']['baseline_commit'] == provenance['worktree_head'], 'Native baseline mismatch')

# Historical ledger bytes remain anchored to the original development baseline.
# Current ledger bytes belong to the native closure captured at review invocation.
review = root / '.audit/DW-93/review-followup'
invocation = json.loads((review / 'invocation-snapshot.json').read_text())
require(len(invocation['files']) == 2 and {item['path'] for item in invocation['files']} == {LEDGER, STORY}, 'Invocation inventory mismatch')
journal = json.loads((review / 'native-journal.json').read_text())
require(any(e['entry']['kind'] == 'sweep-bundle-closed' and e['entry'].get('story_key') == 'dw-persisted-ped-native-followup' and e['entry'].get('dw_ids') == ['DW-93'] for e in journal['entries']), 'Native closure evidence missing')
for item in snapshot['files']:
    baseline = git('show', f"{snapshot['baseline_revision']}:{item['path']}")
    data = baseline if item['path'] == LEDGER else (root / item['path']).read_bytes()
    require(hashlib.sha256(data).hexdigest() == item['sha256'], f"SHA-256 mismatch: {item['path']}")
    require(git('rev-parse', f"{snapshot['baseline_revision']}:{item['path']}").decode().strip() == item['git_blob'], f"Git blob mismatch: {item['path']}")
    require(item['matches_baseline'] is True, f"Snapshot does not attest baseline equality: {item['path']}")
    require(data == baseline, f"Baseline bytes differ: {item['path']}")
    print(f"PRESERVED {'historical ledger' if item['path'] == LEDGER else 'current'} {item['sha256']} {item['path']}")
for item in invocation['files']:
    data = (root / item['path']).read_bytes()
    require(hashlib.sha256(data).hexdigest() == item['sha256'], f"Invocation SHA-256 mismatch: {item['path']}")
    require(git('hash-object', item['path']).decode().strip() == item['git_blob'], f"Invocation Git blob mismatch: {item['path']}")
    print(f"INVOCATION PRESERVED {item['sha256']} {item['path']}")

if args.staged:
    for path in sorted(REQUIRED_PATHS):
        require(git('show', f':{path}') == (root / path).read_bytes(), f'Staged bytes differ: {path}')
    print('PASS staged equality for all five protected artifacts')

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
print('FORMULA original helper text present; calculation statements and query arguments/auth/baseline unchanged; runtime parity is covered by PED tests')
print('PASS all preservation and provenance comparisons')
