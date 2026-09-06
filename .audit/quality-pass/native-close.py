#!/Users/johnnynguyen/.local/share/uv/tools/bmad-loop/bin/python
"""Root-owned native closure. prepare/finalize are read-only for the ledger."""
import argparse
from datetime import datetime, timezone, date
import hashlib
import importlib.metadata
import inspect
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from bmad_loop import deferredwork as dw

ROOT = Path('/Users/johnnynguyen/Documents/Repos/Banhall-quality-pass')
LEDGER = '_bmad-output/implementation-artifacts/deferred-work.md'
TARGETS = ['DW-103', 'DW-104', 'DW-105']
OUT = ROOT / '.audit/quality-pass/native-closure-preflight'
NATIVE_SHA = '170c14c0e2d874238d73ad060bf59b49050e73713a853ef7dc7fb7271cc9d872'
BREAKS = re.compile(r'[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]')

def require(ok, message):
    if not ok:
        raise RuntimeError(message)

def sha(data):
    return hashlib.sha256(data).hexdigest()

def git(*args):
    return subprocess.check_output(['git', '-C', str(ROOT), *args])

def stamp():
    return datetime.now(timezone.utc).isoformat()

def local_path(name):
    p = ROOT / name
    require(not Path(name).is_absolute() and '..' not in Path(name).parts, f'Unsafe path: {name}')
    require(p.resolve().is_relative_to(ROOT.resolve()), f'Escaping path: {name}')
    require(p.is_file() and not p.is_symlink(), f'Not regular local file: {name}')
    return p

def read_json(path):
    return json.loads(path.read_text())

