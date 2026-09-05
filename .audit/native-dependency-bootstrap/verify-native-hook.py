from dataclasses import asdict, replace
from pathlib import Path
import hashlib, json, shutil, subprocess, tempfile
from bmad_loop import policy
from bmad_loop.plugins.registry import PluginRegistry
from bmad_loop.plugins.bus import HookBus
from bmad_loop.plugins.context import HookContext
from bmad_loop.plugins.model import LoadedPlugin

project = Path.cwd()
manifest = project / '.bmad-loop/plugins/npm-bootstrap/plugin.toml'
class Journal:
    def __init__(self): self.rows = []
    def append(self, kind, **fields): self.rows.append(dict(kind=kind, **fields))

results = dict(revision=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),
    manifest_sha256=hashlib.sha256(manifest.read_bytes()).hexdigest(), cases=[])

def package(worker, mode='pass'):
    worker.mkdir(parents=True, exist_ok=True)
    doc=dict(name='native-hook-fixture',version='1.0.0',private=True,
        scripts=dict(prepare='node fixture.cjs && (./node_modules/.bin/svelte-kit sync || echo suppressed >> trace) && echo prepare-end >> trace'))
    (worker/'package.json').write_text(json.dumps(doc))
    (worker/'package-lock.json').write_text(json.dumps(dict(name=doc['name'],version='1.0.0',lockfileVersion=3,requires=True,packages={'':dict(name=doc['name'],version='1.0.0')})))
    bins={}
    for name in ['svelte-kit','tsc','vitest']:
        body=f'#!/bin/sh\necho {name} >> trace\n'
        if mode == name: body += 'exit 7\n'
        elif name == 'svelte-kit': body += 'mkdir -p .svelte-kit\necho "{}" > .svelte-kit/tsconfig.json\n'
        bins[name]=body
    # These are labeled fixture executables, created by a real npm ci lifecycle.
    # They exercise control flow, not actual Svelte/TypeScript/Vitest behavior.
    (worker/'fixture.cjs').write_text("const fs=require('node:fs');\nfs.appendFileSync('trace','install\\n');\nfs.mkdirSync('node_modules/.bin',{recursive:true});\nconst bins="+json.dumps(bins)+";\nfor(const [name,body] of Object.entries(bins)){fs.writeFileSync('node_modules/.bin/'+name,body,{mode:0o755});}\n")

