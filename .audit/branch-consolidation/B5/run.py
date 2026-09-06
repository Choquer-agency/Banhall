import subprocess,sys,json,time
from pathlib import Path
p=Path(__file__).parent
phase=sys.argv[1]
commands={
'unit':'node node_modules/vitest/vitest.mjs run src/lib/workspace/projectIntentHandoff.test.ts src/lib/workspace/stageRankGroups.test.ts src/lib/dashboard/stageFilter.test.ts convex/dashboardStageCounts.test.ts convex/dashboard.test.ts',
'component':'node node_modules/vitest/vitest.mjs run --config vitest.component.config.ts src/routes/project/new/newProjectPrefill.component.test.ts src/lib/components/workspace/ProjectsClientGroups.component.test.ts src/lib/components/workspace/ProjectsTableView.component.test.ts src/lib/components/workspace/ProjectsDisplayMenu.component.test.ts src/lib/components/editor/Editor.component.test.ts',
'underline':'node .audit/branch-consolidation/B5/underline-registration-proof.mjs',
'identity':'node --version && npm --version && git rev-parse HEAD && git show --no-patch --format=fuller fb6c6b5d68e761cdab0b02975d9670c230f5e060 0017ee6259fa2bdc4a23c3c13305273a2eee06de && git log -8 --oneline',
'diff':'git diff --check',
'convex-typecheck':'node node_modules/typescript/bin/tsc --noEmit -p convex/tsconfig.json',
}
for key in sys.argv[2:]:
 cmd=commands[key]; start=time.time()
 r=subprocess.run(cmd,shell=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
 (p/f'{phase}-{key}.log').write_bytes(r.stdout)
 with (p/'commands.jsonl').open('a') as f: f.write(json.dumps(dict(phase=phase,key=key,command=cmd,exit=r.returncode,seconds=time.time()-start))+'\n')
 print(phase,key,r.returncode,r.stdout.decode()[-700:],flush=True)
