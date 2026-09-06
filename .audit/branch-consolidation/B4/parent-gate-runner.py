from pathlib import Path
import datetime, hashlib, json, os, shutil, subprocess, sys, time

root = Path(__file__).resolve().parents[2]
os.chdir(root)
output = root / '.audit/branch-consolidation' / sys.argv[1]
output.mkdir(parents=True, exist_ok=True)
paths = subprocess.check_output(['git', 'ls-files', '-z']).decode().split('\0')
before = {}
for name in filter(None, paths):
    p = root / name
    if p.is_symlink():
        before[name] = ('symlink', os.readlink(p))
    elif p.is_file():
        before[name] = ('file', p.read_bytes())
    else:
        before[name] = ('absent', None)
captures = set(json.loads((root / '.audit/branch-consolidation/local-baseline/result.json').read_text())['generated_historical_captures_preserved_and_restored'])
captures.add('.audit/story-8/learning-desktop-after.png')
runtime = {'node': subprocess.check_output(['node', '--version'], text=True).strip(), 'npm': subprocess.check_output(['npm', '--version'], text=True).strip(), 'node_executable': shutil.which('node'), 'npm_executable': shutil.which('npm')}
if not runtime['node'].startswith('v24.'):
    raise SystemExit('Parent gate requires repository Node24; got '+json.dumps(runtime))
start = time.time()
with (output / 'gate.log').open('wb') as log:
    run = subprocess.run(['bash', 'scripts/loop-verify.sh'], env={**os.environ, 'VERIFY_COMPONENT': '1'}, stdout=log, stderr=subprocess.STDOUT)
changed = []
restored = []
for name, (kind, value) in before.items():
    p = root / name
    current = ('symlink', os.readlink(p)) if p.is_symlink() else ('file', p.read_bytes()) if p.is_file() else ('absent', None)
    if current == (kind, value):
        continue
    if name in captures and kind == 'file' and current[0] == 'file':
        copy = output / 'captures' / name
        copy.parent.mkdir(parents=True, exist_ok=True)
        copy.write_bytes(current[1])
        p.write_bytes(value)
        restored.append(name)
    else:
        changed.append(name)
result = {'runtime': runtime, 'command': 'VERIFY_COMPONENT=1 bash scripts/loop-verify.sh', 'exit_code': run.returncode, 'elapsed_seconds': time.time()-start, 'tracked_files_verified': len(before), 'unexpected_changed_paths': changed, 'generated_captures_restored': restored, 'log_sha256': hashlib.sha256((output/'gate.log').read_bytes()).hexdigest(), 'at': datetime.datetime.now(datetime.timezone.utc).isoformat()}
(output / 'result.json').write_text(json.dumps(result, indent=2)+'\n')
print(json.dumps(result))
sys.exit(run.returncode or bool(changed))
