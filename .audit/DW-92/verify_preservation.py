from pathlib import Path
import subprocess, json, yaml
entry='137d77f87db77d8296f5e759ebfa7e2a55709c25'
spec='_bmad-output/specs/spec-ai-engine-sprint-2-boundary/lanes/qa/stories/8-blocking-qa-policy.md'
git=lambda *a:subprocess.check_output(['git',*a],text=True)
before=git('show',entry+':'+spec)
after=Path(spec).read_text()
front=lambda s:yaml.safe_load(s.split('---',2)[1])
contract=lambda s:s.split('<intent-contract>',1)[1].split('</intent-contract>',1)[0]
assert contract(before)==contract(after)
assert front(before)['deferred']==front(after)['deferred']
assert front(before)['baseline_revision']==front(after)['baseline_revision']
assert before.split('## Auto Run Result\n',1)[1].strip() in after
assert before.split('## Review Triage Log\n',1)[1].split('## Design Notes',1)[0].strip() in after
names=git('diff','--name-only',entry).splitlines()
assert not any(p.startswith(('src/','convex/_generated/')) or 'deferred-work' in p for p in names)
result=dict(entry=entry,frozen_contract_unchanged=True,deferred_unchanged=True,baseline_unchanged=True,prior_result_preserved=True,prior_reviews_preserved=True,frontend_generated_and_ledger_unchanged=True)
Path('.audit/DW-92/preservation.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
