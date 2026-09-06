from pathlib import Path
import collections, functools, hashlib, json, subprocess

root=Path(__file__).resolve().parents[2]
path=root/'.audit/branch-consolidation/factory-audit/full-history-disposition.json'
data=json.loads(path.read_text())
def git(*args):
    return subprocess.check_output(['git',*args],cwd=root)
@functools.lru_cache(maxsize=6)
def tree(sha):
    result={}
    for row in git('ls-tree','-rz',sha).split(b'\0'):
        if not row: continue
        info,name=row.split(b'\t',1)
        mode,kind,blob=info.decode().split()
        result[name.decode()]={'mode':mode,'kind':kind,'blob':blob}
    return result

union=set()
for ref,sha in data['capturedTips'].items():
    assert git('rev-parse',ref).decode().strip()==sha
    union.update(git('rev-list',sha,'--not',data['baseline']).decode().splitlines())
assert union=={r['sha'] for r in data['commits']}
counts=collections.Counter()
for row in data['commits']:
    sha=row['sha'];parents=git('show','-s','--format=%P',sha).decode().split()
    assert parents==row['parents']
    actual=tree(sha);first=tree(parents[0]);baseline=tree(data['baseline']);snapshot=tree(data['currentCommitSnapshot'])
    changed={p for p in actual.keys()|first.keys() if actual.get(p)!=first.get(p)}
    assert changed=={p['path'] for p in row['changedPaths']},(sha,changed-{p['path'] for p in row['changedPaths']})
    for p in row['changedPaths']:
        name=p['path'];a=actual.get(name);b=first.get(name)
        assert p['commitBlob']==(a['blob'] if a else None),(sha,p)
        assert p['parentBlob']==(b['blob'] if b else None),(sha,p)
        assert p['baseline']==baseline.get(name),(sha,p)
        assert p['currentSnapshot']==snapshot.get(name),(sha,p)
        counts['path_records_verified']+=1
    counts['commits_verified']+=1
for relative,sha in data['sourceArtifactSha256'].items():
    p=root/'.audit/branch-consolidation'/relative
    assert hashlib.sha256(p.read_bytes()).hexdigest()==sha,relative
result={'ledger_sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'captured_commit_union_verified':len(union),'counts':dict(counts),'all_declared_source_artifact_hashes_match':True,'limits':'Structural identity verification only. Independent semantic review remains complementary; planned batches still require implementation/review/runtime proof.'}
(path.parent/'root-full-history-verification.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
