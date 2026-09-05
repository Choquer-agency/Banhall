"""Verify every baseline tracked file outside the authorized patch is unchanged."""
from pathlib import Path
import hashlib, json, subprocess, os, stat
root=Path(__file__).resolve().parents[2]
base='dd787d4287bcdf970aa3bcb25f0781dc765e030c'
allowed={'.github/workflows/ci.yml','AGENTS.md','README.md','docs/bmad-loop.md','scripts/loop-verify.sh'}
files=subprocess.check_output(['git','ls-tree','-r','-z',base],cwd=root).split(b'\0')
checked=[]
baseline_paths=set()
def actual_mode(path):
    bits=path.lstat().st_mode
    if stat.S_ISLNK(bits): return '120000', 'blob'
    if stat.S_ISREG(bits): return ('100755' if bits & stat.S_IXUSR else '100644'), 'blob'
    raise AssertionError(f'unexpected object type: {path}')
for row in files:
    if not row: continue
    meta,path=row.split(b'\t',1); path=path.decode(); mode,kind,blob=meta.decode().split()
    baseline_paths.add(path)
    assert actual_mode(root/path)==(mode,kind), f'mode/type changed: {path}'
    if path in allowed: continue
    content=os.readlink(root/path).encode() if mode=='120000' else (root/path).read_bytes()
    current=hashlib.sha1(b'blob '+str(len(content)).encode()+b'\0'+content).hexdigest()
    assert current==blob, path
    checked.append({'path':path,'blob':blob,'sha256':hashlib.sha256(content).hexdigest(),'mode':mode,'type':kind})
for p in ['AGENTS.md','docs/bmad-loop.md']:
    old=subprocess.check_output(['git','show',base+':'+p],cwd=root,text=True)
    new=(root/p).read_text()
    if p=='AGENTS.md':
        assert old.split('## Running and verifying')[0]==new.split('## Running and verifying')[0]
        assert old.split('## Conventions that differ from defaults')[1]==new.split('## Conventions that differ from defaults')[1]
    else:
        assert old.split('## Verify, integrate, and ship')[0]==new.split('## Verify, integrate, and ship')[0]
        assert old.split('Use the native deferred-work sweep')[1]==new.split('Use the native deferred-work sweep')[1]
archives=[r for r in checked if 'qa-structural-boundary-input/' in r['path'] and r['path'].endswith('.test.ts')]
assert len(archives)==3
authorized_new={'.nvmrc','scripts/check-test-discovery.mjs','_bmad-output/implementation-artifacts/spec-verification-contract-reconciliation.md'}
# Include staged additions and nonignored untracked additions, without Git quoting.
visible=set(subprocess.check_output(['git','ls-files','-z','--cached','--others','--exclude-standard'],cwd=root).decode().split('\0'))-{''}
new=visible-baseline_paths
assert new==authorized_new, f'unexpected/missing new files: {new ^ authorized_new}'
for path in new: assert actual_mode(root/path)==('100644','blob'), path
audit=root/'.audit/verification-contract'
own_audit=[]
for path in sorted(audit.rglob('*')):
    if path.is_dir(): continue
    mode,kind=actual_mode(path)
    assert kind=='blob' and mode in ('100644','100755'), str(path)
    own_audit.append({'path':str(path.relative_to(root)),'mode':mode,'type':kind})
output={'authorized_new_files':sorted(new),'own_audit_files':own_audit,'mode_and_type_checked':len(baseline_paths),'baseline':base,'unchanged_tracked_files':len(checked),'archives':archives,'preserved_guidance':['AGENTS policy and native ledger guidance','docs/bmad-loop adjacent native integration guidance']}
(root/'.audit/verification-contract/after-review-immutable-source.json').write_text(json.dumps(output,indent=2)+'\n')
print(json.dumps(output,indent=2))
