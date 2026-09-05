"""Hash tracked and untracked runtime/config inputs, including ignored inputs."""
import hashlib
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
DIRECTORIES = ('convex', 'src', 'shared', 'scripts', 'static', 'tests', 'e2e', 'patches')

def snapshot():
    paths = set()
    for directory in DIRECTORIES:
        base = ROOT / directory
        if base.exists():
            paths.update(p for p in base.rglob('*') if p.is_file())
    # All root-level files include package manifests, every Vite/Vitest/Svelte/
    # TypeScript config, and local environment/config files. Only hashes leave
    # the source tree; environment contents are never retained in the audit.
    paths.update(p for p in ROOT.iterdir() if p.is_file())
    return {
        'revision': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
        'files': {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(paths)},
    }
