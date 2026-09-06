"""Archive a deliberate, immutable pre-ship snapshot; excludes live decision/state files."""
from pathlib import Path
import gzip,hashlib,json,subprocess
root=Path(__file__).resolve().parents[2]
base=root/'.audit/quality-pass'
out=base/'closeout'
assert not (out/'archive-manifest.json').exists(), 'Snapshot already finalized'
out.mkdir(exist_ok=True)
folders=['baseline','dependencies','plans','runtime-audit','native-closure-preflight','native-closure','final-gate','trail-audit']
root_files=[p for p in base.iterdir() if p.is_file() and p.suffix!='.gz']
paths=root_files+[p for name in folders for p in (base/name).rglob('*') if p.is_file() and p.suffix!='.gz']
records=[]
for p in sorted(paths):
    relative=p.relative_to(base)
    if p.name in {'transcript.jsonl','messages.json'}:
        raise RuntimeError('Refusing private transcript')
    raw=p.read_bytes()
    # Preserve historical planning bytes, including trailing Markdown whitespace.
    compressed=p.suffix in {'.log','.diff','.txt','.patch','.z'} or (p.suffix=='.json' and len(raw)>50000) or relative==Path('plans/spec-quality-dependency-health.md')
    stored=(out/relative) if p.parent==base and p.name in {"decisions.tsv","state.json"} else p
    if compressed: stored=stored.with_name(stored.name+'.gz')
    stored.parent.mkdir(parents=True,exist_ok=True)
    stored.write_bytes(gzip.compress(raw,compresslevel=9,mtime=0) if compressed else raw)
    encoded=stored.read_bytes()
    assert (gzip.decompress(encoded) if compressed else encoded)==raw
    records.append({'original_path':str(p.relative_to(root)),'stored_path':str(stored.relative_to(root)),'compressed':compressed,'original_sha256':hashlib.sha256(raw).hexdigest(),'stored_sha256':hashlib.sha256(encoded).hexdigest(),'original_bytes':len(raw)})
manifest=out/'archive-manifest.json'
manifest.write_text(json.dumps({'snapshot':'pre-ship immutable evidence; canonical live root decisions/state remain ignored','records':records},indent=2)+'\n')
subprocess.run(['git','add','-f','--',*[x['stored_path'] for x in records],str(manifest.relative_to(root))],cwd=root,check=True)
print(json.dumps({'files':len(records)+1,'verified':True}))