def exclusive(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('xb') as f:
        f.write(data)
        f.flush()
        import os
        os.fsync(f.fileno())

def save(path, obj):
    exclusive(path, (json.dumps(obj, indent=2) + '\n').encode())

def source_paths():
    names = git('ls-files', '-z', '--cached', '--others', '--exclude-standard').decode().split('\0')
    return sorted({n for n in names if n and not n.startswith('.audit/') and n != LEDGER})

def hygiene():
    require(not git('ls-files', '-u'), 'Unmerged index entries')
    for args in [('diff', '--check'), ('diff', '--cached', '--check')]:
        result = subprocess.run(['git', '-C', str(ROOT), *args], capture_output=True)
        require(result.returncode == 0, 'Git whitespace/path check failed: ' + result.stdout.decode())

def native_identity():
    p = Path(inspect.getsourcefile(dw))
    digest = sha(p.read_bytes())
    require(digest == NATIVE_SHA, 'Native API changed; review installed source before proceeding')
    return {'path': str(p), 'sha256': digest, 'version': importlib.metadata.version('bmad-loop')}

def verify_input(data):
    require(data['root'] == str(ROOT), 'Wrong checkout')
    require(data['head'] == git('rev-parse', 'HEAD').decode().strip(), 'HEAD differs from gate evidence')
    require(data['q8_accepted'] is True and data['exclusive_ledger_writer'] is True,
            'Root must attest Q8 acceptance and exclusive ledger ownership')
    require(data['errors'] == {'gate': [], 'code': [], 'index': [], 'path': []}, 'Acceptance errors remain')
    date.fromisoformat(data['date'])
    require(re.fullmatch(r'\d{4}-\d{2}-\d{2}', data['date']) is not None, 'Invalid native date')
    require(list(data['notes']) == TARGETS, 'Exact ordered target notes required')
    for note in data['notes'].values():
        require(isinstance(note, str) and note.strip() and not BREAKS.search(note), 'Notes must be nonempty single lines')
    paths = source_paths()
    require(set(data['source_hashes']) == set(paths), 'Gate source manifest must cover all non-audit files except ledger')
    for name in paths:
        path = ROOT / name
        require(not Path(name).is_absolute() and '..' not in Path(name).parts, f'Unsafe source path: {name}')
        raw = os.fsencode(os.readlink(path)) if path.is_symlink() else local_path(name).read_bytes()
        require(sha(raw) == data['source_hashes'][name], f'Gate source drift: {name}')
    evidence = data['evidence_hashes']
    require(evidence and set(data['target_evidence']) == set(TARGETS), 'Per-target evidence required')
    for target in TARGETS:
        require(data['target_evidence'][target], f'Missing evidence: {target}')
        require(all(p in evidence for p in data['target_evidence'][target]), 'Unhashed target evidence')
    for name, digest in evidence.items():
        require(sha(local_path(name).read_bytes()) == digest, f'Evidence drift: {name}')
    require(data['gate_result'] in evidence and data['gate_log'] in evidence, 'Gate receipt/log must be bound')
    gate = read_json(local_path(data['gate_result']))
    require(gate['command'] == 'VERIFY_COMPONENT=1 bash scripts/loop-verify.sh', 'Wrong final gate command')
    require(gate['exit_code'] == 0 and gate['unexpected_changed_paths'] == [], 'Gate failed or changed unexpected paths')
    require(gate['log_sha256'] == evidence[data['gate_log']], 'Gate log receipt mismatch')
    require(gate['tracked_and_nonignored_paths_verified'] > 0 and gate['index_unchanged'] is True, 'Empty or dirty gate evidence')
    require(gate['head'] == data['head'], 'Gate HEAD mismatch')
    for key in ['gate_source_before', 'gate_source_after']:
        require(data[key] in evidence, 'Gate source manifests must be bound')
        manifest = read_json(local_path(data[key]))
        covered = {name: record for name, record in manifest.items() if not name.startswith('.audit/') and name != LEDGER}
        require(set(covered) == set(paths), 'Gate-time source coverage mismatch')
        for name, record in covered.items():
            digest = sha(os.fsencode(record['target'])) if record['kind'] == 'symlink' else record['sha256']
            require(digest == data['source_hashes'][name], f'Gate-time source hash mismatch: {name}')
    hygiene()

def ledger_entries(raw):
    text = raw.decode('utf-8')
    require('\r' not in text, 'Unexpected ledger line endings')
    entries = dw.parse_ledger(text)
    require(len(entries) == 105 and len({e.id for e in entries}) == 105, 'Expected 105 unique ledger entries')
    return text, entries

def verify_before(raw):
    text, entries = ledger_entries(raw)
    by_id = {e.id: e for e in entries}
    for key in TARGETS:
        require(key in by_id and by_id[key].open and by_id[key].status_span is not None, f'Target is not uniquely open: {key}')
    return text, entries

def verify_delta(before, after, data):
    text, entries = verify_before(before)
    after_text, after_entries = ledger_entries(after)
    require([e.id for e in entries] == [e.id for e in after_entries], 'Ledger ID/order change')
    after_by_id = {e.id: e for e in after_entries}
    # Construct expected text in memory solely for comparison; never publish it.
    expected = text
    for entry in reversed(entries):
        if entry.id in TARGETS:
            start, end = entry.status_span
            replacement = f"status: done {data['date']}\nresolution: {data['notes'][entry.id]}"
            start += entry.span[0]
            end += entry.span[0]
            expected = expected[:start] + replacement + expected[end:]
        else:
            require(entry.body.encode() == after_by_id[entry.id].body.encode(), f'Other entry changed: {entry.id}')
    require(expected.encode() == after, 'Unexpected target or outside-target text change')
    for key in TARGETS:
        require(after_by_id[key].status == f"done {data['date']}", f'Closure status mismatch: {key}')
    return {'preserved_other_entries': 102, 'only_native_status_and_resolution_changes': True}

def invocation():
    p = OUT / 'invocation.json'
    record = read_json(p)
    require(record['script_sha256'] == sha(Path(__file__).read_bytes()), 'Closure script changed after prepare')
    require(record['native'] == native_identity(), 'Native identity drift')
    verify_input(record['acceptance'])
    require(sha((OUT / 'ledger-before.snapshot').read_bytes()) == record['before_sha256'], 'Before snapshot drift')
    return record

def prepare(args):
    data = read_json(local_path(args.acceptance))
    identity = native_identity()
    verify_input(data)
    before = local_path(LEDGER).read_bytes()
    verify_before(before)
    require(not (OUT / 'invocation.json').exists() and not (OUT / 'execute-start.json').exists(), 'Existing invocation; do not overwrite')
    record = {'created_at': stamp(), 'acceptance': data, 'native': identity,
              'script_sha256': sha(Path(__file__).read_bytes()), 'before_sha256': sha(before),
              'before_git_blob': blob(before),
              'index_sha256': sha(git('ls-files', '--stage', '-z')),
              'api': 'bmad_loop.deferredwork.mark_done_many'}
    exclusive(OUT / 'ledger-before.snapshot', before)
    save(OUT / 'invocation.json', record)
    print('Prepared invocation only; ledger unchanged')

def blob(raw):
    return subprocess.check_output(['git', '-C', str(ROOT), 'hash-object', '--stdin'], input=raw).decode().strip()

def execute(args):
    record = invocation()
    require(record['index_sha256'] == sha(git('ls-files', '--stage', '-z')), 'Index changed since prepare')
    before = local_path(LEDGER).read_bytes()
    require(sha(before) == record['before_sha256'], 'Ledger changed since prepare')
    verify_before(before)
    # Durable attempt marker prevents automatic retry after an uncertain write.
    save(OUT / 'execute-start.json', {'at': stamp(), 'invocation_sha256': sha((OUT / 'invocation.json').read_bytes())})
    data = record['acceptance']
    closed = dw.mark_done_many(ROOT / LEDGER, TARGETS, data['date'], '', notes=[data['notes'][k] for k in TARGETS])
    after = local_path(LEDGER).read_bytes()
    exclusive(OUT / 'ledger-after.snapshot', after)
    save(OUT / 'native-return.json', {'at': stamp(), 'returned_ids': closed, 'after_sha256': sha(after)})
    require(closed == TARGETS, 'Native returned partial/unexpected IDs; no automatic retry or rollback')
    checks = verify_delta(before, after, data)
    verify_input(data)
    save(OUT / 'closure.json', {'at': stamp(), 'invocation_sha256': sha((OUT / 'invocation.json').read_bytes()),
        'api': record['api'], 'native': record['native'], 'closed_ids': closed,
        'before_sha256': sha(before), 'after_sha256': sha(after), 'after_git_blob': blob(after), **checks})
    print('Native closure verified; nothing staged')

def finalize(args):
    record = invocation()
    closure = read_json(OUT / 'closure.json')
    require(closure['invocation_sha256'] == sha((OUT / 'invocation.json').read_bytes()), 'Closure invocation mismatch')
    after = (OUT / 'ledger-after.snapshot').read_bytes()
    require(sha(after) == closure['after_sha256'], 'After snapshot mismatch')
    require(local_path(LEDGER).read_bytes() == after, 'Working ledger differs from native snapshot')
    require(git('show', ':' + LEDGER) == after, 'Staged ledger differs from native snapshot')
    checks = verify_delta((OUT / 'ledger-before.snapshot').read_bytes(), after, record['acceptance'])
    save(OUT / 'finalization.json', {'at': stamp(), 'working_and_staged_match_native_snapshot': True,
        'sha256': sha(after), 'git_blob': blob(after), **checks})
    print('Staged bytes verified; no staging/commit performed')

def main():
    require(Path.cwd().resolve() == ROOT.resolve(), 'Run from assigned checkout')
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    prep = commands.add_parser('prepare')
    prep.add_argument('--acceptance', required=True, help='Root-authored acceptance JSON, checkout-relative path')
    commands.add_parser('execute')
    commands.add_parser('finalize')
    args = parser.parse_args()
    globals()[args.command](args)

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'FAILED: {error}', file=sys.stderr)
        sys.exit(1)
