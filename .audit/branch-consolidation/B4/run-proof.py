import json, subprocess, sys, shlex, datetime
from pathlib import Path
out=Path(__file__).parent
phase=sys.argv[1]
commands=json.loads((out/'retained-commands.json').read_text())
def run(label,cmd):
    start=datetime.datetime.now(datetime.timezone.utc).isoformat()
    with (out/f'{phase}-{label}.log').open('w') as log:
        p=subprocess.run(cmd,shell=True,stdout=log,stderr=subprocess.STDOUT)
    with (out/'commands.jsonl').open('a') as f:
        f.write(json.dumps(dict(phase=phase,label=label,command=cmd,start=start,exit=p.returncode))+'\n')
    print(f'{phase}-{label}: exit {p.returncode}',flush=True)
    if p.returncode: print((out/f'{phase}-{label}.log').read_text()[-7000:],flush=True);sys.exit(p.returncode)
for i,cmd in enumerate(commands,1): run(f'retained-{i}',cmd)
for i,cmd in enumerate(commands,1):
    run(f'cases-{i}',cmd+f' --reporter=json --outputFile={out}/{phase}-cases-{i}.json')
if phase=='before':
    run('retired-component',f'node node_modules/vitest/vitest.mjs run --config vitest.component.config.ts src/lib/components/mywork/MyWorkRow.component.test.ts --reporter=json --outputFile={out}/retired-component.json')
    run('retired-unit',f'node node_modules/vitest/vitest.mjs run src/lib/mywork/laneSort.test.ts src/lib/mywork/myWorkPreferences.test.ts --reporter=json --outputFile={out}/retired-unit.json')
for config in ['vitest.config.ts','vitest.component.config.ts']:
    run('discovery-'+config,f'node node_modules/vitest/vitest.mjs list --filesOnly --json={out}/{phase}-discovery-{config}.json --config {config}')
