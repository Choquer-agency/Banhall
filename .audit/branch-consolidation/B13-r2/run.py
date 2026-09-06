from pathlib import Path
import subprocess,json,sys
p=Path(__file__).parent
phase=sys.argv[1]
commands={
'helper':'node node_modules/vitest/vitest.mjs run src/lib/components/editor/docSearch.test.ts --expect.requireAssertions',
'component':'node node_modules/vitest/vitest.mjs run --config vitest.component.config.ts src/lib/components/editor/Editor.component.test.ts --expect.requireAssertions',
'benchmark':'node scripts/bench/editor-search.mjs',
'check':'PUBLIC_CONVEX_URL=https://placeholder.convex.cloud PUBLIC_CONVEX_SITE_URL=https://placeholder.convex.site npm run check',
'component-all':'npm run test:component',
'diff':'git diff --check',
}
for key in sys.argv[2:]:
 cmd=commands[key]
 r=subprocess.run(cmd,shell=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
 (p/f'{phase}-{key}.log').write_text(r.stdout)
 with (p/'commands.jsonl').open('a') as f: f.write(json.dumps({'phase':phase,'command':cmd,'exit':r.returncode})+'\n')
 print(key,'exit',r.returncode, r.stdout[-1500:],flush=True)
