from pathlib import Path
import datetime, hashlib, json, os, shutil, subprocess, sys, time

root = Path(__file__).resolve().parents[2]
os.chdir(root)
output = root / '.audit/quality-pass' / sys.argv[1]
output.mkdir(parents=True, exist_ok=True)
def snapshot():
    paths = subprocess.check_output(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard']).decode().split('\0')
    records = {}
    for name in filter(None, paths):
        p = root / name
        if p.is_symlink():
            records[name] = {'kind': 'symlink', 'target': os.readlink(p)}
        elif p.is_file():
            raw = p.read_bytes()
            records[name] = {'kind': 'file', 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}
        else:
            records[name] = {'kind': 'absent'}
    return records

before = snapshot()
index_before = subprocess.check_output(['git', 'ls-files', '--stage', '-z'])
(output / 'source-before.json').write_text(json.dumps(before, indent=2)+'\n')
runtime = {'node': subprocess.check_output(['node', '--version'], text=True).strip(), 'npm': subprocess.check_output(['npm', '--version'], text=True).strip(), 'node_executable': shutil.which('node'), 'npm_executable': shutil.which('npm')}
if not runtime['node'].startswith('v24.'):
    raise SystemExit('Parent gate requires repository Node24; got '+json.dumps(runtime))
start = time.time()
with (output / 'gate.log').open('wb') as log:
    run = subprocess.run(['bash', 'scripts/loop-verify.sh'], env={**os.environ, 'VERIFY_COMPONENT': '1'}, stdout=log, stderr=subprocess.STDOUT)
after = snapshot()
changed = sorted(name for name in before.keys() | after.keys() if before.get(name) != after.get(name))
index_after = subprocess.check_output(['git', 'ls-files', '--stage', '-z'])
(output / 'source-after.json').write_text(json.dumps(after, indent=2)+'\n')
result = {'runtime': runtime, 'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(), 'command': 'VERIFY_COMPONENT=1 bash scripts/loop-verify.sh', 'exit_code': run.returncode, 'elapsed_seconds': time.time()-start, 'tracked_and_nonignored_paths_verified': len(before), 'unexpected_changed_paths': changed, 'index_unchanged': index_before == index_after, 'index_before_sha256': hashlib.sha256(index_before).hexdigest(), 'index_after_sha256': hashlib.sha256(index_after).hexdigest(), 'generated_captures_restored': [], 'log_sha256': hashlib.sha256((output/'gate.log').read_bytes()).hexdigest(), 'at': datetime.datetime.now(datetime.timezone.utc).isoformat()}
(output / 'result.json').write_text(json.dumps(result, indent=2)+'\n')
print(json.dumps(result))
sys.exit(run.returncode or bool(changed) or index_before != index_after)
