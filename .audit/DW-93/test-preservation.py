"""Exercise the real verifier with isolated in-memory faults, never protected writes."""
from pathlib import Path
import subprocess
import sys

verifier = Path(__file__).with_name('verify-preservation.py').resolve()
cases = [
    ('sha256', "s['files'][0]['sha256'] = '0' * 64", 'FAIL SHA-256 mismatch:'),
    ('git_blob', "s['files'][0]['git_blob'] = '0' * 40", 'FAIL Git blob mismatch:'),
    ('matches_baseline', "s['files'][0]['matches_baseline'] = False", 'FAIL Snapshot does not attest baseline equality:'),
    ('missing file', "s['files'].pop()", 'FAIL Protected inventory mismatch'),
    ('empty inventory', "s['files'] = []", 'FAIL Protected inventory mismatch'),
    ('duplicate file', "s['files'].append(s['files'][0])", 'FAIL Protected inventory mismatch'),
    ('baseline', "s['baseline_revision'] = '0' * 40", 'FAIL Native baseline mismatch'),
]
failed = 0
count = 0
for flags in ([], ['-O']):
    mode = 'optimized' if flags else 'normal'
    for name, mutation, expected in cases:
        code = f'''
import json, runpy
original_loads = json.loads
first = True
def tampered_loads(*args, **kwargs):
    global first
    s = original_loads(*args, **kwargs)
    if first:
        first = False
        {mutation}
    return s
json.loads = tampered_loads
runpy.run_path({str(verifier)!r}, run_name='__main__')
'''
        result = subprocess.run([sys.executable, *flags, '-c', code], capture_output=True, text=True)
        passed = result.returncode == 1 and expected in result.stderr and 'PASS all preservation' not in result.stdout
        count += 1
        failed += not passed
        print(f'{"PASS" if passed else "FAIL"} {mode} rejects {name} for expected reason: exit {result.returncode}')
    for name, patch, expected in [
        ('protected bytes', "original = Path.read_bytes\nPath.read_bytes = lambda p: b'tampered' if p.name == '3-persist-post-edit-distance-at-milestones.md' else original(p)", 'FAIL SHA-256 mismatch:'),
        ('current ledger bytes', "original = Path.read_bytes\nPath.read_bytes = lambda p: b'tampered' if p.name == 'deferred-work.md' else original(p)", 'FAIL Invocation SHA-256 mismatch:'),
        ('staged ledger bytes', "original = subprocess.check_output\nsubprocess.check_output = lambda args, **kw: b'tampered' if args[:3] == ['git', 'show', ':_bmad-output/implementation-artifacts/deferred-work.md'] else original(args, **kw)\nsys.argv = ['verify-preservation.py', '--staged']", 'FAIL Staged bytes differ:'),
        *[(f'staged {path}', f"original = subprocess.check_output\nsubprocess.check_output = lambda args, **kw: b'tampered' if args[:3] == ['git', 'show', ':{path}'] else original(args, **kw)\nsys.argv = ['verify-preservation.py', '--staged']", 'FAIL Staged bytes differ:') for path in ('convex/_generated/api.d.ts', '.audit/CAP-2-story-3/codegen.log', '.audit/CAP-2-story-3/evidence.md')],
    ]:
        code = f'import runpy, sys, subprocess\nfrom pathlib import Path\n{patch}\nrunpy.run_path({str(verifier)!r}, run_name="__main__")'
        result = subprocess.run([sys.executable, *flags, '-c', code], capture_output=True, text=True)
        passed = result.returncode == 1 and expected in result.stderr
        count += 1
        failed += not passed
        print(f'{"PASS" if passed else "FAIL"} {mode} rejects {name} for expected reason: exit {result.returncode}')
    for label, mutation, expected in [
        ('empty closure', "s['entries'] = []", 'FAIL Native closure evidence missing'),
        ('wrong closure bundle', "[e['entry'].update(dw_ids=['DW-other']) for e in s['entries']]", 'FAIL Native closure evidence missing'),
        ('invocation inventory', "s['files'] = []", 'FAIL Invocation inventory mismatch'),
        ('invocation hash', "s['files'][0]['sha256'] = '0' * 64", 'FAIL Invocation SHA-256 mismatch:'),
        ('invocation blob', "s['files'][0]['git_blob'] = '0' * 40", 'FAIL Invocation Git blob mismatch:'),
    ]:
        target = 'entries' if 'closure' in label else 'head'
        code = f"""
import json, runpy
original_loads = json.loads
def tampered_loads(*args, **kwargs):
    s = original_loads(*args, **kwargs)
    if {target!r} in s:
        {mutation}
    return s
json.loads = tampered_loads
runpy.run_path({str(verifier)!r}, run_name='__main__')
"""
        result = subprocess.run([sys.executable, *flags, '-c', code], capture_output=True, text=True)
        passed = result.returncode == 1 and expected in result.stderr
        count += 1
        failed += not passed
        print(f'{"PASS" if passed else "FAIL"} {mode} rejects {label}: exit {result.returncode}')
    for arguments, expected_exit in [(['--staged'], 0), (['--stage'], 2), (['--unknown'], 2)]:
        result = subprocess.run([sys.executable, *flags, str(verifier), *arguments], capture_output=True, text=True)
        passed = result.returncode == expected_exit
        count += 1
        failed += not passed
        print(f'{"PASS" if passed else "FAIL"} {mode} arguments {arguments}: exit {result.returncode}')
    clean = subprocess.run([sys.executable, *flags, str(verifier)], capture_output=True, text=True)
    passed = clean.returncode == 0 and 'PASS all preservation and provenance comparisons' in clean.stdout
    count += 1
    failed += not passed
    print(f'{"PASS" if passed else "FAIL"} {mode} accepts unchanged snapshot: exit {clean.returncode}')
print(f'{count - failed} passed, {failed} failed; no protected file was mutated')
sys.exit(1 if failed else 0)
