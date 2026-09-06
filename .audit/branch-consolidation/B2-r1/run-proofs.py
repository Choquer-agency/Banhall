import subprocess,pathlib,json,hashlib
out=pathlib.Path('.audit/branch-consolidation/B2-r1')
def run(name,cmd):
 with (out/(name+'.log')).open('w') as f: r=subprocess.run(cmd,shell=True,stdout=f,stderr=subprocess.STDOUT)
 sources={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in [pathlib.Path('src/lib/components/editor/Editor.svelte'),pathlib.Path('src/lib/components/editor/docSearch.ts'),pathlib.Path('src/lib/components/editor/Editor.component.test.ts'),pathlib.Path('src/lib/components/editor/docSearch.test.ts')]}
 (out/(name+'.json')).write_text(json.dumps({'command':cmd,'exit':r.returncode,'sources':sources},indent=2)+'\n')
 print(name,r.returncode,flush=True)
 return r.returncode
browser='node node_modules/vitest/vitest.mjs run --config vitest.component.config.ts src/lib/components/editor/Editor.component.test.ts --expect.requireAssertions'
unit='node node_modules/vitest/vitest.mjs run src/lib/components/editor/docSearch.test.ts --expect.requireAssertions'
run('final-browser',browser)
run('final-unit',unit)
run('final-bench','node scripts/bench/editor-search.mjs')
run('authority','node node_modules/vitest/vitest.mjs run convex/chatProposals.test.ts tests/chatProposals.test.ts --expect.requireAssertions')
editor=pathlib.Path('src/lib/components/editor/Editor.svelte')
helper=pathlib.Path('src/lib/components/editor/docSearch.ts')
e=editor.read_bytes(); h=helper.read_bytes()
controls=[
 ('control-preview',editor,'findOccurrencesBatch(doc, diffs.map((d) => d.find))','diffs.map((d) => findAllOccurrencesCI(doc, d.find))',browser+' -t "batches actual preview"'),
 ('control-find',editor,'findOccurrencesBatch(editor.state.doc, pairs.map((p) => p.find))','pairs.map((p) => findAllOccurrencesCI(editor.state.doc, p.find))',browser+' -t "batches actual findReplaceMatches"'),
 ('control-helper',helper,'  const index = buildSearchIndex(doc);','  if (finds.length > 1) return finds.map((find) => findOccurrencesBatch(doc, [find])[0]);\n  const index = buildSearchIndex(doc);',unit+' -t "batch cost"'),
 ('control-empty',helper,' || normalized.every((n) => !n)','',unit+' -t "does not walk"'),
]
for name,p,old,new,cmd in controls:
 original=p.read_bytes()
 try:
  source=original.decode(); assert source.count(old)==1
  p.write_text(source.replace(old,new))
  (out/(name+'.snapshot')).write_bytes(p.read_bytes())
  assert run(name,cmd)!=0, name+' failed to detect mutation'
 finally:
  p.write_bytes(original)
 assert editor.read_bytes()==e and helper.read_bytes()==h
run('restored-browser',browser)
run('restored-unit',unit)
run('diff-check','git diff --check')
