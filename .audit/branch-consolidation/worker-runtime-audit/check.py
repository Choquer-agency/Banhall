from pathlib import Path
import json,re,hashlib,gzip,collections
root=Path.cwd(); base=root/'.audit/branch-consolidation'; out=base/'worker-runtime-audit'
batches=['B1','B12','B2','B2-r1','B13','B13-r1','B13-r2','B3','B4','B5','B5-r1']
rows=[]
def read(p):return gzip.decompress(p.read_bytes()).decode() if p.suffix=='.gz' else p.read_text()
def artifact(p):return {'path':str(p.relative_to(root)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size}
for batch in batches:
 for role in ['implementation','review-blind','review-edge','review-gap']:
  d=base/batch; ex=d/(role+'-exit.json'); ej=json.loads(ex.read_text())
  dp=d/(role+'-dispatch.json')
  if batch=='B1' and role=='implementation':dp=d/'dispatch.json'
  lp=d/(role+'.log')
  if batch=='B2-r1' and role=='implementation':lp=d/'initial-save-probe/implementation.log';dp=d/'initial-save-probe/implementation-dispatch.json'
  if not lp.exists():lp=Path(str(lp)+'.gz')
  text=read(lp);header={}
  for key in ['workdir','model','reasoning effort','sandbox','session id']:
   m=re.search(r'^'+re.escape(key)+r': (.+)$',text,re.M);header[key]=m.group(1) if m else None
  dj=json.loads(dp.read_text()) if dp.exists() else None
  argv=(dj or ej).get('argv',[])
  rp=Path(argv[argv.index('--output-last-message')+1]) if '--output-last-message' in argv else d/(role+('.md' if batch=='B1' and role.startswith('review') else '-result.md'))
  code=ej.get('exit_code',ej.get('exit'))
  completion=ej.get('completed_at',ej.get('finished_at',ej.get('end')))
  warn=[l[:500] for l in text.splitlines() if re.search(r'(WARN|ERROR|mcp).*?(startup|shutdown|timed out|failed|transport|discrepancy|icon_|closed)',l,re.I)]
  row={'batch':batch,'role':role,'header':header,'exit':code,'completed_at':completion,'result':artifact(rp) if rp.exists() else None,'log':artifact(lp),'exit_receipt':artifact(ex),'dispatch':artifact(dp) if dp.exists() else None,'dispatch_argv_matches': None if not argv else ('gpt-6-astra' in argv and 'model_reasoning_effort="medium"' in argv),'header_matches':header['workdir']==str(root) and header['model']=='gpt-6-astra' and header['reasoning effort']=='medium','warning_count':len(warn),'warning_examples':list(dict.fromkeys(re.sub(r'^\S+\s+','',x) for x in warn))[:5]}
  row['complete']=code==0 and bool(completion) and rp.exists() and rp.stat().st_size>0
  rows.append(row)
summary={'scope':batches,'implementation_workers':sum(r['role']=='implementation' for r in rows),'review_workers':sum(r['role']!='implementation' for r in rows),'review_rounds':len(batches),'distinct_sessions':len({r['header']['session id'] for r in rows}),'all_headers_match':all(r['header_matches'] for r in rows),'all_completed_exit0':all(r['complete'] for r in rows),'failures':[r for r in rows if not(r['header_matches'] and r['complete'])],'pending_excluded':['B6'],'rows':rows}
(out/'receipts.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps({k:v for k,v in summary.items() if k!='rows'},indent=2))
for r in rows:
 if r['warning_count']:print(r['batch'],r['role'],r['warning_count'],r['warning_examples'][:1])
