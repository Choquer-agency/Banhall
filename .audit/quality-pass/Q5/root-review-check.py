from pathlib import Path
import subprocess, hashlib, json, os
root=Path(__file__).resolve().parents[3]; os.chdir(root)
out=root/'.audit/quality-pass/Q5'; source=root/'src/lib/components/editor/ModelTestSummary.svelte'; test=root/'src/lib/components/editor/ModelTestSummary.component.test.ts'
fixed=source.read_bytes(); test_hash=hashlib.sha256(test.read_bytes()).hexdigest()
assert test_hash=='174e29d6cb2fce79602725603f47782ffa751fc491ab1dfdea6e2b19e0af83b8'
assert hashlib.sha256(fixed).hexdigest()=='68c7a74ff7225693f147469f28df8963ad3082e5c8517af93d583797f0c1fe24'
baseline=subprocess.check_output(['git','show','67e115c124320e7e3c446cb2538335f052b7c52c:src/lib/components/editor/ModelTestSummary.svelte'])
assert hashlib.sha256(baseline).hexdigest()=='8a011dd029e5d210b1ae8e1d171ffe0fb738889b090da628e17d65daef73b079'
env={**os.environ,'PUBLIC_CONVEX_URL':'https://placeholder.convex.cloud','PUBLIC_CONVEX_SITE_URL':'https://placeholder.convex.site'}
cmd=['npm','run','test:component','--',str(test.relative_to(root))]; results={}
def run(label,args):
 with (out/(label+'.log')).open('wb') as f: return subprocess.run(args,stdout=f,stderr=subprocess.STDOUT,env=env).returncode
try:
 source.write_bytes(baseline)
 results['baseline_exit']=run('root-baseline',cmd)
 assert results['baseline_exit']==1
 assert 'each_key_duplicate' in (out/'root-baseline.log').read_text()
 assert hashlib.sha256(test.read_bytes()).hexdigest()==test_hash
finally:
 source.write_bytes(fixed)
 assert source.read_bytes()==fixed
results['fixed_exit']=run('root-fixed',cmd)
assert results['fixed_exit']==0
assert hashlib.sha256(test.read_bytes()).hexdigest()==test_hash
results['check_exit']=run('root-check',['npm','run','check']);assert results['check_exit']==0
results['diff_exit']=run('root-diff-check',['git','diff','--check']);assert results['diff_exit']==0
results.update(test_sha256=test_hash,baseline_source_sha256=hashlib.sha256(baseline).hexdigest(),fixed_source_sha256=hashlib.sha256(fixed).hexdigest(),source_restored=True,log_hashes={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in out.glob('root-*.log')})
(out/'root-review-checks.json').write_text(json.dumps(results,indent=2)+'\n'); print(json.dumps(results))
