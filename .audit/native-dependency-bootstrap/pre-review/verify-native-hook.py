from dataclasses import asdict, replace
from pathlib import Path
import hashlib
import json
import subprocess
import tempfile
from bmad_loop import policy
from bmad_loop.plugins.registry import PluginRegistry
from bmad_loop.plugins.bus import HookBus
from bmad_loop.plugins.context import HookContext
from bmad_loop.plugins.model import LoadedPlugin

project = Path.cwd()
manifest = project / '.bmad-loop/plugins/npm-bootstrap/plugin.toml'
class Journal:
    def __init__(self):
        self.rows = []
    def append(self, kind, **fields):
        self.rows.append(dict(kind=kind, **fields))

journal = Journal()
parsed_policy = policy.loads((project/'docs/bmad-loop-policy.example.toml').read_text())
registry = PluginRegistry.build(project, policy=parsed_policy, journal=journal)
loaded = registry.get('npm-bootstrap')
assert loaded and loaded.instance is None and loaded.manifest.python is None
hook = loaded.manifest.hook_for('pre_worktree_setup')
assert hook and hook.blocking and hook.fail_closed and hook.timeout_sec == 1200
assert not loaded.manifest.hook_for('post_worktree_setup')
bus = HookBus(registry, journal=journal)
assert bus.active('pre_worktree_setup')
results = dict(revision=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),
    manifest_sha256=hashlib.sha256(manifest.read_bytes()).hexdigest(),
    policy_parser='PASS', project_loader='PASS', cases=[])
# A real npm ci failure: a valid package.json but no lockfile. No injected runner.
with tempfile.TemporaryDirectory(prefix='bmad-npm-failure-') as tmp:
    worker=Path(tmp)
    (worker/'package.json').write_text('{"name":"native-hook-negative","version":"1.0.0","private":true}')
    ctx=HookContext('pre_worktree_setup',run_id='verification-only',repo_root=str(project),worktree=str(worker))
    bus.emit('pre_worktree_setup',ctx)
    veto=ctx.resolved_veto()
    assert veto and veto.action == 'defer' and 'exited' in veto.reason
    assert any(r['kind']=='plugin-hook' and r.get('plugin')=='npm-bootstrap' and r.get('rc',0)!=0 for r in journal.rows)
    results['cases'].append(dict(name='actual npm ci without lockfile',veto=asdict(veto)))
    # A real subprocess transport failure, using the same installed native bus.
    ctx=HookContext('pre_worktree_setup',repo_root=str(project),worktree=str(worker/'absent'))
    bus.emit('pre_worktree_setup',ctx)
    veto=ctx.resolved_veto()
    assert veto and veto.action == 'defer' and 'errored' in veto.reason
    results['cases'].append(dict(name='actual missing cwd transport failure',veto=asdict(veto)))
    # Each actual production-manifest guard runs with its own symlink fixture.
    for directory in ('node_modules', '.svelte-kit'):
        external=worker/f'external-{directory}'
        external.mkdir()
        link=worker/directory
        link.symlink_to(external, target_is_directory=True)
        ctx=HookContext('pre_worktree_setup',run_id='verification-only',repo_root=str(project),worktree=str(worker))
        bus.emit('pre_worktree_setup',ctx)
        veto=ctx.resolved_veto()
        assert veto and veto.action == 'defer' and 'must belong to this worker' in veto.reason
        results['cases'].append(dict(name=f'actual {directory} symlink refusal',veto=asdict(veto)))
        link.unlink()
    # Isolated harmless timeout fixture: exec replaces the shell with sleep, so
    # native subprocess termination cannot leave an installer descendant behind.
    # Only command and timeout differ from the verified production hook flags.
    timeout_journal=Journal()
    timeout_hook=replace(hook,cmd='exec sleep 5',timeout_sec=1)
    timeout_manifest=replace(loaded.manifest,hooks=(timeout_hook,))
    timeout_registry=PluginRegistry([LoadedPlugin(manifest=timeout_manifest)])
    timeout_bus=HookBus(timeout_registry,journal=timeout_journal)
    ctx=HookContext('pre_worktree_setup',run_id='timeout-fixture-only',repo_root=str(project),worktree=str(worker))
    timeout_bus.emit('pre_worktree_setup',ctx)
    veto=ctx.resolved_veto()
    assert veto and veto.action == 'defer' and 'timed out after 1s' in veto.reason
    assert any(r['kind']=='plugin-hook-error' and 'timed out' in r.get('error','') for r in timeout_journal.rows)
    results['timeout_fixture']=dict(command=timeout_hook.cmd,timeout_sec=1,blocking=timeout_hook.blocking,
        fail_closed=timeout_hook.fail_closed,veto=asdict(veto),journal=timeout_journal.rows)
results['journal']=journal.rows
print(json.dumps(results,indent=2))
