import datetime, gzip, hashlib, json, os, pathlib, shutil, stat, subprocess, sys, time
root=pathlib.Path.cwd()
out=root/'.audit/integration-final-20260905/unified-contract-final'
head=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
assert head=='186029d408b418c4337ee0e772520629cdae937c',head
assert not subprocess.check_output(['git','status','--porcelain']), 'tracked/untracked changes before gate'
def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def digest(b): return hashlib.sha256(b).hexdigest()
def record(p):
    f=root/p
    if f.is_symlink(): return {'kind':'symlink','sha256':digest(os.readlink(f).encode()),'mode':stat.S_IMODE(f.lstat().st_mode)}
    return {'kind':'file','sha256':digest(f.read_bytes()),'mode':stat.S_IMODE(f.stat().st_mode)}
paths=[os.fsdecode(p) for p in subprocess.check_output(['git','ls-files','-z']).split(b'\0') if p]
before={p:record(p) for p in paths}
(out/'tracked-before.json').write_text(json.dumps(before,indent=2)+'\n')
meta={'head':head,'worktree':str(root),'command':'VERIFY_COMPONENT=1 bash scripts/loop-verify.sh','started_at':now(),'node':subprocess.check_output(['node','--version'],text=True).strip(),'npm':subprocess.check_output(['npm','--version'],text=True).strip(),'tracked_paths':len(paths)}
(out/'running.json').write_text(json.dumps(meta,indent=2)+'\n')
log=out/'unified-gate.log'
started=time.monotonic()
with log.open('wb') as f:
    proc=subprocess.run(['bash','scripts/loop-verify.sh'],env={**os.environ,'VERIFY_COMPONENT':'1'},stdout=f,stderr=subprocess.STDOUT)
meta.update(exit_code=proc.returncode,finished_at=now(),elapsed_seconds=round(time.monotonic()-started,2))
(out/'unified-gate.exit').write_text(str(proc.returncode)+'\n')
after={p:record(p) for p in paths}
changed=[p for p in paths if before[p]!=after[p]]
meta['changed_paths']=changed
unexpected=[p for p in changed if not (p.startswith('.audit/') and p.endswith('.png'))]
meta['unexpected_changes']=unexpected
restores=[]
if not unexpected:
    for p in changed:
        f=root/p
        captured=out/'generated-captures'/p
        captured.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(f,captured)
        baseline=subprocess.check_output(['git','show',f'{head}:{p}'])
        assert digest(baseline)==before[p]['sha256'],p
        f.write_bytes(baseline)
        os.chmod(f,before[p]['mode'])
        assert record(p)==before[p],p
        restores.append({'path':p,'before':before[p],'generated':after[p],'restored':record(p),'capture':str(captured.relative_to(root))})
meta['historical_capture_restorations']=restores
final={p:record(p) for p in paths}
meta['all_tracked_paths_restored_or_unchanged']=final==before
meta['working_tree_status']=subprocess.check_output(['git','status','--porcelain'],text=True)
raw=log.read_bytes()
packed=gzip.compress(raw,mtime=0)
(out/'unified-gate.log.gz').write_bytes(packed)
meta['log']={'path':str(log.relative_to(root))+'.gz','raw_sha256':digest(raw),'gzip_sha256':digest(packed),'raw_bytes':len(raw)}
log.unlink()
(out/'verification.json').write_text(json.dumps(meta,indent=2)+'\n')
print(json.dumps({k:v for k,v in meta.items() if k not in ('historical_capture_restorations',)},indent=2),flush=True)
sys.exit(proc.returncode or (1 if unexpected or final!=before else 0))
