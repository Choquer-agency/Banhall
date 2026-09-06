from pathlib import Path
import gzip, hashlib, json, re, subprocess, sys

root = Path(__file__).resolve().parents[2]
base = root / '.audit/branch-consolidation'
admitted = []
for folder in sys.argv[1:]:
    directory = base / folder
    records = []
    for p in sorted(directory.rglob('*')):
        if not p.is_file() or p.is_symlink() or p.name == 'archive-manifest.json' or p.suffix == '.gz':
            continue
        original = p.read_bytes()
        # Preserve raw evidence losslessly and avoid treating copied diagnostic
        # tests or patch whitespace as maintained source.
        # Historical text must retain bytes even when Git flags its old whitespace.
        historical_whitespace = p.suffix in {'.md', '.txt', '.tsv'} and (bool(re.search(rb'[ \t]+(?:\r?\n|$)', original)) or original.endswith(b'\n\n'))
        compress = historical_whitespace or p.suffix in {'.log', '.diff', '.patch', '.snapshot'} or 'prompt' in p.name or '.test.' in p.name or p.name.startswith('parser-') or p.name == 'policy-audit-historical-amendment.md'
        dest = p.with_name(p.name+'.gz') if compress else p
        if compress:
            dest.write_bytes(gzip.compress(original,mtime=0))
        records.append({'original_path':str(p.relative_to(root)),'stored_path':str(dest.relative_to(root)),'original_sha256':hashlib.sha256(original).hexdigest(),'stored_sha256':hashlib.sha256(dest.read_bytes()).hexdigest(),'encoding':'gzip' if compress else 'identity'})
        admitted.append(str(dest.relative_to(root)))
    manifest = directory / 'archive-manifest.json'
    manifest.write_text(json.dumps({'instructions':'Paths in historical evidence resolve through this manifest. gzip files preserve exact original bytes; decompress with gzip -dc. Original hashes permit independent verification.','files':records},indent=2)+'\n')
    admitted.append(str(manifest.relative_to(root)))
subprocess.run(['git','add','-f','--',*admitted],cwd=root,check=True)
print(json.dumps({'admitted_files':len(admitted),'directories':sys.argv[1:]}))