with tempfile.TemporaryDirectory(prefix='bmad-hook-isolated-') as tmp:
    base=Path(tmp)
    isolated=base/'registry-project'
    copied=isolated/'.bmad-loop/plugins/npm-bootstrap/plugin.toml'
    copied.parent.mkdir(parents=True)
    shutil.copy2(manifest,copied)
    journal=Journal()
    parsed_policy=policy.loads((project/'docs/bmad-loop-policy.example.toml').read_text())
    discovered=PluginRegistry.build(isolated,policy=parsed_policy,journal=journal)
    loaded=discovered.get('npm-bootstrap')
    assert loaded and loaded.instance is None and loaded.manifest.python is None
    assert [p.name for p in discovered.plugins() if p.manifest.source=='project'] == ['npm-bootstrap']
    # Retain only the actual project manifest: builtins cannot participate either.
    registry=PluginRegistry([loaded])
    hook=loaded.manifest.hook_for('pre_worktree_setup')
    assert hook and hook.blocking and hook.fail_closed and hook.timeout_sec==1200
    assert not loaded.manifest.hook_for('post_worktree_setup')
    results.update(policy_parser='PASS',project_loader='PASS',isolated_dispatch_plugins=[p.name for p in registry.plugins()])
    bus=HookBus(registry,journal=journal)
    def emit(name, worker, expect=None):
        begin=len(journal.rows)
        ctx=HookContext('pre_worktree_setup',run_id='verification-fixture-only',repo_root=str(isolated),worktree=str(worker))
        bus.emit('pre_worktree_setup',ctx)
        veto=ctx.resolved_veto()
        if expect is None: assert veto is None, veto
        else: assert veto and veto.action=='defer' and expect in veto.reason, veto
        record=dict(name=name,veto=asdict(veto) if veto else None,journal=journal.rows[begin:])
        results['cases'].append(record)
        return record

    parent=base/'parent'; package(parent)
    parent_install=subprocess.run(['npm','ci','--include=dev','--no-audit','--no-fund'],cwd=parent,text=True,capture_output=True)
    assert parent_install.returncode==0,parent_install.stderr
    (parent/'trace').unlink()
    sentinel=parent/'node_modules/installed-sentinel'; sentinel.write_text('preserve-parent-dependencies')
    before=hashlib.sha256(sentinel.read_bytes()).hexdigest()
    child=parent/'child'; child.mkdir()
    case=emit('missing local package preserves installed parent sentinel',child,'local regular package.json required')
    assert sentinel.read_text()=='preserve-parent-dependencies' and not (parent/'trace').exists()
    case['parent_install_rc']=parent_install.returncode
    case['parent_sentinel_sha256_before']=before
    case['parent_sentinel_sha256_after']=hashlib.sha256(sentinel.read_bytes()).hexdigest()
    missing=base/'missing-lock'; package(missing); (missing/'package-lock.json').unlink()
    emit('missing local lockfile guard',missing,'local regular package-lock.json')
    broken=base/'invalid-lock'; package(broken); (broken/'package-lock.json').write_text('{broken')
    emit('actual npm ci invalid lockfile failure',broken,'exited')
    assert not (broken/'trace').exists()
    emit('actual missing cwd transport failure',base/'absent','errored')
    for name in ('node_modules','.svelte-kit'):
        worker=base/('symlink-'+name); package(worker)
        external=base/('external-'+name); external.mkdir()
        (worker/name).symlink_to(external,target_is_directory=True)
        emit('actual '+name+' symlink refusal',worker,'must belong to this worker')
        assert not (worker/'trace').exists()
    for mode, expected in [('pass',['install','svelte-kit','prepare-end','svelte-kit','tsc','vitest']),
            ('svelte-kit',['install','svelte-kit','suppressed','prepare-end','svelte-kit']),
            ('tsc',['install','svelte-kit','prepare-end','svelte-kit','tsc']),
            ('vitest',['install','svelte-kit','prepare-end','svelte-kit','tsc','vitest'])]:
        worker=base/('lifecycle-'+mode); package(worker,mode)
        case=emit('actual npm ci then '+mode+' fixture',worker,None if mode=='pass' else 'exited 7')
        trace=(worker/'trace').read_text().splitlines()
        assert trace==expected,(mode,trace)
        case['trace']=trace
        case['executables']='isolated lifecycle fixture scripts, not production tool binaries'
    # Post-install ownership and escaped binary checks, driven by real lifecycle.
    for kind in ['node_modules','.svelte-kit','binary','generated']:
        worker=base/('escape-'+kind); package(worker)
        external=base/('outside-'+kind); external.mkdir()
        fixture=worker/'fixture.cjs'
        if kind in ['node_modules','.svelte-kit']:
            tail=f"fs.rmSync({json.dumps(kind)},{{recursive:true,force:true}});fs.symlinkSync({json.dumps(str(external))},{json.dumps(kind)},'dir');\n"
        elif kind=='binary':
            outside=external/'tsc'; outside.write_text('#!/bin/sh\nexit 0\n'); outside.chmod(0o755)
            tail=f"fs.unlinkSync('node_modules/.bin/tsc');fs.symlinkSync({json.dumps(str(outside))},'node_modules/.bin/tsc');\n"
        else:
            outside=external/'tsconfig.json'; outside.write_text('{}')
            # Change sync fixture to create a generated config outside ownership.
            target=worker/'node_modules/.bin/svelte-kit'
            script=f'#!/bin/sh\necho svelte-kit >> trace\nmkdir -p .svelte-kit\nln -sf "{outside}" .svelte-kit/tsconfig.json\n'
            tail=f"fs.writeFileSync('node_modules/.bin/svelte-kit',{json.dumps(script)},{{mode:0o755}});\n"
        fixture.write_text(fixture.read_text()+tail)
        emit('actual post-install/sync '+kind+' ownership refusal',worker,'must belong' if kind in ['node_modules','.svelte-kit'] else 'escapes')

    timeout_journal=Journal()
    timeout_hook=replace(hook,cmd='exec sleep 5',timeout_sec=1)
    timeout_registry=PluginRegistry([LoadedPlugin(manifest=replace(loaded.manifest,hooks=(timeout_hook,)))])
    timeout_bus=HookBus(timeout_registry,journal=timeout_journal)
    ctx=HookContext('pre_worktree_setup',run_id='timeout-fixture-only',repo_root=str(isolated),worktree=str(base))
    timeout_bus.emit('pre_worktree_setup',ctx)
    veto=ctx.resolved_veto()
    assert veto and veto.action=='defer' and 'timed out after 1s' in veto.reason
    results['timeout_fixture']=dict(command=timeout_hook.cmd,timeout_sec=1,blocking=True,fail_closed=True,veto=asdict(veto),journal=timeout_journal.rows)
    results['registry_probe_journal']=journal.rows[:next(i for i,r in enumerate(journal.rows) if r['kind']=='plugin-hook')]
print(json.dumps(results,indent=2))
