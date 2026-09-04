from pathlib import Path
import json, shutil, subprocess, tempfile
from bmad_loop.install import _copy_traversable
with tempfile.TemporaryDirectory(prefix='bmad-copy-baseline-') as tmp:
    base=Path(tmp)
    source=base/'source/node_modules'; source.mkdir(parents=True)
    shutil.copytree(Path.cwd()/'node_modules/typescript',source/'typescript',symlinks=True)
    (source/'.bin').mkdir(); (source/'.bin/tsc').symlink_to('../typescript/bin/tsc')
    native=base/'native/node_modules'
    _copy_traversable(source,native)
    control=base/'control/node_modules'
    shutil.copytree(source,control,symlinks=True)
    results={}
    for name,root in [('native',native),('symlink_preserving_control',control)]:
        executable=root/'.bin/tsc'
        proc=subprocess.run([str(executable),'--version'],text=True,capture_output=True)
        results[name]=dict(symlink=executable.is_symlink(),typescript_package_present=(root/'typescript/lib/tsc.js').is_file(),rc=proc.returncode,stdout=proc.stdout,stderr=proc.stderr)
    assert not results['native']['symlink'] and results['native']['typescript_package_present']
    assert results['native']['rc']!=0 and 'MODULE_NOT_FOUND' in results['native']['stderr']
    assert results['symlink_preserving_control']['symlink'] and results['symlink_preserving_control']['rc']==0
    print(json.dumps(results,indent=2))
