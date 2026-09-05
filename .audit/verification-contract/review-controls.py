"""Actual cache/path controls; cache roots are obtained from public Playwright CLI."""
from pathlib import Path
import hashlib,json,os,re,shutil,subprocess,sys,tempfile
root=Path(__file__).resolve().parents[2]; os.chdir(root)
audit=root/'.audit/verification-contract'
phase=sys.argv[1]; assert phase in ('before','after')
label=os.environ.get('REVIEW_EVIDENCE_LABEL',phase+'-review')
base=os.environ.copy(); base.pop('VERIFY_COMPONENT',None)
node=shutil.which('node')
def run(name,cmd,expected,env=base):
    p=subprocess.run(cmd,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=120)
    (audit/f'{label}-{name}.log').write_text(p.stdout)
    (audit/f'{label}-{name}.exit').write_text(str(p.returncode)+'\n')
    print(name,p.returncode,flush=True); assert p.returncode==expected,p.stdout
    return p.stdout
install=run('browser-install-locations',['npx','playwright','install','--dry-run','chromium'],0)
locations=[Path(v.strip()) for v in re.findall(r'Install location:\s*(.+)',install)]
# The CLI lists regular Chromium, FFmpeg, then headless shell in this version.
assert len(locations)==3 and 'Headless Shell' in install
index=Path(subprocess.check_output(['git','rev-parse','--git-path','index'],text=True).strip()).resolve()
index_hash=hashlib.sha256(index.read_bytes()).hexdigest()
launch='const timer=setTimeout(()=>process.exit(1),20000); try { const {chromium}=await import("playwright"); const browser=await chromium.launch({headless:true,timeout:15000}); await browser.close(); console.log("actual headless launch passed"); } catch(e) { console.error(e.message); process.exitCode=1; } finally {clearTimeout(timer);}'
with tempfile.TemporaryDirectory(prefix='review-contract-') as td:
    temp=Path(td); inject=temp/'bin';inject.mkdir()
    fake=inject/'npx';fake.write_text('#!/bin/sh\nexit 37\n');fake.chmod(0o755)
    for name, selected, expected_launch, before_gate, after_gate in [('regular-only',[locations[0],locations[1]],1,37,1),('headless-only',[locations[1],locations[2]],0,1,37)]:
        cache=temp/name;cache.mkdir()
        for loc in selected: (cache/loc.name).symlink_to(loc,target_is_directory=True)
        env=base|{'PLAYWRIGHT_BROWSERS_PATH':str(cache),'VERIFY_COMPONENT':'1'}
        run(name+'-launch',[node,'--input-type=module','-e',launch],expected_launch,env)
        output=run(name+'-gate',['/bin/bash','scripts/loop-verify.sh'],before_gate if phase=='before' else after_gate,env|{'PATH':str(inject)+os.pathsep+base['PATH']})
        assert '[3/' not in output
    isolated=temp/'index';shutil.copyfile(index,isolated)
    env=base|{'GIT_INDEX_FILE':str(isolated)}
    fixture=root/'tests/review-é"quoted\nline.test.ts';assert not fixture.exists()
    try:
        fixture.write_text('import { test } from "vitest";\ntest("path control", () => {});\n')
        subprocess.run(['git','add','--',str(fixture)],env=env,check=True)
        listing=temp/'listing.json'
        run('path-listing',['npx','vitest','list','--filesOnly',f'--json={listing}','--config','vitest.config.ts'],0,env)
        listed=json.loads(listing.read_text());assert any(x['file']==str(fixture) for x in listed)
        (audit/f'{label}-path-fixture.json').write_text(json.dumps({'fixture':str(fixture.relative_to(root)),'discovered_by_canonical_listing':True},indent=2)+'\n')
        run('path-guard',[node,'scripts/check-test-discovery.mjs'],1 if phase=='before' else 0,env)
    finally:fixture.unlink(missing_ok=True)
assert hashlib.sha256(index.read_bytes()).hexdigest()==index_hash
(audit/f'{label}-index-identity.json').write_text(json.dumps({'real_index':str(index),'before_sha256':index_hash,'after_sha256':hashlib.sha256(index.read_bytes()).hexdigest(),'temporary_index_removed':True},indent=2)+'\n')
print('real index unchanged; all fixtures removed',flush=True)
