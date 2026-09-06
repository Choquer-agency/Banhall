from pathlib import Path
import collections, hashlib, json, re, shlex, subprocess

root = Path(__file__).resolve().parents[2]
ledger = root/'.audit/branch-consolidation/recovery-audit/recovery-ledger.json'
data = json.loads(ledger.read_text())
def git(*args, allowed=(0,)):
    result = subprocess.run(['git',*args],cwd=root,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    assert result.returncode in allowed,(args,result.stderr.decode())
    return result.stdout.decode().strip()
def blob(commit,path):
    result = subprocess.run(['git','rev-parse','--verify',f'{commit}:{path}'],cwd=root,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
    return result.stdout.decode().strip() if result.returncode==0 else None

reachable = {line.split(' ',1)[0] for line in git('rev-list','--objects',data['main']).splitlines()}
counts = collections.Counter()
commands = {}
file_evidence = set()
for branch in data['branches']:
    assert git('rev-parse',branch['branch']) == branch['sha']
    unique = git('rev-list','--reverse',f"{data['main']}..{branch['sha']}").splitlines()
    assert set(unique)==set(branch['uniqueCommits']),branch['branch']
    a,b = map(int,git('rev-list','--left-right','--count',f"{branch['sha']}...{data['main']}").split())
    assert (a,b)==(branch['ahead'],branch['behind'])
for sha,commit in data['commits'].items():
    assert sha==commit['sha']
    assert git('show','-s','--format=%P',sha).split()==commit['parents']
    for path in commit['paths']:
        historical = blob(sha,path['path'])
        main = blob(data['main'],path['path'])
        assert (historical,main)==(path['commitBlob'],path['mainBlob']),(sha,path)
        assert (historical==main)==path['identicalToMain'],(sha,path)
        assert bool(historical and historical in reachable)==path['exactBlobReachableInMainHistory'],(sha,path)
        counts['path_blob_checks'] += 1
    for evidence in commit['evidence']:
        if evidence.startswith('git '):
            argv=shlex.split(evidence)
            assert argv[:2]==['git','cherry'] and len(argv)==4
            result=git(*argv[1:])
            assert any(line==f'- {sha}' for line in result.splitlines()),(sha,evidence,result)
            commands[evidence]=result
        elif re.fullmatch('[0-9a-f]{7,40}',evidence):
            assert git('rev-parse','--verify',evidence+'^{commit}')
        else:
            match=re.fullmatch(r'(.+?)(?::(\d+)(?:-\d+)?)?',evidence)
            p=root/match[1]
            assert p.is_file(),evidence
            if match[2]:
                assert len(p.read_text().splitlines()) >= int(match[2]),evidence
            file_evidence.add(str(p.relative_to(root)))
    counts[commit['classification']]+=1
result={'ledger_sha256':hashlib.sha256(ledger.read_bytes()).hexdigest(),'baseline':data['main'],'branches_checked':len(data['branches']),'unique_commits_checked':len(data['commits']),'counts':dict(counts),'file_evidence_checked':len(file_evidence),'cherry_proofs':commands,'limitations':'Structural and source-identity verification complements independent semantic review. B11 integration is still required; this is not merge admission.'}
(ledger.parent/'root-verification.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k!='cherry_proofs'}))
