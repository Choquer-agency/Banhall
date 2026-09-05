"""Run the actual gate and canonical discovery with isolated negative controls."""
from pathlib import Path
import hashlib, os, shutil, subprocess, tempfile
root = Path(__file__).resolve().parents[2]
audit = root / '.audit/verification-contract'
os.chdir(root)
def run(name, command, expected, env=None):
    result = subprocess.run(command, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    (audit / (name + '.log')).write_text(result.stdout)
    (audit / (name + '.exit')).write_text(str(result.returncode) + '\n')
    print(name, 'exit', result.returncode, flush=True)
    assert result.returncode == expected, result.stdout
    return result.stdout
base = os.environ.copy()
base.pop('VERIFY_COMPONENT', None)
base.pop('PUBLIC_CONVEX_URL', None)
base.pop('PUBLIC_CONVEX_SITE_URL', None)
node, npm, pwsh = (shutil.which(x) for x in ('node','npm','pwsh'))
run('discovery-adapted', [node, 'scripts/check-test-discovery.mjs'], 0, base)
index = Path(subprocess.check_output(['git','rev-parse','--git-path','index'],text=True).strip()).resolve()
before = hashlib.sha256(index.read_bytes()).hexdigest()
with tempfile.TemporaryDirectory(prefix='verification-contract-') as temp:
    temp = Path(temp)
    isolated = temp / 'index'
    shutil.copyfile(index, isolated)
    env = base | {'GIT_INDEX_FILE': str(isolated)}
    # A path beneath .audit also proves there is no blanket audit exclusion.
    fixture = root / '.audit/verification-contract/orphan-control.test.ts'
    assert not fixture.exists()
    try:
        fixture.write_text('import { test } from "vitest";\ntest("orphan control", () => {});\n')
        subprocess.run(['git','add','-f','--',str(fixture)],env=env,check=True)
        output=run('discovery-orphan', [node,'scripts/check-test-discovery.mjs'],1,env)
        assert 'orphan: .audit/verification-contract/orphan-control.test.ts' in output
    finally:
        fixture.unlink(missing_ok=True)
    assert hashlib.sha256(index.read_bytes()).hexdigest() == before
    run('discovery-restored', [node,'scripts/check-test-discovery.mjs'],0,base)
    bounded = temp / 'bin'; bounded.mkdir()
    for name, target in [('node',node),('npm',npm),('dirname',shutil.which('dirname'))]:
        (bounded/name).symlink_to(target)
    output = run('missing-pwsh', ['/bin/bash','scripts/loop-verify.sh'],1,base | {'PATH':str(bounded)})
    assert 'required tool pwsh not found' in output and 'Install PowerShell 7' in output and '[2/' not in output
    # Keep real preflight tools; replace only the next command to inject its exit.
    injected = temp / 'inject'; injected.mkdir()
    fake = injected / 'npx'
    fake.write_text('#!/bin/sh\nprintf "injected npx: %s\\n" "$*"\nexit 37\n'); fake.chmod(0o755)
    output = run('convex-exit-37', ['/bin/bash','scripts/loop-verify.sh'],37,base | {'PATH':str(injected)+os.pathsep+base['PATH']})
    assert '[2/8] convex typecheck' in output and 'convex typecheck failed, exit 37' in output and '[3/' not in output
    empty = temp / 'browser-cache'; empty.mkdir()
    output = run('missing-chromium', ['/bin/bash','scripts/loop-verify.sh'],1,base | {'VERIFY_COMPONENT':'1','PLAYWRIGHT_BROWSERS_PATH':str(empty)})
    assert 'Chromium not found' in output and 'npx playwright install chromium' in output and '[2/' not in output
print('all controls passed; real index unchanged', flush=True)
