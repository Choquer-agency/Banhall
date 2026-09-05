"""Hash existing shared browser files around isolated partial-cache controls."""
from pathlib import Path
import hashlib,json,os,re,subprocess
root=Path(__file__).resolve().parents[2];os.chdir(root)
audit=root/'.audit/verification-contract'
listing=subprocess.check_output(['npx','playwright','install','--dry-run','chromium'],text=True)
locations=[Path(v.strip()) for v in re.findall(r'Install location:\s*(.+)',listing)]
def snapshot():
 result=[]
 for location in locations:
  for path in sorted(location.rglob('*')):
   if path.is_symlink():
    content=os.readlink(path).encode();kind='symlink'
   elif path.is_file():
    content=path.read_bytes();kind='file'
   else:continue
   result.append({'path':str(path),'kind':kind,'mode':oct(path.lstat().st_mode),'sha256':hashlib.sha256(content).hexdigest()})
 return result
before=snapshot()
(audit/'cache-identity-before.json').write_text(json.dumps(before,indent=2)+'\n')
p=subprocess.run(['python3',str(audit/'review-controls.py'),'after'],env=os.environ|{'REVIEW_EVIDENCE_LABEL':'cache-identity-review'},capture_output=True,text=True)
(audit/'cache-identity-controls.log').write_text(p.stdout+p.stderr)
assert p.returncode==0,p.stdout+p.stderr
after=snapshot()
(audit/'cache-identity-after.json').write_text(json.dumps(after,indent=2)+'\n')
assert before==after
(audit/'cache-identity-result.json').write_text(json.dumps({'shared_cache_roots':[str(x) for x in locations],'files_checked':len(before),'before_after_equal':True,'scope':'This repeated after-review partial-cache probe only; no pre-run hash exists for earlier full gate runs.'},indent=2)+'\n')
print('cache identities unchanged:',len(before),'files')
