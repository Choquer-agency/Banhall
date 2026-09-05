"""Exercise the real verifier with in-memory tampering, including optimized Python."""
from pathlib import Path
import subprocess
import sys

verifier = Path(__file__).with_name('verify-preservation.py').resolve()
failed = 0
for flags in ([], ['-O']):
    mode = 'optimized' if flags else 'normal'
    for field, value in [('sha256', '0' * 64), ('git_blob', '0' * 40), ('matches_baseline', False)]:
        code = f'''
import json, runpy
original_loads = json.loads
def tampered_loads(*args, **kwargs):
    snapshot = original_loads(*args, **kwargs)
    snapshot['files'][0][{field!r}] = {value!r}
    return snapshot
json.loads = tampered_loads
runpy.run_path({str(verifier)!r}, run_name='__main__')
'''
        result = subprocess.run([sys.executable, *flags, '-c', code], capture_output=True, text=True)
        rejected = result.returncode != 0 and 'PASS all preservation' not in result.stdout
        print(f'{"PASS" if rejected else "FAIL"} {mode} rejects tampered {field}: exit {result.returncode}')
        if not rejected:
            failed += 1
        else:
            print(result.stderr.strip().splitlines()[-1])
    clean = subprocess.run([sys.executable, *flags, str(verifier)], capture_output=True, text=True)
    passed = clean.returncode == 0 and 'PASS all preservation and provenance comparisons' in clean.stdout
    print(f'{"PASS" if passed else "FAIL"} {mode} accepts unchanged snapshot: exit {clean.returncode}')
    if not passed:
        failed += 1
print(f'{8 - failed} passed, {failed} failed; no protected file was mutated')
sys.exit(1 if failed else 0)
