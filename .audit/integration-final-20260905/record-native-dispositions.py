from pathlib import Path
import dataclasses, datetime, difflib, hashlib, json, os, subprocess
from bmad_loop import deferredwork

root = Path.cwd()
audit = root / '.audit/integration-final-20260905'
ledger = root / '_bmad-output/implementation-artifacts/deferred-work.md'
head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
assert head == '569158a2b31ad0a7bf8ff1ba1e63a8634cc6f54c'
verification = json.loads((audit / 'final-gates/final-verification.json').read_text())
assert verification['head'] == head and verification['gates'] == 'all three exact-head receipts passed'
assert not json.loads((audit / 'final-gates/test-discovery-receipt.json').read_text())['orphans']
state_path = Path('/Users/johnnynguyen/Documents/Repos/Banhall-bmad-learn-chat/.bmad-loop/runs/20260904-133944-0158/state.json')
state_bytes = state_path.read_bytes()
state = json.loads(state_bytes)
assert state['finished'] and all(task['phase'] == 'done' for task in state['tasks'].values())
engine = subprocess.run(['ps', '-p', '51590', '-o', 'pid='], capture_output=True, text=True)
assert engine.returncode == 1 and not engine.stdout.strip(), 'Recorded native engine is unexpectedly live'
for filename, digest in json.loads((audit / 'final-gates/source-before.json').read_text()).items():
    path = root / filename
    content = os.readlink(path).encode() if path.is_symlink() else path.read_bytes()
    assert hashlib.sha256(content).hexdigest() == digest, filename

ids = ['DW-94', 'DW-95', 'DW-96', 'DW-97', 'DW-98', 'DW-99']
common = ' Final combined source569158a2b31ad0a7bf8ff1ba1e63a8634cc6f54c passed1970 unit and463 browser tests, both type checks, uploader suites and build; .audit/integration-final-20260905/final-gates/final-verification.json. Review-budget follow-up satisfied.'
notes = [
    'Independent structural QA audit found no remaining in-contract finding; five reviewed source/test hashes still match final source. Native acceptancebdf5d0e34cdd23dd17f74baf5be5f6d2ca32096d; .audit/integration-final-20260905/final-acceptance-preflight.md and .audit/integration-code-review-9da55be/qa-structural-boundary-input/manifest.json.' + common,
    'Independent PED acceptance audit found no actionable defect; later native malformed-content repair was independently reviewed and all eight PED paths remain unchanged from reviewed e13e625. Native acceptanceb984822a8aeb70b7eb48a5d617ed18846392b1d2; .audit/integration-code-review-9da55be/ped-native-acceptance-audit.md and .audit/integration-final-20260905/final-acceptance-preflight.md.' + common,
    'Independent digest follow-up identified and repaired causal generation-error masking; integrated e8aa3eb96eba48ed5826609939242ac899242387. Reviewed repair and baseline failure/pass evidence: .audit/learning-monitor-20260904/DW-96-independent-review.md and DW-96-root-receipt.json.' + common,
    'Independent regenerate follow-up repaired active research identity retention through publication/list displacement; integrated daa4cf82e8c76fcb584f2bbf301d66b4608fad68. Review and real browser proof: .audit/learning-monitor-20260904/DW-97-independent-review.md and DW-97-fix-result.md.' + common,
    'Independent optimistic-send follow-up repaired initial implicit conversation creation intent across failed send, navigation and retry; integrated8c8080576d30c919f825e12f4b786f3f28b86b8f. Review and baseline failure/pass proof: .audit/learning-monitor-20260904/DW-98-independent-review.md and DW-98-root-receipt.json. Final separate confirmed-status repair integrated569158a.' + common,
    'Independent learning-health follow-up added order-sensitive capped rerank cohort coverage with an actual wrong-order failing control; integrated e3f23432121b6d3145cff7040c485ac28739a25f. Review and verified source identity: .audit/learning-monitor-20260904/DW-99-independent-review.md and DW-99-root-receipt.json.' + common,
]
before_bytes = ledger.read_bytes()
before = before_bytes.decode()
classification = deferredwork.classify(before, ids)
assert classification.open_ids == tuple(ids)
assert not (classification.already_done or classification.unknown or classification.malformed or classification.duplicates)
plan = {'source_revision': head, 'ids': ids, 'notes': dict(zip(ids, notes)), 'classification': dataclasses.asdict(classification), 'before_sha256': hashlib.sha256(before_bytes).hexdigest(), 'method': 'Installed native bmad_loop.deferredwork.mark_done_many, one scoped atomic public-API call. Not a CLI sweep, no native story-state rewrite.', 'native_state_sha256': hashlib.sha256(state_bytes).hexdigest(), 'recorded_native_engine_alive': False, 'native_module': deferredwork.__file__}
(audit / 'native-disposition-before.md').write_bytes(before_bytes)
(audit / 'native-disposition-plan.json').write_text(json.dumps(plan, indent=2) + '\n')
changed = deferredwork.mark_done_many(ledger, ids, datetime.datetime.now(datetime.timezone.utc).date().isoformat(), 'verified independent follow-up', notes=notes)
assert changed == ids, changed

after_bytes = ledger.read_bytes()
after = after_bytes.decode()
assert deferredwork.classify(after, ids).already_done == tuple(ids)
old_entries = {entry.id: entry for entry in deferredwork.parse_ledger(before)}
restored = []
cursor = 0
for entry in deferredwork.parse_ledger(after):
    if entry.id in ids:
        old = old_entries[entry.id]
        restored.extend([after[cursor:entry.span[0]], before[old.span[0]:old.span[1]]])
        cursor = entry.span[1]
restored.append(after[cursor:])
assert ''.join(restored) == before, 'Unrelated ledger bytes changed'
(audit / 'native-disposition-after.md').write_bytes(after_bytes)
(audit / 'native-disposition.diff').write_text(''.join(difflib.unified_diff(before.splitlines(True), after.splitlines(True), fromfile='before native API', tofile='after native API')))
receipt = {**plan, 'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'changed': changed, 'after_sha256': hashlib.sha256(after_bytes).hexdigest(), 'unrelated_bytes_unchanged': True, 'native_module_sha256': hashlib.sha256(Path(deferredwork.__file__).read_bytes()).hexdigest(), 'script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
(audit / 'native-disposition-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps({'changed': changed, 'before_sha256': receipt['before_sha256'], 'after_sha256': receipt['after_sha256'], 'unrelated_bytes_unchanged': True}, indent=2))
