import json,pathlib,subprocess
p=pathlib.Path('.audit/branch-consolidation/B7')
old=json.loads((p/'before-package-lock.json').read_text())
assert pathlib.Path('package-lock.json').read_bytes()==(p/'ad9952f-package-lock.json').read_bytes()
new=json.loads(pathlib.Path('package-lock.json').read_text())
manifest=json.loads((p/'before-package.json').read_text())
expected=json.loads(json.dumps(manifest))
for name in ['docx','svelte-exmarkdown','tippy.js']: del expected['dependencies'][name]
for name in ['eslint','@types/bun']: del expected['devDependencies'][name]
assert expected==json.loads((p/'ad9952f-package.json').read_text())
assert expected==json.loads(pathlib.Path('package.json').read_text())
source_parent='8649315de144a7e424c12ff461046d5ec8e58ddd^'
for name in ['package.json','package-lock.json']:
 assert (p/('before-'+name)).read_bytes()==subprocess.check_output(['git','show',source_parent+':'+name]), name+' baseline differs from source parent'
a=old['packages'];b=new['packages'];removed=sorted(a.keys()-b.keys());added=sorted(b.keys()-a.keys())
assert len(removed)==146 and not added
changed={k for k in a.keys()&b.keys() if a[k]!=b[k]}
assert changed=={'','node_modules/debug','node_modules/ms'}
for k in b:
 if k=='':continue
 assert all(a[k].get(f)==b[k].get(f) for f in ['version','resolved','integrity','dependencies','optionalDependencies','peerDependencies','peerDependenciesMeta'])
 if k in changed:
  entry=dict(a[k]);entry['dev']=True;assert entry==b[k]
for section in ['dependencies','devDependencies']:assert b[''][section]==expected[section]
assert {k:v for k,v in old.items() if k!='packages'}=={k:v for k,v in new.items() if k!='packages'}
def resolve(packages,origin,name):
 parts=origin.split('/') if origin else []
 while True:
  candidate='/'.join(parts+['node_modules',name])
  if candidate in packages:return candidate
  if not parts:return None
  parts.pop()
  if parts and parts[-1]=='node_modules':parts.pop()
def graph(packages,root):
 seen={''}; queue=['']; edges=[];missing=[]
 while queue:
  origin=queue.pop();entry=root if origin=='' else packages[origin]
  for kind in ['dependencies','optionalDependencies','peerDependencies']+(['devDependencies'] if origin=='' else []):
   for name,version in entry.get(kind,{}).items():
    target=resolve(packages,origin,name)
    optional=kind=='optionalDependencies' or name in entry.get('optionalDependencies',{}) or (kind=='peerDependencies' and entry.get('peerDependenciesMeta',{}).get(name,{}).get('optional',False))
    edges.append({'from':origin,'kind':kind,'name':name,'range':version,'target':target,'optional':optional})
    if target is None:
     missing.append(edges[-1])
    elif target not in seen:seen.add(target);queue.append(target)
 return seen,edges,missing
seen,edges,missing=graph(a,b[''])
assert not (set(removed)&seen), 'Removed reachable package'
baseline_seen,baseline_edges,baseline_missing=graph(a,a[''])
assert all(x in baseline_missing for x in missing), 'New missing edge'
newseen,newedges,newmissing=graph(b,b[''])
assert seen==newseen
assert newmissing==missing, 'Missing edges changed'
report={'source_parent_inputs_byte_identical':True,'before_entries':len(a),'after_entries':len(b),'removed':removed,'added':added,'changed':sorted(changed),'survivor_tuples_equal':True,'retained_root_reachable_count':len(seen),'unreachable_survivors':sorted(b.keys()-newseen),'removed_reachable':sorted(set(removed)&seen),'missing_edges_unchanged_from_baseline':newmissing,'edges':newedges}
(p/'graph-proof.json').write_text(json.dumps(report,indent=2)+'\n')
for label,packages in [('before',a),('after',b)]:
 (p/(label+'-lock-tuples.json')).write_text(json.dumps({k:{f:v.get(f) for f in ['version','resolved','integrity']} for k,v in packages.items()},indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k not in ['edges','removed','missing_edges_unchanged_from_baseline']},indent=2))
