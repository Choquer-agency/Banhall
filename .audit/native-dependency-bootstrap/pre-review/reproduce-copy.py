from pathlib import Path
import json, subprocess, tempfile
from bmad_loop.install import _copy_traversable
source=Path.cwd()/'node_modules/.bin'
with tempfile.TemporaryDirectory(prefix='bmad-copy-baseline-') as tmp:
    dest=Path(tmp)/'node_modules/.bin'
    _copy_traversable(source, dest)
    copied=dest/'tsc'
    result=subprocess.run([str(copied),'--version'],text=True,capture_output=True)
    assert source.joinpath('tsc').is_symlink() and not copied.is_symlink()
    assert result.returncode != 0 and 'MODULE_NOT_FOUND' in result.stderr
    print(json.dumps(dict(source=str(source/'tsc'),source_symlink=True,copied_symlink=False,rc=result.returncode,stderr=result.stderr),indent=2))
