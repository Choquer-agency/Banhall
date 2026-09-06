from pathlib import Path
import concurrent.futures, datetime, hashlib, json, os, re, subprocess, sys

root = Path(__file__).resolve().parents[2]
os.chdir(root)
mode, batch, spec_name = sys.argv[1:4]
spec = root / '_bmad-output/implementation-artifacts' / spec_name
out = root / '.audit/branch-consolidation' / batch
out.mkdir(parents=True, exist_ok=True)
render = root / '_bmad/render/bmad-build/banhall-branch-consolidation-e925746067f5/1b67cd0ee1d52bcf8eb9'

def run(name, prompt, sandbox):
    prompt_path = out / (name+'-prompt.txt')
    prompt_path.write_text(prompt)
    result_path = out / (name+'-result.md')
    argv = ['codex','exec','--ephemeral','-m','gpt-6-astra','-c','model_reasoning_effort="medium"','-c','approval_policy="never"','--sandbox',sandbox,'--color','never','--output-last-message',str(result_path),'-']
    record = {'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'argv':argv,'prompt_sha256':hashlib.sha256(prompt.encode()).hexdigest(),'spec_sha256':hashlib.sha256(spec.read_bytes()).hexdigest()}
    (out/(name+'-dispatch.json')).write_text(json.dumps(record,indent=2)+'\n')
    with (out/(name+'.log')).open('wb') as log:
        r = subprocess.run(argv,input=prompt.encode(),stdout=log,stderr=subprocess.STDOUT)
    record.update(exit_code=r.returncode,completed_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),result_exists=result_path.is_file())
    (out/(name+'-exit.json')).write_text(json.dumps(record,indent=2)+'\n')
    return record

if mode == 'implement':
    spec.write_text(re.sub(r'^status:.*$', 'status: in-progress', spec.read_text(), count=1, flags=re.M))
    prompt = f'Read {spec} fully and implement it — the spec is the sole source of truth. Load every file listed in its frontmatter context: before you start.\n\nWhen done, report what you changed, how you verified it, and anything left incomplete or risky.\n'
    records = [run('implementation', prompt, 'danger-full-access')]
elif mode == 'review':
    import re
    source = spec.read_text()
    baseline = re.search(r"^baseline_commit: ['\"]?([0-9a-f]{40})",source,re.M).group(1)
    content = subprocess.check_output(['git','diff',baseline,'--no-ext-diff','--binary']).decode()
    untracked = subprocess.check_output(['git','ls-files','--others','--exclude-standard','-z']).decode().split('\0')
    included = set()
    for path in filter(None,untracked):
        r = subprocess.run(['git','diff','--no-index','--binary','--','/dev/null',path],stdout=subprocess.PIPE)
        assert r.returncode in (0,1)
        content += r.stdout.decode()
        included.add(path)
    evidence = out/'evidence.md'
    if evidence.is_file() and str(evidence.relative_to(root)) not in included:
        content += '\n\nPARENT-REVIEWABLE EVIDENCE (raw artifacts are retained under the declared owned audit directory and are explicitly admitted with the batch):\n'+evidence.read_text()
    (out/'review-content.diff').write_text(content)
    prompts = {
        'review-blind': 'Conduct a review of CONTENT.\nLook for what\'s missing, not only what\'s wrong.\nFind at least ten issues to fix or improve.\nOutput a Markdown list of findings only — no severity, priority, or ranking.\nIf the content is empty, stop and say so.\nIf you have zero findings, re-check and keep thinking; do not stop with an empty list.\n\nCONTENT:\n'+content+'\n\nDo not invoke any skill. Return only the review result.\n',
        'review-edge': f'Read `{render}/review-prompts/edge-case-hunter.md` completely and follow it as your review instructions.\n\nReview content:\n\n{content}\n\nDo not invoke any skill. If the instruction file is unreadable, report that exact failure and stop. Return only the review result.\n',
        'review-gap': f'Read `{render}/review-prompts/verification-gap.md` completely and follow it as your review instructions.\n\nReview content:\n\n{content}\n\nDo not invoke any skill. If the instruction file is unreadable, report that exact failure and stop. Return only the review result.\n'
    }
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        futures = [executor.submit(run,name,prompt,'read-only') for name,prompt in prompts.items()]
        records = [future.result() for future in futures]
else:
    raise ValueError(mode)
(out/(mode+'-exits.json')).write_text(json.dumps(records,indent=2)+'\n')
print(json.dumps([{'exit':r['exit_code'],'result_exists':r['result_exists']} for r in records]))
sys.exit(any(r['exit_code'] or not r['result_exists'] for r in records))
