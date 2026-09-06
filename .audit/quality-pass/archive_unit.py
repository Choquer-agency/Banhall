from pathlib import Path
import gzip, hashlib, json, re, subprocess, sys
root = Path(__file__).resolve().parents[2]
unit = sys.argv[1]
assert re.fullmatch(r"Q[1-8](?:-r[1-5])?|baseline|dependencies", unit)
folder = root / ".audit/quality-pass" / unit
records = []
for path in sorted(folder.rglob("*")):
    if not path.is_file() or path.name == "archive-manifest.json" or (path.suffix == ".gz" and not path.name.endswith(".tar.gz")):
        continue
    if {"captures", "vite-cache"}.intersection(path.relative_to(folder).parts):
        continue
    raw = path.read_bytes()
    compressed = path.suffix in {".log", ".diff", ".txt", ".patch", ".z"} or (path.suffix == ".json" and len(raw) > 50000)
    stored = path.with_name(path.name + ".gz") if compressed else path
    if compressed:
        stored.write_bytes(gzip.compress(raw, compresslevel=9, mtime=0))
    encoded = stored.read_bytes()
    assert (gzip.decompress(encoded) if compressed else encoded) == raw
    records.append({"original_path": str(path.relative_to(root)), "stored_path": str(stored.relative_to(root)), "compressed": compressed, "original_sha256": hashlib.sha256(raw).hexdigest(), "stored_sha256": hashlib.sha256(encoded).hexdigest(), "original_bytes": len(raw)})
manifest = folder / "archive-manifest.json"
manifest.write_text(json.dumps({"unit": unit, "records": records}, indent=2) + "\n")
paths = [row["stored_path"] for row in records] + [str(manifest.relative_to(root))]
subprocess.run(["git", "add", "-f", "--", *paths], cwd=root, check=True)
print(json.dumps({"unit": unit, "files": len(paths), "verified": True}))
