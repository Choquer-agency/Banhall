from pathlib import Path
import gzip, hashlib, json, subprocess

root = Path(__file__).resolve().parents[2]
base = root / '.audit/branch-consolidation'
out = base / 'root-evidence'
out.mkdir(exist_ok=True)
records = []
# Direct files only: never recurse through already admitted batch manifests.
for p in sorted(base.iterdir()):
    if not p.is_file() or p.is_symlink() or p.suffix == '.gz':
        continue
    raw = p.read_bytes()
    compress = p.suffix in {'.log', '.diff', '.patch', '.snapshot'}
    dest = out / 'state-at-admission.json' if p.name == 'state.json' else p.with_name(p.name + '.gz') if compress else p
    if compress:
        dest.write_bytes(gzip.compress(raw, mtime=0))
    elif p.name == 'state.json':
        # Preserve this admission snapshot; the local continuation state remains mutable.
        dest.write_bytes(raw)
    records.append({'original_path': str(p.relative_to(root)), 'stored_path': str(dest.relative_to(root)), 'original_sha256': hashlib.sha256(raw).hexdigest(), 'stored_sha256': hashlib.sha256(dest.read_bytes()).hexdigest(), 'encoding': 'gzip' if compress else 'identity'})
manifest = out / 'archive-manifest.json'
manifest.write_text(json.dumps({'instructions': 'Direct root evidence only; immutable batch evidence has independent manifests. Historical status checkpoints are not final acceptance claims.', 'files': records}, indent=2) + '\n')
subprocess.run(['git', 'add', '-f', '--', *[r['stored_path'] for r in records], str(manifest.relative_to(root))], cwd=root, check=True)
print(json.dumps({'direct_root_records': len(records)}))
