"""Verify every baseline tracked file outside the authorized patch is unchanged."""
from pathlib import Path
import hashlib, json, subprocess, os
root=Path(__file__).resolve().parents[2]
base='dd787d4287bcdf970aa3bcb25f0781dc765e030c'
allowed={'.github/workflows/ci.yml','AGENTS.md','README.md','docs/bmad-loop.md','scripts/loop-verify.sh'}
files=subprocess.check_output(['git','ls-tree','-r','-z',base],cwd=root).split(b'\0')
checked=[]
for row in files:
    if not row: continue
    meta,path=row.split(b'\t',1); path=path.decode(); mode,kind,blob=meta.decode().split()
    if path in allowed: continue
    content=os.readlink(root/path).encode() if mode=='120000' else (root/path).read_bytes()
    current=hashlib.sha1(b'blob '+str(len(content)).encode()+b'\0'+content).hexdigest()
    assert current==blob, path
    checked.append({'path':path,'blob':blob,'sha256':hashlib.sha256(content).hexdigest()})
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
output={'baseline':base,'unchanged_tracked_files':len(checked),'archives':archives,'preserved_guidance':['AGENTS policy and native ledger guidance','docs/bmad-loop adjacent native integration guidance']}
(root/'.audit/verification-contract/immutable-source.json').write_text(json.dumps(output,indent=2)+'\n')
print(json.dumps(output,indent=2))
