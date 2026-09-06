from pathlib import Path
import hashlib,json,subprocess
out=Path(__file__).parent
allow=set(json.loads((out/'allowlist.json').read_text()))
baseline=json.loads((out/'baseline-hashes.json').read_text())
changed=[p for p,h in baseline.items() if p not in allow and (not Path(p).is_file() or hashlib.sha256(Path(p).read_bytes()).hexdigest()!=h)]
assert not changed,changed
assert all(not Path(p).exists() for p in allow)
diff=subprocess.check_output(['git','diff','--name-status']).decode().splitlines()
assert set(diff)=={'D\t'+p for p in allow},diff
assert not subprocess.check_output(['git','diff','--cached','--name-only'])
subprocess.run(['git','diff','--check'],check=True)
cases=[]
for i in range(1,4):
 def identities(phase):
  j=json.loads((out/f'{phase}-cases-{i}.json').read_text())
  assert j['numFailedTests']==0 and j['numPendingTests']==0
  return sorted((t['name'],a['fullName'],a['status']) for t in j['testResults'] for a in t['assertionResults'])
 before,after=identities('before'),identities('after');assert before==after
 cases.extend(after)
(out/'retained-case-parity.json').write_text(json.dumps(cases,indent=2)+'\n')
def discovered(phase):
 result=set()
 for config in ['vitest.config.ts','vitest.component.config.ts']:
  for entry in json.loads((out/f'{phase}-discovery-{config}.json').read_text()):result.add(str(Path(entry['file']).relative_to(Path.cwd())))
 return result
before,after=discovered('before'),discovered('after')
removed={p for p in allow if p.endswith('.test.ts')}
assert before-after==removed and not after-before
archives={'.audit/integration-code-review-9da55be/qa-structural-boundary-input/'+p for p in ['convex/ai/qaChecks.test.ts','convex/lib/tiptapReport.test.ts','convex/qaBlocking.test.ts']}
tracked={p for p in baseline if p.endswith('.test.ts')}
orphans=(tracked-removed)-after-archives;assert not orphans,orphans
summary={'retained_cases_identical':len(cases),'before_discovered_unique':len(before),'after_discovered_unique':len(after),'removed_suites':sorted(removed),'retained_tracked_orphans':sorted(orphans),'unchanged_other_tracked_files':len(baseline)-len(allow),'exact_deleted_files':len(allow),'staged_changes':False,'diff_check_exit':0}
(out/'comparison.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary,indent=2))
