"""Read-only external comparison; prints JSON, exits nonzero on drift/errors.
Run from any cwd; redirect stdout to a NEW audit receipt. No Git refresh/writes.
"""
from pathlib import Path
import subprocess, json, hashlib, os, sys, datetime
here = Path(__file__).resolve().parent
supp = json.loads((here / 'external-full-supplement.json').read_text())
original = json.loads((here.parent / 'external-worktree-baseline.json').read_text())
old_by_path = {r['path']: r for r in original}
issues, rows = [], []
started = datetime.datetime.now(datetime.timezone.utc).isoformat()
for old in supp['worktrees']:
    tree = Path(old['path'])
    try:
        def git(*args):
            return subprocess.check_output(['git', '--no-optional-locks', *args], cwd=tree, stderr=subprocess.PIPE)
        head = git('rev-parse', 'HEAD').decode().strip()
        parts = git('status', '--porcelain=v1', '-z', '--untracked-files=all').split(b'\0')
        dirty, i = [], 0
        while i < len(parts):
            item = parts[i]; i += 1
            if not item: continue
            status, name = item[:2].decode(), os.fsdecode(item[3:])
            origin = None
            if 'R' in status or 'C' in status:
                origin = os.fsdecode(parts[i]); i += 1
            f = tree / name
            kind = 'symlink' if f.is_symlink() else 'file' if f.is_file() else 'absent'
            data = os.fsencode(os.readlink(f)) if kind == 'symlink' else f.read_bytes() if kind == 'file' else None
            dirty.append(dict(status=status, path=name, original_path=origin, kind=kind, bytes=len(data) if data is not None else None, sha256=hashlib.sha256(data).hexdigest() if data is not None else None))
        same = head == old['head'] == old_by_path[str(tree)]['head'] and sorted(dirty, key=lambda x:x['path']) == sorted(old['dirty'], key=lambda x:x['path'])
        if not same: issues.append(str(tree))
        rows.append(dict(path=str(tree), head=head, dirty=dirty, unchanged=same))
    except Exception as exc:
        issues.append(str(tree)); rows.append(dict(path=str(tree), error=str(exc)))
# Verify the historical child proof is still bound to the full checkpoint.
for proof in supp['privacy_historical_comparison']:
    matches = [d for r in rows if r['path'].endswith('Banhall-bmad-privacy-contract') for d in r.get('dirty', []) if d['path'] == proof['path']]
    if len(matches) != 1 or matches[0]['sha256'] != proof['historical_sha256']:
        issues.append('historical child: ' + proof['path'])
print(json.dumps(dict(started_at=started, completed_at=datetime.datetime.now(datetime.timezone.utc).isoformat(), compared=len(rows), reference_capture=supp['capture_completed_at'], historical_reference_at=supp['historical_snapshot_at'], issues=issues, worktrees=rows), indent=2))
sys.exit(bool(issues))
